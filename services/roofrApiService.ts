/**
 * Roofr API Service
 *
 * Fetches all Roofr job data via the /api/roofr-data proxy,
 * builds lookup indexes, and provides deterministic job matching.
 * Replaces the old Google Sheets-based address→jobId lookup.
 */

import { normalizeAddressForMatching } from './googleSheetsService';

// --- Types ---

export interface RoofrJob {
  jobId: string;
  customer: string;
  address: string;
  phone: string;
  email: string;
  leadSource: string;
  value: number;
  jobOwner: string;
  workflow: string;
  stage: string;
  stageCategory: string;
  status: string;
  createdAt: string;
  link: string;
  tags: string;
  yearBuilt: string;
  propSqft: string;
  stories: string;
  propertyType: string;
  roofAge: string;
}

export interface RoofrIndex {
  jobs: RoofrJob[];
  byAddress: Map<string, RoofrJob>;
  byCustomer: Map<string, RoofrJob>;
  byPhone: Map<string, RoofrJob>;
  byJobId: Map<string, RoofrJob>;
  /** Backward-compatible map: normalizedAddress → jobId */
  addressToJobId: Map<string, string>;
}

// --- Cache ---

let cachedIndex: RoofrIndex | null = null;
let cacheTimestamp = 0;
let inflightPromise: Promise<RoofrIndex> | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Helpers ---

function normalizeCustomerName(name: string | null | undefined): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // Strip leading 1 for US numbers
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function mapApiRow(row: Record<string, any>): RoofrJob {
  return {
    jobId: String(row['Job ID'] || ''),
    customer: String(row['Customer'] || ''),
    address: String(row['Address'] || ''),
    phone: String(row['Phone'] || ''),
    email: String(row['Email'] || ''),
    leadSource: String(row['Lead source'] || ''),
    value: parseFloat(row['Value']) || 0,
    jobOwner: String(row['Job owner'] || ''),
    workflow: String(row['Workflow'] || ''),
    stage: String(row['Stage'] || ''),
    stageCategory: String(row['Stage category'] || ''),
    status: String(row['Status'] || ''),
    createdAt: String(row['Created at'] || ''),
    link: String(row['Link'] || ''),
    tags: String(row['Tags'] || ''),
    yearBuilt: String(row['Year Built'] || ''),
    propSqft: String(row['Prop Sqft'] || ''),
    stories: String(row['Stories'] || ''),
    propertyType: String(row['Property Type'] || ''),
    roofAge: String(row['Roof Age'] || ''),
  };
}

function buildIndex(jobs: RoofrJob[]): RoofrIndex {
  const byAddress = new Map<string, RoofrJob>();
  const byCustomer = new Map<string, RoofrJob>();
  const byPhone = new Map<string, RoofrJob>();
  const byJobId = new Map<string, RoofrJob>();
  const addressToJobId = new Map<string, string>();

  for (const job of jobs) {
    // Index by job ID
    if (job.jobId) {
      byJobId.set(job.jobId, job);
    }

    // Index by normalized address
    const normAddr = normalizeAddressForMatching(job.address);
    if (normAddr && job.jobId) {
      if (!byAddress.has(normAddr)) {
        byAddress.set(normAddr, job);
      }
      if (!addressToJobId.has(normAddr)) {
        addressToJobId.set(normAddr, job.jobId);
      }
    }

    // Index by normalized customer name (fallback when address doesn't match)
    const normName = normalizeCustomerName(job.customer);
    if (normName && job.jobId) {
      // Use most recent job per customer (later entries overwrite)
      byCustomer.set(normName, job);
      // Also add to address maps so ALL existing consumers benefit from name matching
      if (!byAddress.has(normName)) {
        byAddress.set(normName, job);
      }
      if (!addressToJobId.has(normName)) {
        addressToJobId.set(normName, job.jobId);
      }
    }

    // Index by normalized phone
    const normPhone = normalizePhone(job.phone);
    if (normPhone) {
      if (!byPhone.has(normPhone)) {
        byPhone.set(normPhone, job);
      }
    }
  }

  return { jobs, byAddress, byCustomer, byPhone, byJobId, addressToJobId };
}

// --- Public API ---

/**
 * Fetch all Roofr jobs and build lookup indexes.
 * Results are cached for 5 minutes. Concurrent calls are deduped.
 */
export async function fetchRoofrIndex(force = false): Promise<RoofrIndex> {
  // Return cached if fresh
  if (!force && cachedIndex && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIndex;
  }

  // Dedupe concurrent requests
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const res = await fetch('/api/roofr-data');
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      const rows: Record<string, any>[] = data.jobs || data.rows || data || [];
      const jobs = Array.isArray(rows) ? rows.map(mapApiRow) : [];
      const index = buildIndex(jobs);
      cachedIndex = index;
      cacheTimestamp = Date.now();
      return index;
    } catch (error) {
      // Return stale cache if available
      if (cachedIndex) {
        console.warn('Roofr API fetch failed, using stale cache:', error);
        return cachedIndex;
      }
      throw error;
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

/**
 * Fetch Roofr data and return the backward-compatible
 * normalizedAddress → jobId map (drop-in replacement for fetchRoofrJobIds).
 */
export async function fetchRoofrJobIdMap(): Promise<Map<string, string>> {
  try {
    const index = await fetchRoofrIndex();
    return index.addressToJobId;
  } catch (error) {
    console.error('Failed to fetch Roofr index:', error);
    return new Map();
  }
}

/**
 * Fetch Roofr data and return the enrichment map
 * (normalizedAddress → full RoofrJob object).
 */
export async function fetchRoofrEnrichmentMap(): Promise<Map<string, RoofrJob>> {
  try {
    const index = await fetchRoofrIndex();
    return index.byAddress;
  } catch (error) {
    console.error('Failed to fetch Roofr enrichment:', error);
    return new Map();
  }
}

/**
 * Normalize a customer name for matching (exported for use in components).
 */
export { normalizeCustomerName };

/**
 * Fetch Roofr data and return the customer name → RoofrJob map.
 */
export async function fetchRoofrCustomerMap(): Promise<Map<string, RoofrJob>> {
  try {
    const index = await fetchRoofrIndex();
    return index.byCustomer;
  } catch (error) {
    console.error('Failed to fetch Roofr customer map:', error);
    return new Map();
  }
}

/**
 * Resolve a Roofr job from a scheduler job, trying address first then customer name.
 * Works with both the enrichment map and the ID map.
 */
export function resolveRoofrJobId(
  idMap: Map<string, string> | undefined,
  address: string | undefined,
  customerName: string | undefined,
): string | null {
  if (!idMap || idMap.size === 0) return null;
  // Try address match
  if (address) {
    const normAddr = normalizeAddressForMatching(address);
    if (normAddr) {
      const id = idMap.get(normAddr);
      if (id) return id;
    }
  }
  // Fallback: customer name
  if (customerName) {
    const normName = normalizeCustomerName(customerName);
    if (normName) {
      const id = idMap.get(normName);
      if (id) return id;
    }
  }
  return null;
}

/**
 * Look up a single job by address, returning the full RoofrJob if found.
 */
export function lookupByAddress(index: RoofrIndex, address: string): RoofrJob | null {
  const norm = normalizeAddressForMatching(address);
  if (!norm) return null;
  return index.byAddress.get(norm) || null;
}

/**
 * Look up a single job by phone number.
 */
export function lookupByPhone(index: RoofrIndex, phone: string): RoofrJob | null {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  return index.byPhone.get(norm) || null;
}
