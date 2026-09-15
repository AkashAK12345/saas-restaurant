import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service.js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto, ChangePasswordDto } from './auth.dto.js';
import {
  AuditLogService,
  AuditFailurePolicy,
} from '../audit-logs/audit-logs.service.js';
import { AuditEventType, UserStatus } from '@samco/database';
import {
  LOGIN_ATTEMPT_STORE,
  type LoginAttemptStore,
} from './login-throttle.service.js';

/**
 * Fixed bcrypt hash used to equalise timing when no user matches the submitted
 * email. Without it, the "user not found" path returns before any hash
 * comparison, and the response-time difference distinguishes registered from
 * unregistered addresses. The plaintext behind this hash is irrelevant and is
 * never a valid credential for any account.
 */
const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTokenExpiresInDays: number;
  private readonly refreshTokenAbsoluteDays: number;
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
    @Inject(LOGIN_ATTEMPT_STORE)
    private readonly loginThrottle: LoginAttemptStore,
  ) {
    this.refreshTokenExpiresInDays = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN_DAYS', '7'),
      10,
    );
    this.refreshTokenAbsoluteDays = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_ABSOLUTE_DAYS', '30'),
      10,
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateOpaqueToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Access tokens carry the session id (`sid`) alongside the subject so that
   * JwtStrategy can verify the issuing session is still live. Without it, a
   * revoked session's access token stayed valid for its full remaining lifetime.
   */
  private signAccessToken(userId: string, sessionId: string) {
    return this.jwtService.sign({
      sub: userId,
      sid: sessionId,
    });
  }

  private slidingExpiry(from: Date): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + this.refreshTokenExpiresInDays);
    return d;
  }

  private absoluteExpiry(from: Date): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + this.refreshTokenAbsoluteDays);
    return d;
  }

  async login(loginDto: LoginDto, ip: string, userAgent?: string) {
    const email = this.normalizeEmail(loginDto.email);

    // Throttle check happens before any database lookup, and is keyed only on
    // (ip, submitted email) — so the 429 is identical whether or not the account
    // exists and leaks nothing about account existence.
    if (await this.loginThrottle.isBlocked(ip, email)) {
      const retryAfter = await this.loginThrottle.retryAfterSeconds(ip, email);
      throw new HttpException(
        `Too many failed login attempts. Try again in ${retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a bcrypt comparison, even with no user, so both branches cost
    // the same. `user &&` ordering matters: the dummy compare must still run.
    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    // A globally disabled account must not authenticate, and must be
    // indistinguishable from a wrong password: same 401, same message, same
    // throttle accounting. Revealing "this account is disabled" would confirm
    // the address is registered.
    const accountUsable = !!user && user.status === UserStatus.ACTIVE;

    if (!accountUsable || !passwordMatches) {
      await this.loginThrottle.registerFailure(ip, email);

      // BEST_EFFORT: the request is already being denied. Throwing here would
      // turn a clean 401 into a 500 and hand an attacker a probing signal.
      // The failure is still logged loudly as AUDIT_WRITE_FAILURE.
      await this.auditLogService.create({
        actorUserId: user?.id ?? null,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: user?.id ?? 'unknown',
        payload: {
          action: 'login_failure',
          // The audit record may distinguish the cause — it is server-side and
          // access-controlled. The HTTP response must not.
          reason:
            user && user.status !== UserStatus.ACTIVE
              ? 'account_disabled'
              : 'invalid_credentials',
          method: 'password',
        },
        failurePolicy: AuditFailurePolicy.BEST_EFFORT,
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginThrottle.registerSuccess(ip, email);

    const refreshToken = this.generateOpaqueToken();
    const tokenHash = this.hashRefreshToken(refreshToken);
    const now = new Date();

    // Session creation and its audit record are one transaction: we never issue
    // credentials that we failed to record.
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: this.slidingExpiry(now),
          absolute_expires_at: this.absoluteExpiry(now),
          // For the owner's "signed-in devices" list only.
          user_agent: userAgent ? userAgent.slice(0, 300) : null,
          ip_address: ip && ip !== 'unknown' ? ip.slice(0, 64) : null,
          last_used_at: now,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId: user.id,
          eventType: AuditEventType.SECURITY,
          entityType: 'AUTHENTICATION',
          entityId: user.id,
          payload: { action: 'login_success', method: 'password' },
        },
        tx,
      );

      return created;
    });

    return {
      accessToken: this.signAccessToken(user.id, session.id),
      refreshToken: `${session.id}.${refreshToken}`,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        is_superadmin: user.is_superadmin,
      },
    };
  }

  /**
   * Revoke a session and record why, atomically.
   */
  private async revokeSession(
    sessionId: string,
    userId: string,
    action: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });

      await this.auditLogService.create(
        {
          actorUserId: userId,
          eventType: AuditEventType.SECURITY,
          entityType: 'AUTHENTICATION',
          entityId: userId,
          // Deliberately no session identifier in the payload: it is one half of
          // the refresh-token material and offers no forensic value beyond the
          // user id and timestamp already recorded.
          payload: reason ? { action, reason } : { action },
        },
        tx,
      );
    });
  }

  async refresh(refreshTokenStr: string) {
    const now = new Date();
    const parts = refreshTokenStr.split('.');

    if (parts.length !== 2) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [sessionId, rawToken] = parts;

    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.revoked_at || session.expires_at < now) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Global account status is re-checked on every refresh: disabling a user
    // must stop their existing sessions from being renewed, not merely block
    // new logins. The session is revoked so it cannot be retried.
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(
        sessionId,
        session.user.id,
        'refresh_failure',
        'account_disabled',
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Absolute ceiling: rotation extends the sliding window but can never push a
    // session past the hard lifetime fixed at login.
    if (session.absolute_expires_at < now) {
      await this.revokeSession(
        sessionId,
        session.user.id,
        'refresh_failure',
        'absolute_lifetime_exceeded',
      );
      this.logger.warn(
        `Session ${sessionId} exceeded its absolute lifetime. Session revoked.`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isValidToken = this.hashRefreshToken(rawToken) === session.token_hash;
    if (!isValidToken) {
      // The session id was correct (an unguessable UUID) but the token was not:
      // almost certainly a replay of a superseded token. Kill the session.
      await this.revokeSession(
        sessionId,
        session.user.id,
        'refresh_failure',
        'replay_detected',
      );
      this.logger.warn(
        `Invalid token presented for session ${sessionId}. Revoking session (possible replay).`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRawToken = this.generateOpaqueToken();
    const newTokenHash = this.hashRefreshToken(newRawToken);

    // The new sliding expiry is clamped to the absolute ceiling.
    const slidingCandidate = this.slidingExpiry(now);
    const newExpiresAt =
      slidingCandidate > session.absolute_expires_at
        ? session.absolute_expires_at
        : slidingCandidate;

    // Concurrency protection: atomic compare-and-swap on token_hash.
    const updateResult = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        token_hash: session.token_hash,
        revoked_at: null,
      },
      data: {
        token_hash: newTokenHash,
        expires_at: newExpiresAt,
        last_used_at: now,
      },
    });

    if (updateResult.count === 0) {
      await this.revokeSession(
        sessionId,
        session.user.id,
        'refresh_failure',
        'replay_detected',
      );
      this.logger.warn(`Token replay detected for session ${sessionId}. Session revoked.`);
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken: this.signAccessToken(session.user.id, sessionId),
      refreshToken: `${sessionId}.${newRawToken}`,
    };
  }

  /**
   * An opaque handle for a session, for the owner's device list.
   *
   * The session id is deliberately never returned: it is one half of the
   * refresh-token material (`<id>.<secret>`). The handle is a one-way digest of
   * it, so a leaked device list reveals nothing that helps forge a token.
   */
  sessionHandle(sessionId: string): string {
    return crypto.createHash('sha256').update(`samco-session-handle:${sessionId}`).digest('hex').slice(0, 32);
  }

  /** The caller's live logins, most recently used first. Their own, only. */
  async listSessions(userId: string, currentSessionId: string) {
    const now = new Date();
    const rows = await this.prisma.userSession.findMany({
      where: {
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: now },
        absolute_expires_at: { gt: now },
      },
      orderBy: [{ last_used_at: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        created_at: true,
        last_used_at: true,
        expires_at: true,
        user_agent: true,
        ip_address: true,
      },
    });
    return rows.map(({ id, ...row }) => ({
      handle: this.sessionHandle(id),
      ...row,
      current: id === currentSessionId,
    }));
  }

  /**
   * Sign one of the caller's own logins out, from any of their devices. The
   * revoked session's access token stops working immediately (JwtStrategy
   * checks the session on every request) and its refresh token can never be
   * used again. Another user's session is simply not found.
   */
  async revokeOwnSession(
    userId: string,
    currentSessionId: string,
    handle: string,
  ): Promise<{ revoked: true; current: boolean }> {
    const sessions = await this.prisma.userSession.findMany({
      where: { user_id: userId, revoked_at: null },
      select: { id: true },
    });
    const target = sessions.find((s) => this.sessionHandle(s.id) === handle);
    if (!target) throw new NotFoundException();
    const current = target.id === currentSessionId;
    await this.revokeSession(target.id, userId, 'revoke_session', current ? 'self' : 'remote');
    return { revoked: true, current };
  }

  async logout(refreshTokenStr: string) {
    const parts = refreshTokenStr.split('.');
    if (parts.length !== 2) return;

    const [sessionId, rawToken] = parts;

    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.revoked_at) return;

    const isValid = this.hashRefreshToken(rawToken) === session.token_hash;
    if (!isValid) return;

    await this.revokeSession(sessionId, session.user_id, 'logout');
  }

  /**
   * Change the authenticated user's own password.
   *
   * `userId` and `currentSessionId` both come from the verified JWT
   * (sub / sid) — never from the request body. There is no code path here that
   * can act on another account.
   *
   * SESSION POLICY
   * The session that performed the change stays usable; every OTHER session for
   * this user is revoked. Rationale: a password change is the standard response
   * to a suspected compromise, so any session an attacker may hold must die —
   * but signing the legitimate user out of the device they are actively using
   * is hostile and pushes people away from rotating passwords at all.
   *
   * Because access tokens carry `sid` and JwtStrategy rejects revoked sessions,
   * revoking the row is sufficient to kill both the other refresh tokens AND
   * their outstanding access tokens. No new introspection machinery is needed.
   *
   * ATOMICITY
   * The hash update, the bulk revocation and the audit record are one
   * transaction with the audit write in STRICT mode, so a password can never
   * change without the corresponding audit entry (or vice versa).
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<{ revoked_other_logins: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // JwtStrategy already rejects unknown and disabled accounts, so this is
    // defence in depth rather than the primary control.
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }

    const currentMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash,
    );
    if (!currentMatches) {
      // Recorded so that repeated attempts are visible. Reaching this endpoint
      // requires an already-valid session, so a burst of failures here means
      // someone is trying to convert stolen session access into a permanent
      // account takeover — exactly the thing worth seeing in an audit trail.
      //
      // BEST_EFFORT for the same reason as login_failure: the request is
      // already being denied, and turning an audit outage into a 500 would both
      // mislead the user and hand an attacker a probing signal.
      await this.auditLogService.create({
        actorUserId: userId,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: userId,
        payload: {
          action: 'password_change_failure',
          reason: 'invalid_current_password',
        },
        failurePolicy: AuditFailurePolicy.BEST_EFFORT,
      });

      // 403 rather than 401 deliberately. The session is perfectly valid; it is
      // the re-authentication that failed. Returning 401 here would be
      // indistinguishable from an expired token and would make well-behaved
      // clients sign the user out on a simple typo.
      throw new ForbiddenException('Current password is incorrect');
    }

    // Compared against the stored hash rather than against the submitted
    // current_password string: this is the authoritative "is this actually a
    // new password" check and does not depend on what the client sent.
    const isSameAsCurrent = await bcrypt.compare(
      dto.new_password,
      user.password_hash,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const newHash = await bcrypt.hash(dto.new_password, this.saltRounds);

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password_hash: newHash },
      });

      // Bulk revocation in one statement, and one audit record for the whole
      // action. Revoking each session individually would emit one audit row per
      // session and leak nothing useful — exactly the noise to avoid.
      const revoked = await tx.userSession.updateMany({
        where: {
          user_id: userId,
          id: { not: currentSessionId },
          revoked_at: null,
        },
        data: { revoked_at: new Date() },
      });

      await this.auditLogService.create(
        {
          actorUserId: userId,
          eventType: AuditEventType.SECURITY,
          entityType: 'AUTHENTICATION',
          entityId: userId,
          // No password, hash, token or session identifier. The count is
          // forensically useful; the ids behind it are not.
          //
          // The key deliberately avoids the substring "session": the audit
          // sanitizer redacts any key containing it, which would turn this
          // count into [REDACTED].
          payload: {
            action: 'password_changed',
            revoked_other_logins: revoked.count,
          },
        },
        tx,
      );

      return { revoked_other_logins: revoked.count };
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      is_superadmin: user.is_superadmin,
    };
  }
}
