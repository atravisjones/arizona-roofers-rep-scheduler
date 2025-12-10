/**
 * Test script to verify the Google Sheets API can read SavedStates
 * Run with: node test-sheets-api.js
 */

const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";
const SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = 'Sheet1';

async function testReadSheet() {
  console.log('🧪 Testing Google Sheets API access to SavedStates...\n');
  console.log('Spreadsheet ID:', SPREADSHEET_ID);
  console.log('Sheet Name:', STORAGE_SHEET_NAME);
  console.log('='.repeat(60));

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A:C?key=${GOOGLE_API_KEY}`;

    console.log('\nFetching URL:', url);

    const response = await fetch(url);

    console.log('\nResponse status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error response:', errorText);
      return;
    }

    const data = await response.json();

    console.log('\n✅ Success! Response data:');
    console.log('Range:', data.range);
    console.log('Major dimension:', data.majorDimension);
    console.log('Total rows:', data.values ? data.values.length : 0);

    if (data.values && data.values.length > 0) {
      console.log('\nFirst 5 rows:');
      data.values.slice(0, 5).forEach((row, i) => {
        console.log(`Row ${i + 1}:`, {
          date: row[0],
          dataLength: row[1] ? row[1].length : 0,
          timestamp: row[2]
        });
      });
    } else {
      console.log('\n⚠️  Sheet is empty');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('='.repeat(60));
}

testReadSheet();
