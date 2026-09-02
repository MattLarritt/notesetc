'use client';

import { type FormEvent, useState } from 'react';

/**
 * Enterprise SSO (Microsoft Entra) will be the primary sign-in method. The button
 * is built and ready but hidden until SSO is wired up — flip this to reveal it.
 */
const SSO_ENABLED = false;

/** The branded sign-in card: local (breakglass) login now, SSO-ready. Reused by
 *  the /login page and the home landing. */
export function SignInCard({
  heading = 'Sign in',
  subtitle = 'Your enterprise IT knowledgebase.',
  showBrand = true,
}: {
  heading?: string;
  subtitle?: string;
  showBrand?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const csrfRes = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
      const res = await fetch('/api/bff/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Login failed.');
        return;
      }
      // Full-page navigation, deliberately: after the session cookie changes,
      // a client-side push would render the layout from the stale (signed-out)
      // router cache — spaces and menus only appeared after a manual reload.
      window.location.assign('/');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      {showBrand && (
        <div className="auth-brand">
          <svg className="auth-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 2 h7.5 L19.5 7 V19.5 A2.5 2.5 0 0 1 17 22 H7 A2.5 2.5 0 0 1 4.5 19.5 V4.5 A2.5 2.5 0 0 1 7 2 Z"
        fill="var(--brand-gold)"
      />
      <path d="M14.5 2 V7 H19.5 Z" fill="var(--brand-amber)" />
      <circle cx="8.6" cy="15.5" r="1.4" fill="var(--brand-navy)" />
      <circle cx="12" cy="15.5" r="1.4" fill="var(--brand-navy)" />
      <circle cx="15.4" cy="15.5" r="1.4" fill="var(--brand-navy)" />
    </svg>
          <span className="auth-wordmark">
            Notes<b>Etc</b>
          </span>
        </div>
      )}

      <h2 className="auth-title">{heading}</h2>
      <p className="auth-subtitle">{subtitle}</p>

      {SSO_ENABLED && (
        <>
          <button type="button" className="btn-microsoft" onClick={() => { /* SSO redirect wired later */ }}>
            <MicrosoftLogo />
            Sign in with Microsoft
          </button>
          <div className="auth-divider">
            <span>or sign in with email</span>
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="auth-form">
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            autoComplete="username"
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            autoComplete="current-password"
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn-primary auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

/** Microsoft's four-square logo (used on the SSO button when enabled). */
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
