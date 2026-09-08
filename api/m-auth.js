/**
 * Google Sign-In for the /m/ phone page. Same OAuth client + session JWT as the scheduler
 * (api/auth.js) with the tighter /m/ access rule from _msession.js.
 *
 * GET  /api/m-auth                     -> { auth_required, client_id }
 * POST /api/m-auth  Authorization: Bearer <session JWT | Google ID token>
 *      -> { success, session_token, email, name } | 401/403 { error }
 */
import { signSession, CLIENT_ID, SECRET, emailAllowed, TTL_SECONDS } from './auth.js';
import { verifySession } from './_session.js';
import { mAllowed, rosterHealth, warmRoster } from './_msession.js';

const DENIED = 'This page is for the office team (Management, Administration, Lead Center, Insurance, Production) and Michael. Ask Travis if you need access.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ auth_required: !!CLIENT_ID, client_id: CLIENT_ID, ...(req.query.health ? await rosterHealth() : {}) });
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!CLIENT_ID || !SECRET) return res.status(500).json({ success: false, error: 'Auth not configured' });
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Missing token' });
  const token = auth.slice(7);

  const session = verifySession(token);
  if (session && !session.auth_disabled) {
    if (!(await mAllowed(session.email, session.name))) return res.status(403).json({ success: false, error: DENIED });
    return res.status(200).json({ success: true, session_token: token, email: session.email, name: session.name, exp: session.exp });
  }

  let info;
  warmRoster();   // read the roster sheet while Google checks the token, not after
  try {
    const g = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!g.ok) return res.status(401).json({ success: false, error: 'Invalid Google token' });
    info = await g.json();
  } catch { return res.status(502).json({ success: false, error: 'Could not reach Google to verify' }); }
  if (info.aud !== CLIENT_ID) return res.status(401).json({ success: false, error: 'Token is for a different app' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ success: false, error: 'Email not verified' });
  const email = String(info.email || '').toLowerCase();
  const name = info.name || email;
  if (!emailAllowed(email) || !(await mAllowed(email, name))) return res.status(403).json({ success: false, error: DENIED });

  const now = Math.floor(Date.now() / 1000);
  const payload = { email, name, iat: now, exp: now + TTL_SECONDS };
  return res.status(200).json({ success: true, session_token: signSession(payload), email, name, exp: payload.exp });
}
