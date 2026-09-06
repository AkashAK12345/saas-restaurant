import { Injectable } from '@nestjs/common';
import { DisplayDeviceStatus, BranchStatus, CompanyStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { STAFF_CHANNEL_PERMISSION, displayKindMaySubscribe } from './channels.js';
import type { StreamTicketRecord } from './stream-ticket.service.js';

/**
 * Re-verifies, at CONNECT time, that the subject a ticket was minted for is
 * still allowed to receive the scope it names.
 *
 * The ticket already proves the mint was authorized moments ago. This second
 * check exists so that revoking a device, deactivating a user, removing a
 * role, or disabling a branch takes effect even against a ticket minted just
 * before — and it goes through the SAME AuthorizationService the guards use,
 * so there is exactly one definition of "may this user see this branch".
 */
@Injectable()
export class StreamAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async isStillAuthorized(record: StreamTicketRecord): Promise<boolean> {
    const { subject, scope } = record;

    if (subject.kind === 'staff') {
      return this.authorization.hasBranchPermission(
        subject.userId,
        scope.companyId,
        scope.branchId,
        STAFF_CHANNEL_PERMISSION[scope.channel],
      );
    }

    // Display: same lifecycle rules as DisplayDeviceAuthService, minus the
    // secret comparison (the ticket stands in for it).
    const device = await this.prisma.displayDevice.findUnique({
      where: { id: subject.deviceId },
      include: { branch: { select: { status: true, company_id: true, company: { select: { status: true } } } } },
    });
    if (!device) return false;
    if (device.status !== DisplayDeviceStatus.ACTIVE || device.revoked_at !== null) return false;
    if (device.branch_id !== scope.branchId) return false;
    if (device.branch.company_id !== scope.companyId) return false;
    if (device.branch.status !== BranchStatus.ACTIVE) return false;
    if (device.branch.company.status !== CompanyStatus.ACTIVE) return false;
    if (!displayKindMaySubscribe(device.kind, scope.channel)) return false;
    return true;
  }
}
