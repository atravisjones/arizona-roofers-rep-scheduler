import { GOOGLE_API_KEY, SPREADSHEET_ID, SHEET_TITLE_PREFIX, DATA_RANGE, SKILLS_SHEET_TITLE, SKILLS_DATA_RANGE, SALES_ORDER_DATA_RANGE, USE_MOCK_DATA_ON_FAILURE, ROOFR_JOBS_SPREADSHEET_ID, ROOFR_JOBS_SHEET_TITLE, ROOFR_JOBS_DATA_RANGE } from '../constants';
import { Rep } from '../types';
import { MOCK_REPS_DATA } from './mockData';

// Helper to format a date as MM-DD for sheet name lookup
const getSheetNameFromDate = (date: Date): string => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${SHEET_TITLE_PREFIX} ${month}-${day}`;
};

// Generic fetch utility for Google Sheets API
const fetchSheetValues = async (spreadsheetId: string, range: string): Promise<any[][] | null> => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${GOOGLE_API_KEY}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Google Sheets API error: ${response.status} ${response.statusText}`);
            const errorBody = await response.json();
            console.error("Error details:", errorBody);
            return null;
        }
        const data = await response.json();
        return data.values || [];
    } catch (error) {
        console.error("Failed to fetch from Google Sheets API:", error);
        return null;
    }
};

/**
 * Fetches rep data, skills, and sales ranks from various sheets and combines them.
 * This is the main data loading function for the application.
 */
export const fetchSheetData = async (date: Date): Promise<{ reps: Omit<Rep, 'schedule' | 'isMock'>[], sheetName: string }> => {
    const sheetName = getSheetNameFromDate(date);
    const range = `${sheetName}!${DATA_RANGE}`;

    try {
        const [dailyData, skillsData, salesRankData] = await Promise.all([
            fetchSheetValues(SPREADSHEET_ID, range),
            fetchSheetValues(SPREADSHEET_ID, `${SKILLS_SHEET_TITLE}!${SKILLS_DATA_RANGE}`),
            fetchSheetValues(SPREADSHEET_ID, `${SKILLS_SHEET_TITLE}!${SALES_ORDER_DATA_RANGE}`)
        ]);

        if (!dailyData || !skillsData || !salesRankData) {
            throw new Error("Failed to fetch one or more required sheets.");
        }

        const activeRepNames = new Set(
            dailyData.slice(1) // Skip header row
                .map(row => row[0]) // First column has rep names
                .filter(name => typeof name === 'string' && name.trim())
                .map(name => name.trim())
        );

        if (activeRepNames.size === 0) {
             return { reps: [], sheetName };
        }

        const salesRanks = new Map<string, number>();
        salesRankData.forEach((row, index) => {
            const name = row[0];
            if (typeof name === 'string' && name.trim()) {
                salesRanks.set(name.trim().toLowerCase(), index + 1);
            }
        });

        const reps: Omit<Rep, 'schedule' | 'isMock'>[] = [];
        skillsData.forEach(row => {
            const name = row[0];
            if (typeof name === 'string' && name.trim() && activeRepNames.has(name.trim())) {
                const rep: Omit<Rep, 'schedule' | 'isMock'> = {
                    id: `rep-g-${name.replace(/\s+/g, '-')}`,
                    name: name.trim(),
                    availability: row[1] || 'N/A',
                    skills: {
                        'Tile': parseInt(row[2], 10) || 0,
                        'Shingle': parseInt(row[3], 10) || 0,
                        'Flat': parseInt(row[4], 10) || 0,
                        'Metal': parseInt(row[5], 10) || 0,
                        'Insurance': parseInt(row[6], 10) || 0,
                        'Commercial': parseInt(row[7], 10) || 0,
                    },
                    salesRank: salesRanks.get(name.trim().toLowerCase()),
                    // Placeholder for future data like region, zips
                };
                reps.push(rep);
            }
        });

        return { reps, sheetName };

    } catch (error) {
        console.error("Error in fetchSheetData, using fallback mock data:", error);
        if (USE_MOCK_DATA_ON_FAILURE) {
            return { reps: MOCK_REPS_DATA.map(r => ({ ...r, isMock: true })) as any, sheetName };
        }
        throw error;
    }
};

/**
 * Fetches a map of Roofr job addresses to their corresponding URLs.
 */
export const fetchRoofrJobIds = async (): Promise<Map<string, string>> => {
    const values = await fetchSheetValues(ROOFR_JOBS_SPREADSHEET_ID, `${ROOFR_JOBS_SHEET_TITLE}!${ROOFR_JOBS_DATA_RANGE}`);
    const idMap = new Map<string, string>();

    if (values) {
        values.forEach(row => {
            const address = row[0];
            const url = row[1];
            if (typeof address === 'string' && address.trim() && typeof url === 'string' && url.trim()) {
                idMap.set(address.trim().toLowerCase(), url.trim());
            }
        });
    }
    return idMap;
};

/**
 * Fetches the announcement message from a specific cell.
 */
export const fetchAnnouncementMessage = async (): Promise<string | null> => {
    const range = `${SKILLS_SHEET_TITLE}!A1`; // Assuming announcement is in cell A1 of the skills sheet
    const values = await fetchSheetValues(SPREADSHEET_ID, range);
    if (values && values[0] && values[0][0]) {
        return values[0][0];
    }
    return null;
};

/**
 * Fetches the value of a single cell from a given sheet.
 */
export const fetchSheetCell = async (cellRef: string, sheetName: string): Promise<string | null> => {
    if (!sheetName) return 'No active sheet';
    const range = `${sheetName}!${cellRef}`;
    const values = await fetchSheetValues(SPREADSHEET_ID, range);
    if (values && values[0] && values[0][0]) {
        return values[0][0];
    }
    return `(empty)`;
};
