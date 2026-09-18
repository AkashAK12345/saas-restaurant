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
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import type {
  AuthContextResponse,
  ContextBranch,
  ContextCompanySummary,
} from '@/lib/api/types';

type StoredField = 'company' | 'branch';
const COMPANY_KEY: StoredField = 'company';
const BRANCH_KEY: StoredField = 'branch';

/**
 * The working company and branch are remembered PER USER in localStorage, so a
 * reload, a new tab or a deep link opens where the operator was working
 * (SRS §4.1: a persistent branch selector). Keys carry the user id so two
 * people sharing a tablet never inherit each other's branch.
 *
 * Only the ids are stored — never permissions. The server re-validates the
 * pick on every load and a stale one is dropped (see below).
 */
const storageKey = (userId: string | null, field: StoredField) =>
  userId ? `samco.ctx.${userId}.${field}` : `samco.ctx.${field}`;

export interface AppContextState {
  loading: boolean;
  error: string | null;
  companies: ContextCompanySummary[];
  branches: ContextBranch[];
  selectedCompanyId: string | null;
  selectedBranchId: string | null;
  /**
   * The selected branch in full — its name for the header chip, and its
   * TIMEZONE, which any screen turning a wall clock into an instant needs.
   * Reading it from here rather than the device is what stops a booking made
   * in London landing hours out for a branch in Bengaluru.
   */
  selectedBranch: ContextBranch | null;
  /** Effective company-scoped permissions for the selected company. */
  companyPermissions: string[];
  /** Effective branch-scoped permissions for the selected branch. */
  branchPermissions: string[];
  /**
   * The job this user does here, by name — "Manager", "Chef" — for the one
   * selected branch, or across every branch they work at when none is
   * selected. A LABEL ONLY: nothing is ever granted by a role name.
   */
  roleNames: string[];
  selectCompany(companyId: string | null): void;
  selectBranch(branchId: string | null): void;
  reload(): Promise<void>;
}

const AppContext = createContext<AppContextState | null>(null);

function readStored(userId: string | null, field: StoredField): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return (
      window.localStorage.getItem(storageKey(userId, field)) ??
      // One-time carry-over from the earlier per-tab storage.
      window.sessionStorage.getItem(`samco.ctx.${field}`)
    );
  } catch {
    return null;
  }
}
function writeStored(userId: string | null, field: StoredField, value: string | null): void {
  try {
    const key = storageKey(userId, field);
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(`samco.ctx.${field}`);
  } catch {
    /* storage unavailable (private mode): the pick lasts until reload */
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
 * in server rendering or hydration, so reading browser storage in the lazy
 * initialisers below is safe — and the signed-in user is already known.
 */
export function AppContextProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const userId = user?.id ?? null;
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => readStored(userId, COMPANY_KEY));
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(() => readStored(userId, BRANCH_KEY));
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  /** The user whose company has already been auto-selected once. */
  const autoSelected = useRef<string | null>(null);

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
          writeStored(userId, COMPANY_KEY, null);
        }
        // A branch of the user's company where they hold no role is not theirs
        // to work in: the server still names it, marked has_roles=false, and
        // would refuse every request made there. Treat it like a stale pick.
        const branchReachable = ctx.branch
          ? (ctx.company?.branches ?? []).some((b) => b.id === ctx.branch!.id && b.has_roles)
          : false;
        if (selectedBranchId && !branchReachable) {
          setSelectedBranchId(null);
          writeStored(userId, BRANCH_KEY, null);
        }
        // SINGLE-COMPANY PRODUCT: one company is not a choice to make, so it is
        // selected automatically and the pill is purely a branch picker. Once
        // per user: the branch check above also DROPS a selection the server
        // does not grant, and re-selecting on every response would spin.
        if (!selectedCompanyId && ctx.companies?.length === 1 && autoSelected.current !== userId) {
          autoSelected.current = userId;
          const only = ctx.companies[0].id;
          setSelectedCompanyId(only);
          writeStored(userId, COMPANY_KEY, only);
        }
        setResult({ key, data: ctx, error: null });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.isNotFound && (selectedCompanyId || selectedBranchId)) {
          // A stale selection the user no longer has access to. Drop it; the
          // effect re-runs for the cleared selection.
          setSelectedCompanyId(null);
          setSelectedBranchId(null);
          writeStored(userId, COMPANY_KEY, null);
          writeStored(userId, BRANCH_KEY, null);
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
  }, [status, selectedCompanyId, selectedBranchId, key, reloadNonce, userId]);

  const selectCompany = useCallback((companyId: string | null) => {
    setSelectedCompanyId(companyId);
    writeStored(userId, COMPANY_KEY, companyId);
    // A branch belongs to one company; changing company clears it.
    setSelectedBranchId(null);
    writeStored(userId, BRANCH_KEY, null);
  }, [userId]);

  const selectBranch = useCallback((branchId: string | null) => {
    setSelectedBranchId(branchId);
    writeStored(userId, BRANCH_KEY, branchId);
  }, [userId]);

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
      // Only branches the user can actually work in are offered.
      branches: (data?.company?.branches ?? []).filter((b) => b.has_roles),
      selectedCompanyId: data?.company?.id ?? null,
      selectedBranchId: data?.branch?.id ?? null,
      selectedBranch:
        data?.company?.branches?.find((b) => b.id === data?.branch?.id) ?? null,
      companyPermissions: data?.company?.permissions ?? [],
      roleNames: data?.branch
        ? (data.branch.roles ?? [])
        : [...new Set((data?.company?.branches ?? []).flatMap((b) => b.roles ?? []))].sort(),
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
