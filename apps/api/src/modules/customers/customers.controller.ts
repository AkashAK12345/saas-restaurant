import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, ListCustomersQueryDto, UpdateCustomerDto } from './customers.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Company-scoped. PermissionGuard proves ACTIVE membership + permission for
 * X-Company-ID before any handler runs; the service then pins company_id in
 * every query. The header is context, the guard is the proof.
 */
@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.CUSTOMERS_VIEW)
  async list(
    @Headers('x-company-id') companyId: string,
    @Query() query: ListCustomersQueryDto,
  ) {
    return this.customersService.listCustomers(
      companyId,
      { limit: query.limit, offset: query.offset },
      { q: query.q, status: query.status },
    );
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.CUSTOMERS_VIEW)
  async get(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Headers('x-company-id') companyId: string,
  ) {
    return this.customersService.getCustomer(customerId, companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.CUSTOMERS_CREATE)
  async create(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customersService.createCustomer(companyId, dto, req.user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.CUSTOMERS_UPDATE)
  async update(
    @Param('id', ParseUUIDPipe) customerId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customersService.updateCustomer(customerId, companyId, dto, req.user.id);
  }
}
