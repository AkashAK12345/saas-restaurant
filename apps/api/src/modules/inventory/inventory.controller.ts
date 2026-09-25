import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InventoryService } from './inventory.service.js';
import { InventoryOverviewQueryDto } from './inventory.dto.js';
import { PurchaseService } from './purchase.service.js';
import { CreateSupplierDto, RecordPurchaseDto, SearchQueryDto } from './purchase.dto.js';
import { TransferService } from './transfer.service.js';
import { RecordTransferDto, TransferStockQueryDto } from './transfer.dto.js';

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
  constructor(
    private readonly inventory: InventoryService,
    private readonly purchases: PurchaseService,
    private readonly transfers: TransferService,
  ) {}

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

  // ── Manual purchase ─────────────────────────────────────────────────────
  // The service proves each right at the branch it concerns: the outlet for
  // recording, any branch for reading, suppliers.manage for adding one.

  @Get('purchase/options')
  purchaseOptions(@Headers('x-company-id') companyId: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.purchases.options(this.company(companyId), req.user.id);
  }

  @Get('suppliers')
  suppliers(
    @Headers('x-company-id') companyId: string | undefined,
    @Query() query: SearchQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.suppliers(this.company(companyId), req.user.id, query);
  }

  @Post('suppliers')
  @HttpCode(HttpStatus.CREATED)
  createSupplier(
    @Headers('x-company-id') companyId: string | undefined,
    @Body() dto: CreateSupplierDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.createSupplier(this.company(companyId), req.user.id, dto);
  }

  @Get('items')
  searchItems(
    @Headers('x-company-id') companyId: string | undefined,
    @Query() query: SearchQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.searchItems(this.company(companyId), req.user.id, query);
  }

  @Post('purchases')
  @HttpCode(HttpStatus.CREATED)
  recordPurchase(
    @Headers('x-company-id') companyId: string | undefined,
    @Body() dto: RecordPurchaseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.record(this.company(companyId), req.user.id, dto);
  }

  // ── Transfer stock ──────────────────────────────────────────────────────
  // inventory.transfer is proved at the SOURCE outlet; any other active
  // branch of the company may receive.

  @Get('transfer/options')
  transferOptions(@Headers('x-company-id') companyId: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.transfers.options(this.company(companyId), req.user.id);
  }

  @Get('transfer/stock')
  transferStock(
    @Headers('x-company-id') companyId: string | undefined,
    @Query() query: TransferStockQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.stock(this.company(companyId), req.user.id, query);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  recordTransfer(
    @Headers('x-company-id') companyId: string | undefined,
    @Body() dto: RecordTransferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.record(this.company(companyId), req.user.id, dto);
  }
}
