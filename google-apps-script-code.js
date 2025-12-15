/**
 * Google Apps Script for Rolling 7-Day Storage
 *
 * DEPLOY THIS SCRIPT:
 * 1. Go to https://script.google.com
 * 2. Create a new project or update your existing one
 * 3. Replace the code with this script
 * 4. Deploy as Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the new Web App URL to constants.ts SAVE_LOAD_API_URL
 *
 * STORAGE STRUCTURE:
 * Row 1 = yesterday (day offset -1)
 * Row 2 = today (day offset 0)
 * Row 3 = tomorrow (day offset +1)
 * Row 4 = day after tomorrow (day offset +2)
 * Row 5 = day offset +3
 * Row 6 = day offset +4
 * Row 7 = day offset +5
 *
 * Each row has 3 columns: [dateKey, jsonData, timestamp]
 */

// Configuration - update with your spreadsheet ID
const STORAGE_SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = "Sheet1";
const TOTAL_ROWS = 7;

/**
 * Handle incoming POST requests
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    let result;

    switch (action) {
      case 'saveToRow':
        result = saveToRow(payload.dateKey, payload.rowNumber, payload.data);
        break;
      case 'saveAllToRows':
        result = saveAllToRows(payload.states);
        break;
      // Legacy support for old save/saveAll actions
      case 'save':
        // Calculate row from dateKey if rowNumber not provided
        const row = payload.rowNumber || calculateRowForDate(payload.dateKey);
        result = saveToRow(payload.dateKey, row, payload.data);
        break;
      case 'saveAll':
        // Add row numbers to states that don't have them
        const statesWithRows = payload.states.map(s => ({
          ...s,
          rowNumber: s.rowNumber || calculateRowForDate(s.dateKey)
        }));
        result = saveAllToRows(statesWithRows);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing)
 */
function doGet(e) {
  const ss = SpreadsheetApp.openById(STORAGE_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(STORAGE_SHEET_NAME);

  // Get current data for inspection
  const range = sheet.getRange(1, 1, TOTAL_ROWS, 3);
  const values = range.getValues();

  const today = new Date();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const rows = values.map((row, index) => ({
    row: index + 1,
    dateKey: row[0] || '(empty)',
    hasData: !!row[1],
    timestamp: row[2] || '(never)',
    expectedDate: getExpectedDateForRow(index + 1)
  }));

  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Rolling 7-day storage status',
      today: todayStr,
      rows: rows
    }, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Calculate the row number (1-indexed) for a given date key
 */
function calculateRowForDate(dateKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(dateKey + 'T00:00:00');
  targetDate.setHours(0, 0, 0, 0);

  // Calculate day difference
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  // Row 1 = yesterday (-1), Row 2 = today (0), etc.
  const startOffset = -1;
  const rowNumber = diffDays - startOffset + 1;

  // Validate range
  if (rowNumber < 1 || rowNumber > TOTAL_ROWS) {
    return -1;
  }

  return rowNumber;
}

/**
 * Get the expected date for a row number (for display/debugging)
 */
function getExpectedDateForRow(rowNumber) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const startOffset = -1;
  const dayOffset = startOffset + (rowNumber - 1);

  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + dayOffset);

  return Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * Save data to a specific row (overwrites existing data)
 */
function saveToRow(dateKey, rowNumber, data) {
  try {
    // Validate row number
    if (rowNumber < 1 || rowNumber > TOTAL_ROWS) {
      return {
        success: false,
        dateKey: dateKey,
        error: 'Row number ' + rowNumber + ' is outside valid range (1-' + TOTAL_ROWS + ')'
      };
    }

    const ss = SpreadsheetApp.openById(STORAGE_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(STORAGE_SHEET_NAME);

    if (!sheet) {
      // Create sheet if it doesn't exist
      ss.insertSheet(STORAGE_SHEET_NAME);
    }

    const timestamp = new Date().toISOString();
    const jsonData = JSON.stringify(data);

    // Write to the specific row (overwrite)
    const range = sheet.getRange(rowNumber, 1, 1, 3);
    range.setValues([[dateKey, jsonData, timestamp]]);

    return {
      success: true,
      dateKey: dateKey,
      rowNumber: rowNumber,
      timestamp: timestamp,
      action: 'updated'
    };

  } catch (error) {
    return {
      success: false,
      dateKey: dateKey,
      rowNumber: rowNumber,
      error: error.toString()
    };
  }
}

/**
 * Save multiple states to their respective rows
 */
function saveAllToRows(states) {
  try {
    const ss = SpreadsheetApp.openById(STORAGE_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(STORAGE_SHEET_NAME);

    if (!sheet) {
      ss.insertSheet(STORAGE_SHEET_NAME);
    }

    const timestamp = new Date().toISOString();
    const results = [];

    // Process each state
    for (const state of states) {
      const rowNumber = state.rowNumber;

      // Skip invalid rows
      if (rowNumber < 1 || rowNumber > TOTAL_ROWS) {
        results.push({
          dateKey: state.dateKey,
          success: false,
          error: 'Row number ' + rowNumber + ' is outside valid range'
        });
        continue;
      }

      try {
        const jsonData = JSON.stringify(state.data);
        const range = sheet.getRange(rowNumber, 1, 1, 3);
        range.setValues([[state.dateKey, jsonData, timestamp]]);

        results.push({
          dateKey: state.dateKey,
          rowNumber: rowNumber,
          success: true,
          action: 'updated'
        });
      } catch (err) {
        results.push({
          dateKey: state.dateKey,
          rowNumber: rowNumber,
          success: false,
          error: err.toString()
        });
      }
    }

    return {
      success: true,
      timestamp: timestamp,
      results: results
    };

  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Initialize the sheet with 7 empty rows (run once to set up)
 */
function initializeSheet() {
  const ss = SpreadsheetApp.openById(STORAGE_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(STORAGE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(STORAGE_SHEET_NAME);
  }

  // Clear existing data
  sheet.clear();

  // Set up 7 rows with expected dates
  const rows = [];
  for (let i = 1; i <= TOTAL_ROWS; i++) {
    const expectedDate = getExpectedDateForRow(i);
    rows.push([expectedDate, '', '']);
  }

  // Write all rows
  sheet.getRange(1, 1, TOTAL_ROWS, 3).setValues(rows);

  // Set column headers (optional, as a comment row at row 8)
  // sheet.getRange(8, 1, 1, 3).setValues([['dateKey', 'jsonData', 'timestamp']]);

  Logger.log('Sheet initialized with ' + TOTAL_ROWS + ' rows');
  return { success: true, message: 'Initialized ' + TOTAL_ROWS + ' rows' };
}

/**
 * Test function - run from the Apps Script editor to test
 */
function testSave() {
  const testData = {
    reps: [{ id: 'test', name: 'Test Rep' }],
    unassignedJobs: [],
    settings: {}
  };

  const today = new Date();
  const dateKey = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const rowNumber = calculateRowForDate(dateKey);

  Logger.log('Testing save for ' + dateKey + ' to row ' + rowNumber);
  const result = saveToRow(dateKey, rowNumber, testData);
  Logger.log(JSON.stringify(result, null, 2));
}
