import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import * as crypto from 'crypto';
import {
  BranchStatus,
  CompanyStatus,
  DisplayDeviceStatus,
  type DisplayDeviceKind,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';

/** What a successfully authenticated device is allowed to know about itself. */
export interface AuthenticatedDisplay {
  id: string;
  branchId: string;
  companyId: string;
  kind: DisplayDeviceKind;
}

/**
 * Display credential mechanics, shared by pairing (DisplayDevicesService) and
 * authentication (DisplayDeviceGuard).
 *
 * Credential format mirrors the refresh token: `<deviceId>.<secret>`, where
 * only SHA-256(secret) is stored. The device id half lets us look the row up
 * by primary key; the secret half is compared in constant time.
 *
 * This is a SEPARATE trust path from staff RBAC by design:
 *
 *   Staff:    JWT → session → RBAC → permission
 *   Display:  credential → device row → ACTIVE + branch + kind
 *
 * A device never gains a permission, a role, or a user identity.
 */
@Injectable()
export class DisplayDeviceAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Generate a fresh raw secret and its stored hash. */
  issueSecret(): { secret: string; hash: string } {
    const secret = crypto.randomBytes(32).toString('hex');
    return { secret, hash: this.hashSecret(secret) };
  }

  hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  formatCredential(deviceId: string, secret: string): string {
    return `${deviceId}.${secret}`;
  }

  private secretsMatch(presented: string, storedHash: string): boolean {
    const a = Buffer.from(this.hashSecret(presented), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Resolve a raw credential to an authenticated display, or null.
   *
   * Every failure — malformed, unknown, revoked, bad secret, wrong branch,
   * disabled branch, disabled company — returns null uniformly so the caller
   * can emit one generic 401 and disclose nothing about which check failed.
   *
   * `requestedBranchId` is the X-Branch-ID header: it is the branch the device
   * *claims* to be operating for. The claim is verified against the row, never
   * trusted.
   */
  async authenticate(
    rawCredential: string | undefined,
    requestedBranchId: string | undefined,
  ): Promise<AuthenticatedDisplay | null> {
    if (!rawCredential || !requestedBranchId) return null;

    const dot = rawCredential.indexOf('.');
    if (dot <= 0) return null;
    const deviceId = rawCredential.slice(0, dot);
    const secret = rawCredential.slice(dot + 1);
    if (!isUUID(deviceId) || !isUUID(requestedBranchId) || secret.length === 0) {
      return null;
    }

    const device = await this.prisma.displayDevice.findUnique({
      where: { id: deviceId },
      include: {
        branch: { select: { id: true, status: true, company_id: true, company: { select: { status: true } } } },
      },
    });

    if (!device) return null;
    if (device.status !== DisplayDeviceStatus.ACTIVE || device.revoked_at !== null) return null;
    if (!this.secretsMatch(secret, device.credential_hash)) return null;

    // Branch binding: the credential is only valid for the branch it was
    // paired to. A device physically moved to another branch must be re-paired.
    if (device.branch_id !== requestedBranchId) return null;

    // Same lifecycle gating as staff authorization (H4): a disabled branch or
    // company stops its screens too.
    if (device.branch.status !== BranchStatus.ACTIVE) return null;
    if (device.branch.company.status !== CompanyStatus.ACTIVE) return null;

    return {
      id: device.id,
      branchId: device.branch_id,
      companyId: device.branch.company_id,
      kind: device.kind,
    };
  }
}
