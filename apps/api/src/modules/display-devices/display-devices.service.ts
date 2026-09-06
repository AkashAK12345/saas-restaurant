import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { AuditEventType, DisplayDeviceStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { DisplayDeviceAuthService } from '../../common/display-auth/display-device-auth.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { CreateDisplayDeviceDto } from './display-devices.dto.js';

/**
 * Projection returned to staff. `credential_hash` is never selected — there is
 * no code path that reads it out of this service except authentication.
 */
const SAFE_SELECT = {
  id: true,
  branch_id: true,
  name: true,
  kind: true,
  status: true,
  revoked_at: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class DisplayDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly displayAuth: DisplayDeviceAuthService,
  ) {}

  async listDevices(
    branchId: string,
    page: { limit: number; offset: number },
  ): Promise<Paginated<unknown>> {
    const where = { branch_id: branchId };
    const [data, total] = await Promise.all([
      this.prisma.displayDevice.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { created_at: 'desc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.displayDevice.count({ where }),
    ]);
    return { data, meta: { total, limit: page.limit, offset: page.offset } };
  }

  /** Scoped by id AND branch_id; 404 hides other branches' devices. */
  async getDevice(deviceId: string, branchId: string) {
    const device = await this.prisma.displayDevice.findFirst({
      where: { id: deviceId, branch_id: branchId },
      select: SAFE_SELECT,
    });
    if (!device) throw new NotFoundException();
    return device;
  }

  /**
   * Pair a new device. The raw credential is returned in THIS response only;
   * it is not stored, not logged, and cannot be retrieved again. Losing it
   * means revoking the device and pairing a new one.
   */
  async createDevice(
    branchId: string,
    companyId: string,
    dto: CreateDisplayDeviceDto,
    actorUserId: string,
  ) {
    const { secret, hash } = this.displayAuth.issueSecret();

    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.displayDevice.create({
        data: {
          branch_id: branchId,
          name: dto.name,
          kind: dto.kind,
          credential_hash: hash,
        },
        select: SAFE_SELECT,
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId,
          eventType: AuditEventType.SECURITY,
          entityType: 'DISPLAY_DEVICE',
          entityId: created.id,
          // Never the secret, never the hash. The sanitizer would also redact
          // any key containing "credential" as a second line of defence.
          payload: { action: 'device_paired', name: dto.name, kind: dto.kind },
        },
        tx,
      );

      return created;
    });

    return {
      device,
      credential: this.displayAuth.formatCredential(device.id, secret),
    };
  }

  /**
   * Revoke. Idempotent-safe: revoking an already-revoked device is a 409 so
   * the caller learns nothing new and no duplicate audit row is written.
   */
  async revokeDevice(deviceId: string, branchId: string, companyId: string, actorUserId: string) {
    const existing = await this.getDevice(deviceId, branchId);
    if (existing.status === DisplayDeviceStatus.REVOKED) {
      throw new ConflictException('Display device is already revoked');
    }

    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.displayDevice.update({
        where: { id: deviceId },
        data: { status: DisplayDeviceStatus.REVOKED, revoked_at: new Date() },
        select: SAFE_SELECT,
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId,
          eventType: AuditEventType.SECURITY,
          entityType: 'DISPLAY_DEVICE',
          entityId: deviceId,
          payload: { action: 'device_revoked', name: existing.name, kind: existing.kind },
        },
        tx,
      );

      return revoked;
    });
  }
}
