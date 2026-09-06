/**
 * Browser-side credential storage for the existing backend auth model
 * (short-lived JWT access token + rotating, replay-detected, absolutely-capped
 * refresh session).
 *
 * STRATEGY — and the reasoning, since this is the decision that matters:
 *
 *   ACCESS TOKEN  → memory only (a module variable). Never written to any
 *                   storage. It lives 15 minutes, is bound to a revocable
 *                   session (`sid`), and is re-obtained via refresh on reload.
 *
 *   REFRESH TOKEN → sessionStorage. Tab-scoped and cleared when the tab
 *                   closes; not shared across tabs or windows. This is the
 *                   trade-off point:
 *
 *     - memory-only would force a fresh login on every reload — unusable for
 *       a podium tablet that gets refreshed all day;
 *     - localStorage would survive the tab and be shared by every tab —
 *       broader exposure for no benefit here;
 *     - an httpOnly cookie would be strictly better against XSS, but the
 *       backend returns tokens in the JSON body by design and this task must
 *       not change backend authentication semantics. Moving refresh to an
 *       httpOnly cookie (via a BFF route or a backend change) is BACKLOG.
 *
 *   The residual risk is XSS reading sessionStorage. It is bounded by the
 *   backend: refresh tokens rotate on every use, a replayed token revokes the
 *   whole session, and no session outlives its absolute lifetime.
 *
 * Nothing here decides authorization. The backend re-checks every request.
 */

const REFRESH_KEY = 'samco.refresh';

let accessToken: string | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export const sessionStore = {
  getAccessToken(): string | null {
    return accessToken;
  },
  setAccessToken(token: string | null): void {
    accessToken = token;
  },

  getRefreshToken(): string | null {
    try {
      return storage()?.getItem(REFRESH_KEY) ?? null;
    } catch {
      return null;
    }
  },
  setRefreshToken(token: string | null): void {
    try {
      const s = storage();
      if (!s) return;
      if (token) s.setItem(REFRESH_KEY, token);
      else s.removeItem(REFRESH_KEY);
    } catch {
      // Storage unavailable (private mode, quota) — treat as memory-only.
    }
  },

  /** Store both halves of a login/refresh response. */
  setSession(tokens: { accessToken: string; refreshToken: string }): void {
    this.setAccessToken(tokens.accessToken);
    this.setRefreshToken(tokens.refreshToken);
  },

  clear(): void {
    this.setAccessToken(null);
    this.setRefreshToken(null);
  },
};
