import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { PurchaseService } from './purchase.service.js';
import { TransferService } from './transfer.service.js';
import { PurchaseOrderService } from './purchase-order.service.js';

/** Inventory: products, stock per branch, and the purchase totals above them. */
@Module({
  imports: [
    AuthModule, // JwtAuthGuard
    AuthorizationModule, // AuthorizationService, to prove each branch
  ],
  controllers: [InventoryController],
  providers: [InventoryService, PurchaseService, TransferService, PurchaseOrderService],
})
export class InventoryModule {}
