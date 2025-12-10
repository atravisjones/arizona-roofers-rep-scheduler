/**
 * Test script to examine the actual saved JSON data
 * Run with: node test-detailed-data.js
 */

const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";
const SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = 'Sheet1';

async function testDetailedData() {
  console.log('🔍 Examining saved JSON data...\n');

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A:C?key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.values || data.values.length === 0) {
      console.log('No data found');
      return;
    }

    // Check the most recent entry for 2025-12-09
    const dec9Entries = data.values.filter(row => row[0] === '2025-12-09');
    console.log(`Found ${dec9Entries.length} entries for 2025-12-09\n`);

    if (dec9Entries.length > 0) {
      // Get the most recent one
      const latestEntry = dec9Entries[dec9Entries.length - 1];
      const jsonData = JSON.parse(latestEntry[1]);

      console.log('Latest entry for 2025-12-09:');
      console.log('Timestamp:', latestEntry[2]);
      console.log('\nUnassigned jobs:', jsonData.unassignedJobs.length);
      console.log('Number of reps:', jsonData.reps.length);

      console.log('\nRep assignments:');
      jsonData.reps.forEach(rep => {
        const totalJobs = rep.schedule.reduce((sum, slot) => sum + slot.jobs.length, 0);
        console.log(`  ${rep.name}: ${totalJobs} jobs assigned`);

        // Show details of first assigned job if any
        for (const slot of rep.schedule) {
          if (slot.jobs.length > 0) {
            console.log(`    - Slot ${slot.timeSlotLabel || slot.timeSlotId}:`, JSON.stringify(slot.jobs[0], null, 2).substring(0, 200));
            break;
          }
        }
      });

      console.log('\nFirst unassigned job (if any):');
      if (jsonData.unassignedJobs.length > 0) {
        console.log(JSON.stringify(jsonData.unassignedJobs[0], null, 2).substring(0, 200));
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDetailedData();
