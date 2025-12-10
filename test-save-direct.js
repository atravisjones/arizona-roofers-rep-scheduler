/**
 * Test direct save to Google Sheets
 * Run with: node test-save-direct.js
 */

const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";
const SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = 'Sheet1';

async function testSave() {
  console.log('🧪 Testing direct save to Google Sheets...\n');

  try {
    // Test data
    const testDate = '2025-12-11';
    const testData = { test: 'This is a test save' };
    const timestamp = new Date().toISOString();
    const jsonString = JSON.stringify(testData);

    // Try to save to next available row
    const values = [[testDate, jsonString, timestamp]];
    const range = `'${STORAGE_SHEET_NAME}'!A100:C100`; // Use row 100 to avoid conflicts

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${GOOGLE_API_KEY}&valueInputOption=RAW`;

    console.log('URL:', url);
    console.log('Method: PUT');
    console.log('Data:', values);
    console.log('\nSending request...\n');

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values })
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('\n❌ Error response:', errorText);
      return;
    }

    const result = await response.json();
    console.log('\n✅ Success! Response:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
  }
}

testSave();
