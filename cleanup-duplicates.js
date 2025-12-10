/**
 * Cleanup script to remove duplicate date entries
 * This will keep only the most recent entry for each date
 * Run with: node cleanup-duplicates.js
 */

const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";
const SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
const STORAGE_SHEET_NAME = 'Sheet1';

async function fetchAllRows() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A:C?key=${GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.values || [];
}

async function clearRow(rowNumber) {
  const range = `'${STORAGE_SHEET_NAME}'!A${rowNumber}:C${rowNumber}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${GOOGLE_API_KEY}&valueInputOption=RAW`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['', '', '']] })
  });

  return response.ok;
}

async function cleanupDuplicates() {
  console.log('🧹 Cleaning up duplicate date entries...\n');

  const rows = await fetchAllRows();
  console.log(`Total rows: ${rows.length}\n`);

  // Group rows by date
  const dateMap = new Map();
  rows.forEach((row, index) => {
    const date = row[0];
    if (date && date.trim()) {
      if (!dateMap.has(date)) {
        dateMap.set(date, []);
      }
      dateMap.get(date).push({
        rowNumber: index + 1,
        timestamp: row[2],
        dataLength: row[1] ? row[1].length : 0
      });
    }
  });

  console.log('Dates found:');
  for (const [date, entries] of dateMap.entries()) {
    console.log(`  ${date}: ${entries.length} entries`);
    if (entries.length > 1) {
      console.log('    Duplicates found!');

      // Sort by timestamp descending (most recent first)
      entries.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.localeCompare(a.timestamp);
      });

      const keep = entries[0];
      const remove = entries.slice(1);

      console.log(`    Keeping row ${keep.rowNumber} (${keep.timestamp})`);
      console.log(`    Removing ${remove.length} duplicate(s):`);

      for (const dup of remove) {
        console.log(`      - Row ${dup.rowNumber} (${dup.timestamp})`);
        const success = await clearRow(dup.rowNumber);
        if (success) {
          console.log(`        ✅ Cleared`);
        } else {
          console.log(`        ❌ Failed to clear`);
        }
      }
    }
  }

  console.log('\n✅ Cleanup complete!');
  console.log('Note: Empty rows still exist but contain no data.');
  console.log('You can manually delete them in Google Sheets if desired.');
}

cleanupDuplicates().catch(console.error);
