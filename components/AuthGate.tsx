import React, { useEffect, useRef, useState } from 'react';

// Google Sign-In gate for the whole app — same flow (and same OAuth client)
// as roofr-search. GET /api/auth says whether auth is on and which client id
// to use; a stored session token is trusted until its exp; otherwise the
// Google button's ID token is swapped for a session JWT via POST /api/auth.
// If the config endpoint is unreachable the app opens (availability over
// lockout, matching roofr-search's behavior).

const AUTH_SESSION_KEY = 'schedAuth';
const REVIEWER_STORAGE_KEY = 'reviewQueue.reviewer';

interface StoredSession { token: string; email: string; name: string; exp: number; }

declare global {
  interface Window { google?: any; }
}

const readSession = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    // 60s of slack so a token doesn't expire mid-action right after boot.
    if (!parsed.token || !parsed.exp || parsed.exp * 1000 < Date.now() + 60000) return null;
    return parsed;
  } catch { return null; }
};

export const getAuthUser = (): StoredSession | null => readSession();

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState<StoredSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth')
      .then(r => r.json())
      .then((cfg: { auth_required?: boolean; client_id?: string }) => {
        if (!cfg.auth_required) { setPhase('ready'); return; }
        setClientId(cfg.client_id || '');
        const stored = readSession();
        if (stored) { setUser(stored); setPhase('ready'); return; }
        setPhase('login');
      })
      .catch(() => setPhase('ready'));
  }, []);

  // Mount the Google button once we're on the login screen and GIS has loaded.
  useEffect(() => {
    if (phase !== 'login' || !clientId) return;
    let cancelled = false;
    const init = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id || !btnRef.current) { window.setTimeout(init, 100); return; }
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: true,
        callback: (response: { credential: string }) => {
          fetch('/api/auth', { method: 'POST', headers: { Authorization: `Bearer ${response.credential}` } })
            .then(r => r.json())
            .then((result: { success?: boolean; session_token?: string; email?: string; name?: string; exp?: number; error?: string }) => {
              if (!result.success || !result.session_token) { setError(result.error || 'Access denied.'); return; }
              const session: StoredSession = { token: result.session_token, email: result.email || '', name: result.name || result.email || '', exp: result.exp || 0 };
              localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
              // Sign-in OWNS the reviewer identity: always overwrite, so a
              // shared machine switching accounts logs under the right name.
              if (session.name) localStorage.setItem(REVIEWER_STORAGE_KEY, session.name);
              setUser(session);
              setPhase('ready');
            })
            .catch(() => setError('Verification failed. Please try again.'));
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large', width: 260 });
      window.google.accounts.id.prompt();
    };
    init();
    return () => { cancelled = true; };
  }, [phase, clientId]);

  const signOut = () => {
    localStorage.removeItem(AUTH_SESSION_KEY);
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* optional */ }
    window.location.reload();
  };

  if (phase === 'loading') {
    return <div className="h-screen grid place-items-center bg-bg-secondary text-text-tertiary text-sm">Loading…</div>;
  }

  if (phase === 'login') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-bg-secondary">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-primary bg-bg-primary px-10 py-8 shadow-xl">
          <h1 className="text-lg font-bold text-text-primary">Arizona Roofers — Scheduler</h1>
          <p className="text-[12px] text-text-tertiary">Sign in with your work Google account to continue.</p>
          <div ref={btnRef} className="mt-2" />
          {error && <p className="mt-1 max-w-[280px] text-center text-[12px] font-semibold text-tag-red-text">{error}</p>}
        </div>
      </div>
    );
  }

  return <>
    {children}
    {user && (
      <div className="fixed bottom-3 right-3 z-50">
        {menuOpen && (
          <div className="absolute bottom-9 right-0 w-56 rounded-md border border-border-primary bg-bg-primary p-2 shadow-xl">
            <p className="truncate px-1 text-[11px] font-semibold text-text-primary">{user.name}</p>
            <p className="truncate px-1 text-[10px] text-text-tertiary">{user.email}</p>
            <button onClick={signOut} className="mt-2 w-full rounded border border-border-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary transition hover:border-brand-primary hover:text-brand-primary">Sign out</button>
          </div>
        )}
        <button onClick={() => setMenuOpen(open => !open)} title={`Signed in as ${user.email}`}
          className="grid h-7 w-7 place-items-center rounded-full border border-border-secondary bg-bg-primary text-[10px] font-bold text-text-secondary shadow transition hover:border-brand-primary hover:text-brand-primary">
          {(user.name || user.email).trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() || '?'}
        </button>
      </div>
    )}
  </>;
};

export default AuthGate;
