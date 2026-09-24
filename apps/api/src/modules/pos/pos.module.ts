import { Module } from '@nestjs/common';
import { ReportingCoreModule } from '../reports/reporting-core.module.js';
import {
  PosAnalyticsReport,
  PosOrdersReport,
  PosReportRegistrar,
  PosRevenueByHourReport,
  PosRevenueByTypeReport,
  PosSummaryReport,
} from './pos.report-provider.js';

/**
 * Point of sale. Today it is reporting only: the order tables exist and POS
 * Reports reads them. Taking orders is the module still to come, and will
 * live here beside them.
 */
@Module({
  imports: [ReportingCoreModule],
  providers: [
    PosSummaryReport,
    PosOrdersReport,
    PosAnalyticsReport,
    PosRevenueByHourReport,
    PosRevenueByTypeReport,
    PosReportRegistrar,
  ],
})
export class PosModule {}
