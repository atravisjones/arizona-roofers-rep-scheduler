/**
 * Arizona Roofers Rep Scheduler - Save/Load API
 *
 * Simple API to save and load planner state from Google Sheets
 * Tab: Sheet1
 * Format: Date | JSON Data | Last Modified
 */

// Configuration
const SHEET_NAME = 'Sheet1';
const DATE_COLUMN = 1; // Column A
const JSON_COLUMN = 2; // Column B
const MODIFIED_COLUMN = 3; // Column C

/**
 * Main entry point for GET and POST requests
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    let response;
    if (action === 'save') {
      response = saveState(params.dateKey, params.data);
    } else if (action === 'load') {
      response = loadState(params.dateKey);
    } else if (action === 'saveAll') {
      response = saveAllStates(params.states);
    } else if (action === 'loadAll') {
      response = loadAllStates(params.dateKeys);
    } else {
      response = createResponse({ error: 'Invalid action. Use: save, load, saveAll, or loadAll' }, 400);
    }

    // Add CORS headers
    return response;
  } catch (error) {
    return createResponse({ error: error.toString() }, 500);
  }
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Handle GET requests (for testing or simple loads)
 */
function doGet(e) {
  const dateKey = e.parameter.date;

  if (!dateKey) {
    return createResponse({ error: 'Missing date parameter. Use ?date=YYYY-MM-DD' }, 400);
  }

  return loadState(dateKey);
}

/**
 * Save state for a single date
 */
function saveState(dateKey, data) {
  if (!dateKey || !data) {
    return createResponse({ error: 'Missing dateKey or data' }, 400);
  }

  const sheet = getSheet();
  const existingRow = findRowByDate(sheet, dateKey);
  const jsonString = JSON.stringify(data);
  const timestamp = new Date().toISOString();

  if (existingRow > 0) {
    // Update existing row
    sheet.getRange(existingRow, JSON_COLUMN).setValue(jsonString);
    sheet.getRange(existingRow, MODIFIED_COLUMN).setValue(timestamp);
  } else {
    // Add new row
    sheet.appendRow([dateKey, jsonString, timestamp]);
  }

  return createResponse({
    success: true,
    dateKey: dateKey,
    timestamp: timestamp,
    message: existingRow > 0 ? 'Updated' : 'Created'
  });
}

/**
 * Load state for a single date
 */
function loadState(dateKey) {
  if (!dateKey) {
    return createResponse({ error: 'Missing dateKey' }, 400);
  }

  const sheet = getSheet();
  const row = findRowByDate(sheet, dateKey);

  if (row === -1) {
    return createResponse({
      success: false,
      dateKey: dateKey,
      message: 'No data found for this date'
    });
  }

  const jsonString = sheet.getRange(row, JSON_COLUMN).getValue();
  const timestamp = sheet.getRange(row, MODIFIED_COLUMN).getValue();

  try {
    const data = JSON.parse(jsonString);
    return createResponse({
      success: true,
      dateKey: dateKey,
      data: data,
      timestamp: timestamp
    });
  } catch (error) {
    return createResponse({
      error: 'Failed to parse stored JSON: ' + error.toString()
    }, 500);
  }
}

/**
 * Save multiple states at once (for bulk save)
 */
function saveAllStates(states) {
  if (!Array.isArray(states)) {
    return createResponse({ error: 'states must be an array' }, 400);
  }

  const sheet = getSheet();
  const results = [];
  const timestamp = new Date().toISOString();

  for (const state of states) {
    if (!state.dateKey || !state.data) {
      results.push({ dateKey: state.dateKey || 'unknown', success: false, error: 'Missing data' });
      continue;
    }

    const existingRow = findRowByDate(sheet, state.dateKey);
    const jsonString = JSON.stringify(state.data);

    if (existingRow > 0) {
      sheet.getRange(existingRow, JSON_COLUMN).setValue(jsonString);
      sheet.getRange(existingRow, MODIFIED_COLUMN).setValue(timestamp);
      results.push({ dateKey: state.dateKey, success: true, action: 'updated' });
    } else {
      sheet.appendRow([state.dateKey, jsonString, timestamp]);
      results.push({ dateKey: state.dateKey, success: true, action: 'created' });
    }
  }

  return createResponse({
    success: true,
    timestamp: timestamp,
    results: results
  });
}

/**
 * Load multiple states at once (for bulk load)
 */
function loadAllStates(dateKeys) {
  if (!Array.isArray(dateKeys)) {
    return createResponse({ error: 'dateKeys must be an array' }, 400);
  }

  const sheet = getSheet();
  const results = [];

  for (const dateKey of dateKeys) {
    const row = findRowByDate(sheet, dateKey);

    if (row === -1) {
      results.push({ dateKey: dateKey, success: false, message: 'Not found' });
      continue;
    }

    const jsonString = sheet.getRange(row, JSON_COLUMN).getValue();
    const timestamp = sheet.getRange(row, MODIFIED_COLUMN).getValue();

    try {
      const data = JSON.parse(jsonString);
      results.push({
        dateKey: dateKey,
        success: true,
        data: data,
        timestamp: timestamp
      });
    } catch (error) {
      results.push({
        dateKey: dateKey,
        success: false,
        error: 'Parse error: ' + error.toString()
      });
    }
  }

  return createResponse({
    success: true,
    results: results
  });
}

/**
 * Helper: Get the sheet
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // Create the sheet if it doesn't exist
    sheet = ss.insertSheet(SHEET_NAME);
    // Add headers
    sheet.getRange(1, DATE_COLUMN).setValue('Date');
    sheet.getRange(1, JSON_COLUMN).setValue('JSON Data');
    sheet.getRange(1, MODIFIED_COLUMN).setValue('Last Modified');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Helper: Find row by date
 * Returns row number or -1 if not found
 */
function findRowByDate(sheet, dateKey) {
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) { // Start at 1 to skip header
    if (data[i][DATE_COLUMN - 1] === dateKey) {
      return i + 1; // Return 1-indexed row number
    }
  }

  return -1;
}

/**
 * Helper: Create JSON response with CORS headers
 */
function createResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function - run this to verify the script works
 */
function testAPI() {
  // Test save
  const testDate = '2025-12-09';
  const testData = {
    reps: [{ id: 'rep-1', name: 'Test Rep' }],
    unassignedJobs: [],
    settings: {}
  };

  Logger.log('Testing save...');
  const saveResult = saveState(testDate, testData);
  Logger.log(saveResult.getContent());

  Logger.log('Testing load...');
  const loadResult = loadState(testDate);
  Logger.log(loadResult.getContent());
}
