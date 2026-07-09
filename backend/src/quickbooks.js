require('dotenv').config();
const OAuthClient = require('intuit-oauth');
const { pool } = require('./db');

// Lazy-initialized client so env vars are guaranteed to be loaded
let _oauthClient = null;
function getOAuthClient() {
  if (!_oauthClient) {
    _oauthClient = new OAuthClient({
      clientId: process.env.QB_CLIENT_ID,
      clientSecret: process.env.QB_CLIENT_SECRET,
      environment: process.env.QB_ENVIRONMENT || 'sandbox',
      redirectUri: process.env.QB_REDIRECT_URI,
    });
    console.log('OAuthClient initialized with clientId:', process.env.QB_CLIENT_ID ? '✓ present' : '✗ MISSING');
  }
  return _oauthClient;
}

// Keep oauthClient as a named export for backward compat with app.js
const oauthClient = new Proxy({}, {
  get(target, prop) {
    const client = getOAuthClient();
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
  set(target, prop, value) {
    const client = getOAuthClient();
    client[prop] = value;
    return true;
  }
});


/**
 * Retrieves the current QuickBooks connection, automatically refreshing the access token if it has expired.
 * Returns { accessToken, realmId }
 */
async function getValidToken(forceRefresh = false) {
  try {
    const result = await pool.query("SELECT access_token, refresh_token, realm_id, expires_at FROM oauth_tokens WHERE provider = 'quickbooks'");
    if (result.rows.length === 0) {
      throw new Error('QuickBooks is not connected. Please connect via the dashboard first.');
    }

    const { access_token, refresh_token, realm_id, expires_at } = result.rows[0];
    
    // Check if expired (with a 5-minute safety margin) or forced refresh
    const safetyMargin = 5 * 60 * 1000;
    const isExpired = forceRefresh || (new Date(expires_at).getTime() - safetyMargin < Date.now());

    if (!isExpired) {
      return { accessToken: access_token, realmId: realm_id };
    }

    console.log(`QuickBooks Access Token expiration check failed (expired: ${isExpired}). Initiating background token refresh...`);

    // Set the old tokens in the intuit client for the refresh call
    oauthClient.setToken({
      access_token: access_token,
      refresh_token: refresh_token,
    });

    // Refresh the tokens
    const authResponse = await oauthClient.refresh();
    const freshToken = authResponse.getJson();

    const newExpiresAt = new Date(Date.now() + freshToken.expires_in * 1000);
    const newRefreshExpiresAt = new Date(Date.now() + freshToken.x_refresh_token_expires_in * 1000);

    // Save back in local PostgreSQL database
    const upsertQuery = `
      INSERT INTO oauth_tokens (provider, access_token, refresh_token, realm_id, expires_at, refresh_expires_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (provider) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        refresh_expires_at = EXCLUDED.refresh_expires_at,
        updated_at = CURRENT_TIMESTAMP;
    `;
    await pool.query(upsertQuery, [
      'quickbooks',
      freshToken.access_token,
      freshToken.refresh_token,
      realm_id,
      newExpiresAt,
      newRefreshExpiresAt,
    ]);

    console.log('QuickBooks token successfully refreshed and saved in PostgreSQL.');
    return { accessToken: freshToken.access_token, realmId: realm_id };
  } catch (err) {
    console.error('Failed to validate/refresh QuickBooks token:', err.message);
    throw err;
  }
}

/**
 * Generic request helper for QuickBooks API.
 * Automatically handles token verification, auto-refresh on 401,
 * and rate limit retries (429) with exponential backoff.
 */
async function requestQBO(path, options = {}, retriesLeft = 3, backoffMs = 1000, forceRefresh = false) {
  const { accessToken, realmId } = await getValidToken(forceRefresh);
  const baseUrl = process.env.QB_ENVIRONMENT === 'production' 
    ? 'https://quickbooks.api.intuit.com' 
    : 'https://sandbox-quickbooks.api.intuit.com';
    
  const url = `${baseUrl}/v3/company/${realmId}/${path}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    // Handle 401 Unauthorized by forcing token refresh once
    if (response.status === 401 && !forceRefresh) {
      console.warn('QuickBooks API returned 401 Unauthorized. Retrying with a forced token refresh...');
      return requestQBO(path, options, retriesLeft, backoffMs, true);
    }
    
    // Handle 429 Too Many Requests (Rate limit)
    if (response.status === 429 && retriesLeft > 0) {
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoffMs;
      console.warn(`QuickBooks API rate limited (429). Retrying in ${delay}ms... (${retriesLeft} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return requestQBO(path, options, retriesLeft - 1, backoffMs * 2, forceRefresh);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks API returned status ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (err) {
    if (retriesLeft > 0 && (!err.status || err.status !== 401) && (!err.message || !err.message.includes('status 40'))) {
      console.warn(`Network error calling QuickBooks API: ${err.message}. Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return requestQBO(path, options, retriesLeft - 1, backoffMs * 2, forceRefresh);
    }
    throw err;
  }
}

/**
 * Fetches single invoice details from QuickBooks Online API.
 */
async function fetchInvoice(invoiceId) {
  const data = await requestQBO(`invoice/${invoiceId}?minorversion=65`);
  return data.Invoice;
}

/**
 * Queries QuickBooks Online for unpaid invoices where the DueDate is in the past.
 * Returns an array of invoices.
 */
async function fetchOverdueInvoices() {
  const todayStr = new Date().toISOString().split('T')[0];
  const query = `SELECT * FROM Invoice WHERE Balance > '0' AND DueDate < '${todayStr}'`;
  const data = await requestQBO(`query?query=${encodeURIComponent(query)}&minorversion=65`);
  return (data.QueryResponse && data.QueryResponse.Invoice) || [];
}

/**
 * Queries QuickBooks Online for all invoices, using pagination to fetch all pages.
 * Returns an array of invoices.
 */
async function fetchAllInvoices() {
  let allInvoices = [];
  let startPosition = 1;
  const maxResults = 100;
  let hasMore = true;

  console.log('[QuickBooks] Starting fetch of all invoices from QBO...');

  while (hasMore) {
    const query = `SELECT * FROM Invoice STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const data = await requestQBO(`query?query=${encodeURIComponent(query)}&minorversion=65`);
    const invoices = (data.QueryResponse && data.QueryResponse.Invoice) || [];
    
    allInvoices = allInvoices.concat(invoices);
    console.log(`[QuickBooks] Fetched ${invoices.length} invoices (Total so far: ${allInvoices.length})`);

    if (invoices.length < maxResults) {
      hasMore = false;
    } else {
      startPosition += maxResults;
    }
  }

  console.log(`[QuickBooks] Successfully fetched all ${allInvoices.length} invoices.`);
  return allInvoices;
}

module.exports = {
  oauthClient,
  getValidToken,
  requestQBO,
  fetchInvoice,
  fetchOverdueInvoices,
  fetchAllInvoices,
};
