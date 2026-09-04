import crypto from 'crypto';

const CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const SECRET = (process.env.SESSION_JWT_SECRET || '').trim();
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

const b64url = input => Buffer.from(input).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function emailAllowed(email) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.some(entry => entry.startsWith('@') ? email.endsWith(entry) : email === entry);
}

export function verifySession(token) {
  if (!CLIENT_ID) return { email: null, name: null, auth_disabled: true };
  if (!token || !SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET)
    .update(`${parts[0]}.${parts[1]}`).digest());
  const given = parts[2];
  if (expected.length !== given.length
    || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    const email = String(payload.email || '').toLowerCase();
    if (!emailAllowed(email)) return null;
    return { ...payload, email };
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const authorization = req.headers?.authorization || '';
  if (!CLIENT_ID) return { email: null, name: null, auth_disabled: true };
  if (!authorization.startsWith('Bearer ')) return null;
  return verifySession(authorization.slice(7));
}

export function isManager(email, profiles = []) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const configured = (process.env.AVAILABILITY_MANAGER_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (configured.some(entry => entry.startsWith('@') ? normalized.endsWith(entry) : normalized === entry)) return true;
  if (profiles.some(profile => String(profile.email || '').toLowerCase() === normalized
    && profile.section === 'MANAGEMENT')) return true;
  return ALLOWED.some(entry => !entry.startsWith('@') && entry === normalized);
}
