import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { DisplayDeviceAuthService } from './display-device-auth.service.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '44444444-4444-4444-8444-444444444444';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    branch_id: BRANCH_ID,
    kind: 'QUEUE_CUSTOMER',
    status: 'ACTIVE',
    revoked_at: null,
    credential_hash: sha256('correct-secret'),
    branch: {
      id: BRANCH_ID,
      status: 'ACTIVE',
      company_id: COMPANY_ID,
      company: { status: 'ACTIVE' },
    },
    ...overrides,
  };
}

describe('DisplayDeviceAuthService', () => {
  let prisma: { displayDevice: { findUnique: ReturnType<typeof vi.fn> } };
  let service: DisplayDeviceAuthService;

  beforeEach(() => {
    prisma = { displayDevice: { findUnique: vi.fn().mockResolvedValue(makeDevice()) } };
    service = new DisplayDeviceAuthService(prisma as unknown as PrismaService);
  });

  describe('issueSecret', () => {
    it('produces a 64-hex secret whose stored form is its SHA-256', () => {
      const { secret, hash } = service.issueSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(sha256(secret));
      expect(hash).not.toBe(secret);
    });

    it('never issues the same secret twice', () => {
      const a = service.issueSecret().secret;
      const b = service.issueSecret().secret;
      expect(a).not.toBe(b);
    });

    it('formats the credential as <deviceId>.<secret>', () => {
      expect(service.formatCredential(DEVICE_ID, 'abc')).toBe(`${DEVICE_ID}.abc`);
    });
  });

  describe('authenticate', () => {
    const good = `${DEVICE_ID}.correct-secret`;

    it('authenticates a valid credential for its own branch', async () => {
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toEqual({
        id: DEVICE_ID,
        branchId: BRANCH_ID,
        companyId: COMPANY_ID,
        kind: 'QUEUE_CUSTOMER',
      });
    });

    it.each([
      ['missing credential', undefined, BRANCH_ID],
      ['missing branch', good, undefined],
      ['no dot separator', `${DEVICE_ID}correct-secret`, BRANCH_ID],
      ['empty secret', `${DEVICE_ID}.`, BRANCH_ID],
      ['non-uuid device id', 'not-a-uuid.correct-secret', BRANCH_ID],
      ['non-uuid branch', good, 'not-a-uuid'],
    ])('rejects %s without touching the database', async (_label, cred, branch) => {
      await expect(service.authenticate(cred as never, branch as never)).resolves.toBeNull();
      expect(prisma.displayDevice.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an unknown device', async () => {
      prisma.displayDevice.findUnique.mockResolvedValue(null);
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toBeNull();
    });

    it('rejects a wrong secret (constant-time compare against the stored hash)', async () => {
      await expect(
        service.authenticate(`${DEVICE_ID}.wrong-secret`, BRANCH_ID),
      ).resolves.toBeNull();
    });

    it('rejects a REVOKED device', async () => {
      prisma.displayDevice.findUnique.mockResolvedValue(
        makeDevice({ status: 'REVOKED', revoked_at: new Date() }),
      );
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toBeNull();
    });

    it('rejects a device whose revoked_at is set even if status was not updated', async () => {
      prisma.displayDevice.findUnique.mockResolvedValue(makeDevice({ revoked_at: new Date() }));
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toBeNull();
    });

    it('rejects a valid credential presented for a DIFFERENT branch', async () => {
      // X-Branch-ID is a claim; the row is the truth.
      await expect(service.authenticate(good, OTHER_BRANCH)).resolves.toBeNull();
    });

    it('rejects when the branch is INACTIVE', async () => {
      const d = makeDevice();
      d.branch.status = 'INACTIVE';
      prisma.displayDevice.findUnique.mockResolvedValue(d);
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toBeNull();
    });

    it.each(['INACTIVE', 'SUSPENDED'])('rejects when the company is %s', async (status) => {
      const d = makeDevice();
      d.branch.company.status = status;
      prisma.displayDevice.findUnique.mockResolvedValue(d);
      await expect(service.authenticate(good, BRANCH_ID)).resolves.toBeNull();
    });

    it('looks the device up by primary key, not by secret', async () => {
      await service.authenticate(good, BRANCH_ID);
      expect(prisma.displayDevice.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: DEVICE_ID } }),
      );
    });
  });
});
