import { Module } from '@nestjs/common';
import { ReportRegistry } from './report-registry.service.js';
import { DashboardService } from './dashboard.service.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

/**
 * The reporting seam.
 *
 * Domain modules import THIS (never ReportsModule) to register their own
 * reports and dashboard widgets. The registry knows nothing about any domain
 * and no domain module depends on the reporting HTTP layer, so the dependency
 * arrow only ever points one way and a new module adds reports without
 * touching the engine.
 *
 * Mirrors RealtimeCoreModule: primitives here, transport in the feature module.
 */
@Module({
  imports: [AuthorizationModule],
  providers: [ReportRegistry, DashboardService],
  exports: [ReportRegistry, DashboardService],
})
export class ReportingCoreModule {}
