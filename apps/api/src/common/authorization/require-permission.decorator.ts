import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permission-keys.js';

// The scope determines which context headers are required and validated.
// 'company'        → X-Company-ID only; verifies CompanyMembership + company-wide permissions.
// 'branch'         → X-Company-ID + X-Branch-ID; verifies membership, branch ownership, branch permissions.
// 'company_status' → as 'company', minus the company-must-be-ACTIVE precondition.
//                    Reserved exclusively for company lifecycle transitions.
export type PermissionScope = 'company' | 'branch' | 'company_status';

export interface PermissionMeta {
  /**
   * One key, or a list of which the caller must hold AT LEAST ONE. A list is
   * for reads that come in a wide and a narrow form (tasks.view /
   * tasks.view_own); the service then narrows what the narrow key returns.
   */
  permission: PermissionKey | readonly PermissionKey[];
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
export const RequireBranchPermission = (permission: PermissionKey | readonly PermissionKey[]) =>
  SetMetadata<string, PermissionMeta>(PERMISSION_META_KEY, {
    permission,
    scope: 'branch',
  });

/**
 * Marks a route as a COMPANY LIFECYCLE TRANSITION.
 *
 * Identical to RequireCompanyPermission except that it does NOT require the
 * company to be ACTIVE — by definition a company being reactivated is not.
 *
 * This is the ONLY scope that relaxes the company-status precondition, and it
 * exists solely so that disabling a company is a recoverable action rather than
 * a permanent lockout. Everything else still applies and is verified
 * server-side:
 *
 *   - the caller is authenticated
 *   - the caller holds an ACTIVE CompanyMembership in that exact company
 *   - the caller holds the required permission via a branch role in that company
 *
 * Because membership and roles are company-scoped, cross-company recovery is
 * structurally impossible: there is no way to satisfy this check for a company
 * you are not an active member of.
 *
 * Do NOT reuse this scope for ordinary business operations.
 */
export const RequireCompanyStatusPermission = (permission: PermissionKey) =>
  SetMetadata<string, PermissionMeta>(PERMISSION_META_KEY, {
    permission,
    scope: 'company_status',
  });
