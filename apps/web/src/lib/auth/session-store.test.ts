import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from './session-store';

describe('sessionStore', () => {
  beforeEach(() => sessionStore.clear());

  it('keeps the ACCESS token in memory only — never in any storage', () => {
    sessionStore.setAccessToken('access-123');
    expect(sessionStore.getAccessToken()).toBe('access-123');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('access-123');
    expect(JSON.stringify(window.localStorage)).not.toContain('access-123');
  });

  it('keeps the REFRESH token in sessionStorage (tab-scoped), never localStorage', () => {
    sessionStore.setRefreshToken('refresh-456');
    expect(sessionStore.getRefreshToken()).toBe('refresh-456');
    expect(window.sessionStorage.getItem('samco.refresh')).toBe('refresh-456');
    expect(window.localStorage.length).toBe(0);
  });

  it('setSession stores both halves; clear removes both', () => {
    sessionStore.setSession({ accessToken: 'a', refreshToken: 'r' });
    expect(sessionStore.getAccessToken()).toBe('a');
    expect(sessionStore.getRefreshToken()).toBe('r');
    sessionStore.clear();
    expect(sessionStore.getAccessToken()).toBeNull();
    expect(sessionStore.getRefreshToken()).toBeNull();
    expect(window.sessionStorage.getItem('samco.refresh')).toBeNull();
  });
});
