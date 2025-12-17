
const dateRegex = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/i;

const monthMap: { [key: string]: number } = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function parseDate(line: string) {
    const trimmed = line.trim();
    const match = trimmed.match(dateRegex);
    console.log(`Testing line: "${line}"`);
    console.log(`Match:`, match);
    
    if (match && trimmed.split(' ').length < 6) {
         const [, monthName, day, year] = match;
         console.log(`Detected: ${monthName} ${day} ${year}`);
         return true;
    }
    return false;
}

const input = `Wednesday, Dec 17, 2025

7:30am-9am (1)
SCOTTSDALE # (Old Roof) 20yrs Tile 1s 2,053sq 85262 - 9514 East Cavalry Drive - 2025-12-15 07:22 AM

10am-12pm (0)

1pm-3pm (1)
SCOTTSDALE #### (Size/Old Roof/Replace/High Value) 19yrs Tile 1s 6,942sq 85259 - 12946 East Cibola Road - 2025-12-15 10:15 AM

4pm-6pm (2)
SCOTTSDALE (Issues/Solar Damage) 6yrs Tile 1s 2,524sq 85259 - 12161 North 138th Street - 2025-12-15 03:17 PM
PHOENIX (Cracks/Missing Tile/Inspect) Unknown Flat 1s Unknown 85018 - 3800 East Lincoln Drive - 2025-12-15 03:54 PM`;

console.log("--- Testing Date Parsing ---");
const lines = input.split('\n');
let dateFound = false;
for (const line of lines) {
    if (parseDate(line)) {
        dateFound = true;
    }
}
console.log(`Date Found: ${dateFound}`);

console.log("\n--- Testing Timestamp Regex ---");
const timestampRegex = /\s*-\s*(?:(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?[a-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s+at)?|\d{1,2}\/\d{1,2}\/\d{4})\s*(?:\d{1,2}:\d{2}\s*[AP]M)?(?:\s+[A-Z]{3,4})?\s*$/i;
const jobLine = "SCOTTSDALE # (Old Roof) 20yrs Tile 1s 2,053sq 85262 - 9514 East Cavalry Drive - 2025-12-15 07:22 AM";
const stripped = jobLine.replace(timestampRegex, '').trim();
console.log(`Original: ${jobLine}`);
console.log(`Stripped: ${stripped}`);
console.log(`Changed: ${jobLine !== stripped}`);
