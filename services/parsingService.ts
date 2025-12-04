import { Job, Rep, ParsedJobsResult } from '../types';
import { TIME_SLOTS, TAG_KEYWORDS } from '../constants';
import { ALL_KNOWN_CITIES } from './geography';

/**
 * Helper to get the 24-hour start hour from a time string (e.g., "7:30am", "1pm").
 * @param timeString The time string to parse.
 * @returns The hour in 24-hour format (0-23) or null.
 */
const getStartHour24 = (timeString: string): number | null => {
    const match = timeString.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return null;

    let [_, hourStr, minuteStr, period] = match;
    let hour = parseInt(hourStr, 10);
    
    period = period?.toLowerCase();

    if (period === 'pm' && hour < 12) {
        hour += 12;
    }
    if (period === 'am' && hour === 12) { // 12am is 00:00
        hour = 0;
    }
    return hour;
};

/**
 * Maps a job's timeframe string to a predefined time slot ID.
 * @param timeframe The timeframe string (e.g., "7:30am-9am").
 * @returns The matching slot ID ('ts-1', 'ts-2', etc.) or null.
 */
export const mapTimeframeToSlotId = (timeframe: string): string | null => {
    const jobStartHour = getStartHour24(timeframe);
    if (jobStartHour === null) return null;

    if (jobStartHour >= 7 && jobStartHour < 10) return 'ts-1'; // 7:30am - 10am
    if (jobStartHour >= 10 && jobStartHour < 13) return 'ts-2'; // 10am - 1pm
    if (jobStartHour >= 13 && jobStartHour < 16) return 'ts-3'; // 1pm - 4pm
    if (jobStartHour >= 16 && jobStartHour < 19) return 'ts-4'; // 4pm - 7pm
    
    return null;
};

/**
 * Builds a list of searchable name variations for each rep to find them in text.
 * This is now more robust, creating multiple formats for better matching.
 * @param reps The list of all representative objects.
 * @returns An array of objects, each containing a rep and their name variations.
 */
const buildRepNameMatchers = (reps: Rep[]): { rep: Rep; searchTerms: string[] }[] => {
    return reps.map(rep => {
        const terms = new Set<string>();
        const originalName = rep.name.toLowerCase();

        // Clean the full name by removing quotes and known region suffixes.
        const cleanedFullName = originalName
            .replace(/"/g, '') // remove quotes
            .replace(/\s+\(.*\)$/, '') // remove anything in parentheses (e.g., "(Sample)")
            .replace(/\s+(phoenix|tucson)$/i, '') // remove region tags
            .trim();
        
        // The primary search term is the cleaned full name.
        if (cleanedFullName && cleanedFullName.includes(' ')) {
            terms.add(cleanedFullName);
        }
        
        const parts = cleanedFullName.split(' ').filter(p => p.length > 1);
        
        if (parts.length > 2) {
             terms.add(`${parts[0]} ${parts[parts.length - 1]}`);
        }
        
        if (/^[a-zA-Z]+\s[a-zA-Z]$/.test(cleanedFullName)) {
            terms.add(cleanedFullName);
        }

        const finalTerms = Array.from(terms).filter(t => t && t.trim().length > 1);

        return {
            rep,
            searchTerms: [...new Set(finalTerms)].sort((a, b) => b.length - a.length)
        };
    });
};


/**
 * Parses jobs from a pasted text block.
 * @param text The raw text pasted by the user.
 * @param reps A list of available reps to check against.
 * @returns A promise resolving to jobs, a detected date, and any pre-assignments.
 */
export async function parseJobsFromText(
  text: string,
  reps: Rep[]
): Promise<ParsedJobsResult & { assignments: { jobId: string, repId: string, slotId: string }[] }> {
  const jobs: Job[] = [];
  const assignments: { jobId: string, repId: string, slotId: string }[] = [];
  const repNameMatchers = buildRepNameMatchers(reps);
  
  const lines = text.split('\n');
  
  let detectedDate: string | null = null;
  const dateRegex = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/i;
  const monthMap: { [key: string]: number } = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  
  for (const line of lines.slice(0, 5)) {
    const match = line.trim().match(dateRegex);
    if (match) {
        const [, monthName, day, year] = match;
        const normalizedMonthKey = monthName.toLowerCase().substring(0, 3);
        const month = monthMap[normalizedMonthKey];
        if (month !== undefined) {
          const parsedDate = new Date(parseInt(year), month, parseInt(day));
          const y = parsedDate.getFullYear();
          const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
          const d = String(parsedDate.getDate()).padStart(2, '0');
          detectedDate = `${y}-${m}-${d}`;
          break;
        }
    }
  }

  const timeSlotRegex = /(\d{1,2}(?::\d{2})?(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?(?:am|pm)?)/i;
  let currentTimeframe: string | undefined = undefined;

  const knownCitiesList = Array.from(ALL_KNOWN_CITIES).sort((a, b) => b.length - a.length);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (dateRegex.test(trimmedLine) && trimmedLine.split(' ').length < 6) continue;

    const timeSlotMatch = trimmedLine.match(timeSlotRegex);
    if (timeSlotMatch && /\(\d+\)$/.test(trimmedLine)) {
      currentTimeframe = timeSlotMatch[1];
      continue;
    }

    let assignedRep: Rep | null = null;
    let lineWithoutRep = trimmedLine;
    
    for (const matcher of repNameMatchers) {
        for (const term of matcher.searchTerms) {
            const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedTerm}\\b`, 'i');
            if (regex.test(lineWithoutRep)) {
                assignedRep = matcher.rep;
                lineWithoutRep = lineWithoutRep.replace(regex, '')
                    .replace(/\s*-\s*-\s*/, ' - ')
                    .replace(/\s*-\s*$/, '')
                    .replace(/^\s*-\s*/, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
                break;
            }
        }
        if (assignedRep) break;
    }

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
    }
    
    let notes = '';
    let city = '';
    let zipCode: string | undefined = undefined;
    
    let cityAndNotesPart = nonAddressPart.replace(/\s*-\s*$/, '').trim();

    const lowerNonAddress = nonAddressPart.toLowerCase();
    const matchedCity = knownCitiesList.find(c => lowerNonAddress.startsWith(c));

    if (matchedCity) {
        city = matchedCity.toUpperCase();
        const cityRegex = new RegExp(`^${matchedCity}[,\\.\\s]*`, 'i');
        notes = nonAddressPart.replace(cityRegex, '').trim();
        cityAndNotesPart = notes;
    } else {
        const tagKeywordsRegex = new RegExp(`\\b(${TAG_KEYWORDS.join('|')}|\\d+\\s*S|\\d+\\s*sq\\.?(?:ft)?|\\d+\\s*yrs)\\b|#`, 'i');
        const firstTagMatch = cityAndNotesPart.match(tagKeywordsRegex);
        if (firstTagMatch && firstTagMatch.index !== undefined) {
            city = cityAndNotesPart.substring(0, firstTagMatch.index).trim();
            notes = cityAndNotesPart.substring(firstTagMatch.index).trim();
        } else {
            city = cityAndNotesPart;
            notes = '';
        }
    }

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
            continue;
        }
    }

    if (!city && address) {
        const addressParts = address.split(',');
        if (addressParts.length > 1) {
            const potentialCityPart = addressParts.length > 2 ? addressParts[addressParts.length - 2] : addressParts[1];
            const potentialCity = potentialCityPart.trim();
            if (potentialCity && !/^[A-Z]{2}(\s\d{5})?$/i.test(potentialCity)) {
                city = potentialCity;
            }
        }
    }

    if (!city) {
      continue;
    }
    
    city = city.replace(/[,:.-]\s*$/, '').trim();

    const cityRegex = new RegExp(`^${city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[,:\\s]*`, 'i');
    notes = notes.replace(cityRegex, '').trim();

    if (assignedRep) {
        notes = `${notes} (Rep: ${assignedRep.name})`.trim();
    }

    const hasNumber = /\d/.test(address);
    const hasStreetName = /\b[a-zA-Z]{3,}\b/.test(address);
    if (!address || !hasNumber || !hasStreetName) {
        continue;
    }

    const newJob = {
      id: `job-${Date.now()}-${jobs.length}-${Math.random().toString(36).substring(2, 9)}`,
      customerName: city,
      address, city, notes,
      originalTimeframe: currentTimeframe,
      zipCode,
    };
    jobs.push(newJob);

    if (assignedRep && currentTimeframe) {
        const slotId = mapTimeframeToSlotId(currentTimeframe);
        if (slotId) {
            assignments.push({ jobId: newJob.id, repId: assignedRep.id, slotId });
        }
    }
  }

  const result = { date: detectedDate, jobs, assignments };
  return Promise.resolve(result);
}

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
