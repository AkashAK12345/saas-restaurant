import { api } from '@/lib/api/client';

/**
 * User Management: members and the access each one is given as toggles.
 *
 * The catalogue (sections, daily forms, presets) comes from the API, which
 * also turns a selection into permission keys — the web only draws the form
 * and sends back what was switched on.
 */

export type UserType = 'ADMIN' | 'MANAGER' | 'STAFF';
export type RoutineLevel = 'STAFF' | 'MANAGER';
export type TaskMode = 'OFF' | 'RECEIVE' | 'BOTH';

export interface AccessSelection {
  toggles: string[];
  /** A daily form left out is Off. */
  routines: Partial<Record<string, RoutineLevel>>;
  tasks: TaskMode;
}

export interface AccessCatalogue {
  sections: {
    key: string;
    title: string;
    /** `available: false` — saved with the user, but the feature is not built yet. */
    toggles: { key: string; label: string; available: boolean }[];
  }[];
  routines: { key: string; label: string }[];
  presets: Record<UserType, AccessSelection>;
  branches: { id: string; name: string }[];
}

export interface UserListEntry {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  user_type: UserType;
  corporate: boolean;
  branch: { id: string; name: string } | null;
}

export interface UserAccessDetail extends UserListEntry {
  access: AccessSelection;
  /** False until first saved here: the toggles show what shared roles give today. */
  managed: boolean;
}

export interface SaveUserAccess {
  user_type: UserType;
  corporate: boolean;
  branch_id?: string;
  access: AccessSelection;
}

const opts = (companyId: string) => ({ companyId });

export const userAccessApi = {
  catalogue: (companyId: string) => api.get<AccessCatalogue>('/user-access/catalog', opts(companyId)),
  list: (companyId: string) => api.get<UserListEntry[]>('/user-access/users', opts(companyId)),
  detail: (companyId: string, id: string) => api.get<UserAccessDetail>(`/user-access/users/${id}`, opts(companyId)),
  create: (companyId: string, body: SaveUserAccess & { email: string; password: string }) =>
    api.post<UserAccessDetail>('/user-access/users', body, opts(companyId)),
  save: (companyId: string, id: string, body: SaveUserAccess) =>
    api.put<UserAccessDetail>(`/user-access/users/${id}`, body, opts(companyId)),
};

export const USER_TYPE_LABEL: Record<UserType, string> = { ADMIN: 'Admin', MANAGER: 'Manager', STAFF: 'Staff' };

/** The value of the branch picker that means every branch. */
export const CORPORATE = 'corporate';

export const EMPTY_SELECTION: AccessSelection = { toggles: [], routines: {}, tasks: 'OFF' };

/** The preset a selection matches exactly, if any — else the form reads "Custom". */
export function matchingPreset(catalogue: AccessCatalogue, selection: AccessSelection): UserType | null {
  const same = (a: AccessSelection, b: AccessSelection) =>
    a.tasks === b.tasks &&
    [...a.toggles].sort().join() === [...b.toggles].sort().join() &&
    JSON.stringify(Object.entries(a.routines).sort()) === JSON.stringify(Object.entries(b.routines).sort());
  return (['ADMIN', 'MANAGER', 'STAFF'] as const).find((t) => same(catalogue.presets[t], selection)) ?? null;
}

/** Two letters for the avatar. */
export const initials = (name: string) => name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';

/** A steady avatar tint per person, from the reference's soft palette. */
export const AVATAR_TONES = ['terracotta', 'blue', 'purple', 'amber', 'green'] as const;
export function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
