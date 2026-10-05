import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import {
  LoginThrottleService,
  LOGIN_ATTEMPT_STORE,
} from './login-throttle.service.js';
import { AuthContextService } from './auth-context.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

@Module({
  imports: [
    // AuthContextService resolves effective permissions through the SAME
    // AuthorizationService the guard uses — no second permission resolver.
    AuthorizationModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('ACCESS_TOKEN_SECRET') as string,
        signOptions: {
          expiresIn: configService.get<string>('ACCESS_TOKEN_EXPIRES_IN', '15m') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthContextService,
    PasswordRecoveryService,
    MailService,
    JwtStrategy,
    JwtAuthGuard,
    // Swap this useClass for a shared-store implementation to make throttling
    // work across replicas — nothing else needs to change.
    { provide: LOGIN_ATTEMPT_STORE, useClass: LoginThrottleService },
  ],
  exports: [AuthService, JwtAuthGuard, PassportModule, LOGIN_ATTEMPT_STORE],
})
export class AuthModule {}

