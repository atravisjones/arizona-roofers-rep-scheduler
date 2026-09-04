import { getAuthUser } from '../components/AuthGate';

export type Section = 'PHX' | 'NORTH' | 'SOUTH' | 'COMMERCIAL' | 'INSURANCE' | 'MANAGEMENT' | 'D2D';
export type Slot = 's1' | 's2' | 's3' | 's4' | 's5';

export interface Profile {
  id: string;
  display_name: string;
  section: Section | string;
  active: boolean;
  email?: string | null;
  roofr_user_id?: string | null;
  home_zip?: string | null;
  skills?: Record<string, number | boolean | string> | null;
  is_placeholder?: boolean;
}

export interface Resolved {
  rep_id: string;
  work_date: string;
  weekday: number;
  slot: Slot | string;
  available: boolean;
  source?: string;
  note?: string | null;
}

export interface Exception {
  id: string;
  rep_id: string;
  exception_date: string;
  slot: Slot | string;
  available: boolean | null;
  source?: string;
  note?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface Request {
  id?: string;
  rep_id: string;
  request_date?: string;
  dates?: string[];
  slot?: string;
  status: string;
  note?: string | null;
}

export interface PatternSlot {
  weekday: number;
  slot: Slot | string;
  available: boolean;
}

export interface Pattern {
  id: string;
  rep_id: string;
  effective_from: string;
  effective_to?: string | null;
  status: string;
  slots: PatternSlot[];
}

export interface HoldRule {
  per: number;
  cap: number;
  min_reps: number;
  warn_below: number;
}

export interface WeekPolicy {
  template_kind?: string;
  sales_meeting_mon?: boolean;
  company_meeting_fri?: boolean;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface AvailabilityData {
  profiles: Profile[];
  inactive?: Pick<Profile, 'id' | 'display_name' | 'section'>[];
  resolved: Resolved[];
  exceptions: Exception[];
  policy: Record<string, WeekPolicy>;
  holidays: Holiday[];
  requests: Request[];
  patterns: Pattern[];
  hold_rule: HoldRule;
  me: { email?: string | null; name?: string; is_manager: boolean };
}

interface ApiResponse {
  ok?: boolean;
  error?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const session = getAuthUser();
  const headers = new Headers(init?.headers);

  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(url, { ...init, headers });
  const body = (await response.json()) as T & ApiResponse;
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Availability request failed (${response.status})`);
  }
  return body;
}

export async function loadAvailability(from: string, to: string): Promise<AvailabilityData> {
  const query = new URLSearchParams({ from, to });
  return request<AvailabilityData>(`/api/availability?${query.toString()}`);
}

export async function saveAvailability(payload: Record<string, unknown>): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/availability', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
