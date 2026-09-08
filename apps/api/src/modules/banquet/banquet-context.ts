/**
 * Guard-verified request context for every banquet operation.
 *
 * PermissionGuard has already proved, against the database, that
 * `actorUserId` is an ACTIVE user with ACTIVE membership in `companyId`, that
 * `branchId` belongs to that company and is ACTIVE, and that the user holds
 * the route's permission there. The headers that carried these ids are
 * requested context only; this object is the proven result.
 */
export interface BanquetActorContext {
  companyId: string;
  branchId: string;
  actorUserId: string;
}

/** Company-scoped operations (packages) need no branch. */
export interface BanquetCompanyContext {
  companyId: string;
  actorUserId: string;
}
