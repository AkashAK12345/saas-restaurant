export interface TaskActorContext {
  companyId: string;
  branchId: string;
  actorUserId: string;
}

/** Company-scoped operations (checklist templates) need no branch. */
export interface TaskCompanyContext {
  companyId: string;
  actorUserId: string;
}
