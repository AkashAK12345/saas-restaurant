import { BadRequestException, Controller, Get, Headers, Query, Req, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InventoryService } from './inventory.service.js';
import { InventoryOverviewQueryDto } from './inventory.dto.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Inventory spans branches, so these endpoints are company-scoped and take no
 * PermissionGuard: the service proves inventory.view at EACH branch it shows
 * (see InventoryService), exactly as the all-branches dashboard does. The
 * company header is only a request — a company the caller is not a member of
 * yields no branches, and so a refusal.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private company(companyId: string | undefined): string {
    if (!companyId || !isUUID(companyId)) throw new BadRequestException('X-Company-ID header is required');
    return companyId;
  }

  @Get('filters')
  filters(@Headers('x-company-id') companyId: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.inventory.filters(this.company(companyId), req.user.id);
  }

  @Get('overview')
  overview(
    @Headers('x-company-id') companyId: string | undefined,
    @Query() query: InventoryOverviewQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.inventory.overview(this.company(companyId), req.user.id, query);
  }
}
