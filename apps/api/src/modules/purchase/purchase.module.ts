import { Module } from '@nestjs/common';
import { ReportingCoreModule } from '../reports/reporting-core.module.js';
import {
  PurchaseByItemReport,
  PurchaseByVendorReport,
  PurchaseReportRegistrar,
} from './purchase.report-provider.js';

/**
 * Purchasing. Today it is reporting only: vendors and purchase orders exist
 * and Purchase Reports reads them. Raising orders is the module still to
 * come, and will live here beside them.
 */
@Module({
  imports: [ReportingCoreModule],
  providers: [PurchaseByVendorReport, PurchaseByItemReport, PurchaseReportRegistrar],
})
export class PurchaseModule {}
