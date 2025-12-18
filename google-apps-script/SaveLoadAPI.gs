/**
 * Arizona Roofers Rep Scheduler - Save/Load API (CORS Fixed)
 *
 * 3-Tab Pipeline Storage System:
 * 1. Import - Receives new data from API (temporary staging)
 * 2. Main - Working data (the current state)
 * 3. Backup - Rollback snapshot (copied from Main before each update)
 *
 * Format in Main/Backup: Date | JSON Data | Last Modified
 */

// 3-Tab Pipeline Configuration
const IMPORT_TAB = 'Import';
const MAIN_TAB = 'Main';
const BACKUP_TAB = 'Backup';
const LOG_TAB = 'PipelineLog';

// Storage Spreadsheet ID - explicitly specify to avoid issues with standalone scripts
const STORAGE_SPREADSHEET_ID = '1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk';

// Column configuration for Main/Backup tabs
const DATE_COLUMN = 1; // Column A
const JSON_COLUMN = 2; // Column B
const MODIFIED_COLUMN = 3; // Column C

/**
 * Get the storage spreadsheet - use explicit ID instead of getActiveSpreadsheet()
 * This ensures the script works whether it's bound or standalone
 */
function getStorageSpreadsheet() {
  return SpreadsheetApp.openById(STORAGE_SPREADSHEET_ID);
}

/**
 * Main entry point for POST requests
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
    } else if (action === 'importAndProcess') {
      response = importAndProcess(params.data);
    } else if (action === 'runPipeline') {
      response = runPipeline();
    } else {
      response = createResponse({ error: 'Invalid action. Use: save, load, saveAll, loadAll, importAndProcess, or runPipeline' }, 400);
    }

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
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Handle GET requests (for testing or simple loads)
 */
function doGet(e) {
  const dateKey = e.parameter.date;
  const action = e.parameter.action;

  if (action === 'status') {
    return getPipelineStatus();
  }

  if (!dateKey) {
    return createResponse({ error: 'Missing date parameter. Use ?date=YYYY-MM-DD or ?action=status' }, 400);
  }

  return loadState(dateKey);
}

// ============================================
// Save/Load Functions with 3-Tab Pipeline
// ============================================

/**
 * Save state for a single date - writes directly to Import tab
 * Verifies the write by reading back from the sheet before returning success
 */
function saveState(dateKey, data) {
  if (!dateKey || !data) {
    return createResponse({ error: 'Missing dateKey or data' }, 400);
  }

  const ss = getStorageSpreadsheet();
  const timestamp = new Date().toISOString();
  const jsonString = JSON.stringify(data);

  try {
    // Get or create Import tab
    const importSheet = getOrCreateSheet(ss, IMPORT_TAB, true);

    // Find existing row for this date or append new row
    const existingRow = findRowByDate(importSheet, dateKey);
    const action = existingRow > 0 ? 'Updated' : 'Created';

    if (existingRow > 0) {
      // Update existing row
      importSheet.getRange(existingRow, JSON_COLUMN).setValue(jsonString);
      importSheet.getRange(existingRow, MODIFIED_COLUMN).setValue(timestamp);
    } else {
      // Add new row
      importSheet.appendRow([dateKey, jsonString, timestamp]);
    }

    // Force flush to ensure write is committed
    SpreadsheetApp.flush();

    // Verify the write by reading back from the sheet
    const verifyRow = findRowByDate(importSheet, dateKey);
    if (verifyRow === -1) {
      return createResponse({
        success: false,
        dateKey: dateKey,
        error: 'Verification failed: Row not found after write'
      }, 500);
    }

    const savedTimestamp = importSheet.getRange(verifyRow, MODIFIED_COLUMN).getValue();
    if (savedTimestamp !== timestamp) {
      return createResponse({
        success: false,
        dateKey: dateKey,
        error: 'Verification failed: Timestamp mismatch after write'
      }, 500);
    }

    return createResponse({
      success: true,
      dateKey: dateKey,
      timestamp: timestamp,
      message: action,
      verified: true
    });

  } catch (error) {
    return createResponse({ error: error.toString() }, 500);
  }
}

/**
 * Load state for a single date from Import tab
 */
function loadState(dateKey) {
  if (!dateKey) {
    return createResponse({ error: 'Missing dateKey' }, 400);
  }

  const ss = getStorageSpreadsheet();
  const importSheet = ss.getSheetByName(IMPORT_TAB);

  if (!importSheet) {
    return createResponse({
      success: false,
      dateKey: dateKey,
      message: 'Import tab does not exist'
    });
  }

  const row = findRowByDate(importSheet, dateKey);

  if (row === -1) {
    return createResponse({
      success: false,
      dateKey: dateKey,
      message: 'No data found for this date'
    });
  }

  const jsonString = importSheet.getRange(row, JSON_COLUMN).getValue();
  const timestamp = importSheet.getRange(row, MODIFIED_COLUMN).getValue();

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
 * Save multiple states at once - writes directly to Import tab
 * Verifies each write by reading back from the sheet
 */
function saveAllStates(states) {
  if (!Array.isArray(states)) {
    return createResponse({ error: 'states must be an array' }, 400);
  }

  const ss = getStorageSpreadsheet();
  const timestamp = new Date().toISOString();
  const results = [];

  try {
    // Get or create Import tab
    const importSheet = getOrCreateSheet(ss, IMPORT_TAB, true);

    // Save each state to Import tab
    for (const state of states) {
      if (!state.dateKey || !state.data) {
        results.push({ dateKey: state.dateKey || 'unknown', success: false, error: 'Missing data' });
        continue;
      }

      const jsonString = JSON.stringify(state.data);
      const existingRow = findRowByDate(importSheet, state.dateKey);
      const action = existingRow > 0 ? 'updated' : 'created';

      if (existingRow > 0) {
        // Update existing row
        importSheet.getRange(existingRow, JSON_COLUMN).setValue(jsonString);
        importSheet.getRange(existingRow, MODIFIED_COLUMN).setValue(timestamp);
      } else {
        // Add new row
        importSheet.appendRow([state.dateKey, jsonString, timestamp]);
      }

      results.push({ dateKey: state.dateKey, success: true, action: action });
    }

    // Force flush to ensure all writes are committed
    SpreadsheetApp.flush();

    // Verify all writes by checking each dateKey exists with correct timestamp
    let allVerified = true;
    for (const result of results) {
      if (!result.success) continue;

      const verifyRow = findRowByDate(importSheet, result.dateKey);
      if (verifyRow === -1) {
        result.verified = false;
        result.success = false;
        result.error = 'Verification failed: Row not found';
        allVerified = false;
      } else {
        const savedTimestamp = importSheet.getRange(verifyRow, MODIFIED_COLUMN).getValue();
        if (savedTimestamp !== timestamp) {
          result.verified = false;
          result.success = false;
          result.error = 'Verification failed: Timestamp mismatch';
          allVerified = false;
        } else {
          result.verified = true;
        }
      }
    }

    const successCount = results.filter(r => r.success).length;

    return createResponse({
      success: allVerified,
      timestamp: timestamp,
      results: results,
      verified: allVerified,
      summary: `${successCount}/${states.length} verified`
    });

  } catch (error) {
    return createResponse({ error: error.toString() }, 500);
  }
}

/**
 * Load multiple states at once from Import tab
 */
function loadAllStates(dateKeys) {
  if (!Array.isArray(dateKeys)) {
    return createResponse({ error: 'dateKeys must be an array' }, 400);
  }

  const ss = getStorageSpreadsheet();
  const importSheet = ss.getSheetByName(IMPORT_TAB);
  const results = [];

  if (!importSheet) {
    for (const dateKey of dateKeys) {
      results.push({ dateKey: dateKey, success: false, message: 'Import tab does not exist' });
    }
    return createResponse({ success: true, results: results });
  }

  for (const dateKey of dateKeys) {
    const row = findRowByDate(importSheet, dateKey);

    if (row === -1) {
      results.push({ dateKey: dateKey, success: false, message: 'Not found' });
      continue;
    }

    const jsonString = importSheet.getRange(row, JSON_COLUMN).getValue();
    const timestamp = importSheet.getRange(row, MODIFIED_COLUMN).getValue();

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

// ============================================
// Bulk Import Pipeline Functions
// ============================================

/**
 * Import data array and run the full 3-tab pipeline
 * Used for bulk imports of tabular data
 */
function importAndProcess(data) {
  const ss = getStorageSpreadsheet();
  const timestamp = new Date().toISOString();
  const logEntries = [];

  try {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return createResponse({
        success: false,
        error: 'No data provided for import',
        timestamp: timestamp
      }, 400);
    }

    const importSheet = getOrCreateSheet(ss, IMPORT_TAB, false);
    const mainSheet = getOrCreateSheet(ss, MAIN_TAB, false);
    const backupSheet = getOrCreateSheet(ss, BACKUP_TAB, false);

    // Write data to Import tab
    const importResult = writeDataToSheet(importSheet, data);
    logEntries.push({
      step: 'Import',
      success: true,
      rowCount: importResult.rowCount,
      message: `Wrote ${importResult.rowCount} rows to Import tab`
    });

    const mainRowsBefore = mainSheet.getLastRow();

    // Copy Main → Backup
    const backupResult = copySheetContents(mainSheet, backupSheet, 'Main → Backup');
    logEntries.push({
      step: 'Backup',
      success: backupResult.success,
      rowCount: backupResult.rowCount,
      message: backupResult.message
    });

    if (!backupResult.success) {
      logPipelineRun(ss, timestamp, logEntries, false, 'Backup step failed');
      return createResponse({
        success: false,
        error: 'Failed to create backup: ' + backupResult.message,
        timestamp: timestamp,
        log: logEntries
      }, 500);
    }

    // Copy Import → Main
    const mainResult = copySheetContents(importSheet, mainSheet, 'Import → Main');
    logEntries.push({
      step: 'UpdateMain',
      success: mainResult.success,
      rowCount: mainResult.rowCount,
      message: mainResult.message
    });

    if (!mainResult.success) {
      logPipelineRun(ss, timestamp, logEntries, false, 'Main update failed');
      return createResponse({
        success: false,
        error: 'Failed to update Main: ' + mainResult.message,
        timestamp: timestamp,
        log: logEntries
      }, 500);
    }

    const mainRowsAfter = mainSheet.getLastRow();
    if (mainRowsAfter < 1) {
      logPipelineRun(ss, timestamp, logEntries, false, 'Validation failed: Main is empty');
      return createResponse({
        success: false,
        error: 'Validation failed: Main tab is empty after update',
        timestamp: timestamp,
        log: logEntries
      }, 500);
    }

    logEntries.push({
      step: 'Validation',
      success: true,
      rowCount: mainRowsAfter,
      message: `Main validated: ${mainRowsAfter} rows (was ${mainRowsBefore})`
    });

    // Clear Import (leave headers)
    const clearResult = clearSheetKeepHeaders(importSheet);
    logEntries.push({
      step: 'ClearImport',
      success: clearResult.success,
      rowCount: 0,
      message: clearResult.message
    });

    logPipelineRun(ss, timestamp, logEntries, true, 'Pipeline completed successfully');

    return createResponse({
      success: true,
      timestamp: timestamp,
      message: 'Pipeline completed successfully',
      summary: {
        importedRows: importResult.rowCount,
        backupRows: backupResult.rowCount,
        mainRows: mainRowsAfter,
        importCleared: clearResult.success
      },
      log: logEntries
    });

  } catch (error) {
    logEntries.push({
      step: 'Error',
      success: false,
      rowCount: 0,
      message: error.toString()
    });
    logPipelineRun(ss, timestamp, logEntries, false, error.toString());

    return createResponse({
      success: false,
      error: error.toString(),
      timestamp: timestamp,
      log: logEntries
    }, 500);
  }
}

/**
 * Run pipeline using existing Import tab contents
 */
function runPipeline() {
  const ss = getStorageSpreadsheet();
  const timestamp = new Date().toISOString();
  const logEntries = [];

  try {
    const importSheet = ss.getSheetByName(IMPORT_TAB);
    const mainSheet = getOrCreateSheet(ss, MAIN_TAB, false);
    const backupSheet = getOrCreateSheet(ss, BACKUP_TAB, false);

    if (!importSheet) {
      return createResponse({
        success: false,
        error: 'Import tab does not exist',
        timestamp: timestamp
      }, 400);
    }

    const importRows = importSheet.getLastRow();
    if (importRows <= 1) {
      return createResponse({
        success: false,
        error: 'Import tab is empty (no data rows)',
        timestamp: timestamp
      }, 400);
    }

    logEntries.push({
      step: 'ValidateImport',
      success: true,
      rowCount: importRows - 1,
      message: `Found ${importRows - 1} data rows in Import tab`
    });

    // Copy Main → Backup
    const backupResult = copySheetContents(mainSheet, backupSheet, 'Main → Backup');
    logEntries.push({
      step: 'Backup',
      success: backupResult.success,
      rowCount: backupResult.rowCount,
      message: backupResult.message
    });

    if (!backupResult.success) {
      logPipelineRun(ss, timestamp, logEntries, false, 'Backup step failed');
      return createResponse({
        success: false,
        error: 'Failed to create backup: ' + backupResult.message,
        timestamp: timestamp,
        log: logEntries
      }, 500);
    }

    // Copy Import → Main
    const mainResult = copySheetContents(importSheet, mainSheet, 'Import → Main');
    logEntries.push({
      step: 'UpdateMain',
      success: mainResult.success,
      rowCount: mainResult.rowCount,
      message: mainResult.message
    });

    if (!mainResult.success) {
      logPipelineRun(ss, timestamp, logEntries, false, 'Main update failed');
      return createResponse({
        success: false,
        error: 'Failed to update Main: ' + mainResult.message,
        timestamp: timestamp,
        log: logEntries
      }, 500);
    }

    const mainRowsAfter = mainSheet.getLastRow();
    logEntries.push({
      step: 'Validation',
      success: true,
      rowCount: mainRowsAfter,
      message: `Main validated: ${mainRowsAfter} rows`
    });

    // Clear Import (leave headers)
    const clearResult = clearSheetKeepHeaders(importSheet);
    logEntries.push({
      step: 'ClearImport',
      success: clearResult.success,
      rowCount: 0,
      message: clearResult.message
    });

    logPipelineRun(ss, timestamp, logEntries, true, 'Pipeline completed successfully');

    return createResponse({
      success: true,
      timestamp: timestamp,
      message: 'Pipeline completed successfully',
      summary: {
        importedRows: importRows - 1,
        backupRows: backupResult.rowCount,
        mainRows: mainRowsAfter,
        importCleared: clearResult.success
      },
      log: logEntries
    });

  } catch (error) {
    logPipelineRun(ss, timestamp, logEntries, false, error.toString());
    return createResponse({
      success: false,
      error: error.toString(),
      timestamp: timestamp,
      log: logEntries
    }, 500);
  }
}

/**
 * Get pipeline status (row counts for all tabs)
 */
function getPipelineStatus() {
  const ss = getStorageSpreadsheet();

  const importSheet = ss.getSheetByName(IMPORT_TAB);
  const mainSheet = ss.getSheetByName(MAIN_TAB);
  const backupSheet = ss.getSheetByName(BACKUP_TAB);
  const logSheet = ss.getSheetByName(LOG_TAB);

  const status = {
    import: {
      exists: !!importSheet,
      rowCount: importSheet ? Math.max(0, importSheet.getLastRow() - 1) : 0
    },
    main: {
      exists: !!mainSheet,
      rowCount: mainSheet ? Math.max(0, mainSheet.getLastRow() - 1) : 0
    },
    backup: {
      exists: !!backupSheet,
      rowCount: backupSheet ? Math.max(0, backupSheet.getLastRow() - 1) : 0
    },
    lastRun: null
  };

  if (logSheet && logSheet.getLastRow() > 1) {
    const lastRow = logSheet.getLastRow();
    const lastLog = logSheet.getRange(lastRow, 1, 1, 4).getValues()[0];
    status.lastRun = {
      timestamp: lastLog[0],
      success: lastLog[1],
      message: lastLog[2],
      details: lastLog[3]
    };
  }

  return createResponse({
    success: true,
    status: status,
    timestamp: new Date().toISOString()
  });
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get or create a sheet by name
 * @param ss Spreadsheet
 * @param sheetName Name of the sheet
 * @param withHeaders If true, adds Date/JSON/Modified headers
 */
function getOrCreateSheet(ss, sheetName, withHeaders) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (withHeaders) {
      sheet.getRange(1, 1, 1, 3).setValues([['Date', 'JSON Data', 'Last Modified']]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * Find row by date in a sheet
 * Returns row number (1-indexed) or -1 if not found
 */
function findRowByDate(sheet, dateKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  const data = sheet.getRange(2, DATE_COLUMN, lastRow - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === dateKey) {
      return i + 2; // +2 because we start at row 2 and array is 0-indexed
    }
  }

  return -1;
}

/**
 * Write data array to a sheet (clears existing content first)
 */
function writeDataToSheet(sheet, data) {
  sheet.clear();

  if (Array.isArray(data) && data.length > 0) {
    if (Array.isArray(data[0])) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      return { success: true, rowCount: data.length - 1 };
    } else {
      const headers = Object.keys(data[0]);
      const rows = [headers];
      for (const item of data) {
        rows.push(headers.map(h => item[h] || ''));
      }
      sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
      return { success: true, rowCount: rows.length - 1 };
    }
  }

  return { success: true, rowCount: 0 };
}

/**
 * Copy all contents from source sheet to destination sheet
 */
function copySheetContents(sourceSheet, destSheet, operationName) {
  try {
    const sourceRows = sourceSheet.getLastRow();
    const sourceCols = sourceSheet.getLastColumn();

    destSheet.clear();

    if (sourceRows === 0 || sourceCols === 0) {
      return {
        success: true,
        rowCount: 0,
        message: `${operationName}: Source was empty, destination cleared`
      };
    }

    const data = sourceSheet.getRange(1, 1, sourceRows, sourceCols).getValues();
    destSheet.getRange(1, 1, sourceRows, sourceCols).setValues(data);

    return {
      success: true,
      rowCount: sourceRows - 1,
      message: `${operationName}: Copied ${sourceRows} rows (${sourceRows - 1} data rows)`
    };
  } catch (error) {
    return {
      success: false,
      rowCount: 0,
      message: `${operationName} failed: ${error.toString()}`
    };
  }
}

/**
 * Clear sheet contents but keep the header row
 */
function clearSheetKeepHeaders(sheet) {
  try {
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return { success: true, message: 'Already clear (only headers or empty)' };
    }

    sheet.deleteRows(2, lastRow - 1);

    return { success: true, message: `Cleared ${lastRow - 1} data rows, headers preserved` };
  } catch (error) {
    return { success: false, message: `Clear failed: ${error.toString()}` };
  }
}

/**
 * Log a pipeline run to the PipelineLog tab
 */
function logPipelineRun(ss, timestamp, logEntries, success, message) {
  try {
    let logSheet = ss.getSheetByName(LOG_TAB);
    if (!logSheet) {
      logSheet = ss.insertSheet(LOG_TAB);
      logSheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Success', 'Message', 'Details']]);
      logSheet.setFrozenRows(1);
    }

    const details = JSON.stringify(logEntries);
    logSheet.appendRow([timestamp, success, message, details]);

    // Keep only last 100 log entries
    const logRows = logSheet.getLastRow();
    if (logRows > 101) {
      logSheet.deleteRows(2, logRows - 101);
    }
  } catch (error) {
    Logger.log('Failed to log pipeline run: ' + error.toString());
  }
}

/**
 * Create JSON response
 */
function createResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function - run manually to test
 */
function testSave() {
  Logger.log('Testing save...');

  const testDate = '2025-12-17';
  const testData = {
    reps: [{ id: 'rep-1', name: 'Test Rep' }],
    unassignedJobs: [],
    settings: {}
  };

  const result = saveState(testDate, testData);
  Logger.log(result.getContent());

  Logger.log('Testing load...');
  const loadResult = loadState(testDate);
  Logger.log(loadResult.getContent());
}
