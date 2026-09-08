import { Module } from '@nestjs/common';
import { BanquetController } from './banquet.controller.js';
import { BanquetCatalogService } from './banquet-catalog.service.js';
import { BanquetBookingsService } from './banquet-bookings.service.js';
import { BanquetKdsService } from './banquet-kds.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { RealtimeCoreModule } from '../../common/realtime/realtime-core.module.js';

/**
 * Phase 8 — banquet management. PrismaService and AuditLogService come from
 * their global modules; EVENT_BROKER from RealtimeCoreModule (the T0-B seam —
 * this module publishes on `banquet-kds`, it never serves streams).
 *
 * The KDS read services are exported so the DEVICE-side display controller can
 * render a chef board without importing any staff authorization.
 */
@Module({
  imports: [AuthModule, AuthorizationModule, RealtimeCoreModule],
  controllers: [BanquetController],
  providers: [BanquetCatalogService, BanquetBookingsService, BanquetKdsService],
  exports: [BanquetKdsService, BanquetBookingsService],
})
export class BanquetModule {}
