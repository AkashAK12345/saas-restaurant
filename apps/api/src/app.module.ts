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
  ],
})
export class AppModule {}

