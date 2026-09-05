import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permission-keys.js';

// The scope determines which context headers are required and validated.
// 'company' → X-Company-ID only; verifies CompanyMembership + company-wide permissions.
// 'branch'  → X-Company-ID + X-Branch-ID; verifies membership, branch ownership, branch permissions.
export type PermissionScope = 'company' | 'branch';

export interface PermissionMeta {
  permission: PermissionKey;
  scope: PermissionScope;
}

export const PERMISSION_META_KEY = 'samco:permission_meta';

/**
 * Marks a route as requiring a company-scoped permission.
 * The guard will verify the authenticated user has an ACTIVE CompanyMembership
 * for X-Company-ID and holds the required permission via any branch role in that company.
 */
export const RequireCompanyPermission = (permission: PermissionKey) =>
  SetMetadata<string, PermissionMeta>(PERMISSION_META_KEY, {
    permission,
    scope: 'company',
  });

/**
 * Marks a route as requiring a branch-scoped permission.
 * The guard will additionally verify that:
 *   - X-Branch-ID is provided
 *   - the branch belongs to X-Company-ID
 *   - the user holds the required permission via branch roles at that specific branch
 */
export const RequireBranchPermission = (permission: PermissionKey) =>
  SetMetadata<string, PermissionMeta>(PERMISSION_META_KEY, {
    permission,
    scope: 'branch',
  });
