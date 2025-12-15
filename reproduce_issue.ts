
// Mock constants/types from the app
const ROOF_KEYWORDS = ['Tile', 'Shingle', 'Flat', 'Metal'];
const TAG_KEYWORDS = ['Insurance', 'Commercial', 'Tile', 'Shingle', 'Flat', 'Metal'];
const ALL_KNOWN_CITIES = new Set([
    'Peoria', 'Cave Creek', 'Glendale', 'Phoenix', 'Scottsdale', 'Mesa', 'Chandler', 'Gilbert', 'Tempe', 'Surprise'
]);

// Helper
const getStartHour24 = (timeString: string): number | null => {
    const match = timeString.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return null;
    let [_, hourStr, minuteStr, period] = match;
    let hour = parseInt(hourStr, 10);
    period = period?.toLowerCase();
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour;
};

const mapTimeframeToSlotId = (timeframe: string): string | null => {
    const jobStartHour = getStartHour24(timeframe);
    if (jobStartHour === null) return null;
    if (jobStartHour >= 7 && jobStartHour < 10) return 'ts-1';
    if (jobStartHour >= 10 && jobStartHour < 13) return 'ts-2';
    if (jobStartHour >= 13 && jobStartHour < 16) return 'ts-3';
    if (jobStartHour >= 16 && jobStartHour < 19) return 'ts-4';
    return null;
};

// Copied function with debug logs added
export async function parseJobsFromText(text: string) {
    const jobs: any[] = [];

    // We don't have reps for this test, so ignoring rep matching logic for simplicity 
    // unless it's critical. The bug seems to be about address/city parsing.
    const repNameMatchers: any[] = [];

    const lines = text.split('\n');
    console.log(`Total lines: ${lines.length}`);

    const dateRegex = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/i;

    const timeSlotRegex = /(\d{1,2}(?::\d{2})?(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?(?:am|pm)?)/i;
    let currentTimeframe: string | undefined = undefined;

    const knownCitiesList = Array.from(ALL_KNOWN_CITIES).map(c => c.toLowerCase()).sort((a, b) => b.length - a.length);

    for (const line of lines) {
        let trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Skip date header
        if (dateRegex.test(trimmedLine) && trimmedLine.split(' ').length < 6) {
            console.log(`Skipping date header: ${trimmedLine}`);
            continue;
        }

        // Remove timestamp suffix
        const timestampRegex = /\s*-\s*(?:(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?[a-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s+at)?|\d{1,2}\/\d{1,2}\/\d{4})\s*(?:\d{1,2}:\d{2}\s*[AP]M)?(?:\s+[A-Z]{3,4})?\s*$/i;
        trimmedLine = trimmedLine.replace(timestampRegex, '').trim();

        // Time slot line detection
        const timeSlotMatch = trimmedLine.match(timeSlotRegex);
        if (timeSlotMatch && /\(\d+\)$/.test(trimmedLine)) {
            currentTimeframe = timeSlotMatch[1];
            console.log(`Found time slot: ${currentTimeframe}`);
            continue;
        }

        console.log(`Processing line: "${trimmedLine}"`);

        // SKIP Rep detection for this reproduction to focus on address/city
        let assignedRep = null;
        let lineWithoutRep = trimmedLine;

        // 2. Identify address
        let address = '';
        let nonAddressPart = lineWithoutRep;

        const addressStartRegex = /\b\d{1,}\s+[A-Z]/g;
        let lastMatch;
        let match;
        while ((match = addressStartRegex.exec(lineWithoutRep)) !== null) {
            lastMatch = match;
        }
        const addressStartIndex = lastMatch ? lastMatch.index : -1;

        if (addressStartIndex > -1) {
            address = lineWithoutRep.substring(addressStartIndex).trim();
            nonAddressPart = lineWithoutRep.substring(0, addressStartIndex).trim();
            console.log(`  -> Address found: "${address}"`);
            console.log(`  -> Non-address part: "${nonAddressPart}"`);
        } else {
            console.log(`  -> No address pattern found.`);
        }

        let notes = '';
        let city = '';
        let zipCode: string | undefined = undefined;

        // 3. Parse city/notes
        let cityAndNotesPart = nonAddressPart.replace(/\s*-\s*$/, '').trim();
        const lowerNonAddress = nonAddressPart.toLowerCase();

        // Manual match instead of using 'find' to be sure
        let matchedCity = knownCitiesList.find(c => lowerNonAddress.startsWith(c));

        // DEBUG: check loose match
        if (!matchedCity) {
            console.log(`  -> City check failed against known list.`);
        }

        if (matchedCity) {
            city = matchedCity.toUpperCase();
            const cityRegex = new RegExp(`^${matchedCity}[,\\.\\s]*`, 'i');
            notes = nonAddressPart.replace(cityRegex, '').trim();
            cityAndNotesPart = notes;
            console.log(`  -> City matched: ${city}`);
        } else {
            // Fallback
            console.log(`  -> Fallback city parsing...`);
            const tagKeywordsRegex = new RegExp(`\\b(${TAG_KEYWORDS.join('|')}|\\d+\\s*S|[\\d,]+\\s*sq\\.?(?:ft)?|\\d+\\s*yrs)\\b|#`, 'i');
            const firstTagMatch = cityAndNotesPart.match(tagKeywordsRegex);
            if (firstTagMatch && firstTagMatch.index !== undefined) {
                city = cityAndNotesPart.substring(0, firstTagMatch.index).trim();
                notes = cityAndNotesPart.substring(firstTagMatch.index).trim();
            } else {
                city = cityAndNotesPart;
                notes = '';
            }
            console.log(`  -> Fallback result - City: "${city}", Notes: "${notes}"`);
        }

        // Zip extraction
        const zipCodeRegex = /\b(\d{5})\b/;
        const zipMatch = cityAndNotesPart.match(zipCodeRegex);
        if (zipMatch) {
            zipCode = zipMatch[1];
            city = city.replace(zipCode, '').replace(/,$/, '').trim();
            notes = notes.replace(zipCode, '').replace(/,,/g, ',').trim();
            console.log(`  -> Zip extracted: ${zipCode}`);
        }

        city = city.replace(/\d+/g, '').replace(/[,:.-]+$/, '').replace(/^[,:.-]+/, '').trim();

        if (addressStartIndex === -1) {
            if (/\d/.test(notes) && /[a-zA-Z]/.test(notes)) {
                address = notes;
                console.log(`  -> Fallback address from notes: ${address}`);
            } else {
                console.log(`  -> Skipping: No address found even in notes.`);
                continue;
            }
        }

        if (!city && address) {
            // Address parts parsing logic...
        }

        if (!city) {
            console.log(`  -> Skipping: No city found.`);
            continue;
        }

        const hasNumber = /\d/.test(address);
        const hasStreetName = /\b([a-zA-Z]{3,}|Dr|St|Ct|Rd|Pl|Ln|Blvd|Ave|Way|N|S|E|W|NE|NW|SE|SW)\b/i.test(address); // THE FIX

        console.log(`  -> Validation: hasNumber=${hasNumber}, hasStreetName=${hasStreetName} (Pattern: FIXED) for Address: "${address}"`);

        if (!address || !hasNumber || !hasStreetName) {
            console.log(`  -> REJECTED by validation.`);
            continue;
        }

        const newJob = {
            address, city, notes, originalTimeframe: currentTimeframe, zipCode
        };
        jobs.push(newJob);
        console.log(`  -> ADDED JOB.`);
    }

    return jobs;
}

// TEST EXECUTION
const TEST_TEXT = `Monday, Dec 15, 2025

7:30am-9am (0)

10am-12pm (0)

1pm-3pm (3)
PEORIA ## (Old Roof, Intent) 31yrs Tile 1 1,980sq 85382 - 17442 N 84th Dr
CAVE CREEK # (29yr Tile Roof) 29yrs Tile 1 2,329sq. 85331 - 29002 N 48th Ct - Dec 9, 2025
GLENDALE # (Built 1962) 25+yrs Flat 1 2,183sq. 85301 - 5548 West Belmont Avenue - 12/10/2025 09:51 AM

4pm-6pm (0)`;

parseJobsFromText(TEST_TEXT).then(jobs => {
    console.log(`\nParsed ${jobs.length} jobs.`);
});
