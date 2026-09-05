import { Module, Global } from '@nestjs/common';
import { AuditLogService } from './audit-logs.service.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Global()
@Module({
  imports: [AuthorizationModule, AuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogsModule {}
