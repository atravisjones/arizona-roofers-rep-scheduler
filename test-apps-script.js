/**
 * Test the Apps Script deployment
 * Run with: node test-apps-script.js
 */

const STORAGE_API_URL = "https://script.google.com/macros/s/AKfycbzJWCZP9WorIa7RZKgLjiaE4nW56rdkGASF7GIcPH-SvhpHyZUO4Sbi0lvqQJ1RQG1JNQ/exec";

async function testAppScript() {
  console.log('🧪 Testing Apps Script deployment...\n');
  console.log('URL:', STORAGE_API_URL);
  console.log('='.repeat(60));

  // Test 1: Simple save
  console.log('\n📤 Test 1: Save a test entry...');
  try {
    const testData = {
      reps: [{ id: 'rep-1', name: 'Test Rep', schedule: [] }],
      unassignedJobs: [],
      settings: {}
    };

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'save',
        dateKey: '2025-12-11',
        data: testData
      })
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error response:', errorText);
      return;
    }

    const result = await response.json();
    console.log('✅ Success!');
    console.log('Result:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
  }

  console.log('\n' + '='.repeat(60));
}

testAppScript();
