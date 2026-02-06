import { Rep } from '../types';
import { TIME_SLOTS } from '../constants';

/**
 * Checks if a rep is London Smith
 */
export const isLondon = (rep: Rep): boolean =>
    rep.name.trim().toLowerCase().startsWith('london smith');

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
 * Gets the effective unavailable slots for a rep on a given day.
 * Special handling for London Smith: always available except Sundays.
 * @param rep The rep to check
 * @param dayName The day of the week (e.g., "Monday", "Sunday")
 * @returns Array of unavailable slot IDs (empty array = fully available)
 */
export const getEffectiveUnavailableSlots = (rep: Rep, dayName: string): string[] => {
    if (isLondon(rep)) {
        // London Smith is unavailable ONLY on Sundays
        if (dayName === 'Sunday') {
            return TIME_SLOTS.map(s => s.id); // All slots unavailable on Sunday
        }
        return []; // Available all other days
    }
    return rep.unavailableSlots?.[dayName] || [];
};
