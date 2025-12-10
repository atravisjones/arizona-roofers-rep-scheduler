/**
 * Test script to verify the cloud API is working correctly
 * Run with: node test-cloud-api.js
 */

const CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbzJWCZP9WorIa7RZKgLjiaE4nW56rdkGASF7GIcPH-SvhpHyZUO4Sbi0lvqQJ1RQG1JNQ/exec";

async function testLoad() {
  console.log('Testing LOAD for date: 2025-12-09');

  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'load',
        dateKey: '2025-12-09'
      })
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('✅ Load successful!');
      if (data.data) {
        console.log('Found data with', data.data.reps?.length || 0, 'reps');
      }
    } else {
      console.log('❌ Load failed:', data.message || data.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testLoadAll() {
  console.log('\nTesting LOAD ALL for dates: 2025-12-08, 2025-12-09, 2025-12-10');

  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'loadAll',
        dateKeys: ['2025-12-08', '2025-12-09', '2025-12-10']
      })
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.success && data.results) {
      const successCount = data.results.filter(r => r.success).length;
      console.log(`✅ Load all successful! Found ${successCount}/${data.results.length} dates`);
    } else {
      console.log('❌ Load all failed:', data.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function main() {
  console.log('🧪 Testing Cloud Storage API...\n');
  console.log('URL:', CLOUD_API_URL);
  console.log('='.repeat(60));

  await testLoad();
  await testLoadAll();

  console.log('='.repeat(60));
  console.log('\n✨ Tests complete!');
}

main();
