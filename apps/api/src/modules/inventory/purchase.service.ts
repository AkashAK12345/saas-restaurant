import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { InventoryService } from './inventory.service.js';
import type { CreateSupplierDto, RecordPurchaseDto, SearchQueryDto, UpdateSupplierDto } from './purchase.dto.js';

const CURRENCY = 'INR';
/** The largest total an order may carry: an INTEGER column of paise. */
const MAX_TOTAL_MINOR = 2_000_000_000;

/** One line, priced: quantity × rate, then GST on that. Pure, for testing. */
export function priceLine(quantity: number, rateMinor: number, taxRateBps: number) {
  const net = Math.round(quantity * rateMinor);
  const tax = Math.round((net * taxRateBps) / 10_000);
  return { net, tax, total: net + tax };
}

/** Stock units a purchase adds: bought units × how many stock units each holds. */
export function stockQuantity(quantity: number, conversion: number | null): number {
  return Math.round(quantity * (conversion ?? 1) * 1000) / 1000;
}

/** What "Edit current supplier" shows and may change. */
const SUPPLIER_DETAIL = {
  id: true,
  name: true,
  label: true,
  phone: true,
  gstin: true,
  address: true,
  bank_account_name: true,
  bank_account_number: true,
  bank_ifsc: true,
  bank_name: true,
  bank_branch: true,
  upi_id: true,
} as const;
const SUPPLIER_EDITABLE = [
  'name',
  'phone',
  'gstin',
  'address',
  'bank_account_name',
  'bank_account_number',
  'bank_ifsc',
  'bank_name',
  'bank_branch',
  'upi_id',
] as const;

/**
 * "INV-CEN-2609-": the start of every invoice number a branch gives a
 * delivery in a branch-local month — the first three letters of its name,
 * then the year and month. Pure, for testing.
 */
export function invoicePrefix(branchName: string, localDate: string): string {
  const code = (branchName.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'BR').toUpperCase().padEnd(3, 'X');
  return `INV-${code}-${localDate.slice(2, 4)}${localDate.slice(5, 7)}-`;
}

/** The month's next invoice number at a branch ("INV-CEN-2609-0135"). */
export async function invoiceNumber(
  tx: Prisma.TransactionClient,
  branch: { id: string; name: string; timezone: string },
  at: Date,
  attempt = 0,
): Promise<string> {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: branch.timezone }).format(at);
  const prefix = invoicePrefix(branch.name, localDate);
  const sameMonth = await tx.purchaseReceipt.count({ where: { branch_id: branch.id, invoice_number: { startsWith: prefix } } });
  return `${prefix}${String(sameMonth + 1 + attempt).padStart(4, '0')}`;
}

/** "MP-250925-": the start of every manual purchase number on a branch-local day. */
export function purchasePrefix(localDate: string): string {
  return `MP-${localDate.slice(2).replace(/-/g, '')}-`;
}

/**
 * Manual purchases — goods that arrived at an outlet from a supplier,
 * recorded after the fact.
 *
 * Recording one does four things in ONE transaction: saves the purchase as
 * RECEIVED (source MANUAL, nothing paid yet, so its total is outstanding),
 * saves its lines with their GST, gives the delivery a receipt under our own
 * invoice number, and adds each line's quantity to the
 * outlet's stock as a PURCHASE movement — converted to the stock unit when
 * the item is bought in another (1 bag = 50 Kg).
 *
 * Who may: inventory.purchase.create at the OUTLET, proved for that branch.
 * The supplier and the items must be the company's and active.
 */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /** Where the caller may record purchases, and whether they may add suppliers. */
  async options(companyId: string, userId: string) {
    const [outlets, managers] = await Promise.all([
      this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE]),
      this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_SUPPLIERS_MANAGE]),
    ]);
    if (outlets.length === 0) throw new ForbiddenException('You cannot record purchases at any branch of this company');
    return {
      outlets: outlets.map(({ id, name }) => ({ id, name })),
      may_create_supplier: managers.length > 0,
    };
  }

  /** Reading suppliers or products needs inventory access, or purchase rights, somewhere. */
  private async assertMayRead(companyId: string, userId: string) {
    const branches = await this.inventory.branchesWith(companyId, userId, [
      PERMISSION_KEYS.INVENTORY_VIEW,
      PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE,
    ]);
    if (branches.length === 0) throw new ForbiddenException('You do not have inventory access at any branch of this company');
  }

  /** Active suppliers the company buys from, by name. */
  async suppliers(companyId: string, userId: string, query: SearchQueryDto) {
    await this.assertMayRead(companyId, userId);
    const q = query.q?.trim();
    return this.prisma.vendor.findMany({
      where: {
        company_id: companyId,
        is_active: true,
        type: { in: ['PURCHASE', 'BOTH'] },
        ...(q
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { label: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      select: { id: true, name: true, label: true, phone: true },
      orderBy: { name: 'asc' },
      // A company has a few hundred at most: the whole list, for a dropdown.
      take: query.limit ?? 500,
    });
  }

  async createSupplier(companyId: string, userId: string, dto: CreateSupplierDto) {
    const managers = await this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_SUPPLIERS_MANAGE]);
    if (managers.length === 0) throw new ForbiddenException('You cannot add suppliers for this company');
    const clash = await this.prisma.vendor.findFirst({
      where: { company_id: companyId, name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`A supplier named "${dto.name}" already exists`);
    return this.prisma.vendor.create({
      data: {
        company_id: companyId,
        name: dto.name,
        phone: dto.phone,
        gstin: dto.gstin ?? null,
        gst_registered: !!dto.gstin,
        address: dto.address ?? null,
        bank_account_name: dto.bank_account_name ?? null,
        bank_account_number: dto.bank_account_number ?? null,
        bank_ifsc: dto.bank_ifsc ?? null,
        bank_name: dto.bank_name ?? null,
        bank_branch: dto.bank_branch ?? null,
        upi_id: dto.upi_id ?? null,
      },
      select: { id: true, name: true, label: true, phone: true },
    });
  }

  /** One supplier's details, for "Edit current supplier". */
  async supplier(companyId: string, userId: string, vendorId: string) {
    await this.assertMayRead(companyId, userId);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, company_id: companyId },
      select: SUPPLIER_DETAIL,
    });
    if (!vendor) throw new NotFoundException('Supplier not found');
    const managers = await this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_SUPPLIERS_MANAGE]);
    return { ...vendor, may_edit: managers.length > 0 };
  }

  async updateSupplier(companyId: string, userId: string, vendorId: string, dto: UpdateSupplierDto) {
    const managers = await this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_SUPPLIERS_MANAGE]);
    if (managers.length === 0) throw new ForbiddenException("You cannot edit this company's suppliers");
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, company_id: companyId }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Supplier not found');
    if (dto.name) {
      const clash = await this.prisma.vendor.findFirst({
        where: { company_id: companyId, id: { not: vendorId }, name: { equals: dto.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`A supplier named "${dto.name}" already exists`);
    }
    const data: Prisma.VendorUpdateInput = {};
    for (const key of SUPPLIER_EDITABLE) {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key];
    }
    if (dto.gstin !== undefined) data.gst_registered = !!dto.gstin;
    const saved = await this.prisma.vendor.update({ where: { id: vendorId }, data, select: SUPPLIER_DETAIL });
    return { ...saved, may_edit: true };
  }

  /** Active products whose name or short code matches, for adding to a purchase. */
  async searchItems(companyId: string, userId: string, query: SearchQueryDto) {
    await this.assertMayRead(companyId, userId);
    const q = query.q?.trim();
    if (!q) return [];
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        company_id: companyId,
        is_active: true,
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { short_code: { contains: q, mode: 'insensitive' } }],
      },
      select: {
        id: true,
        name: true,
        unit: true,
        purchase_unit: true,
        conversion_qty: true,
        purchase_price_minor: true,
        tax_rate_bps: true,
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: query.limit ?? 20,
    });
    return items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      purchase_unit: i.purchase_unit ?? i.unit,
      conversion_qty: i.conversion_qty === null ? null : Number(i.conversion_qty),
      purchase_price_minor: i.purchase_price_minor,
      tax_rate_bps: i.tax_rate_bps ?? 0,
      category: i.category?.name ?? null,
    }));
  }

  async record(companyId: string, userId: string, dto: RecordPurchaseDto) {
    const outlets = await this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE]);
    const outlet = outlets.find((b) => b.id === dto.branch_id);
    if (!outlet) throw new ForbiddenException('You cannot record purchases at that branch');

    const vendor = await this.prisma.vendor.findFirst({
      where: { id: dto.vendor_id, company_id: companyId },
      select: { id: true, name: true, is_active: true, type: true },
    });
    if (!vendor) throw new NotFoundException('Supplier not found');
    if (!vendor.is_active || vendor.type === 'SALE') {
      throw new BadRequestException(`${vendor.name} is not an active supplier to buy from`);
    }

    const ids = dto.items.map((l) => l.item_id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('An item is on the purchase twice');
    const products = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, company_id: companyId, is_active: true },
      select: { id: true, name: true, unit: true, purchase_unit: true, conversion_qty: true, tax_rate_bps: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new BadRequestException('Some items are not active products of this company');

    const lines = dto.items.map((line, position) => {
      const product = byId.get(line.item_id)!;
      const taxBps = product.tax_rate_bps ?? 0;
      const { tax, total } = priceLine(line.quantity, line.rate_minor, taxBps);
      return {
        position,
        product,
        quantity: line.quantity,
        rate: line.rate_minor,
        taxBps,
        tax,
        total,
        stock: stockQuantity(line.quantity, product.conversion_qty === null ? null : Number(product.conversion_qty)),
      };
    });
    const total = lines.reduce((sum, l) => sum + l.total, 0);
    if (total > MAX_TOTAL_MINOR) throw new BadRequestException('A purchase this large must be split');

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: outlet.timezone }).format(new Date());

    // The number is the day's next; two people recording at once may pick
    // the same one, so a clash on the (branch, number) key is retried.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const prefix = purchasePrefix(today);
          const sameDay = await tx.purchaseOrder.count({
            where: { branch_id: outlet.id, po_number: { startsWith: prefix } },
          });
          const now = new Date();
          const order = await tx.purchaseOrder.create({
            data: {
              company_id: companyId,
              branch_id: outlet.id,
              vendor_id: vendor.id,
              po_number: `${prefix}${sameDay + 1 + attempt}`,
              status: 'RECEIVED',
              source: 'MANUAL',
              total_minor: total,
              paid_minor: 0,
              currency: CURRENCY,
              ordered_at: now,
              received_at: now,
              notes: dto.note ?? null,
              created_by: userId,
              items: {
                create: lines.map((l) => ({
                  name: l.product.name,
                  quantity: l.quantity,
                  unit: (l.product.purchase_unit ?? l.product.unit).slice(0, 16),
                  unit_price_minor: l.rate,
                  tax_rate_bps: l.taxBps,
                  tax_minor: l.tax,
                  line_total_minor: l.total,
                  position: l.position,
                  inventory_item_id: l.product.id,
                })),
              },
            },
            select: { id: true, po_number: true, total_minor: true, currency: true },
          });
          // Goods in hand: one delivery, under an invoice number of our own.
          const receipt = await tx.purchaseReceipt.create({
            data: {
              purchase_order_id: order.id,
              branch_id: outlet.id,
              invoice_number: await invoiceNumber(tx, outlet, now, attempt),
              total_minor: total,
              received_at: now,
              received_by: userId,
            },
            select: { id: true, invoice_number: true },
          });
          await tx.purchaseOrderItem.updateMany({ where: { purchase_order_id: order.id }, data: { receipt_id: receipt.id } });
          await tx.stockMovement.createMany({
            data: lines.map((l) => ({
              company_id: companyId,
              branch_id: outlet.id,
              item_id: l.product.id,
              kind: 'PURCHASE' as const,
              quantity: l.stock,
              occurred_at: now,
              note: `Manual purchase ${order.po_number} from ${vendor.name}`,
              actor_user_id: userId,
              purchase_order_id: order.id,
            })),
          });
          return {
            ...order,
            invoice_number: receipt.invoice_number,
            branch: outlet.name,
            vendor: vendor.name,
            items: lines.length,
          };
        });
      } catch (e) {
        const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!clash || attempt >= 4) throw e;
      }
    }
  }
}
