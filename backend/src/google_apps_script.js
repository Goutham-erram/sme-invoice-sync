/**
 * Google Apps Script for SME Invoice Sync — V4 (Safe Batch Edition)
 *
 * Instructions:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Replace ALL code with this script. Save (floppy disk).
 * 3. Deploy -> New deployment -> Web app -> Execute as: Me -> Access: Anyone -> Deploy.
 * 4. Copy the new Web App URL into backend `.env` as GOOGLE_SHEETS_WEB_APP_URL.
 * 5. Restart backend: docker compose restart backend
 */

var HEADERS = [
  "Invoice ID", "Customer Name", "Invoice Amount", "Due Date",
  "Currency", "Exchange Rate", "Home Currency Amount", "Status", "Last Synced At"
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "No post data received." });
    }
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    ensureHeaders(sheet);

    if (data.action === 'bulk_sync') {
      return jsonResponse(processBulkSync(sheet, data.invoices));
    } else {
      return jsonResponse(processSingleInvoice(sheet, data));
    }
  } catch (error) {
    return jsonResponse({ success: false, error: error.message, stack: error.stack });
  }
}

function doGet(e) {
  return jsonResponse({ status: "UP", message: "SME Apps Script V4 is running." });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------
// Ensure header row exists
// -------------------------------------------------------
function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0f172a");
    headerRange.setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();
  }
}

// -------------------------------------------------------
// Safely convert any value to a Sheets-safe scalar
// -------------------------------------------------------
function safe(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' && isNaN(v)) return '';
  if (typeof v === 'object') return '';
  return v;
}

// -------------------------------------------------------
// Build a safe 9-element row array
// -------------------------------------------------------
function buildRow(invoiceId, customer, amount, dueDate, currency, exchangeRate, homeAmount, status, nowStr) {
  return [
    safe(invoiceId),
    safe(customer),
    safe(amount) === '' ? 0 : Number(amount),
    safe(dueDate),
    safe(currency) || 'USD',
    safe(exchangeRate) === '' ? 1 : Number(exchangeRate),
    safe(homeAmount) === '' ? (safe(amount) === '' ? 0 : Number(amount)) : Number(homeAmount),
    safe(status),
    safe(nowStr)
  ];
}

// -------------------------------------------------------
// Determine status for single invoice
// -------------------------------------------------------
function resolveStatus(action, balance, dueDate) {
  if (action === 'pay') return "Paid";
  if (action === 'overdue') return "Overdue";
  if (action === 'void') return "Voided";
  if (action === 'delete') return "Deleted";
  if (balance !== undefined && balance !== null && Number(balance) === 0) return "Paid";
  if (!dueDate) return "Open";
  var today = new Date(); today.setHours(0,0,0,0);
  var due = new Date(dueDate); due.setHours(0,0,0,0);
  return due < today ? "Overdue" : "Open";
}

// -------------------------------------------------------
// Determine status for bulk (no action field per invoice)
// -------------------------------------------------------
function resolveStatusBulk(balance, dueDate, today) {
  if (balance !== undefined && balance !== null && !isNaN(Number(balance)) && Number(balance) === 0) return "Paid";
  if (!dueDate) return "Open";
  var due = new Date(dueDate); due.setHours(0,0,0,0);
  return due < today ? "Overdue" : "Open";
}

// -------------------------------------------------------
// Apply status-based styling to a single row
// -------------------------------------------------------
function styleRow(sheet, rowIndex, statusText) {
  var full = sheet.getRange(rowIndex, 1, 1, 9);
  full.setBackground('#ffffff');
  full.setFontColor('#0f172a');
  full.setFontLine('none');

  var cell = sheet.getRange(rowIndex, 8);
  if (statusText === 'Paid') {
    cell.setBackground('#d1fae5'); cell.setFontColor('#065f46'); cell.setFontWeight('bold');
  } else if (statusText === 'Overdue') {
    cell.setBackground('#fee2e2'); cell.setFontColor('#991b1b'); cell.setFontWeight('bold');
  } else if (statusText === 'Open') {
    cell.setBackground('#fef3c7'); cell.setFontColor('#92400e'); cell.setFontWeight('bold');
  } else if (statusText === 'Voided' || statusText === 'Deleted') {
    full.setFontLine('line-through'); full.setFontColor('#94a3b8');
  }
}

// -------------------------------------------------------
// Single invoice handler (webhook path)
// -------------------------------------------------------
function processSingleInvoice(sheet, data) {
  var invoiceId = safe(data.invoiceId) || 'UNKNOWN';
  var action = data.action || 'create';
  var statusText = resolveStatus(action, data.balance, data.dueDate);
  var nowStr = Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd HH:mm:ss");

  var rowValues = buildRow(invoiceId, data.customer, data.amount, data.dueDate,
    data.currency, data.exchangeRate, data.homeAmount, statusText, nowStr);

  // Find existing row
  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var cellVal = ids[i] ? ids[i][0] : null;
      var existingId = cellVal !== undefined && cellVal !== null ? String(cellVal) : '';
      if (existingId === String(invoiceId)) {
        rowIndex = i + 2; break;
      }
    }
  }

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
    rowIndex = sheet.getLastRow();
  } else {
    sheet.getRange(rowIndex, 1, 1, 9).setValues([rowValues]);
  }

  styleRow(sheet, rowIndex, statusText);
  applyStatusDropdowns(sheet);
  ensureFilter(sheet);
  SpreadsheetApp.flush();
  return { success: true, invoiceId: invoiceId, status: statusText };
}

// -------------------------------------------------------
// Bulk sync handler — safe, row-by-row append + batch style
// -------------------------------------------------------
function processBulkSync(sheet, invoices) {
  if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
    return { success: false, error: "Empty or invalid invoices array." };
  }

  var today = new Date(); today.setHours(0,0,0,0);
  var nowStr = Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd HH:mm:ss");

  // --- STEP 1: Read existing invoice IDs (ONE read call) ---
  var lastRow = sheet.getLastRow();
  var existingMap = {}; // invoiceId -> sheet row (1-based)
  if (lastRow > 1) {
    var existingRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < existingRange.length; r++) {
      var cellVal = existingRange[r] ? existingRange[r][0] : null;
      var existingId = cellVal !== undefined && cellVal !== null ? String(cellVal) : '';
      if (existingId) existingMap[existingId] = r + 2;
    }
  }

  // --- STEP 2: Classify invoices and build row data in memory ---
  var toUpdate = []; // { rowIndex, rowData, status }
  var toInsert = []; // { rowData, status }

  for (var k = 0; k < invoices.length; k++) {
    var inv = invoices[k];
    if (!inv) continue; // skip null/undefined entries

    var invoiceId = safe(inv.invoiceId);
    if (!invoiceId) continue; // skip if no ID

    var statusText = resolveStatusBulk(inv.balance, inv.dueDate, today);
    var rowData = buildRow(
      invoiceId, inv.customer, inv.amount, inv.dueDate,
      inv.currency, inv.exchangeRate, inv.homeAmount, statusText, nowStr
    );

    if (existingMap[invoiceId] !== undefined) {
      toUpdate.push({ rowIndex: existingMap[invoiceId], rowData: rowData, status: statusText });
    } else {
      toInsert.push({ rowData: rowData, status: statusText });
    }
  }

  // --- STEP 3: Write UPDATES (each row individually, safe setValues) ---
  for (var u = 0; u < toUpdate.length; u++) {
    try {
      sheet.getRange(toUpdate[u].rowIndex, 1, 1, 9).setValues([toUpdate[u].rowData]);
    } catch (e) {
      // Log issue and skip this row rather than failing everything
      Logger.log('Update failed for row ' + toUpdate[u].rowIndex + ': ' + e.message);
    }
  }

  // --- STEP 4: Write INSERTS (appendRow — most type-safe method) ---
  var insertRowStart = sheet.getLastRow() + 1;
  for (var i = 0; i < toInsert.length; i++) {
    try {
      sheet.appendRow(toInsert[i].rowData);
    } catch (e) {
      Logger.log('Insert failed for item ' + i + ': ' + e.message);
    }
  }

  // Flush writes before styling
  SpreadsheetApp.flush();

  // --- STEP 5: Batch formatting using RangeList per status group ---
  var statusGroups = { 'Paid': [], 'Overdue': [], 'Open': [], 'Voided': [], 'Deleted': [] };

  for (var u2 = 0; u2 < toUpdate.length; u2++) {
    var s = toUpdate[u2].status;
    if (statusGroups[s]) statusGroups[s].push(toUpdate[u2].rowIndex);
  }
  for (var i2 = 0; i2 < toInsert.length; i2++) {
    var s2 = toInsert[i2].status;
    var sheetRow = insertRowStart + i2;
    if (statusGroups[s2]) statusGroups[s2].push(sheetRow);
  }

  applyBatchFormatting(sheet, statusGroups);
  applyStatusDropdowns(sheet);
  ensureFilter(sheet);

  SpreadsheetApp.flush();
  return { success: true, created: toInsert.length, updated: toUpdate.length };
}

// -------------------------------------------------------
// Batch formatting via RangeList (one API call per style per status)
// -------------------------------------------------------
function applyBatchFormatting(sheet, statusGroups) {
  var totalRows = sheet.getLastRow();
  if (totalRows < 2) return;

  // Reset ALL data rows to default white first (ONE call)
  var dataRange = sheet.getRange(2, 1, totalRows - 1, 9);
  dataRange.setBackground('#ffffff');
  dataRange.setFontColor('#0f172a');
  dataRange.setFontLine('none');

  // Map each status to its style
  var styleMap = {
    'Paid':    { bg: '#d1fae5', fg: '#065f46', bold: 'bold',   line: 'none' },
    'Overdue': { bg: '#fee2e2', fg: '#991b1b', bold: 'bold',   line: 'none' },
    'Open':    { bg: '#fef3c7', fg: '#92400e', bold: 'bold',   line: 'none' },
    'Voided':  { bg: null,      fg: '#94a3b8', bold: 'normal', line: 'line-through' },
    'Deleted': { bg: null,      fg: '#94a3b8', bold: 'normal', line: 'line-through' }
  };

  var statuses = ['Paid', 'Overdue', 'Open', 'Voided', 'Deleted'];
  for (var sIdx = 0; sIdx < statuses.length; sIdx++) {
    var status = statuses[sIdx];
    var rows = statusGroups[status];
    if (!rows || rows.length === 0) continue;
    var style = styleMap[status];
    if (!style) continue;

    // Build A1 notation arrays for the status cell (col 8) and full row (cols 1-9)
    var statusCellNotations = [];
    var fullRowNotations = [];

    for (var i = 0; i < rows.length; i++) {
      var rowIndex = rows[i];
      if (!rowIndex || rowIndex < 2) continue;
      statusCellNotations.push(sheet.getRange(rowIndex, 8).getA1Notation());
      fullRowNotations.push(sheet.getRange(rowIndex, 1, 1, 9).getA1Notation());
    }

    if (statusCellNotations.length === 0) continue;

    if (style.line === 'line-through') {
      // Strikethrough statuses: style the full row
      var fullList = sheet.getRangeList(fullRowNotations);
      fullList.setFontLine('line-through');
      fullList.setFontColor(style.fg);
    } else {
      // Color statuses: style only the status cell (col 8)
      var cellList = sheet.getRangeList(statusCellNotations);
      if (style.bg) cellList.setBackground(style.bg);
      cellList.setFontColor(style.fg);
      cellList.setFontWeight(style.bold);
    }
  }
}

// -------------------------------------------------------
// Apply Dropdown validation rules to the Status column (col 8)
// -------------------------------------------------------
function applyStatusDropdowns(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var range = sheet.getRange(2, 8, lastRow - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Open', 'Paid', 'Overdue', 'Voided', 'Deleted'])
    .setAllowInvalid(true)
    .build();
  range.setDataValidation(rule);
}

// -------------------------------------------------------
// Ensure a filter exists for the sheet to make it a filterable table
// -------------------------------------------------------
function ensureFilter(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 1 && lastColumn > 0) {
    if (!sheet.getFilter()) {
      var range = sheet.getRange(1, 1, lastRow, lastColumn);
      range.createFilter();
    }
  }
}
