import { FLAGSTAFF_ZONE_CITIES, I17_CORRIDOR_CITIES, SR87_CORRIDOR_CITIES } from './geography';

export type ConfigurableNorthZone = 'I17' | 'SR87' | 'FLAGSTAFF';

export interface NorthRoutingZoneConfig {
    cities: string[];
    repNamePrefixes: string[];
    zipPrefixes: string[];
}

const zoneCitySets: Record<ConfigurableNorthZone, Set<string>> = {
    I17: I17_CORRIDOR_CITIES,
    SR87: SR87_CORRIDOR_CITIES,
    FLAGSTAFF: FLAGSTAFF_ZONE_CITIES,
};

const defaultZoneCities: Record<ConfigurableNorthZone, string[]> = {
    I17: [...I17_CORRIDOR_CITIES],
    SR87: [...SR87_CORRIDOR_CITIES],
    FLAGSTAFF: [...FLAGSTAFF_ZONE_CITIES],
};

const defaultEligibility: Record<ConfigurableNorthZone, {
    repNamePrefixes: string[];
    zipPrefixes: string[];
}> = {
    I17: {
        repNamePrefixes: ['christian noren', 'justin parker'],
        zipPrefixes: [],
    },
    SR87: {
        repNamePrefixes: [],
        zipPrefixes: ['852'],
    },
    FLAGSTAFF: {
        repNamePrefixes: ['london smith'],
        zipPrefixes: [],
    },
};

export const northRoutingEligibility: Record<ConfigurableNorthZone, {
    repNamePrefixes: Set<string>;
    zipPrefixes: Set<string>;
}> = {
    I17: {
        repNamePrefixes: new Set(defaultEligibility.I17.repNamePrefixes),
        zipPrefixes: new Set(defaultEligibility.I17.zipPrefixes),
    },
    SR87: {
        repNamePrefixes: new Set(defaultEligibility.SR87.repNamePrefixes),
        zipPrefixes: new Set(defaultEligibility.SR87.zipPrefixes),
    },
    FLAGSTAFF: {
        repNamePrefixes: new Set(defaultEligibility.FLAGSTAFF.repNamePrefixes),
        zipPrefixes: new Set(defaultEligibility.FLAGSTAFF.zipPrefixes),
    },
};

export function resetNorthRoutingZoneDefault(zone: ConfigurableNorthZone): void {
    const citySet = zoneCitySets[zone];
    citySet.clear();
    defaultZoneCities[zone].forEach(city => citySet.add(city));

    const eligibility = northRoutingEligibility[zone];
    eligibility.repNamePrefixes.clear();
    defaultEligibility[zone].repNamePrefixes.forEach(name => eligibility.repNamePrefixes.add(name));
    eligibility.zipPrefixes.clear();
    defaultEligibility[zone].zipPrefixes.forEach(zip => eligibility.zipPrefixes.add(zip));
}

export function applyNorthRoutingZoneConfig(zone: ConfigurableNorthZone, config: NorthRoutingZoneConfig): boolean {
    const cities = config.cities.map(city => city.trim().toLowerCase()).filter(Boolean);
    if (cities.length === 0) return false;

    const citySet = zoneCitySets[zone];
    citySet.clear();
    cities.forEach(city => citySet.add(city));

    const eligibility = northRoutingEligibility[zone];
    eligibility.repNamePrefixes.clear();
    config.repNamePrefixes
        .map(name => name.trim().toLowerCase())
        .filter(Boolean)
        .forEach(name => eligibility.repNamePrefixes.add(name));

    eligibility.zipPrefixes.clear();
    config.zipPrefixes
        .map(zip => zip.trim())
        .filter(Boolean)
        .forEach(zip => eligibility.zipPrefixes.add(zip));

    return true;
}
