import {
  Controller,
  Post,
  Patch,
  Body,
  UseGuards,
  Get,
  Req,
  Ip,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
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
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Ip() ip: string) {
    // The client IP is one half of the brute-force throttle key. It is request
    // metadata, never treated as authorization proof.
    return this.authService.login(loginDto, ip ?? 'unknown');
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
