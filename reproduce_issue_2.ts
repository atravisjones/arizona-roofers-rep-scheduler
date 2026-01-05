
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

// Copied function with debug logs added
export async function parseJobsFromText(text: string) {
    const jobs: any[] = [];
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

        // OLD REGEX (Before my fix for this specific task)
        // Note: I am testing if the CURRENT code (which has my previous fix) handles this case
        // My previous fix added `\d{1,2}\/\d{1,2}\/\d{4}` but NOT `YYYY-MM-DD`
        const timestampRegex = /\s*-\s*(?:(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?[a-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s+at)?|\d{1,2}\/\d{1,2}\/\d{4})\s*(?:\d{1,2}:\d{2}\s*[AP]M)?(?:\s+[A-Z]{3,4})?\s*$/i;

        // Let's capture what we matched
        const tsMatch = trimmedLine.match(timestampRegex);
        if (tsMatch) {
            console.log(`  -> Timestamp matched and removed: "${tsMatch[0]}"`);
            trimmedLine = trimmedLine.replace(timestampRegex, '').trim();
        } else {
            console.log(`  -> No timestamp matched.`);
        }

        const timeSlotMatch = trimmedLine.match(timeSlotRegex);
        if (timeSlotMatch && /\(\d+\)$/.test(trimmedLine)) {
            currentTimeframe = timeSlotMatch[1];
            console.log(`Found time slot: ${currentTimeframe}`);
            continue;
        }

        console.log(`Processing line: "${trimmedLine}"`);

        // Skip rep detection
        let lineWithoutRep = trimmedLine;
        let assignedRep = null;

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
        }

        let notes = '';
        let city = '';
        let zipCode: string | undefined = undefined;

        let cityAndNotesPart = nonAddressPart.replace(/\s*-\s*$/, '').trim();
        const lowerNonAddress = nonAddressPart.toLowerCase();
        let matchedCity = knownCitiesList.find(c => lowerNonAddress.startsWith(c));

        if (matchedCity) {
            city = matchedCity.toUpperCase();
            const cityRegex = new RegExp(`^${matchedCity}[,\\.\\s]*`, 'i');
            notes = nonAddressPart.replace(cityRegex, '').trim();
            cityAndNotesPart = notes;
            console.log(`  -> City matched: ${city}`);
        } else {
            // Fallback
            const tagKeywordsRegex = new RegExp(`\\b(${TAG_KEYWORDS.join('|')}|\\d+\\s*S|[\\d,]+\\s*sq\\.?(?:ft)?|\\d+\\s*yrs)\\b|#`, 'i');
            const firstTagMatch = cityAndNotesPart.match(tagKeywordsRegex);
            if (firstTagMatch && firstTagMatch.index !== undefined) {
                city = cityAndNotesPart.substring(0, firstTagMatch.index).trim();
                notes = cityAndNotesPart.substring(firstTagMatch.index).trim();
            } else {
                city = cityAndNotesPart;
                notes = '';
            }
        }

        // Zip
        const zipCodeRegex = /\b(\d{5})\b/;
        const zipMatch = cityAndNotesPart.match(zipCodeRegex);
        if (zipMatch) {
            zipCode = zipMatch[1];
            city = city.replace(zipCode, '').replace(/,$/, '').trim();
            notes = notes.replace(zipCode, '').replace(/,,/g, ',').trim();
        }

        city = city.replace(/\d+/g, '').replace(/[,:.-]+$/, '').replace(/^[,:.-]+/, '').trim();

        if (addressStartIndex === -1) {
            if (/\d/.test(notes) && /[a-zA-Z]/.test(notes)) {
                address = notes;
            } else {
                console.log(`  -> Skipping: No address found.`);
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
        const hasStreetName = /\b([a-zA-Z]{3,}|Dr|St|Ct|Rd|Pl|Ln|Blvd|Ave|Way|N|S|E|W|NE|NW|SE|SW)\b/i.test(address);

        if (!address || !hasNumber || !hasStreetName) {
            console.log(`  -> REJECTED by validation: "${address}"`);
            continue;
        }

        const newJob = {
            address, city, notes, originalTimeframe: currentTimeframe, zipCode
        };
        jobs.push(newJob);
        console.log(`  -> ADDED JOB:`, newJob);
    }

    return jobs;
}

// TEST EXECUTION
const TEST_TEXT = `GILBERT (Leak/Inspect) 13yrs Tile 1s 2,978sq 85297 - 3149 East Oriole Drive - 2025-12-15 07:30 AM`;

parseJobsFromText(TEST_TEXT).then(jobs => {
    console.log(`\nParsed ${jobs.length} jobs.`);
});
