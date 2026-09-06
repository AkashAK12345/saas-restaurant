/**
 * Types for the backend responses the foundation consumes.
 *
 * These mirror the API's DTOs by hand for now. The `packages/api-contracts`
 * workspace stub exists precisely so this can become a shared, generated
 * contract later; that move is tracked as backlog and is not required here.
 */

export interface ApiErrorBody {
  statusCode: number;
  timestamp?: string;
  path?: string;
  message: string | string[];
}

export interface AuthUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser & { is_superadmin: boolean };
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export type CompanyStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type BranchStatus = 'ACTIVE' | 'INACTIVE';

export interface ContextCompanySummary {
  id: string;
  name: string;
  status: CompanyStatus;
}

export interface ContextBranch {
  id: string;
  name: string;
  status: BranchStatus;
  timezone: string;
  has_roles: boolean;
}

export interface ContextSelectedCompany extends ContextCompanySummary {
  permissions: string[];
  branches: ContextBranch[];
}

export interface ContextSelectedBranch {
  id: string;
  name: string;
  status: BranchStatus;
  timezone: string;
  permissions: string[];
}

/** GET /auth/context */
export interface AuthContextResponse {
  user: AuthUser;
  companies: ContextCompanySummary[];
  company: ContextSelectedCompany | null;
  branch: ContextSelectedBranch | null;
}

/** POST /realtime/tickets/:channel and POST /display/stream-tickets */
export interface StreamTicketResponse {
  ticket: string;
  expires_at: string;
  channel: string;
  branch_id: string;
}
