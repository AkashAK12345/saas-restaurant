import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  UseGuards,
  Get,
  Req,
  Ip,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthContextService } from './auth-context.service.js';
import {
  LoginDto,
  RefreshDto,
  LogoutDto,
  ChangePasswordDto,
} from './auth.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

interface AuthenticatedRequest {
  user: { id: string; sessionId: string };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authContext: AuthContextService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    // The client IP is one half of the brute-force throttle key. It and the
    // user agent are request metadata — shown to the account owner on their
    // device list, never treated as authorization proof.
    return this.authService.login(loginDto, ip ?? 'unknown', userAgent);
  }

  /** The caller's own signed-in devices. */
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async listSessions(@Req() req: AuthenticatedRequest) {
    return { data: await this.authService.listSessions(req.user.id, req.user.sessionId) };
  }

  /** Sign out one of the caller's own devices, by its opaque handle. */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:handle')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Param('handle') handle: string, @Req() req: AuthenticatedRequest) {
    if (!/^[a-f0-9]{32}$/.test(handle)) throw new NotFoundException();
    return this.authService.revokeOwnSession(req.user.id, req.user.sessionId, handle);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refresh(refreshDto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() logoutDto: LogoutDto) {
    await this.authService.logout(logoutDto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.id);
  }

  /**
   * GET /auth/context
   *
   * Frontend shell data: identity, selectable companies, and — when
   * X-Company-ID / X-Branch-ID are supplied — that company's branches and the
   * caller's EFFECTIVE permissions there.
   *
   * The headers are requested context, exactly as everywhere else: a company
   * the caller is not an active member of, or a branch outside that company,
   * is a 404. Nothing in this response is trusted by the backend for
   * authorization; PermissionGuard re-derives it on every protected request.
   */
  @UseGuards(JwtAuthGuard)
  @Get('context')
  async getContext(
    @Req() req: AuthenticatedRequest,
    @Headers('x-company-id') companyId: string | undefined,
    @Headers('x-branch-id') branchId: string | undefined,
  ) {
    return this.authContext.getContext(req.user.id, companyId, branchId);
  }

  /**
   * PATCH /auth/password
   *
   * Changes the AUTHENTICATED user's own password. The account and the current
   * session both come from the verified JWT (`sub` / `sid`) — the body carries
   * only the two passwords, and cannot name a target user.
   *
   * On success every other login for this user is revoked; the calling session
   * stays usable.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.changePassword(req.user.id, req.user.sessionId, dto);
  }
}
