import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BanquetCatalogService } from './banquet-catalog.service.js';
import {
  ADJUSTMENT_ROUTE_PERMISSIONS,
  BanquetBookingsService,
} from './banquet-bookings.service.js';
import { BanquetKdsService } from './banquet-kds.service.js';
import { BanquetPlatesService } from './banquet-plates.service.js';
import {
  AvailabilityQueryDto,
  CancelBookingDto,
  CreateAdjustmentDto,
  CreateBookingDto,
  CreateHallDto,
  CreateHallSlotDto,
  CreatePackageDto,
  CreatePaymentDto,
  CreatePlateRequestDto,
  KdsBoardQueryDto,
  ListBookingsQueryDto,
  RejectPlateRequestDto,
  UpdateBookingDto,
  UpdateHallDto,
  UpdateHallSlotDto,
  UpdatePackageDto,
  UpsertEventPlanDto,
  VerifyPaymentDto,
} from './banquet.dto.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import {
  RequireBranchPermission,
  RequireCompanyPermission,
} from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import type { BanquetActorContext, BanquetCompanyContext } from './banquet-context.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Staff-side banquet API.
 *
 * Halls, bookings, payments, event plans and the kitchen board are BRANCH
 * scoped; packages are COMPANY scoped, like customers. Every route carries a
 * permission decorator, so PermissionGuard proves — server-side, against the
 * database — that the caller has ACTIVE membership, that the branch belongs to
 * the company and is ACTIVE, and that the caller holds the permission there.
 * The context headers are a request, never the proof.
 *
 * There is deliberately NO route that writes a booking status or a KDS status
 * directly: each lifecycle move is its own operation, and each one runs a
 * single validated transition of the state machine.
 */
@Controller('banquet')
@UseGuards(JwtAuthGuard)
export class BanquetController {
  constructor(
    private readonly catalog: BanquetCatalogService,
    private readonly bookings: BanquetBookingsService,
    private readonly kds: BanquetKdsService,
    private readonly plates: BanquetPlatesService,
    private readonly authorization: AuthorizationService,
  ) {}

  private branchCtx(
    companyId: string,
    branchId: string,
    req: AuthenticatedRequest,
  ): BanquetActorContext {
    return { companyId, branchId, actorUserId: req.user.id };
  }

  private companyCtx(companyId: string, req: AuthenticatedRequest): BanquetCompanyContext {
    return { companyId, actorUserId: req.user.id };
  }

  // ── Halls (branch-scoped) ─────────────────────────────────────────────────

  @Get('halls')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  listHalls(@Headers('x-branch-id') branchId: string, @Query() page: PaginationQueryDto) {
    return this.catalog.listHalls(branchId, page);
  }

  @Get('halls/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  getHall(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.catalog.getHall(id, branchId);
  }

  @Post('halls')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_HALL_MANAGE)
  createHall(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateHallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.createHall(this.branchCtx(companyId, branchId, req), dto);
  }

  @Patch('halls/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_HALL_MANAGE)
  updateHall(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateHallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updateHall(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('halls/:id/slots')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_HALL_MANAGE)
  createHallSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateHallSlotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.createSlot(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Patch('halls/:id/slots/:slotId')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_HALL_MANAGE)
  updateHallSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateHallSlotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updateSlot(this.branchCtx(companyId, branchId, req), id, slotId, dto);
  }

  /** Hall × slot × date calendar. Derived and read-only: it reserves nothing. */
  @Get('availability')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  availability(@Headers('x-branch-id') branchId: string, @Query() query: AvailabilityQueryDto) {
    return this.catalog.availability(branchId, query);
  }

  // ── Packages (company-scoped) ─────────────────────────────────────────────

  @Get('packages')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BANQUET_VIEW)
  listPackages(@Headers('x-company-id') companyId: string, @Query() page: PaginationQueryDto) {
    return this.catalog.listPackages(companyId, page);
  }

  @Get('packages/:id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BANQUET_VIEW)
  getPackage(@Param('id', ParseUUIDPipe) id: string, @Headers('x-company-id') companyId: string) {
    return this.catalog.getPackage(id, companyId);
  }

  @Post('packages')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BANQUET_PACKAGE_MANAGE)
  createPackage(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreatePackageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.createPackage(this.companyCtx(companyId, req), dto);
  }

  @Patch('packages/:id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BANQUET_PACKAGE_MANAGE)
  updatePackage(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdatePackageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updatePackage(this.companyCtx(companyId, req), id, dto);
  }

  // ── Kitchen board (declared before :id routes) ────────────────────────────

  @Get('kds/board')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_VIEW)
  async kdsBoard(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: KdsBoardQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // Customer names are banquet data, not kitchen data: kds.view alone is
    // not enough to see who an event is for.
    const includeCustomer = await this.authorization.hasBranchPermission(
      req.user.id,
      companyId,
      branchId,
      PERMISSION_KEYS.BANQUET_VIEW,
    );
    return this.kds.staffBoard(branchId, query.service_date, includeCustomer);
  }

  @Post('kds/items/:id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_MANAGE)
  startItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kds.startItem(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('kds/items/:id/ready')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_MANAGE)
  readyItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kds.readyItem(this.branchCtx(companyId, branchId, req), id);
  }

  // ── Bookings (branch-scoped) ──────────────────────────────────────────────

  @Get('bookings')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  listBookings(
    @Headers('x-branch-id') branchId: string,
    @Query() query: ListBookingsQueryDto,
  ) {
    return this.bookings.list(branchId, query);
  }

  @Get('bookings/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  getBooking(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.bookings.get(branchId, id);
  }

  /** Booking plus the billing branch's GSTIN/FSSAI, for the printable bill. */
  @Get('bookings/:id/bill')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  getBill(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.bookings.getBill(branchId, id);
  }

  @Post('bookings')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_BOOKING_CREATE)
  createBooking(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateBookingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.create(this.branchCtx(companyId, branchId, req), dto);
  }

  @Patch('bookings/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_BOOKING_UPDATE)
  updateBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateBookingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.update(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_BOOKING_CONFIRM)
  confirmBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.confirm(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('bookings/:id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_BOOKING_COMPLETE)
  completeBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.complete(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_BOOKING_CANCEL)
  cancelBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CancelBookingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.cancel(this.branchCtx(companyId, branchId, req), id, dto.reason);
  }

  // ── Pricing adjustments (extra charges & discounts) ───────────────────────
  // The guard admits any of the three pricing keys; the service then requires
  // the exact key for the line's kind (see ADJUSTMENT_PERMISSION).

  @Post('bookings/:id/adjustments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(ADJUSTMENT_ROUTE_PERMISSIONS)
  addAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateAdjustmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.addAdjustment(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('bookings/:id/adjustments/:adjustmentId/reverse')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(ADJUSTMENT_ROUTE_PERMISSIONS)
  reverseAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.reverseAdjustment(this.branchCtx(companyId, branchId, req), id, adjustmentId);
  }

  // ── Payments (advance & balance) ──────────────────────────────────────────

  @Get('bookings/:id/payments')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  listPayments(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.bookings.listPayments(branchId, id);
  }

  @Post('bookings/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_PAYMENT_CREATE)
  createPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreatePaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.createPayment(this.branchCtx(companyId, branchId, req), id, dto);
  }

  /** Second-person verification. Adds a record; the payment itself is never changed. */
  @Post('payments/:id/verify')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_PAYMENT_VERIFY)
  verifyPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: VerifyPaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.verifyPayment(this.branchCtx(companyId, branchId, req), id, dto);
  }

  // ── Event plan ────────────────────────────────────────────────────────────

  // ── Plate approval (branch-scoped) ─────────────────────────────────────────

  @Get('bookings/:id/plate-requests')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  listPlateRequests(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.plates.listForBooking(branchId, id);
  }

  @Post('bookings/:id/plate-requests')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_PLATE_REQUEST)
  requestPlates(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreatePlateRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.plates.request(this.branchCtx(companyId, branchId, req), id, dto);
  }

  /** The kitchen's list for one branch-local day. No customer, no money. */
  @Get('kds/plate-requests')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_VIEW)
  kitchenPlateRequests(@Headers('x-branch-id') branchId: string, @Query() query: KdsBoardQueryDto) {
    return this.plates.listForDay(branchId, query.service_date);
  }

  @Post('kds/plate-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_MANAGE)
  approvePlates(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.plates.approve(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('kds/plate-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_MANAGE)
  rejectPlates(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: RejectPlateRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.plates.reject(this.branchCtx(companyId, branchId, req), id, dto.reason);
  }

  @Post('kds/plate-requests/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_KDS_MANAGE)
  dispatchPlates(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.plates.dispatch(this.branchCtx(companyId, branchId, req), id);
  }

  @Get('bookings/:id/event-plan')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_VIEW)
  getEventPlan(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.bookings.getEventPlan(branchId, id);
  }

  @Put('bookings/:id/event-plan')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.BANQUET_EVENT_PLAN_MANAGE)
  upsertEventPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpsertEventPlanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookings.upsertEventPlan(this.branchCtx(companyId, branchId, req), id, dto);
  }
}
