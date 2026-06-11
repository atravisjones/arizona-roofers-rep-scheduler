import { Job, Rep } from '../types';
import { FLAGSTAFF_ZONE_CITIES, I17_CORRIDOR_CITIES, NORTHERN_AZ_CITIES, SR87_CORRIDOR_CITIES } from '../services/geography';
import { northRoutingEligibility } from '../services/northRoutingConfig';

/**
 * Checks if a rep is London Smith
 */
export const isLondon = (rep: Rep): boolean =>
    rep.name.trim().toLowerCase().startsWith('london smith');

export const isI17CorridorRep = (rep: Rep): boolean => {
    const name = rep.name.trim().toLowerCase();
    return [...northRoutingEligibility.I17.repNamePrefixes].some(prefix => name.startsWith(prefix));
};

export const isEastValleyRep = (rep: Rep): boolean => {
    const name = rep.name.trim().toLowerCase();
    const matchesName = [...northRoutingEligibility.SR87.repNamePrefixes].some(prefix => name.startsWith(prefix));
    const matchesZip = rep.zipCodes?.some(zip =>
        [...northRoutingEligibility.SR87.zipPrefixes].some(prefix => zip.trim().startsWith(prefix))
    ) ?? false;
    return matchesName || matchesZip;
};

const isFlagstaffRep = (rep: Rep): boolean => {
    const name = rep.name.trim().toLowerCase();
    return [...northRoutingEligibility.FLAGSTAFF.repNamePrefixes].some(prefix => name.startsWith(prefix));
};

export type NorthZone = 'FLAGSTAFF' | 'I17' | 'SR87' | 'FALLBACK';

export const getNorthZone = (city: string | null | undefined): NorthZone | null => {
    const normalizedCity = (city || '').toLowerCase().trim();
    if (FLAGSTAFF_ZONE_CITIES.has(normalizedCity)) return 'FLAGSTAFF';
    if (I17_CORRIDOR_CITIES.has(normalizedCity)) return 'I17';
    if (SR87_CORRIDOR_CITIES.has(normalizedCity)) return 'SR87';
    if (NORTHERN_AZ_CITIES.has(normalizedCity)) return 'FALLBACK';
    return null;
};

export const isRepEligibleForNorthZone = (rep: Rep, zone: NorthZone): boolean => {
    if (zone === 'I17') return isI17CorridorRep(rep);
    if (zone === 'SR87') return isEastValleyRep(rep);
    if (zone === 'FLAGSTAFF') return isFlagstaffRep(rep);
    return isLondon(rep);
};

const getAdjacentTravelSlotId = (rep: Rep, slotId: string): string | null => {
    const slotIndex = rep.schedule.findIndex(slot => slot.id === slotId);
    if (slotIndex === -1) return null;
    const adjacentIndex = slotIndex === rep.schedule.length - 1 ? slotIndex - 1 : slotIndex + 1;
    return rep.schedule[adjacentIndex]?.id || null;
};

export const getTravelBlockedSlots = (rep: Rep): string[] => {
    if (isLondon(rep)) return [];

    const blockedSlots = new Set<string>();
    rep.schedule.forEach(slot => {
        if (!slot.jobs.some(job => getNorthZone(job.city) !== null)) return;
        const adjacentSlotId = getAdjacentTravelSlotId(rep, slot.id);
        if (adjacentSlotId) blockedSlots.add(adjacentSlotId);
    });
    return [...blockedSlots];
};

export const canReserveNorthTravelSlot = (rep: Rep, job: Job, slotId: string): boolean => {
    if (isLondon(rep)) return true;
    const targetSlot = rep.schedule.find(slot => slot.id === slotId);
    if (targetSlot?.jobs.some(scheduledJob => getNorthZone(scheduledJob.city) !== null)) return false;
    if (getNorthZone(job.city) === null) return true;
    if (targetSlot && targetSlot.jobs.length > 0) return false;
    const adjacentSlotId = getAdjacentTravelSlotId(rep, slotId);
    if (!adjacentSlotId) return true;
    return rep.schedule.find(slot => slot.id === adjacentSlotId)?.jobs.length === 0;
};

/**
 * Checks if a rep is a field sales rep (not management or door knocker).
 * Used for filtering summary reports to only show actual sales reps.
 */
export const isFieldSalesRep = (rep: Rep): boolean => {
    const nameLower = rep.name.trim().toLowerCase();

    // Specific names to exclude (management and door knockers)
    const excludedNames = [
        'anthony bonomo',
        'yousef ayad',
        'bradley crohurst',
        'brenda ochoa',
        'phillip merrell',
        'brett jackson',
    ];

    // Check if name matches any excluded name
    for (const name of excludedNames) {
        if (nameLower.startsWith(name)) {
            return false;
        }
    }

    // Exclude management roles by pattern
    const managementPatterns = [
        'manager', 'director', 'owner', 'admin', 'coordinator',
        'supervisor', 'lead', 'chief', 'vp ', 'vice president',
        'ceo', 'cfo', 'coo', 'president', 'executive'
    ];

    // Exclude door knockers (common abbreviations and full terms)
    const doorKnockerPatterns = [
        'door knock', 'doorknock', 'dk ', ' dk', 'knocker',
        'canvass', 'canvas'
    ];

    // Check if name matches any exclusion pattern
    for (const pattern of [...managementPatterns, ...doorKnockerPatterns]) {
        if (nameLower.includes(pattern)) {
            return false;
        }
    }

    return true;
};

/**
 * Gets sheet-unavailable slots plus adjacent travel slots consumed by north jobs.
 * @param rep The rep to check
 * @param dayName The day of the week (e.g., "Monday", "Sunday")
 * @returns Array of unavailable slot IDs (empty array = fully available)
 */
export const getEffectiveUnavailableSlots = (rep: Rep, dayName: string): string[] => {
    return [...new Set([...(rep.unavailableSlots?.[dayName] || []), ...getTravelBlockedSlots(rep)])];
};
