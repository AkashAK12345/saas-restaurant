import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service.js';
import { UserStatus } from '@samco/database';

export interface JwtPayload {
  sub: string;
  /** Issuing session id — binds the access token to a revocable UserSession. */
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('ACCESS_TOKEN_SECRET') as string,
    });
  }

  /**
   * Signature verification alone is not sufficient: a stateless JWT stays valid
   * for its full lifetime even after logout or session revocation. Binding the
   * token to its issuing session and checking that session here makes revocation
   * take effect immediately.
   *
   * Cost is one indexed primary-key lookup per request, joined with the user row
   * so a single query also confirms the account still exists. Short-lived access
   * tokens are preserved — this adds revocation awareness, not a new token model.
   */
  async validate(payload: JwtPayload) {
    if (!payload?.sub || !payload?.sid) {
      // Includes legacy tokens minted before session binding existed.
      throw new UnauthorizedException();
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      include: { user: { select: { id: true, status: true } } },
    });

    if (
      !session ||
      session.user_id !== payload.sub ||
      session.revoked_at !== null ||
      session.absolute_expires_at < new Date() ||
      !session.user ||
      // Globally disabled accounts lose access immediately, without waiting for
      // the access token to expire.
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException();
    }

    // Attaches to Request.user
    return {
      id: payload.sub,
      sessionId: payload.sid,
    };
  }
}
