import {
  BadRequestException,
  BadGatewayException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { AuditEventType, UserStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService, AuditFailurePolicy } from '../audit-logs/audit-logs.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { LOGIN_ATTEMPT_STORE, type LoginAttemptStore } from './login-throttle.service.js';

export const RECOVERY = {
  CODE_TTL_MS: 10 * 60 * 1000,
  MAX_ATTEMPTS: 5,
  /** Between two codes for one email. */
  RESEND_COOLDOWN_MS: 60 * 1000,
  /** Requests per email, and per IP, in an hour. */
  MAX_REQUESTS_PER_EMAIL: 5,
  MAX_REQUESTS_PER_IP: 20,
  /** Reset attempts per IP in an hour, across all codes. */
  MAX_RESETS_PER_IP: 30,
  WINDOW_MS: 60 * 60 * 1000,
} as const;

/** The same answer whether or not the email can be recovered. */
export const RECOVERY_SENT_MESSAGE =
  'If this account can be recovered, a 6-digit code has been sent to its email. It expires in 10 minutes.';
const INVALID_CODE = 'The code is wrong or has expired. Ask for a new code.';

/**
 * "Forgot password" by an emailed one-time code — for the OWNER account only.
 *
 * Every other email gets the same reply and nothing is sent, so the screen
 * never reveals which accounts exist or which one is the owner. Codes are 6
 * random digits, kept only as an HMAC, valid 10 minutes, spent after 5 wrong
 * tries, by a successful reset, or by a newer code. A reset signs the owner
 * out everywhere and clears the sign-in lockout.
 */
@Injectable()
export class PasswordRecoveryService {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditLogService,
    @Inject(LOGIN_ATTEMPT_STORE) private readonly loginThrottle: LoginAttemptStore,
  ) {}

  async request(rawEmail: string, ip: string): Promise<{ message: string }> {
    const email = rawEmail.trim().toLowerCase();
    if (!this.mail.configured) {
      throw new ServiceUnavailableException('Password recovery by email is not set up yet.');
    }
    this.limit(`req:ip:${ip}`, RECOVERY.MAX_REQUESTS_PER_IP);
    this.limit(`req:email:${email}`, RECOVERY.MAX_REQUESTS_PER_EMAIL);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.is_owner || user.status !== UserStatus.ACTIVE) return { message: RECOVERY_SENT_MESSAGE };

    const last = await this.prisma.passwordResetCode.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
    });
    if (last && Date.now() - last.created_at.getTime() < RECOVERY.RESEND_COOLDOWN_MS) {
      throw new HttpException('Please wait a minute before asking for another code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const record = await this.prisma.$transaction(async (tx) => {
      // A newer code replaces any earlier one.
      await tx.passwordResetCode.updateMany({
        where: { user_id: user.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      return tx.passwordResetCode.create({
        data: {
          user_id: user.id,
          code_hash: this.hash(user.id, code),
          expires_at: new Date(Date.now() + RECOVERY.CODE_TTL_MS),
        },
      });
    });

    try {
      await this.mail.send({
        to: user.email,
        subject: `${code} is your SAMCO password reset code`,
        text:
          `Your SAMCO password reset code is ${code}.\n\n` +
          'It expires in 10 minutes. If you did not ask to reset your password, ignore this email — your password stays the same.',
        html:
          '<div style="font-family:Arial,sans-serif;color:#2c2825;max-width:420px">' +
          '<p style="font-size:20px;font-weight:bold;color:#7a1b39;margin:0 0 16px">SAMCO</p>' +
          '<p>Your password reset code is</p>' +
          `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#c25839;margin:8px 0 16px">${code}</p>` +
          '<p>It expires in 10 minutes.</p>' +
          '<p style="color:#8b8478;font-size:13px">If you did not ask to reset your password, ignore this email — your password stays the same.</p></div>',
      });
    } catch {
      await this.prisma.passwordResetCode.update({ where: { id: record.id }, data: { consumed_at: new Date() } });
      throw new BadGatewayException('The code could not be emailed. Please try again later.');
    }

    await this.audit.create({
      actorUserId: user.id,
      eventType: AuditEventType.SECURITY,
      entityType: 'AUTHENTICATION',
      entityId: user.id,
      payload: { action: 'password_reset_requested', ip },
      failurePolicy: AuditFailurePolicy.BEST_EFFORT,
    });
    return { message: RECOVERY_SENT_MESSAGE };
  }

  async reset(rawEmail: string, code: string, newPassword: string, ip: string): Promise<{ reset: true }> {
    const email = rawEmail.trim().toLowerCase();
    this.limit(`reset:ip:${ip}`, RECOVERY.MAX_RESETS_PER_IP);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.is_owner || user.status !== UserStatus.ACTIVE) throw new BadRequestException(INVALID_CODE);

    const current = await this.prisma.passwordResetCode.findFirst({
      where: { user_id: user.id, consumed_at: null, expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
    });
    if (!current) throw new BadRequestException(INVALID_CODE);

    if (!this.matches(current.code_hash, this.hash(user.id, code))) {
      const attempts = current.attempts + 1;
      await this.prisma.passwordResetCode.update({
        where: { id: current.id },
        data: { attempts, ...(attempts >= RECOVERY.MAX_ATTEMPTS ? { consumed_at: new Date() } : {}) },
      });
      await this.audit.create({
        actorUserId: user.id,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: user.id,
        payload: { action: 'password_reset_failure', attempts, ip },
        failurePolicy: AuditFailurePolicy.BEST_EFFORT,
      });
      throw new BadRequestException(INVALID_CODE);
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      // Spent only if still unspent: two resets racing on one code, one wins.
      const { count } = await tx.passwordResetCode.updateMany({
        where: { id: current.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      if (count !== 1) throw new BadRequestException(INVALID_CODE);
      await tx.user.update({ where: { id: user.id }, data: { password_hash } });
      const revoked = await tx.userSession.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await this.audit.create(
        {
          actorUserId: user.id,
          eventType: AuditEventType.SECURITY,
          entityType: 'AUTHENTICATION',
          entityId: user.id,
          payload: { action: 'password_reset', revoked_logins: revoked.count, ip },
        },
        tx,
      );
    });
    // A locked-out owner can sign in straight away with the new password.
    await this.loginThrottle.registerSuccess(ip, email);
    return { reset: true };
  }

  private hash(userId: string, code: string): string {
    const secret = this.config.get<string>('ACCESS_TOKEN_SECRET') ?? '';
    return createHmac('sha256', secret).update(`password-reset:${userId}:${code}`).digest('hex');
  }

  private matches(a: string, b: string): boolean {
    const x = Buffer.from(a, 'hex');
    const y = Buffer.from(b, 'hex');
    return x.length === y.length && timingSafeEqual(x, y);
  }

  /** A sliding one-hour window per key; refuses once the budget is spent. */
  private limit(key: string, max: number) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < RECOVERY.WINDOW_MS);
    if (recent.length >= max) {
      throw new HttpException('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value!);
  }
}
