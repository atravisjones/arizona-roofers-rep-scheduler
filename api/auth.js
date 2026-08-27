/**
 * Google Sign-In for the scheduler — same pattern (and same OAuth client)
 * as roofr-search: the page gets the client id from GET /api/auth, Google
 * Identity Services returns an ID token, POST /api/auth verifies it against
 * the client id + ALLOWED_EMAILS and issues a short HS256 session JWT the
 * frontend sends back on later verifies.
 *
 * Env: GOOGLE_OAUTH_CLIENT_ID (absent = auth disabled, app stays open),
 *      SESSION_JWT_SECRET, ALLOWED_EMAILS ("@domain.com" or full addresses,
 *      comma-separated; empty list = any verified Google account),
 *      SESSION_TTL_HOURS (default 168 = 7 days).
 *
 * Zero deps on purpose: Google ID tokens are checked via the tokeninfo
 * endpoint (fine at team volume) and the session JWT is hand-rolled HMAC.
 */
import crypto from 'crypto';

const CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const SECRET = (process.env.SESSION_JWT_SECRET || '').trim();
const TTL_SECONDS = parseInt(process.env.SESSION_TTL_HOURS || '168', 10) * 3600;
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const b64url = (input) => Buffer.from(input).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signSession(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

function verifySession(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !SECRET) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest());
  const given = parts[2];
  if (expected.length !== given.length
    || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (!emailAllowed(String(payload.email || '').toLowerCase())) return null;
    return payload;
  } catch { return null; }
}

function emailAllowed(email) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.some(entry => entry.startsWith('@') ? email.endsWith(entry) : email === entry);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ auth_required: !!CLIENT_ID, client_id: CLIENT_ID });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!CLIENT_ID || !SECRET) return res.status(500).json({ success: false, error: 'Auth not configured' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Missing token' });
  const token = authHeader.slice(7);

  // A still-valid session token re-verifies without a round trip to Google.
  const session = verifySession(token);
  if (session) {
    return res.status(200).json({ success: true, session_token: token, email: session.email, name: session.name, exp: session.exp });
  }

  // Otherwise treat it as a fresh Google ID token from the sign-in button.
  let info;
  try {
    const g = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!g.ok) return res.status(401).json({ success: false, error: 'Invalid Google token' });
    info = await g.json();
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Google to verify' });
  }
  if (info.aud !== CLIENT_ID) return res.status(401).json({ success: false, error: 'Token is for a different app' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ success: false, error: 'Email not verified' });
  const email = String(info.email || '').toLowerCase();
  if (!emailAllowed(email)) return res.status(403).json({ success: false, error: 'This Google account is not authorized for the scheduler.' });

  const name = info.name || email;
  const now = Math.floor(Date.now() / 1000);
  const payload = { email, name, iat: now, exp: now + TTL_SECONDS };
  return res.status(200).json({ success: true, session_token: signSession(payload), email, name, exp: payload.exp });
}
