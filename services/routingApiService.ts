/**
 * Routing API Service
 *
 * Handles communication with the Arizona Roofers Routing API backend.
 * This allows the rep scheduler to load jobs from the Roofr scanner
 * and sync assignments back to the routing database.
 */

import { Job } from '../types';
import { ROUTING_API_BASE_URL, ROUTING_API_KEY } from '../constants';

// ============ Types ============

export interface RoutingApiJob {
  id: string;
  customerName: string;
  address: string;
  city?: string;
  zipCode?: string;
  state?: string;
  notes?: string;
  status: string;
  originalTimeframe?: string;
  priority?: number;
  source?: string;
  externalId?: string;
  latitude?: number;
  longitude?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoutingApiAppointment {
  id: string;
  jobId: string;
  repId: string;
  date: string;
  timeSlotId: string;
  timeSlotLabel: string;
  status: string;
  notes?: string;
  job?: RoutingApiJob;
  rep?: {
    id: string;
    name: string;
    region: string;
  };
}

export interface CreateAppointmentPayload {
  jobId: string;
  repId: string;
  date: string; // YYYY-MM-DD format
  timeSlotId: string;
  notes?: string;
}

export interface UpdateAppointmentPayload {
  status?: string;
  notes?: string;
  repId?: string;
  date?: string;
  timeSlotId?: string;
}

// Day schedule response types
export interface RoutingApiTimeSlot {
  id: string;
  label: string;
  jobs: RoutingApiJob[];
}

export interface RoutingApiRep {
  id: string;
  name: string;
  availability?: string;
  schedule: RoutingApiTimeSlot[];
  unavailableSlots: Record<string, string[]>;
  skills: Record<string, number>;
  region?: string;
}

export interface DayScheduleResponse {
  date: string;
  dayOfWeek: string;
  reps: RoutingApiRep[];
  unassignedJobs: RoutingApiJob[];
  timeSlots: Array<{ id: string; label: string }>;
}

// ============ API Helper ============

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${ROUTING_API_BASE_URL}${endpoint}`;

  console.log(`[RoutingAPI] ${options.method || 'GET'} ${endpoint}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ROUTING_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RoutingAPI] Error ${response.status}: ${errorText}`);
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============ API Functions ============

/**
 * Fetch all pending/unassigned jobs from the Routing API.
 * These are jobs submitted by the Roofr scanner that haven't been assigned yet.
 */
export async function fetchUnassignedJobs(): Promise<RoutingApiJob[]> {
  const data = await apiRequest<{ jobs: RoutingApiJob[] }>('/api/v1/jobs/unassigned');
  console.log(`[RoutingAPI] Fetched ${data.jobs?.length || 0} unassigned jobs`);
  return data.jobs || [];
}

/**
 * Fetch all jobs with optional filters.
 */
export async function fetchJobs(filters?: {
  status?: string;
  region?: string;
  source?: string;
  limit?: number;
}): Promise<RoutingApiJob[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.region) params.set('region', filters.region);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.limit) params.set('limit', filters.limit.toString());

  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest<{ jobs: RoutingApiJob[]; total: number }>(`/api/v1/jobs${query}`);
  return data.jobs || [];
}

/**
 * Fetch appointments for a specific date.
 */
export async function fetchAppointmentsByDate(date: string): Promise<RoutingApiAppointment[]> {
  const data = await apiRequest<{ appointments: RoutingApiAppointment[] }>(
    `/api/v1/appointments?date=${date}`
  );
  return data.appointments || [];
}

/**
 * Create a new appointment (assign job to rep).
 */
export async function createAppointment(payload: CreateAppointmentPayload): Promise<RoutingApiAppointment> {
  const data = await apiRequest<{ appointment: RoutingApiAppointment }>('/api/v1/appointments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  console.log(`[RoutingAPI] Created appointment: job ${payload.jobId} -> rep ${payload.repId}`);
  return data.appointment;
}

/**
 * Update an existing appointment.
 */
export async function updateAppointment(
  appointmentId: string,
  updates: UpdateAppointmentPayload
): Promise<RoutingApiAppointment> {
  const data = await apiRequest<{ appointment: RoutingApiAppointment }>(
    `/api/v1/appointments/${appointmentId}`,
    {
      method: 'PUT',
      body: JSON.stringify(updates),
    }
  );
  console.log(`[RoutingAPI] Updated appointment ${appointmentId}`);
  return data.appointment;
}

/**
 * Cancel/delete an appointment.
 */
export async function cancelAppointment(appointmentId: string): Promise<void> {
  await apiRequest(`/api/v1/appointments/${appointmentId}`, {
    method: 'DELETE',
  });
  console.log(`[RoutingAPI] Cancelled appointment ${appointmentId}`);
}

/**
 * Fetch day schedule from the Routing API.
 * Returns reps with their assigned jobs and any unassigned jobs for that date.
 */
export async function fetchDaySchedule(date: string): Promise<DayScheduleResponse> {
  const data = await apiRequest<DayScheduleResponse>(`/api/v1/schedule/day/${date}`);
  console.log(`[RoutingAPI] Fetched schedule for ${date}: ${data.reps?.length || 0} reps, ${data.unassignedJobs?.length || 0} unassigned jobs`);
  return data;
}

// ============ Type Mapping ============

/**
 * Map a Routing API job to the app's Job type.
 */
export function mapRoutingApiJobToAppJob(apiJob: RoutingApiJob): Job {
  return {
    id: apiJob.id,
    customerName: apiJob.customerName,
    address: apiJob.address,
    originalAddress: apiJob.address,
    notes: apiJob.notes || '',
    city: apiJob.city,
    originalTimeframe: apiJob.originalTimeframe,
    zipCode: apiJob.zipCode,
    // These will be populated from existing appointments if any
    originalRepId: undefined,
    originalRepName: undefined,
  };
}

/**
 * Map an appointment to update the job with assignment info.
 */
export function mapAppointmentToJobAssignment(
  job: Job,
  appointment: RoutingApiAppointment
): Job {
  return {
    ...job,
    originalRepId: appointment.repId,
    originalRepName: appointment.rep?.name,
  };
}
