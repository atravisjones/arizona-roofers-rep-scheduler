import { Rep } from '../types';
import { GOOGLE_API_KEY, SPREADSHEET_ID, SHEET_TITLE_PREFIX, DATA_RANGE, USE_MOCK_DATA_ON_FAILURE, TIME_SLOTS, SKILLS_SHEET_TITLE, SKILLS_DATA_RANGE, SALES_ORDER_DATA_RANGE, ROOFR_JOBS_SPREADSHEET_ID, ROOFR_JOBS_SHEET_TITLE, ROOFR_JOBS_DATA_RANGE } from '../constants';
import { MOCK_REPS_DATA } from './mockData';
import { ALL_KNOWN_CITIES } from './geography';
import { createAddressVariationMap } from './addressMatcher';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalizes an address for reliable matching by extracting the street number and standardizing the street name.
 * For example, "123 N. Main St., City" becomes "123 north main street".
 * @param address The raw address string.
 * @returns A normalized string or null if the address is invalid.
 */
export const normalizeAddressForMatching = (address: string): string | null => {
    if (!address) return null;

    let addr = address.toLowerCase().trim();

    // Cautiously remove state and zip from the very end of the string
    addr = addr.replace(/(,\s*(az|arizona))?\s+\d{5}(?:-\d{4})?$/, '');

    // Cautiously remove just the state from the end if it's there
    addr = addr.replace(/,\s*(az|arizona)$/, '');

    // Clean up any trailing comma left from the removals
    addr = addr.trim().replace(/,$/, '').trim();

    // Now, if the string ends with a known city preceded by a comma, remove it.
    // This is safer than a global city search, as it avoids stripping city names from street names.
    const cityList = [...ALL_KNOWN_CITIES].sort((a, b) => b.length - a.length);
    for (const city of cityList) {
        // Regex to match ", city" at the end of the string, case-insensitive.
        const regex = new RegExp(`,\\s*${city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');
        if (regex.test(addr)) {
            addr = addr.replace(regex, '').trim();
            break; // Stop after the first (and longest) match
        }
    }

    // What remains should be the core street address.
    let streetPart = addr;

    // The address must start with a number.
    const streetNumberMatch = streetPart.match(/^(\d+)/);
    if (!streetNumberMatch) return null;

    // Expand abbreviations like St, Rd, N, W, etc. to their full words.
    streetPart = streetPart
        .replace(/\b(n\.?|north)\b/g, 'north')
        .replace(/\b(s\.?|south)\b/g, 'south')
        .replace(/\b(e\.?|east)\b/g, 'east')
        .replace(/\b(w\.?|west)\b/g, 'west')
        .replace(/\b(st\.?|street)\b/g, 'street')
        .replace(/\b(rd\.?|road)\b/g, 'road')
        .replace(/\b(dr\.?|drive)\b/g, 'drive')
        .replace(/\b(ave?\.?|avenue)\b/g, 'avenue')
        .replace(/\b(blvd\.?|boulevard)\b/g, 'boulevard')
        .replace(/\b(ln\.?|lane)\b/g, 'lane')
        .replace(/\b(ct\.?|court)\b/g, 'court')
        .replace(/\b(pl\.?|place)\b/g, 'place')
        .replace(/\b(trl\.?|trail)\b/g, 'trail')
        .replace(/\b(cir\.?|circle)\b/g, 'circle')
        .replace(/\b(wy\.?|way)\b/g, 'way');

    // Remove all non-alphanumeric characters (except spaces) and collapse whitespace.
    streetPart = streetPart.replace(/[^a-z0-9\s]/g, '');
    streetPart = streetPart.replace(/\s+/g, ' ').trim();

    // Remove common street types from the end to make them optional for matching
    // This handles cases where one address has "St" and another doesn't
    streetPart = streetPart.replace(/\s+(street|road|drive|avenue|boulevard|lane|court|place|trail|circle|way)$/i, '').trim();

    // Remove directional prefixes after the street number to make them optional
    // "123 north main" becomes "123 main", "123 west oak" becomes "123 oak"
    streetPart = streetPart.replace(/^(\d+)\s+(north|south|east|west)\s+/i, '$1 ').trim();

    return streetPart;
};


/**
 * Fetches a URL with exponential backoff retry logic for server errors (5xx) and rate limits (429).
 */
async function fetchWithRetry(url: string, retries = 3, initialDelay = 1000): Promise<Response> {
    let currentDelay = initialDelay;

    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);

            // If successful or a client error (4xx except 429), return the response immediately.
            // We let the caller handle 404s, 403s etc.
            if (response.ok || (response.status < 500 && response.status !== 429)) {
                return response;
            }

            // If it's a server error (5xx) or rate limit (429), and we have retries left...
            if (i < retries) {
                console.warn(`Google Sheets API attempt ${i + 1} failed (Status ${response.status}). Retrying in ${currentDelay}ms...`);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }

            // If no retries left, return the last response (likely an error status)
            return response;

        } catch (error) {
            // Network errors (fetch throws)
            if (i < retries) {
                console.warn(`Google Sheets API network attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`, error);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }
            // Propagate error if out of retries
            throw error;
        }
    }
    throw new Error("Fetch failed unexpectedly.");
}

/**
 * Finds the correct sheet title for a given date from the spreadsheet metadata.
 * This new logic is more robust and correctly handles year rollovers by checking
 * the selected date against ranges constructed for the current, previous, and next year.
 * @param dateToFind The date to find a matching sheet for.
 * @param sheets The list of sheet properties from the spreadsheet metadata.
 * @returns The title of the matching sheet, or a fallback title.
 */
function findSheetNameForDate(dateToFind: Date, sheets: any[]): string | null {
    dateToFind.setHours(0, 0, 0, 0); // Normalize to the start of the day for comparison
    const dateRangeRegex = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/;

    for (const s of sheets) {
        const title = s.properties.title;
        if (title.startsWith(SHEET_TITLE_PREFIX)) {
            const match = title.match(dateRangeRegex);
            if (match) {
                const [, startMonth, startDay, endMonth, endDay] = match.map(Number);

                // Check for the date in 3 possible years: the selected date's year, the year before, and the year after.
                // This handles viewing past/future schedules correctly.
                for (const yearOffset of [0, -1, 1]) {
                    const searchYear = dateToFind.getFullYear() + yearOffset;

                    let startYear = searchYear;
                    let endYear = searchYear;

                    // Handle year rollover (e.g., a range from December to January)
                    if (startMonth > endMonth) {
                        endYear = startYear + 1;
                    }

                    const startDate = new Date(startYear, startMonth - 1, startDay);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endYear, endMonth - 1, endDay);
                    endDate.setHours(23, 59, 59, 999);

                    // If the date we're looking for is within this constructed range, we found the right sheet.
                    if (dateToFind >= startDate && dateToFind <= endDate) {
                        return title;
                    }
                }
            }
        }
    }

    // Fallback if no matching date range is found after checking multiple years.
    const fallbackSheet = sheets.find((s: any) => s.properties.title.startsWith(SHEET_TITLE_PREFIX));
    if (fallbackSheet) {
        console.warn(`Could not find a sheet for the selected date (${dateToFind.toLocaleDateString()}). Falling back to the first sheet with the prefix: ${fallbackSheet.properties.title}`);
        return fallbackSheet.properties.title;
    }

    return null;
}

/**
 * Helper to normalize names for matching against skill/rank sheets.
 * Creates a consistent "firstlast" key from various name formats.
 * E.g., `"Lee" William Yost Phoenix` -> `leeyost`
 * E.g., `Lee Yost` -> `leeyost`
 */
const normalizeName = (name: string): string => {
    if (!name) return '';
    // Clean string: lowercase, remove quotes, content in parens, and city suffixes.
    let cleaned = name.toLowerCase().trim()
        .replace(/"/g, '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+(phoenix|tucson)$/i, '')
        .trim();

    // Split into parts, filtering out empty strings or stray characters.
    const parts = cleaned.split(/\s+/).filter(p => p.length > 0 && p !== '-');
    if (parts.length === 0) return '';

    // If only one part (e.g., "Cher"), use that.
    if (parts.length === 1) {
        return parts[0];
    }

    // If name is like "Lee Y", the key is "leey".
    if (parts.length === 2 && parts[1].length === 1) {
        return `${parts[0]}${parts[1]}`;
    }

    // For "First Middle Last" or "First Last", the key is "firstlast".
    const first = parts[0];
    const last = parts[parts.length - 1];

    return `${first}${last}`;
};

/**
 * Helper to clean up rep names for display in the UI.
 * E.g., `"Lee" William Yost Phoenix` -> `Lee William Yost`
 */
const cleanDisplayName = (name: string): string => {
    if (!name) return '';
    return name.trim()
        .replace(/"/g, '') // remove quotes
        .replace(/\s*\([^)]*\)/g, '') // remove parentheses content
        .replace(/\s+(phoenix|tucson)$/i, '') // remove city suffixes
        .replace(/\s{2,}/g, ' ') // collapse spaces
        .trim();
};

/**
 * Fetches the sales rankings from the 'Appointment Blocks' sheet.
 * Uses the previous month's rankings for the selected date.
 * For example: December uses November's data, January uses December's data.
 * Falls back to the previous available month if the current month's column is empty.
 * @param selectedDate The date for which to fetch rankings.
 */
async function fetchSalesRankings(selectedDate: Date = new Date()): Promise<Map<string, number>> {
    const rankMap = new Map<string, number>();
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(SKILLS_SHEET_TITLE)}'!${SALES_ORDER_DATA_RANGE}?key=${GOOGLE_API_KEY}`;
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            console.warn(`Failed to fetch sales rankings: ${response.statusText}`);
            return rankMap;
        }
        const data = await response.json();
        const values = data.values;

        if (!values || values.length < 2) {
            return rankMap;
        }

        // Parse header row to find month columns
        // Row format: ["Sales Order", "October", "November", "December", "January", "February", "March"]
        const headerRow = values[0];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                            'July', 'August', 'September', 'October', 'November', 'December'];

        // Build a map of month name -> column index
        const monthToColumn = new Map<string, number>();
        headerRow.forEach((cell: string, index: number) => {
            if (cell && index > 0) {
                const monthName = String(cell).trim();
                if (monthNames.includes(monthName)) {
                    monthToColumn.set(monthName, index);
                }
            }
        });

        // Determine which month column to use (previous month relative to selected date)
        const selectedMonth = selectedDate.getMonth(); // 0-11
        const previousMonth = selectedMonth === 0 ? 11 : selectedMonth - 1;
        const previousMonthName = monthNames[previousMonth];

        // Try to find the column for the previous month, with fallback logic
        let columnIndex = monthToColumn.get(previousMonthName);

        // If not found or column is empty, try earlier months as fallback
        if (columnIndex === undefined) {
            // Try to find any available column, preferring most recent
            const availableMonths = Array.from(monthToColumn.keys());
            if (availableMonths.length > 0) {
                // Find the closest previous month that has data
                for (let offset = 1; offset <= 12; offset++) {
                    const fallbackMonth = (previousMonth - offset + 12) % 12;
                    const fallbackMonthName = monthNames[fallbackMonth];
                    if (monthToColumn.has(fallbackMonthName)) {
                        columnIndex = monthToColumn.get(fallbackMonthName);
                        console.log(`Sales rankings: Using ${fallbackMonthName} as fallback for ${previousMonthName}`);
                        break;
                    }
                }
            }
        }

        // If still no column found, use the first available month column
        if (columnIndex === undefined && monthToColumn.size > 0) {
            columnIndex = Array.from(monthToColumn.values())[0];
        }

        if (columnIndex === undefined) {
            console.warn('No valid month columns found in sales rankings sheet');
            return rankMap;
        }

        // Check if the selected column has data, if not try previous months
        const dataRows = values.slice(1);
        let hasData = dataRows.some((row: any[]) => row[columnIndex!] && String(row[columnIndex!]).trim());

        if (!hasData) {
            // Try earlier months until we find data
            const monthOrder = Array.from(monthToColumn.entries()).sort((a, b) => {
                const aMonth = monthNames.indexOf(a[0]);
                const bMonth = monthNames.indexOf(b[0]);
                return bMonth - aMonth; // Sort descending (most recent first)
            });

            for (const [monthName, colIdx] of monthOrder) {
                if (colIdx !== columnIndex) {
                    hasData = dataRows.some((row: any[]) => row[colIdx] && String(row[colIdx]).trim());
                    if (hasData) {
                        columnIndex = colIdx;
                        console.log(`Sales rankings: Using ${monthName} (has data) instead of empty column`);
                        break;
                    }
                }
            }
        }

        // Iterate through data rows and build the rankings from the selected column
        let rank = 1;
        dataRows.forEach((row: any[]) => {
            const name = row[columnIndex!];
            if (name && String(name).trim()) {
                const nameStr = String(name).trim();
                // Skip header-like rows
                if (nameStr.toLowerCase().includes('sales order')) return;

                const normalized = normalizeName(nameStr);
                // Only set if not already present (in case of duplicates, first one wins as higher rank)
                if (normalized && !rankMap.has(normalized)) {
                    rankMap.set(normalized, rank);
                    rank++;
                }
            }
        });
    } catch (error) {
        console.error("Error fetching sales rankings:", error);
    }
    return rankMap;
}

// Fetches and parses the rep skills from the 'Appointment Blocks' sheet.
async function fetchRepSkills(): Promise<Map<string, { skills: Record<string, number>, zipCodes: string[] }>> {
    const skillsMap = new Map<string, { skills: Record<string, number>, zipCodes: string[] }>();
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(SKILLS_SHEET_TITLE)}'!${SKILLS_DATA_RANGE}?key=${GOOGLE_API_KEY}`;
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            console.error(`Failed to fetch skills sheet: ${response.statusText}`);
            return skillsMap; // Return empty map on failure
        }
        const data = await response.json();
        const values = data.values;

        if (!values || values.length < 2) {
            console.warn('Skills sheet is empty or has only a header.');
            return skillsMap;
        }

        const headers = values[0].map((h: string) => h.trim());
        const skillRows = values.slice(1);

        const zipCodeColumnIndex = headers.findIndex(h => h.toLowerCase().includes('zip'));

        for (const currentRow of skillRows) {
            const repName = currentRow[0];
            if (!repName) continue; // Skip empty rows

            const normalizedName = normalizeName(repName);
            const skills: Record<string, number> = {};

            const skillHeaders = headers.slice(1, zipCodeColumnIndex > 0 ? zipCodeColumnIndex : headers.length);

            skillHeaders.forEach((skillName: string, headerIndex: number) => {
                const dataColumnIndex = headerIndex + 1; // +1 to account for 'Rep Name' column (A) being at index 0.
                const skillValueString = currentRow[dataColumnIndex];
                const skillValue = parseInt(skillValueString, 10);
                if (!isNaN(skillValue)) {
                    skills[skillName] = skillValue;
                }
            });

            let zipCodes: string[] = [];
            if (zipCodeColumnIndex > -1 && currentRow[zipCodeColumnIndex]) {
                const zipString = String(currentRow[zipCodeColumnIndex]);
                zipCodes = zipString.split(/[,;\s]+/).map(zip => zip.trim()).filter(Boolean);
            }

            skillsMap.set(normalizedName, { skills, zipCodes });
        }
    } catch (error) {
        console.error("Error fetching or parsing rep skills:", error);
    }
    return skillsMap;
}

/**
 * Fetches Job IDs and addresses from the Roofr sheet to build a lookup map.
 * @returns A promise resolving to a Map where the key is a normalized address and the value is the Roofr Job ID.
 */
export async function fetchRoofrJobIds(): Promise<Map<string, string>> {
    const addressToIdMap = new Map<string, string>();
    try {
        // Fetch from both 'Main' and 'Import' tabs
        const sheets = [ROOFR_JOBS_SHEET_TITLE, 'Import'];

        for (const sheetName of sheets) {
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${ROOFR_JOBS_SPREADSHEET_ID}/values/'${encodeURIComponent(sheetName)}'!${ROOFR_JOBS_DATA_RANGE}?key=${GOOGLE_API_KEY}&valueRenderOption=FORMATTED_VALUE`;
            const response = await fetchWithRetry(url);
            if (!response.ok) {
                console.warn(`Failed to fetch Roofr job IDs from ${sheetName}: ${response.statusText}`);
                continue; // Try next sheet
            }
            const data = await response.json();
            const values = data.values;

            if (!values || values.length === 0) {
                console.warn(`${sheetName} sheet appears to be empty.`);
                continue; // Try next sheet
            }


            let successCount = 0;
            let failCount = 0;

            values.forEach((row: any[], index: number) => {
                const [jobId, address] = row;

                if (jobId && address) {
                    const normalizedAddress = normalizeAddressForMatching(String(address));
                    if (normalizedAddress) {
                        // Avoid overwriting with empty IDs if a duplicate address exists
                        if (!addressToIdMap.has(normalizedAddress)) {
                            addressToIdMap.set(normalizedAddress, String(jobId));
                            successCount++;
                        }
                    } else {
                        failCount++;
                    }
                }
            });

        }
    } catch (error) {
        console.error("Error fetching Roofr job IDs:", error);
    }
    return addressToIdMap;
}

/**
 * Fetches rep availability data directly from the Google Sheets API based on the visual layout.
 * This requires the spreadsheet to be public ("Anyone with the link can view").
 * @param date The date for which to fetch availability. Defaults to today.
 */
export async function fetchSheetData(date: Date = new Date()): Promise<{ reps: Omit<Rep, 'schedule'>[], sheetName: string }> {
    let sheetName = '';
    try {
        // 0. Fetch skills and rankings data in parallel
        const skillsPromise = fetchRepSkills();
        const ranksPromise = fetchSalesRankings(date);

        // 1. Get spreadsheet metadata to find the current sheet name
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${GOOGLE_API_KEY}`;
        const metaResponse = await fetchWithRetry(metaUrl);
        if (!metaResponse.ok) {
            throw new Error(`Failed to fetch spreadsheet metadata (Status: ${metaResponse.status}). Is the spreadsheet ID correct and public?`);
        }
        const metaData = await metaResponse.json();

        const foundSheetName = findSheetNameForDate(date, metaData.sheets);

        if (!foundSheetName) {
            throw new Error(`No sheet found in the spreadsheet with the prefix "${SHEET_TITLE_PREFIX}".`);
        }
        sheetName = foundSheetName;

        // 2. Fetch the data from the specified range, getting the formatted values.
        const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(sheetName)}'!${DATA_RANGE}?key=${GOOGLE_API_KEY}&valueRenderOption=FORMATTED_VALUE`;
        const dataResponse = await fetchWithRetry(dataUrl);
        if (!dataResponse.ok) {
            throw new Error(`Failed to fetch sheet data (Status: ${dataResponse.status}). Check API key and spreadsheet permissions.`);
        }
        const data = await dataResponse.json();
        const values = data.values;
        if (!values || values.length < 2) { // Need at least header and one data row
            console.warn("Sheet has no data or only a header row.");
            if (USE_MOCK_DATA_ON_FAILURE) return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data' };
            return { reps: [], sheetName };
        }

        // 3. Parse header row to dynamically find day columns
        const headerRow = values[0];
        const days: { name: string; colIndex: number }[] = [];
        const dayRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;

        headerRow.forEach((cell: any, index: number) => {
            if (index > 0 && cell) { // Skip first column (A)
                const cellAsString = String(cell); // Ensure value is a string before trimming
                const match = cellAsString.trim().match(dayRegex);
                if (match) {
                    // Normalize day name to proper case (e.g., "Monday" not "MONDAY")
                    const normalizedDayName = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
                    days.push({ name: normalizedDayName, colIndex: index });
                }
            }
        });

        if (days.length === 0) {
            throw new Error("Could not find valid day headers in row 2 (e.g., 'Monday 10/27').");
        }

        // 4. Parse data rows into Rep structure
        const repsMap = new Map<string, { name: string; unavailableSlots: Record<string, Set<string>>; firstRowIndex: number }>();
        const timeSlotLabelsToIds = new Map(TIME_SLOTS.map(slot => [slot.label.trim().toLowerCase(), slot.id]));
        const dataRows = values.slice(1);

        let currentRepContext: string | null = null;

        for (const [rowIndex, row] of dataRows.entries()) {
            const firstCol = String(row?.[0] || '').trim();
            if (!firstCol) {
                currentRepContext = null;
                continue;
            }

            if (firstCol.toUpperCase() === firstCol && firstCol.replace(/[^A-Z\s]/g, '').length > 1) {
                currentRepContext = null;
                continue;
            }

            let wasRowProcessed = false;

            for (const [label, id] of timeSlotLabelsToIds.entries()) {
                const labelRegex = new RegExp(label.replace(/(\s-\s)/, '\\s?-\\s?') + '$', 'i');
                if (labelRegex.test(firstCol)) {
                    const slotId = id;
                    let repName = firstCol.replace(labelRegex, '').trim().replace(/:$/, '').trim();

                    if (!repName && currentRepContext) {
                        repName = currentRepContext;
                    }

                    if (!repName) {
                        wasRowProcessed = true;
                        break;
                    }

                    currentRepContext = repName;

                    if (!repsMap.has(repName)) {
                        repsMap.set(repName, {
                            name: repName,
                            unavailableSlots: Object.fromEntries(days.map(d => [d.name, new Set()])),
                            firstRowIndex: rowIndex + 2 // Sheet rows are 1-based, and we sliced the header.
                        });
                    }

                    const repData = repsMap.get(repName)!;
                    days.forEach(day => {
                        const availabilityMark = row[day.colIndex];

                        // New, more robust availability logic. Default to AVAILABLE unless explicitly marked otherwise.
                        // This handles empty cells, "TRUE", boolean true, and '✅' as AVAILABLE.
                        // It handles "FALSE", boolean false, and any other text as UNAVAILABLE.
                        const availabilityMarkStr = String(availabilityMark ?? '').trim();
                        const isExplicitlyUnavailable =
                            availabilityMark === false ||
                            availabilityMarkStr.toUpperCase() === 'FALSE' ||
                            (availabilityMarkStr !== '' && availabilityMarkStr.toUpperCase() !== 'TRUE' && availabilityMarkStr !== '✅');

                        if (isExplicitlyUnavailable) {
                            repData.unavailableSlots[day.name].add(slotId);
                        }
                    });

                    wasRowProcessed = true;
                    break;
                }
            }

            if (!wasRowProcessed && firstCol) {
                currentRepContext = firstCol.replace(/:$/, '').trim();
            }
        }

        const skillsMap = await skillsPromise;
        const rankingsMap = await ranksPromise;

        // 5. Convert the map into the final array of Rep objects and merge skills
        const reps: Omit<Rep, 'schedule'>[] = Array.from(repsMap.values()).map((repData, index) => {
            const availableDaysSummary: string[] = [];
            days.forEach(day => {
                const unavailableCount = repData.unavailableSlots[day.name]?.size || 0;
                if (unavailableCount < TIME_SLOTS.length) {
                    availableDaysSummary.push(day.name.substring(0, 3));
                }
            });

            const availability = availableDaysSummary.join(', ') || 'Not available';

            const finalUnavailableSlots: Record<string, string[]> = {};
            for (const day in repData.unavailableSlots) {
                finalUnavailableSlots[day] = Array.from(repData.unavailableSlots[day]);
            }

            const displayName = cleanDisplayName(repData.name);
            const normalizedName = normalizeName(displayName); // Use the cleaned name for normalization

            const repInfo = skillsMap.get(normalizedName);
            const skills = repInfo?.skills;
            const zipCodes = repInfo?.zipCodes;
            const salesRank = rankingsMap.get(normalizedName);

            const { firstRowIndex } = repData;
            let region: Rep['region'] = 'UNKNOWN';
            if (firstRowIndex >= 2 && firstRowIndex <= 118) {
                region = 'PHX';
            } else if (firstRowIndex >= 119 && firstRowIndex <= 135) {
                region = 'NORTH';
            } else if (firstRowIndex >= 136 && firstRowIndex <= 152) {
                region = 'SOUTH';
            }

            return {
                id: `rep-${index + 1}-${displayName.replace(/\s+/g, '-')}`,
                name: displayName,
                availability,
                unavailableSlots: finalUnavailableSlots,
                skills,
                zipCodes,
                region,
                salesRank,
                sourceRow: firstRowIndex // Track source row for filtering
            }
        });

        if (reps.length === 0) {
            console.warn("Successfully connected and data was found, but no valid rep data could be parsed. Check the sheet format.");
            if (USE_MOCK_DATA_ON_FAILURE) {
                return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data' };
            }
        }

        return { reps, sheetName };

    } catch (error) {
        console.error("Error fetching from Google Sheets API:", error);
        if (USE_MOCK_DATA_ON_FAILURE) {
            console.warn("Google Sheets fetch failed. Falling back to mock data.");
            return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data' };
        } else {
            throw error;
        }
    }
}

/**
 * Fetches a single cell's value from a given sheet.
 * @param cell The cell reference (e.g., "A1").
 * @param sheetName The name of the sheet to query.
 * @returns The value of the cell as a string.
 */
export async function fetchSheetCell(cell: string, sheetName: string): Promise<string> {
    if (!sheetName) {
        throw new Error('Sheet name must be provided to fetch a cell.');
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(sheetName)}'!${encodeURIComponent(cell)}?key=${GOOGLE_API_KEY}&valueRenderOption=FORMATTED_VALUE`;

    try {
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch cell ${cell} (Status: ${response.status})`);
        }
        const data = await response.json();
        const value = data.values?.[0]?.[0];

        if (value === undefined || value === null || value === "") {
            return '(empty)';
        }
        return String(value);
    } catch (err) {
        console.error(`Error fetching cell data for ${cell} from ${sheetName}:`, err);
        throw new Error(`Could not retrieve data for cell ${cell}.`);
    }
}

/**
 * Fetches an announcement message from cell A2 of the Roofr jobs sheet.
 * @returns The value of the cell as a string, or an empty string.
 */
export async function fetchAnnouncementMessage(): Promise<string> {
    const cell = 'A2';
    const sheetName = ROOFR_JOBS_SHEET_TITLE;
    const spreadsheetId = ROOFR_JOBS_SPREADSHEET_ID;

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!${encodeURIComponent(cell)}?key=${GOOGLE_API_KEY}&valueRenderOption=FORMATTED_VALUE`;

    try {
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            console.warn(`Failed to fetch announcement cell ${cell} (Status: ${response.status})`);
            return '';
        }
        const data = await response.json();
        const value = data.values?.[0]?.[0];

        return value ? String(value) : '';
    } catch (err) {
        console.error(`Error fetching announcement data from ${sheetName}:`, err);
        return '';
    }
}
