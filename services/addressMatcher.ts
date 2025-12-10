/**
 * Enhanced Address Matching Service
 *
 * This service provides fuzzy matching and address variation generation
 * to improve matching rates between job addresses and Roofr database addresses.
 */

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of addresses
 */
function levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Calculate similarity score (0-1) between two strings
 * 1 = perfect match, 0 = completely different
 */
export function calculateSimilarity(str1: string, str2: string): number {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;
    const distance = levenshteinDistance(str1, str2);
    return 1 - (distance / maxLen);
}

/**
 * Extract street number from an address
 */
function extractStreetNumber(address: string): string | null {
    const match = address.match(/^(\d+)/);
    return match ? match[1] : null;
}

/**
 * Generate address variations for better matching
 * This handles common abbreviation differences and formatting variations
 */
export function generateAddressVariations(address: string): string[] {
    const variations = new Set<string>();
    const normalized = address.toLowerCase().trim();

    // Add original normalized version
    variations.add(normalized);

    // Extract street number - if no street number, return only the original
    const streetNumber = extractStreetNumber(normalized);
    if (!streetNumber) return [normalized];

    // Direction variations: N/North, S/South, E/East, W/West
    const directionVariations = [
        // North variations
        { patterns: [/\bnorth\b/g, /\bn\b/g, /\bn\./g], replacements: ['north', 'n'] },
        // South variations
        { patterns: [/\bsouth\b/g, /\bs\b/g, /\bs\./g], replacements: ['south', 's'] },
        // East variations
        { patterns: [/\beast\b/g, /\be\b/g, /\be\./g], replacements: ['east', 'e'] },
        // West variations
        { patterns: [/\bwest\b/g, /\bw\b/g, /\bw\./g], replacements: ['west', 'w'] },
    ];

    // Street type variations: St/Street, Rd/Road, etc.
    const streetTypeVariations = [
        { patterns: [/\bstreet\b/g, /\bst\b/g, /\bst\./g], replacements: ['street', 'st'] },
        { patterns: [/\broad\b/g, /\brd\b/g, /\brd\./g], replacements: ['road', 'rd'] },
        { patterns: [/\bdrive\b/g, /\bdr\b/g, /\bdr\./g], replacements: ['drive', 'dr'] },
        { patterns: [/\bavenue\b/g, /\bave\b/g, /\bave\./g, /\bav\b/g], replacements: ['avenue', 'ave', 'av'] },
        { patterns: [/\bboulevard\b/g, /\bblvd\b/g, /\bblvd\./g], replacements: ['boulevard', 'blvd'] },
        { patterns: [/\blane\b/g, /\bln\b/g, /\bln\./g], replacements: ['lane', 'ln'] },
        { patterns: [/\bcourt\b/g, /\bct\b/g, /\bct\./g], replacements: ['court', 'ct'] },
        { patterns: [/\bplace\b/g, /\bpl\b/g, /\bpl\./g], replacements: ['place', 'pl'] },
        { patterns: [/\btrail\b/g, /\btrl\b/g, /\btrl\./g], replacements: ['trail', 'trl'] },
        { patterns: [/\bcircle\b/g, /\bcir\b/g, /\bcir\./g], replacements: ['circle', 'cir'] },
        { patterns: [/\bway\b/g, /\bwy\b/g, /\bwy\./g], replacements: ['way', 'wy'] },
        { patterns: [/\bparkway\b/g, /\bpkwy\b/g, /\bpkwy\./g], replacements: ['parkway', 'pkwy'] },
        { patterns: [/\bterrace\b/g, /\bter\b/g, /\bter\./g], replacements: ['terrace', 'ter'] },
    ];

    // Generate variations by applying different abbreviation combinations
    const baseAddresses = [normalized];

    // Apply direction variations
    directionVariations.forEach(({ patterns, replacements }) => {
        const newBases = [...baseAddresses];
        baseAddresses.forEach(addr => {
            patterns.forEach(pattern => {
                if (pattern.test(addr)) {
                    replacements.forEach(replacement => {
                        newBases.push(addr.replace(pattern, replacement));
                    });
                }
            });
        });
        baseAddresses.push(...newBases);
    });

    // Apply street type variations
    streetTypeVariations.forEach(({ patterns, replacements }) => {
        const newBases = [...baseAddresses];
        baseAddresses.forEach(addr => {
            patterns.forEach(pattern => {
                if (pattern.test(addr)) {
                    replacements.forEach(replacement => {
                        newBases.push(addr.replace(pattern, replacement));
                    });
                }
            });
        });
        baseAddresses.push(...newBases);
    });

    // Add all variations to the set (automatically deduplicates)
    baseAddresses.forEach(addr => {
        // Clean up: remove extra spaces, punctuation
        const cleaned = addr
            .replace(/[.,#]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleaned) {
            variations.add(cleaned);
        }
    });

    return Array.from(variations);
}

/**
 * Find best match for an address from a list of candidates
 * Returns the best matching candidate and similarity score
 */
export interface MatchResult {
    match: string | null;
    score: number;
    value?: any; // Associated value (e.g., job ID)
}

export function findBestMatch(
    targetAddress: string,
    candidates: Map<string, any>,
    threshold: number = 0.85
): MatchResult {
    let bestMatch: string | null = null;
    let bestScore = 0;
    let bestValue: any = null;

    // Generate variations of the target address
    const targetVariations = generateAddressVariations(targetAddress);

    // Check for exact matches first
    for (const variation of targetVariations) {
        if (candidates.has(variation)) {
            return {
                match: variation,
                score: 1.0,
                value: candidates.get(variation)
            };
        }
    }

    // If no exact match, try fuzzy matching
    const targetStreetNumber = extractStreetNumber(targetAddress.toLowerCase());
    if (!targetStreetNumber) {
        return { match: null, score: 0 };
    }

    for (const [candidateKey, candidateValue] of candidates.entries()) {
        // Only compare addresses with the same street number (performance optimization)
        const candidateStreetNumber = extractStreetNumber(candidateKey);
        if (candidateStreetNumber !== targetStreetNumber) {
            continue;
        }

        // Try matching each variation of target against this candidate
        for (const targetVar of targetVariations) {
            const score = calculateSimilarity(targetVar, candidateKey);
            if (score > bestScore && score >= threshold) {
                bestScore = score;
                bestMatch = candidateKey;
                bestValue = candidateValue;
            }
        }
    }

    return {
        match: bestMatch,
        score: bestScore,
        value: bestValue
    };
}

/**
 * Create a searchable address map with variations
 * This pre-generates variations for all addresses in the database
 * for more efficient matching
 */
export function createAddressVariationMap(
    addressMap: Map<string, any>
): Map<string, any> {
    const variationMap = new Map<string, any>();

    for (const [address, value] of addressMap.entries()) {
        const variations = generateAddressVariations(address);
        variations.forEach(variation => {
            // If multiple addresses generate the same variation,
            // keep the first one (could be improved with better conflict resolution)
            if (!variationMap.has(variation)) {
                variationMap.set(variation, value);
            }
        });
    }

    return variationMap;
}
