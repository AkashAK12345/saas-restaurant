/**
 * The credential a paired screen keeps.
 *
 * A display device is not a user: it authenticates with the long-lived
 * `<deviceId>.<secret>` credential issued once at pairing time (T0-A), sent in
 * the Authorization header and NEVER in a URL. It holds no RBAC permissions
 * and cannot reach any staff endpoint.
 *
 * Stored in localStorage on purpose: a wall-mounted screen must come back on
 * its own after a power cut, so a per-tab store would be wrong here. This is
 * device-local state on dedicated hardware — the trade-off is deliberate, and
 * the mitigation is revocation: an operator revokes the device server-side and
 * the credential is refused everywhere immediately.
 *
 * The credential is never logged, never rendered, and never put in a query
 * string.
 */
const CREDENTIAL_KEY = 'samco.display.credential';
const BRANCH_KEY = 'samco.display.branch';

export interface DeviceSession {
  credential: string;
  branchId: string;
}

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode or storage disabled — the screen simply asks for pairing again */
  }
}

/** Shape check only: `<uuid>.<secret>`. The server is the authority. */
export function isWellFormedCredential(value: string): boolean {
  const [id, secret, ...rest] = value.trim().split('.');
  if (rest.length > 0) return false;
  return (
    !!id &&
    !!secret &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
    secret.length >= 16
  );
}

export const deviceSession = {
  get(): DeviceSession | null {
    const credential = read(CREDENTIAL_KEY);
    const branchId = read(BRANCH_KEY);
    return credential && branchId ? { credential, branchId } : null;
  },
  set(session: DeviceSession): void {
    write(CREDENTIAL_KEY, session.credential.trim());
    write(BRANCH_KEY, session.branchId.trim());
  },
  clear(): void {
    write(CREDENTIAL_KEY, null);
    write(BRANCH_KEY, null);
  },
};
