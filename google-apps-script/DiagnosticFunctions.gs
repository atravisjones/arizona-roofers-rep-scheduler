/**
 * Diagnostic Functions for Debugging
 * Add these to your Apps Script to help debug the issue
 */

/**
 * Run this function manually in Apps Script to see what's in the sheet
 */
function debugShowSheetData() {
  const SHEET_NAME = 'Sheet1';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('❌ Sheet "' + SHEET_NAME + '" not found!');
    Logger.log('Available sheets:');
    ss.getSheets().forEach(s => Logger.log('  - ' + s.getName()));
    return;
  }

  Logger.log('✅ Found sheet: ' + SHEET_NAME);

  const data = sheet.getDataRange().getValues();
  Logger.log('Total rows: ' + data.length);
  Logger.log('\nFirst 10 rows:');
  Logger.log('='.repeat(80));

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    const dateCell = row[0]; // Column A (DATE_COLUMN - 1)

    Logger.log('Row ' + (i + 1) + ':');
    Logger.log('  Column A (Date): ' + dateCell);
    Logger.log('  Type: ' + typeof dateCell);

    if (dateCell instanceof Date) {
      const y = dateCell.getFullYear();
      const m = String(dateCell.getMonth() + 1).padStart(2, '0');
      const d = String(dateCell.getDate()).padStart(2, '0');
      Logger.log('  Formatted: ' + y + '-' + m + '-' + d);
    }

    Logger.log('  Column B length: ' + (row[1] ? row[1].length : 0) + ' chars');
    Logger.log('  Column C: ' + row[2]);
    Logger.log('');
  }

  Logger.log('='.repeat(80));
}

/**
 * Test the findRowByDate function
 */
function debugTestFindRow() {
  const SHEET_NAME = 'Sheet1';
  const testDate = '2025-12-09';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('❌ Sheet not found!');
    return;
  }

  Logger.log('Testing findRowByDate for: ' + testDate);
  const result = findRowByDate(sheet, testDate);

  if (result > 0) {
    Logger.log('✅ Found at row: ' + result);
    const data = sheet.getRange(result, 1, 1, 3).getValues()[0];
    Logger.log('Data: ' + JSON.stringify(data));
  } else {
    Logger.log('❌ Not found (returned -1)');
  }
}

/**
 * Test a full load operation
 */
function debugTestLoad() {
  const testDate = '2025-12-09';
  Logger.log('Testing loadState for: ' + testDate);

  const result = loadState(testDate);
  const content = result.getContent();
  const parsed = JSON.parse(content);

  Logger.log('Result: ' + JSON.stringify(parsed, null, 2));
}
