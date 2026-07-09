require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const OAuthClient = require('intuit-oauth');
const { pool, initDb } = require('./db');
const { oauthClient, getValidToken, fetchInvoice, fetchOverdueInvoices, fetchAllInvoices } = require('./quickbooks');
const { syncToGoogleSheets, bulkSyncToGoogleSheets } = require('./sheets');
const { sendOverdueReminderEmail } = require('./email');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize database tables on startup
initDb();

// Route: Redirect user to QuickBooks consent screen
app.get('/api/auth/quickbooks', (req, res) => {
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: 'sme-sync-state',
  });
  res.redirect(authUri);
});

// Route: Callback receiver from QuickBooks auth redirect
app.get('/api/auth/quickbooks/callback', async (req, res) => {
  try {
    const authResponse = await oauthClient.createToken(req.url);
    const token = authResponse.getJson();
    
    const realmId = req.query.realmId;
    
    // Calculate token expiration date
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const refreshExpiresAt = new Date(Date.now() + token.x_refresh_token_expires_in * 1000);

    // Save tokens in local PostgreSQL database
    const upsertQuery = `
      INSERT INTO oauth_tokens (provider, access_token, refresh_token, realm_id, expires_at, refresh_expires_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (provider) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        realm_id = EXCLUDED.realm_id,
        expires_at = EXCLUDED.expires_at,
        refresh_expires_at = EXCLUDED.refresh_expires_at,
        updated_at = CURRENT_TIMESTAMP;
    `;
    
    await pool.query(upsertQuery, [
      'quickbooks',
      token.access_token,
      token.refresh_token,
      realmId,
      expiresAt,
      refreshExpiresAt,
    ]);

    console.log('Successfully saved QuickBooks tokens in database.');
    
    // Redirect back to frontend Next.js application
    res.redirect('http://localhost:3000/?qb_connected=true');
  } catch (error) {
    console.error('Error during QuickBooks callback:', error.message);
    res.status(500).json({ error: 'Authentication failed', details: error.message });
  }
});

// Route: Check QuickBooks connection status
app.get('/api/auth/quickbooks/status', async (req, res) => {
  try {
    const result = await pool.query("SELECT expires_at FROM oauth_tokens WHERE provider = 'quickbooks'");
    if (result.rows.length === 0) {
      return res.json({ connected: false });
    }
    
    const token = result.rows[0];
    const isExpired = new Date(token.expires_at) < new Date();
    
    res.json({ 
      connected: !isExpired,
      expired: isExpired 
    });
  } catch (error) {
    console.error('Error checking connection status:', error.message);
    res.status(500).json({ error: 'Failed to retrieve connection status' });
  }
});

// Route: Live Webhook Receiver from QuickBooks Online
app.post('/api/webhook/quickbooks', async (req, res) => {
  const verifierToken = process.env.QB_VERIFIER_TOKEN;
  
  if (verifierToken) {
    const signature = req.headers['intuit-signature'];
    if (!signature) {
      console.warn('Webhook received but missing "intuit-signature" header.');
      return res.status(401).send('Missing signature');
    }
    
    const hash = crypto
      .createHmac('sha256', verifierToken)
      .update(req.rawBody || '')
      .digest('base64');
      
    if (hash !== signature) {
      console.warn('Webhook received but signature check failed.');
      return res.status(401).send('Invalid signature');
    }
  }

  try {
    const payload = req.rawBody ? JSON.parse(req.rawBody.toString()) : {};
    console.log('Valid QuickBooks webhook event received:', JSON.stringify(payload));
    
    const events = [];
    
    if (payload.eventNotifications) {
      // Legacy format
      for (const notification of payload.eventNotifications) {
        const realmId = notification.realmId;
        if (notification.dataChangeEvent && notification.dataChangeEvent.entities) {
          for (const entity of notification.dataChangeEvent.entities) {
            events.push({
              entityId: entity.id,
              entityName: entity.name,
              operation: entity.operation, // 'Create', 'Update', 'Delete', 'Void'
              realmId: realmId
            });
          }
        }
      }
    } else if (Array.isArray(payload)) {
      // CloudEvents format
      for (const event of payload) {
        const parts = (event.type || '').split('.');
        if (parts.length >= 3 && parts[0] === 'qbo') {
          const entityNameRaw = parts[1]; // e.g. "invoice"
          const actionRaw = parts[2]; // e.g. "created", "updated", "deleted", "voided"
          
          const entityName = entityNameRaw.charAt(0).toUpperCase() + entityNameRaw.slice(1);
          
          let operation = 'Update';
          if (actionRaw === 'created') operation = 'Create';
          else if (actionRaw === 'updated') operation = 'Update';
          else if (actionRaw === 'deleted') operation = 'Delete';
          else if (actionRaw === 'voided') operation = 'Void';
          
          events.push({
            entityId: event.intuitentityid,
            entityName: entityName,
            operation: operation,
            realmId: event.intuitaccountid
          });
        }
      }
    }

    console.log(`Extracted ${events.length} events from webhook payload.`);

    for (const event of events) {
      // Only process Invoice entities — skip Customer, Payment, etc.
      if (event.entityName !== 'Invoice') {
        console.log(`Skipping non-Invoice entity: ${event.entityName} (${event.operation})`);
        continue;
      }

      // Skip informational-only operations that don't change invoice state
      if (event.operation === 'Emailed') {
        console.log(`Skipping 'Emailed' operation for Invoice ID ${event.entityId} — no sheet update needed.`);
        continue;
      }

      console.log(`Processing webhook trigger for Invoice ID ${event.entityId} (${event.operation})...`);
        
      if (event.operation === 'Delete') {
        // Deletion edge case: invoice cannot be fetched from QBO once deleted
        await syncToGoogleSheets('delete', {
          invoiceId: event.entityId,
          customer: 'N/A',
          amount: 0,
          dueDate: 'N/A',
          balance: 0,
          currency: 'USD',
          exchangeRate: 1,
          homeAmount: 0,
        });
      } else {
        // Fetch full invoice details from QuickBooks API
        const invoice = await fetchInvoice(event.entityId);
        
        const invoiceData = {
          invoiceId: invoice.DocNumber || event.entityId,
          customer: invoice.CustomerRef.name,
          amount: invoice.TotalAmt,
          dueDate: invoice.DueDate,
          balance: invoice.Balance,
          currency: invoice.CurrencyRef ? invoice.CurrencyRef.value : 'USD',
          exchangeRate: invoice.ExchangeRate || 1,
          homeAmount: invoice.HomeTotalAmt || invoice.TotalAmt,
          customerEmail: invoice.BillEmail ? invoice.BillEmail.Address : null
        };

        if (event.operation === 'Create') {
          await syncToGoogleSheets('create', invoiceData);
        } else if (event.operation === 'Update') {
          if (Number(invoice.Balance) === 0) {
            await syncToGoogleSheets('pay', invoiceData);
          } else {
            await syncToGoogleSheets('update', invoiceData);
          }
        } else if (event.operation === 'Void') {
          await syncToGoogleSheets('void', invoiceData);
        } else {
          console.log(`Unhandled operation type '${event.operation}' for Invoice ID ${event.entityId}. Skipping.`);
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling QuickBooks webhook:', error.message);
    res.status(500).send('Internal server error processing webhook');
  }
});

// Route: Local testing route to manually trigger invoice sync by ID
app.get('/api/test/sync-invoice', async (req, res) => {
  const invoiceId = req.query.id;
  if (!invoiceId) {
    return res.status(400).json({ error: 'Missing required query parameter "id"' });
  }
  
  try {
    console.log(`Starting simulated sync for QuickBooks Invoice ID: ${invoiceId}...`);
    
    // 1. Fetch full invoice details from QuickBooks Sandbox
    const invoice = await fetchInvoice(invoiceId);
    
    // 2. Extract relevant fields (with multi-currency fields)
    const invoiceData = {
      invoiceId: invoice.DocNumber || invoiceId,
      customer: invoice.CustomerRef.name,
      amount: invoice.TotalAmt,
      dueDate: invoice.DueDate,
      balance: invoice.Balance,
      currency: invoice.CurrencyRef ? invoice.CurrencyRef.value : 'USD',
      exchangeRate: invoice.ExchangeRate || 1,
      homeAmount: invoice.HomeTotalAmt || invoice.TotalAmt,
      customerEmail: invoice.BillEmail ? invoice.BillEmail.Address : null
    };
    
    // Determine action based on Balance
    const action = Number(invoice.Balance) === 0 ? 'pay' : 'create';
    
    // 3. Dispatch to Google Sheets Apps Script endpoint
    const result = await syncToGoogleSheets(action, invoiceData);
    
    res.json({
      success: true,
      message: `Successfully processed invoice ID ${invoiceId} and synced to Google Sheets.`,
      actionTriggered: action,
      quickbooksInvoice: invoiceData,
      googleSheetsResult: result,
    });
  } catch (error) {
    console.error('Error during manual sync simulation:', error.message);
    res.status(500).json({ error: 'Sync simulation failed', details: error.message });
  }
});

// Helper: Runs a scan of overdue invoices, updates sheets, and sends email reminders
async function runOverdueScan() {
  console.log('[Scheduler] Initiating scan for overdue invoices...');
  try {
    // 1. Fetch all unpaid past-due invoices from QuickBooks Online
    const overdueInvoices = await fetchOverdueInvoices();
    console.log(`[Scheduler] Found ${overdueInvoices.length} overdue invoices to process.`);

    const results = [];

    // 2. Process each overdue invoice
    for (const invoice of overdueInvoices) {
      const invoiceData = {
        invoiceId: invoice.DocNumber || invoice.Id,
        customer: invoice.CustomerRef.name,
        amount: invoice.TotalAmt,
        dueDate: invoice.DueDate,
        balance: invoice.Balance,
        currency: invoice.CurrencyRef ? invoice.CurrencyRef.value : 'USD',
        exchangeRate: invoice.ExchangeRate || 1,
        homeAmount: invoice.HomeTotalAmt || invoice.TotalAmt,
        customerEmail: invoice.BillEmail ? invoice.BillEmail.Address : null
      };

      console.log(`[Scheduler] Processing overdue invoice #${invoiceData.invoiceId} for ${invoiceData.customer}...`);

      let sheetSynced = false;
      let emailSent = false;
      let error = null;

      try {
        // Step A: Flag in Google Sheets
        await syncToGoogleSheets('overdue', invoiceData);
        sheetSynced = true;
      } catch (err) {
        console.error(`[Scheduler] Google Sheets sync failed for Invoice #${invoiceData.invoiceId}:`, err.message);
        error = `Sheets Sync Error: ${err.message}`;
      }

      try {
        // Step B: Send Email Reminder via Gmail
        if (invoiceData.customerEmail) {
          await sendOverdueReminderEmail(invoiceData);
          emailSent = true;
        } else {
          console.warn(`[Scheduler] No customer email available for Invoice #${invoiceData.invoiceId}. Skipping email reminder.`);
          error = error ? `${error}; Missing email` : 'Missing customer email';
        }
      } catch (err) {
        console.error(`[Scheduler] Email reminder failed for Invoice #${invoiceData.invoiceId}:`, err.message);
        error = error ? `${error}; Email Error: ${err.message}` : `Email Error: ${err.message}`;
      }

      results.push({
        invoiceId: invoiceData.invoiceId,
        customer: invoiceData.customer,
        sheetSynced,
        emailSent,
        error
      });
    }

    console.log('[Scheduler] Overdue scan completed successfully.');
    return { success: true, processedCount: overdueInvoices.length, results };
  } catch (error) {
    console.error('[Scheduler] Critical error running overdue scan:', error.message);
    throw error;
  }
}

// Route: Local testing route to manually trigger overdue invoice scan
app.get('/api/test/scan-overdue', async (req, res) => {
  try {
    const scanResult = await runOverdueScan();
    res.json({
      success: true,
      message: 'Manually triggered overdue scan completed.',
      ...scanResult
    });
  } catch (error) {
    console.error('Error during manual overdue scan:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Manually triggered overdue scan failed', 
      details: error.message 
    });
  }
});

// Route: Fetch all invoices from QuickBooks Online and bulk sync to Google Sheets
app.get('/api/sync/bulk', async (req, res) => {
  try {
    console.log('[Bulk Sync] Initiating bulk sync of all QuickBooks invoices to Google Sheets...');
    
    // 1. Fetch all invoices from QuickBooks
    const invoices = await fetchAllInvoices();
    
    if (invoices.length === 0) {
      return res.json({
        success: true,
        message: 'No invoices found in QuickBooks Online to sync.',
        count: 0
      });
    }
    
    // 2. Map QuickBooks invoices to Sheets format
    const formattedInvoices = invoices.map(invoice => ({
      invoiceId: invoice.DocNumber || invoice.Id,
      customer: invoice.CustomerRef.name,
      amount: invoice.TotalAmt,
      dueDate: invoice.DueDate,
      balance: invoice.Balance,
      currency: invoice.CurrencyRef ? invoice.CurrencyRef.value : 'USD',
      exchangeRate: invoice.ExchangeRate || 1,
      homeAmount: invoice.HomeTotalAmt || invoice.TotalAmt,
      customerEmail: invoice.BillEmail ? invoice.BillEmail.Address : null
    }));
    
    // 3. Dispatch bulk payload to Google Sheets
    const result = await bulkSyncToGoogleSheets(formattedInvoices);
    
    res.json({
      success: true,
      message: `Successfully processed and queued bulk sync for ${invoices.length} invoices.`,
      count: invoices.length,
      sheetsResult: result
    });
  } catch (error) {
    console.error('[Bulk Sync] Error during bulk sync:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Bulk sync failed', 
      details: error.message 
    });
  }
});

// Schedule daily scan at 03:10 PM EST
cron.schedule('10 15 * * *', async () => {
  try {
    await runOverdueScan();
  } catch (err) {
    console.error('[Scheduler] Cron job failed:', err.message);
  }
}, {
  scheduled: true,
  timezone: "America/New_York"
});
console.log('[Scheduler] Daily overdue scan scheduled for 03:10 PM (America/New_York timezone).');

// Health Check route
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date(),
    service: 'SME Invoice Sync Backend'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

