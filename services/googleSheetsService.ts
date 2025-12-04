import { Rep } from '../types';
import { GOOGLE_API_KEY, SPREADSHEET_ID, ROOFR_JOBS_SPREADSHEET_ID, ROOFR_JOBS_SHEET_TITLE, ROOFR_JOBS_DATA_RANGE } from '../constants';
import { ALL_KNOWN_CITIES } from './geography';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const normalizeAddressForMatching = (address: string): string | null => {
    if (!address) return null;
    
    let addr = address.toLowerCase().trim();
    addr = addr.replace(/(,\s*(az|arizona))?\s+\d{5}(?:-\d{4})?$/, '');
    addr = addr.replace(/,\s*(az|arizona)$/, '');
    addr = addr.trim().replace(/,$/, '').trim();

    const cityList = [...ALL_KNOWN_CITIES].sort((a,b) => b.length - a.length);
    for (const city of cityList) {
        const regex = new RegExp(`,\\s*${city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');
        if (regex.test(addr)) {
            addr = addr.replace(regex, '').trim();
            break;
        }
    }
    
    let streetPart = addr;
    const streetNumberMatch = streetPart.match(/^(\d+)/);
    if (!streetNumberMatch) return null; 

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
        
    streetPart = streetPart.replace(/[^a-z0-9\s]/g, '');
    streetPart = streetPart.replace(/\s+/g, ' ').trim();

    return streetPart;
};

async function fetchWithRetry(url: string, retries = 3, initialDelay = 1000): Promise<Response> {
    let currentDelay = initialDelay;
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok || (response.status < 500 && response.status !== 429)) {
                return response;
            }
            if (i < retries) {
                console.warn(`Google Sheets API attempt ${i + 1} failed (Status ${response.status}). Retrying in ${currentDelay}ms...`);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }
            return response;
        } catch (error) {
            if (i < retries) {
                console.warn(`Google Sheets API network attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`, error);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }
            throw error;
        }
    }
    throw new Error("Fetch failed unexpectedly.");
}

export async function fetchRoofrJobIds(): Promise<Map<string, string>> {
    const addressToIdMap = new Map<string, string>();
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${ROOFR_JOBS_SPREADSHEET_ID}/values/'${encodeURIComponent(ROOFR_JOBS_SHEET_TITLE)}'!${ROOFR_JOBS_DATA_RANGE}?key=${GOOGLE_API_KEY}&valueRenderOption=FORMATTED_VALUE`;
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            console.warn(`Failed to fetch Roofr job IDs: ${response.statusText}`);
            return addressToIdMap;
        }
        const data = await response.json();
        const values = data.values;

        if (!values || values.length === 0) {
            console.warn('Roofr job ID sheet appears to be empty.');
            return addressToIdMap;
        }

        values.forEach((row: any[]) => {
            const [jobId, address] = row;
            if (jobId && address) {
                const normalizedAddress = normalizeAddressForMatching(String(address));
                if (normalizedAddress) {
                    if (!addressToIdMap.has(normalizedAddress)) {
                        addressToIdMap.set(normalizedAddress, String(jobId));
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error fetching Roofr job IDs:", error);
    }
    return addressToIdMap;
}

export async function fetchSheetData(date: Date = new Date()): Promise<{ reps: Omit<Rep, 'schedule'>[], sheetName: string }> {
  console.warn("fetchSheetData is deprecated and should not be called. Data is now loaded from Firebase.");
  return { reps: [], sheetName: 'deprecated' };
}

export async function fetchSheetCell(cell: string, sheetName:string): Promise<string> {
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