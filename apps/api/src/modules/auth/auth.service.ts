import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service.js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './auth.dto.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuditEventType } from '@samco/database';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTokenExpiresInDays: number;
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.refreshTokenExpiresInDays = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN_DAYS', '7'),
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

  private signAccessToken(userId: string) {
    return this.jwtService.sign({
      sub: userId,
    });
  }

  async login(loginDto: LoginDto) {
    const email = this.normalizeEmail(loginDto.email);
    
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await this.auditLogService.create({
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: 'unknown',
        payload: { action: 'login_failure', reason: 'invalid_credentials', method: 'password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password_hash);
    if (!isPasswordValid) {
      await this.auditLogService.create({
        actorUserId: user.id,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: user.id,
        payload: { action: 'login_failure', reason: 'invalid_credentials', method: 'password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.signAccessToken(user.id);
    const refreshToken = this.generateOpaqueToken();
    const tokenHash = this.hashRefreshToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenExpiresInDays);

    const session = await this.prisma.userSession.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    await this.auditLogService.create({
      actorUserId: user.id,
      eventType: AuditEventType.SECURITY,
      entityType: 'AUTHENTICATION',
      entityId: user.id,
      payload: { action: 'login_success', method: 'password' },
    });

    return {
      accessToken,
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

    const isValidToken = this.hashRefreshToken(rawToken) === session.token_hash;
    if (!isValidToken) {
      // If the token is invalid but the sessionId was correct (unguessable UUID),
      // it is highly likely a replay of an old token. Revoke the session.
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
      
      await this.auditLogService.create({
        actorUserId: session.user.id,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: session.user.id,
        payload: { action: 'refresh_failure', reason: 'replay_detected', session_id: sessionId },
      });
      
      this.logger.warn(`Invalid token presented for session ${sessionId}. Revoking session (possible replay).`);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newAccessToken = this.signAccessToken(session.user.id);
    const newRawToken = this.generateOpaqueToken();
    const newTokenHash = this.hashRefreshToken(newRawToken);
    
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + this.refreshTokenExpiresInDays);

    // Concurrency Protection: Use atomic Compare-And-Swap on token_hash
    const updateResult = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        token_hash: session.token_hash,
        revoked_at: null,
      },
      data: {
        token_hash: newTokenHash,
        expires_at: newExpiresAt,
      },
    });

    if (updateResult.count === 0) {
      // Replay detected or race condition. MUST revoke the session entirely.
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
      
      await this.auditLogService.create({
        actorUserId: session.user.id,
        eventType: AuditEventType.SECURITY,
        entityType: 'AUTHENTICATION',
        entityId: session.user.id,
        payload: { action: 'refresh_failure', reason: 'replay_detected', session_id: sessionId },
      });
      
      this.logger.warn(`Token replay detected for session ${sessionId}. Session revoked.`);
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken: newAccessToken,
      refreshToken: `${sessionId}.${newRawToken}`,
    };
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

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revoked_at: new Date() },
    });

    await this.auditLogService.create({
      actorUserId: session.user_id,
      eventType: AuditEventType.SECURITY,
      entityType: 'AUTHENTICATION',
      entityId: session.user_id,
      payload: { action: 'logout' },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
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
