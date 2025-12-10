const GOOGLE_API_KEY = 'AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI';
const SPREADSHEET_ID = '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g';

async function listSheets() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${GOOGLE_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    console.log('📋 Available sheets in the spreadsheet:\n');
    data.sheets.forEach(s => {
      console.log('  ✓', s.properties.title);
    });
    console.log('\n💡 You need to create a sheet named exactly: SavedStates');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listSheets();
