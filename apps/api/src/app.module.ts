import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { TablesModule } from './modules/tables/tables.module.js';
import { DisplayDevicesModule } from './modules/display-devices/display-devices.module.js';
import { DisplayModule } from './modules/display/display.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SchedulerModule } from './common/scheduler/scheduler.module.js';
import { QueueTokensModule } from './modules/queue-tokens/queue-tokens.module.js';
import { BanquetModule } from './modules/banquet/banquet.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { PosModule } from './modules/pos/pos.module.js';
import { PurchaseModule } from './modules/purchase/purchase.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env', // Pointing to the monorepo root .env
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CompaniesModule,
    BranchesModule,
    AuditLogsModule,
    // T0-A operational foundations
    CustomersModule,
    TablesModule,
    DisplayDevicesModule,
    DisplayModule,
    // T0-B real-time infrastructure
    RealtimeModule,
    // T0-C scheduler foundation (registers no jobs)
    SchedulerModule,
    // Phase 7 — queue management (backend domain core)
    QueueTokensModule,
    // Phase 8 — banquet management
    BanquetModule,
    // Phase 9 — tasks & routines
    TasksModule,
    // Point of sale — reporting over the order tables, ahead of order taking
    PosModule,
    // Purchasing — reporting over vendors and purchase orders, ahead of ordering
    PurchaseModule,
    // Inventory — products and stock per branch
    InventoryModule,
    // Phase 10 — reports & dashboard. Imported LAST so it is obvious that no
    // domain module depends on it: reports register themselves into
    // ReportingCoreModule from the module that owns the data.
    ReportsModule,
  ],
})
export class AppModule {}

