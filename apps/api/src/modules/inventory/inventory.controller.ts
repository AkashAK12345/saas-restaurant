import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InventoryService } from './inventory.service.js';
import { InventoryOverviewQueryDto } from './inventory.dto.js';
import { PurchaseService } from './purchase.service.js';
import { CreateSupplierDto, RecordPurchaseDto, SearchQueryDto, UpdateSupplierDto } from './purchase.dto.js';
import { TransferService } from './transfer.service.js';
import { RecordTransferDto, TransferStockQueryDto } from './transfer.dto.js';
import { PurchaseOrderService } from './purchase-order.service.js';
import {
  MarkPaidDto,
  PurchaseOrderListQueryDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  UploadOrderPhotoDto,
} from './purchase-order.dto.js';

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
    private readonly orders: PurchaseOrderService,
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

  @Get('suppliers/:id')
  supplier(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.supplier(this.company(companyId), req.user.id, id);
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchases.updateSupplier(this.company(companyId), req.user.id, id, dto);
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

  // ── Purchase orders ─────────────────────────────────────────────────────
  // Reading proves inventory.view or inventory.purchase.create at the
  // order's branch; changing it proves inventory.purchase.create there.

  @Get('purchase-orders')
  listOrders(
    @Headers('x-company-id') companyId: string | undefined,
    @Query() query: PurchaseOrderListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.list(this.company(companyId), req.user.id, query);
  }

  @Get('purchase-orders/:id')
  order(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.detail(this.company(companyId), req.user.id, id);
  }

  @Get('purchase-orders/:id/pdf')
  async orderPdf(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { po_number, data } = await this.orders.pdf(this.company(companyId), req.user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po_number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
    res.send(data);
  }

  @Patch('purchase-orders/:id')
  updateOrder(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.update(this.company(companyId), req.user.id, id, dto);
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(HttpStatus.OK)
  receiveOrder(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.receive(this.company(companyId), req.user.id, id, dto);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.cancel(this.company(companyId), req.user.id, id);
  }

  @Post('purchase-orders/:id/payment')
  @HttpCode(HttpStatus.OK)
  orderPayment(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.markPaid(this.company(companyId), req.user.id, id, dto);
  }

  @Post('purchase-orders/:id/sent')
  @HttpCode(HttpStatus.OK)
  orderSent(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.markSent(this.company(companyId), req.user.id, id);
  }

  @Get('purchase-orders/:id/photos/:photoId')
  async orderPhoto(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { data, mime_type, file_name } = await this.orders.photo(this.company(companyId), req.user.id, id, photoId);
    res.setHeader('Content-Type', mime_type);
    if (file_name) res.setHeader('Content-Disposition', `inline; filename="${file_name.replace(/["\\\r\n]/g, '')}"`);
    res.send(data);
  }

  @Post('purchase-orders/:id/photos')
  @HttpCode(HttpStatus.CREATED)
  uploadOrderPhoto(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadOrderPhotoDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.uploadPhoto(this.company(companyId), req.user.id, id, dto);
  }

  @Delete('purchase-orders/:id/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOrderPhoto(
    @Headers('x-company-id') companyId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.deletePhoto(this.company(companyId), req.user.id, id, photoId);
  }
}
