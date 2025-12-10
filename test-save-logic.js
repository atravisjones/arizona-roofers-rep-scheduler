/**
 * Test script to debug why duplicates are being created
 * Run with: node test-save-logic.js
 */

const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";
const SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = 'Sheet1';

async function fetchAllRows() {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A:C?key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.values || [];
  } catch (error) {
    console.error('Error fetching rows:', error);
    return [];
  }
}

function findRowIndex(rows, dateKey) {
  console.log(`\nSearching for dateKey: "${dateKey}"`);
  console.log(`Total rows to search: ${rows.length}`);

  for (let i = 0; i < rows.length; i++) {
    const cellValue = rows[i][0];
    console.log(`  Row ${i + 1}: "${cellValue}" === "${dateKey}" ? ${cellValue === dateKey}`);
    if (cellValue === dateKey) {
      return i;
    }
  }
  return -1;
}

async function testSaveLogic() {
  console.log('🔍 Testing save logic...\n');

  const rows = await fetchAllRows();
  console.log(`Fetched ${rows.length} rows from sheet\n`);
  console.log('First 5 rows:');
  rows.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, {
      date: row[0],
      dateType: typeof row[0],
      dateLength: row[0] ? row[0].length : 0,
      dataLength: row[1] ? row[1].length : 0,
      timestamp: row[2]
    });
  });

  // Test finding 2025-12-09
  const testDate = '2025-12-09';
  const foundIndex = findRowIndex(rows, testDate);

  if (foundIndex >= 0) {
    console.log(`\n✅ Found "${testDate}" at row ${foundIndex + 1}`);
  } else {
    console.log(`\n❌ Did not find "${testDate}"`);
  }
}

testSaveLogic();
