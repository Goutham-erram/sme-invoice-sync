// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.QB_VERIFIER_TOKEN = 'test-verifier-token';
process.env.PORT = '5002';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/sme_sync'; // mock safe

const crypto = require('crypto');
const assert = require('assert');

// Mock database connection
const db = require('./db');
db.initDb = async () => {
  console.log('[Mock] initDb called - skipped');
};
db.pool = {
  query: async () => ({ rows: [] }),
  connect: async () => ({
    query: async () => {},
    release: () => {}
  })
};

const quickbooks = require('./quickbooks');
const sheets = require('./sheets');

let fetchInvoiceCallCount = 0;
let syncToGoogleSheetsCalls = [];
let mockInvoiceResult = {
  DocNumber: '1001',
  CustomerRef: { name: 'Acme Corp' },
  TotalAmt: 100.00,
  DueDate: '2026-06-30',
  Balance: '100.00',
  CurrencyRef: { value: 'CAD' },
  ExchangeRate: 1.35,
  HomeTotalAmt: 135.00,
  BillEmail: { Address: 'billing@acme.com' }
};

quickbooks.getValidToken = async () => {
  return { accessToken: 'mock-access-token', realmId: 'mock-realm' };
};

quickbooks.fetchInvoice = async (id) => {
  fetchInvoiceCallCount++;
  return mockInvoiceResult;
};

sheets.syncToGoogleSheets = async (action, data) => {
  syncToGoogleSheetsCalls.push({ action, data });
  return { success: true };
};

// Start the express server
const app = require('./app');

// Helper to make local POST requests
async function sendWebhookRequest(payload, signature) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
  };
  if (signature) {
    headers['intuit-signature'] = signature;
  }
  
  const response = await fetch('http://localhost:5002/api/webhook/quickbooks', {
    method: 'POST',
    headers,
    body
  });
  return response;
}

// Generate valid signature
function getSignature(payload) {
  return crypto
    .createHmac('sha256', 'test-verifier-token')
    .update(JSON.stringify(payload))
    .digest('base64');
}

async function runTests() {
  console.log('--- RUNNING WEBHOOK AND EDGE CASE TESTS ---');
  
  try {
    // Wait a brief moment for Express to bind
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test Case 1: Missing signature
    {
      const payload = { test: true };
      const res = await sendWebhookRequest(payload, null);
      assert.strictEqual(res.status, 401, 'Should return 401 for missing signature');
      const text = await res.text();
      assert.strictEqual(text, 'Missing signature');
      console.log('✓ Case 1: Missing signature rejected successfully.');
    }

    // Test Case 2: Invalid signature
    {
      const payload = { test: true };
      const res = await sendWebhookRequest(payload, 'bad-signature');
      assert.strictEqual(res.status, 401, 'Should return 401 for invalid signature');
      const text = await res.text();
      assert.strictEqual(text, 'Invalid signature');
      console.log('✓ Case 2: Invalid signature rejected successfully.');
    }

    // Test Case 3: Legacy Payload (Create Event)
    {
      fetchInvoiceCallCount = 0;
      syncToGoogleSheetsCalls = [];
      mockInvoiceResult.Balance = '100.00';
      
      const payload = {
        eventNotifications: [
          {
            realmId: '123456',
            dataChangeEvent: {
              entities: [
                {
                  name: 'Invoice',
                  id: '1001',
                  operation: 'Create'
                }
              ]
            }
          }
        ]
      };
      
      const sig = getSignature(payload);
      const res = await sendWebhookRequest(payload, sig);
      assert.strictEqual(res.status, 200, 'Should return 200 for valid legacy payload');
      assert.strictEqual(fetchInvoiceCallCount, 1, 'Should fetch invoice details');
      assert.strictEqual(syncToGoogleSheetsCalls.length, 1, 'Should sync once');
      assert.strictEqual(syncToGoogleSheetsCalls[0].action, 'create');
      assert.strictEqual(syncToGoogleSheetsCalls[0].data.currency, 'CAD');
      assert.strictEqual(syncToGoogleSheetsCalls[0].data.exchangeRate, 1.35);
      console.log('✓ Case 3: Legacy Create Webhook processed successfully with multi-currency.');
    }

    // Test Case 4: CloudEvents Payload (Update Event to Paid)
    {
      fetchInvoiceCallCount = 0;
      syncToGoogleSheetsCalls = [];
      mockInvoiceResult.Balance = '0.00'; // Marked as paid
      
      const payload = [
        {
          specversion: '1.0',
          id: 'evt-123',
          type: 'qbo.invoice.updated.v1',
          intuitentityid: '1001',
          intuitaccountid: '123456',
          time: new Date().toISOString()
        }
      ];
      
      const sig = getSignature(payload);
      const res = await sendWebhookRequest(payload, sig);
      assert.strictEqual(res.status, 200, 'Should return 200 for valid CloudEvents payload');
      assert.strictEqual(fetchInvoiceCallCount, 1, 'Should fetch invoice details');
      assert.strictEqual(syncToGoogleSheetsCalls.length, 1, 'Should sync once');
      assert.strictEqual(syncToGoogleSheetsCalls[0].action, 'pay');
      console.log('✓ Case 4: CloudEvents Update (Paid) Webhook processed successfully.');
    }

    // Test Case 5: Delete Event (Should not fetch invoice)
    {
      fetchInvoiceCallCount = 0;
      syncToGoogleSheetsCalls = [];
      
      const payload = {
        eventNotifications: [
          {
            realmId: '123456',
            dataChangeEvent: {
              entities: [
                {
                  name: 'Invoice',
                  id: '9999',
                  operation: 'Delete'
                }
              ]
            }
          }
        ]
      };
      
      const sig = getSignature(payload);
      const res = await sendWebhookRequest(payload, sig);
      assert.strictEqual(res.status, 200, 'Should return 200 for valid delete payload');
      assert.strictEqual(fetchInvoiceCallCount, 0, 'Should NOT fetch invoice for delete operations');
      assert.strictEqual(syncToGoogleSheetsCalls.length, 1, 'Should sync once');
      assert.strictEqual(syncToGoogleSheetsCalls[0].action, 'delete');
      assert.strictEqual(syncToGoogleSheetsCalls[0].data.invoiceId, '9999');
      console.log('✓ Case 5: Invoice deletion edge case processed successfully.');
    }

    console.log('\n--- ALL TESTS PASSED SUCCESSFULLY ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
