'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, onSessionLost, refreshSession, NotAuthenticatedError } from '@/lib/api/client';
import { sessionStore } from '@/lib/auth/session-store';
import type { AuthUser, LoginResponse } from '@/lib/api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Staff session state. Mounted ONLY in the staff root layout — display pages
 * live under a separate root layout that never renders this provider, so a
 * display screen structurally cannot obtain a staff session.
 *
 * On mount: if a refresh token exists in the tab, rotate it for an access
 * token and load the profile; otherwise the user is unauthenticated. Nothing
 * here is trusted for authorization — every API call is re-checked server-side.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const mounted = useRef(true);

  const loadProfile = useCallback(async () => {
    try {
      const me = await api.get<AuthUser>('/auth/me');
      if (!mounted.current) return;
      setUser(me);
      setStatus('authenticated');
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof NotAuthenticatedError) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      // Network or server error: keep whatever we had; do not log the user out
      // for a transient failure.
      setStatus((s) => (s === 'loading' ? 'unauthenticated' : s));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onSessionLost(() => {
      if (!mounted.current) return;
      setUser(null);
      setStatus('unauthenticated');
    });

    // Resolve the initial session asynchronously; every state update happens
    // inside this task, after the effect body has returned.
    void (async () => {
      if (!sessionStore.getRefreshToken()) {
        if (mounted.current) setStatus('unauthenticated');
        return;
      }
      const ok = await refreshSession();
      if (ok) await loadProfile();
    })();

    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.public<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      sessionStore.setSession(res);
      // Only the fields the shell needs; is_superadmin is neither needed nor
      // meaningful to the UI (it grants nothing anywhere).
      setUser({
        id: res.user.id,
        email: res.user.email,
        first_name: res.user.first_name,
        last_name: res.user.last_name,
      });
      setStatus('authenticated');
    },
    [],
  );

  const logout = useCallback(async () => {
    const refreshToken = sessionStore.getRefreshToken();
    // Best effort: the backend revokes the session; locally we drop it either way.
    if (refreshToken) {
      try {
        await api.public('/auth/logout', { method: 'POST', body: { refreshToken } });
      } catch {
        /* already gone server-side, or offline — nothing else to do */
      }
    }
    sessionStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthState>(() => ({ status, user, login, logout }), [status, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider> (staff routes only)');
  }
  return ctx;
}
