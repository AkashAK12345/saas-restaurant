'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  AuthContextResponse,
  ContextBranch,
  ContextCompanySummary,
} from '@/lib/api/types';

const COMPANY_KEY = 'samco.ctx.company';
const BRANCH_KEY = 'samco.ctx.branch';

export interface AppContextState {
  loading: boolean;
  error: string | null;
  companies: ContextCompanySummary[];
  branches: ContextBranch[];
  selectedCompanyId: string | null;
  selectedBranchId: string | null;
  /** Effective company-scoped permissions for the selected company. */
  companyPermissions: string[];
  /** Effective branch-scoped permissions for the selected branch. */
  branchPermissions: string[];
  selectCompany(companyId: string | null): void;
  selectBranch(branchId: string | null): void;
  reload(): Promise<void>;
}

const AppContext = createContext<AppContextState | null>(null);

function readStored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

interface LoadResult {
  /** The selection this result answers, so a stale response is never shown. */
  key: string;
  data: AuthContextResponse | null;
  error: string | null;
}

const requestKey = (companyId: string | null, branchId: string | null) =>
  `${companyId ?? ''}|${branchId ?? ''}`;

/**
 * Company / branch selection and the effective permissions for that
 * selection, sourced from GET /auth/context.
 *
 * The selection is REQUESTED CONTEXT. It is sent as X-Company-ID /
 * X-Branch-ID on subsequent calls and the backend decides, every time, whether
 * the caller may act there. The permission arrays exist so the UI can avoid
 * rendering dead controls; they are never consulted to *allow* anything.
 *
 * If the stored selection names a company or branch the server does not
 * return for this user (404 from /auth/context), it is discarded rather than
 * trusted.
 *
 * Mount order matters: this provider sits inside AuthGate, which renders only
 * once the session is confirmed on the client. It therefore never takes part
 * in server rendering or hydration, so reading sessionStorage in the lazy
 * initialisers below is safe.
 */
export function AppContextProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => readStored(COMPANY_KEY));
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(() => readStored(BRANCH_KEY));
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const key = requestKey(selectedCompanyId, selectedBranchId);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    void (async () => {
      try {
        const ctx = await api.get<AuthContextResponse>('/auth/context', {
          companyId: selectedCompanyId,
          branchId: selectedBranchId,
        });
        if (cancelled) return;
        // The server is the authority on what exists for this user.
        if (selectedCompanyId && !ctx.company) {
          setSelectedCompanyId(null);
          writeStored(COMPANY_KEY, null);
        }
        if (selectedBranchId && !ctx.branch) {
          setSelectedBranchId(null);
          writeStored(BRANCH_KEY, null);
        }
        setResult({ key, data: ctx, error: null });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.isNotFound && (selectedCompanyId || selectedBranchId)) {
          // A stale selection the user no longer has access to. Drop it; the
          // effect re-runs for the cleared selection.
          setSelectedCompanyId(null);
          setSelectedBranchId(null);
          writeStored(COMPANY_KEY, null);
          writeStored(BRANCH_KEY, null);
          return;
        }
        setResult({
          key,
          data: null,
          error: err instanceof Error ? err.message : 'Failed to load context',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, selectedCompanyId, selectedBranchId, key, reloadNonce]);

  const selectCompany = useCallback((companyId: string | null) => {
    setSelectedCompanyId(companyId);
    writeStored(COMPANY_KEY, companyId);
    // A branch belongs to one company; changing company clears it.
    setSelectedBranchId(null);
    writeStored(BRANCH_KEY, null);
  }, []);

  const selectBranch = useCallback((branchId: string | null) => {
    setSelectedBranchId(branchId);
    writeStored(BRANCH_KEY, branchId);
  }, []);

  const reload = useCallback(async () => {
    setReloadNonce((n) => n + 1);
  }, []);

  const value = useMemo<AppContextState>(() => {
    const authenticated = status === 'authenticated';
    const current = authenticated && result?.key === key ? result : null;
    const data = current?.data ?? null;
    return {
      loading: status === 'loading' || (authenticated && current === null),
      error: current?.error ?? null,
      companies: data?.companies ?? [],
      branches: data?.company?.branches ?? [],
      selectedCompanyId: data?.company?.id ?? null,
      selectedBranchId: data?.branch?.id ?? null,
      companyPermissions: data?.company?.permissions ?? [],
      branchPermissions: data?.branch?.permissions ?? [],
      selectCompany,
      selectBranch,
      reload,
    };
  }, [status, result, key, selectCompany, selectBranch, reload]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within <AppContextProvider>');
  return ctx;
}
