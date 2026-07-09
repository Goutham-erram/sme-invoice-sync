/**
 * Dispatches a sync payload to the Google Sheets Apps Script Web App.
 * @param {string} action - 'create', 'pay', or 'overdue'
 * @param {object} invoice - { invoiceId, customer, amount, dueDate }
 */
async function syncToGoogleSheets(action, invoice) {
  const url = (process.env.GOOGLE_SHEETS_WEB_APP_URL || '').trim();
  if (!url || url.includes('your_google_sheets_web_app_url')) {
    console.warn('Google Sheets Web App URL is not configured in .env. Skipping sheets sync.');
    return { success: false, error: 'Web App URL not configured.' };
  }

  const payload = {
    action: action,
    invoiceId: invoice.invoiceId,
    customer: invoice.customer,
    amount: invoice.amount,
    dueDate: invoice.dueDate,
    balance: invoice.balance,
    currency: invoice.currency || 'USD',
    exchangeRate: invoice.exchangeRate || 1,
    homeAmount: invoice.homeAmount || invoice.amount,
  };

  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // Apps Script requires text/plain to avoid CORS preflight
    body: JSON.stringify(payload),
    redirect: 'follow',
  };

  try {
    console.log(`Sending '${action}' action payload for Invoice #${invoice.invoiceId} to Google Sheets...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'manual', // Don't auto-follow — we handle it ourselves
    });

    // Google Apps Script executes the script THEN returns a 302.
    // The 302 means the script ran successfully — data is already written.
    // We do NOT re-POST to the redirect (it's a Google Docs URL that rejects POST with 405).
    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        console.log(`Following Google Sheets redirect to check response: ${redirectUrl}`);
        const redirectResponse = await fetch(redirectUrl);
        const text = await redirectResponse.text();
        try {
          const result = JSON.parse(text);
          console.log('Google Sheets sync result:', result);
          return result;
        } catch (_) {
          console.log('Google Sheets sync successful (non-JSON redirect body).');
          return { success: true, message: 'Invoice synced to Google Sheets.', raw: text };
        }
      }
      console.log(`Google Sheets sync successful (Apps Script returned ${response.status} after execution).`);
      return { success: true, message: 'Invoice synced to Google Sheets.' };
    }

    const text = await response.text();
    console.log('Google Sheets raw response:', text.substring(0, 300));

    if (!response.ok) {
      throw new Error(`Google Sheets returned HTTP ${response.status}: ${text.substring(0, 300)}`);
    }

    try {
      const result = JSON.parse(text);
      console.log('Google Sheets sync successful:', result);
      return result;
    } catch (_) {
      throw new Error(`Google Sheets returned non-JSON: ${text.substring(0, 300)}`);
    }
  } catch (err) {
    console.error('Failed to sync data to Google Sheets:', err.message);
    throw err;
  }
}

/**
 * Dispatches a list of invoices to the Google Sheets Apps Script Web App for bulk synchronization.
 * @param {Array} invoices - Array of invoice objects: { invoiceId, customer, amount, dueDate, balance, currency, exchangeRate, homeAmount }
 */
async function bulkSyncToGoogleSheets(invoices) {
  const url = (process.env.GOOGLE_SHEETS_WEB_APP_URL || '').trim();
  if (!url || url.includes('your_google_sheets_web_app_url')) {
    console.warn('Google Sheets Web App URL is not configured in .env. Skipping bulk sheets sync.');
    return { success: false, error: 'Web App URL not configured.' };
  }

  const payload = {
    action: 'bulk_sync',
    invoices: invoices.map(invoice => ({
      invoiceId: invoice.invoiceId,
      customer: invoice.customer,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      balance: invoice.balance,
      currency: invoice.currency || 'USD',
      exchangeRate: invoice.exchangeRate || 1,
      homeAmount: invoice.homeAmount || invoice.amount,
    }))
  };

  try {
    console.log(`Sending bulk sync payload with ${invoices.length} invoices to Google Sheets...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        console.log(`Following Google Sheets bulk redirect to check response: ${redirectUrl}`);
        const redirectResponse = await fetch(redirectUrl);
        const text = await redirectResponse.text();
        try {
          const result = JSON.parse(text);
          console.log('Google Sheets bulk sync result:', result);
          return result;
        } catch (_) {
          console.log('Google Sheets bulk sync successful (non-JSON redirect body).');
          return { success: true, message: `Successfully bulk synced ${invoices.length} invoices.`, raw: text };
        }
      }
      console.log(`Google Sheets bulk sync successful (Apps Script returned ${response.status}).`);
      return { success: true, message: `Successfully bulk synced ${invoices.length} invoices.` };
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Google Sheets returned HTTP ${response.status}: ${text.substring(0, 300)}`);
    }

    try {
      const result = JSON.parse(text);
      console.log('Google Sheets bulk sync successful:', result);
      return result;
    } catch (_) {
      throw new Error(`Google Sheets returned non-JSON: ${text.substring(0, 300)}`);
    }
  } catch (err) {
    console.error('Failed to bulk sync data to Google Sheets:', err.message);
    throw err;
  }
}

module.exports = {
  syncToGoogleSheets,
  bulkSyncToGoogleSheets,
};
