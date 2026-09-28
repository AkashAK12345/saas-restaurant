import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { branchLocalToInstant } from '../../common/scheduler/branch-time.js';
import { InventoryService, type InventoryBranch } from './inventory.service.js';
import { invoiceNumber, priceLine, stockQuantity } from './purchase.service.js';
import { orderPdf } from './purchase-order-pdf.js';
import {
  MAX_ORDER_PHOTOS,
  MAX_ORDER_PHOTO_BYTES,
  type OrderLineDto,
  type PurchaseOrderListQueryDto,
  type ReceivePurchaseOrderDto,
  type UpdatePurchaseOrderDto,
  type UploadOrderPhotoDto,
} from './purchase-order.dto.js';

/** The largest total an order may carry: an INTEGER column of paise. */
const MAX_TOTAL_MINOR = 2_000_000_000;
/** Item chips a card shows before "+N more". */
const CARD_CHIPS = 3;

type Tx = Prisma.TransactionClient;

/** "Meera Nair", or the start of the email when no name was given. */
function personName(u: { first_name: string | null; last_name: string | null; email: string }): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email.split('@')[0];
}

/** The day after a YYYY-MM-DD date. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Purchase orders — the Purchase tab: every order at the branches the caller
 * may see, and the Receive Order screen for one of them.
 *
 * Receiving takes the TICKED lines in as one delivery, in ONE transaction:
 * a receipt under our own invoice number, the delivery photos claimed by it,
 * any payment made then, and each line's stock added at the branch (in stock
 * units). Unticked lines stay awaited; the order is RECEIVED once none are.
 *
 * Who may: reading needs inventory.view or inventory.purchase.create at the
 * order's branch; changing it needs inventory.purchase.create there.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private readers(companyId: string, userId: string) {
    return this.inventory.branchesWith(companyId, userId, [
      PERMISSION_KEYS.INVENTORY_VIEW,
      PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE,
    ]);
  }

  private writers(companyId: string, userId: string) {
    return this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE]);
  }

  // ── The list ────────────────────────────────────────────────────────────

  async list(companyId: string, userId: string, q: PurchaseOrderListQueryDto) {
    const visible = await this.readers(companyId, userId);
    if (visible.length === 0) throw new ForbiddenException('You do not have inventory access at any branch of this company');
    if ((q.from && !q.to) || (!q.from && q.to)) throw new BadRequestException('Give both dates of the period, or neither');
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('The period ends before it starts');
    let branches = visible;
    if (q.branch_id) {
      branches = visible.filter((b) => b.id === q.branch_id);
      if (branches.length === 0) throw new ForbiddenException('You do not have inventory access at that branch');
    }
    const tab = q.tab ?? 'all';

    // Each branch's dates are its own local days.
    const within = (field: 'ordered_at' | 'received_at'): Prisma.PurchaseOrderWhereInput =>
      q.from && q.to
        ? {
            OR: branches.map((b) => ({
              branch_id: b.id,
              [field]: {
                gte: branchLocalToInstant(q.from!, '00:00', b.timezone),
                lt: branchLocalToInstant(nextDay(q.to!), '00:00', b.timezone),
              },
            })),
          }
        : { branch_id: { in: branches.map((b) => b.id) } };

    const base: Prisma.PurchaseOrderWhereInput = {
      company_id: companyId,
      ...(q.vendor_id ? { vendor_id: q.vendor_id } : {}),
    };
    const raised = { ...base, ...within('ordered_at') };
    const [all, sent, cancelled] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { ...raised, status: { not: 'CANCELLED' } } }),
      this.prisma.purchaseOrder.count({ where: { ...raised, status: 'ORDERED' } }),
      this.prisma.purchaseOrder.count({ where: { ...raised, status: 'CANCELLED' } }),
    ]);

    const statuses =
      tab === 'received'
        ? (['RECEIVED'] as const)
        : tab === 'sent'
          ? (['ORDERED', ...(q.include_cancelled ? (['CANCELLED'] as const) : [])] as const)
          : (['ORDERED', 'RECEIVED', ...(q.include_cancelled ? (['CANCELLED'] as const) : [])] as const);
    const where: Prisma.PurchaseOrderWhereInput = {
      ...base,
      ...within(tab === 'received' ? 'received_at' : 'ordered_at'),
      status: { in: [...statuses] },
    };
    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput[] = {
      newest: [{ ordered_at: 'desc' }],
      oldest: [{ ordered_at: 'asc' }],
      received: [{ received_at: { sort: 'desc', nulls: 'last' } }, { ordered_at: 'desc' }],
      supplier: [{ vendor: { name: 'asc' } }, { ordered_at: 'desc' }],
      amount: [{ total_minor: 'desc' }, { ordered_at: 'desc' }],
    }[q.sort ?? 'newest'] as Prisma.PurchaseOrderOrderByWithRelationInput[];
    orderBy.push({ id: 'asc' });

    const limit = q.limit ?? 30;
    const offset = q.offset ?? 0;
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          po_number: true,
          status: true,
          total_minor: true,
          paid_minor: true,
          currency: true,
          ordered_at: true,
          received_at: true,
          whatsapp_sent_at: true,
          created_by: true,
          vendor: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          items: {
            select: { name: true, quantity: true, unit: true, receipt_id: true },
            orderBy: { position: 'asc' },
          },
          receipts: {
            select: { invoice_number: true, received_at: true },
            orderBy: { received_at: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    const creators = await this.names(rows.map((r) => r.created_by));
    const mayWrite = new Set((await this.writers(companyId, userId)).map((b) => b.id));
    return {
      counts: { all, sent, cancelled },
      orders: rows.map((r) => {
        const awaiting = r.items.filter((i) => !i.receipt_id);
        const shown = r.status === 'RECEIVED' ? r.items : awaiting;
        return {
          id: r.id,
          po_number: r.po_number,
          status: r.status,
          vendor: r.vendor,
          branch: r.branch,
          created_by: r.created_by ? (creators.get(r.created_by) ?? null) : null,
          ordered_at: r.ordered_at,
          received_at: r.receipts[0]?.received_at ?? r.received_at,
          invoice_number: r.receipts[0]?.invoice_number ?? null,
          whatsapp_sent_at: r.whatsapp_sent_at,
          items_count: r.items.length,
          received_count: r.items.length - awaiting.length,
          chips: shown.slice(0, CARD_CHIPS).map((i) => ({ name: i.name, quantity: Number(i.quantity), unit: i.unit })),
          more_items: Math.max(shown.length - CARD_CHIPS, 0),
          total_minor: r.total_minor,
          paid_minor: r.paid_minor,
          currency: r.currency,
          may_edit: mayWrite.has(r.branch.id),
        };
      }),
      meta: { total, limit, offset },
    };
  }

  /** User id -> display name. */
  private async names(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, first_name: true, last_name: true, email: true },
    });
    return new Map(users.map((u) => [u.id, personName(u)]));
  }

  // ── One order ───────────────────────────────────────────────────────────

  /** The order, if it is the company's and at a branch in `branches`. */
  private async find(companyId: string, orderId: string, branches: InventoryBranch[], action: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, company_id: companyId },
      select: { id: true, branch_id: true, status: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    const branch = branches.find((b) => b.id === order.branch_id);
    if (!branch) throw new ForbiddenException(`You cannot ${action} purchase orders at that branch`);
    return { ...order, branch };
  }

  async detail(companyId: string, userId: string, orderId: string) {
    const readable = await this.readers(companyId, userId);
    await this.find(companyId, orderId, readable, 'see');
    return this.view(companyId, userId, orderId);
  }

  /** The order as an A4 PDF, to send the supplier. */
  async pdf(companyId: string, userId: string, orderId: string) {
    const { branch } = await this.find(companyId, orderId, await this.readers(companyId, userId), 'see');
    const order = await this.view(companyId, userId, orderId);
    return { po_number: order.po_number, data: await orderPdf(order, branch.timezone) };
  }

  private async view(companyId: string, userId: string, orderId: string) {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        po_number: true,
        status: true,
        source: true,
        total_minor: true,
        paid_minor: true,
        currency: true,
        ordered_at: true,
        received_at: true,
        cancelled_at: true,
        whatsapp_sent_at: true,
        notes: true,
        created_by: true,
        vendor: { select: { id: true, name: true, phone: true, label: true } },
        branch: { select: { id: true, name: true } },
        items: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            quantity: true,
            unit: true,
            unit_price_minor: true,
            tax_rate_bps: true,
            tax_minor: true,
            line_total_minor: true,
            receipt_id: true,
            inventory_item: { select: { id: true, unit: true, conversion_qty: true, purchase_unit: true } },
          },
        },
        receipts: {
          orderBy: { received_at: 'asc' },
          select: {
            id: true,
            invoice_number: true,
            total_minor: true,
            paid_minor: true,
            payment_mode: true,
            received_at: true,
            _count: { select: { lines: true } },
          },
        },
        photos: {
          orderBy: { position: 'asc' },
          select: { id: true, mime_type: true, file_name: true, position: true, receipt_id: true },
        },
      },
    });
    const creators = await this.names([order.created_by]);
    const [writable, managers] = await Promise.all([
      this.writers(companyId, userId),
      this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_SUPPLIERS_MANAGE]),
    ]);
    return {
      id: order.id,
      po_number: order.po_number,
      status: order.status,
      source: order.source,
      vendor: order.vendor,
      branch: order.branch,
      created_by: order.created_by ? (creators.get(order.created_by) ?? null) : null,
      ordered_at: order.ordered_at,
      received_at: order.received_at,
      cancelled_at: order.cancelled_at,
      whatsapp_sent_at: order.whatsapp_sent_at,
      notes: order.notes,
      total_minor: order.total_minor,
      paid_minor: order.paid_minor,
      currency: order.currency,
      lines: order.items.map((i) => ({
        id: i.id,
        item_id: i.inventory_item?.id ?? null,
        name: i.name,
        quantity: Number(i.quantity),
        unit: i.unit,
        stock_unit: i.inventory_item?.unit ?? null,
        conversion_qty: i.inventory_item?.conversion_qty == null ? null : Number(i.inventory_item.conversion_qty),
        unit_price_minor: i.unit_price_minor,
        tax_rate_bps: i.tax_rate_bps,
        tax_minor: i.tax_minor,
        line_total_minor: i.line_total_minor,
        received: !!i.receipt_id,
      })),
      receipts: order.receipts.map(({ _count, ...r }) => ({ ...r, items: _count.lines })),
      photos: order.photos.map(({ receipt_id, ...p }) => ({ ...p, received: !!receipt_id })),
      may_edit: order.status === 'ORDERED' && writable.some((b) => b.id === order.branch.id),
      may_manage_suppliers: managers.length > 0,
    };
  }

  // ── Changing it ─────────────────────────────────────────────────────────

  /** An ORDERED order the caller may change, locked for the transaction. */
  private async lockOpen(tx: Tx, companyId: string, orderId: string, writable: InventoryBranch[]) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: { id: orderId, company_id: companyId },
      select: { id: true, branch_id: true, status: true, vendor_id: true, paid_minor: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    const branch = writable.find((b) => b.id === order.branch_id);
    if (!branch) throw new ForbiddenException('You cannot change purchase orders at that branch');
    if (order.status !== 'ORDERED') {
      throw new ConflictException(`This order is ${order.status === 'RECEIVED' ? 'already received' : 'cancelled'}`);
    }
    return { ...order, branch };
  }

  /**
   * Make the order's AWAITED lines what the screen holds, and its supplier
   * what it chose. Lines already received are never touched. Returns the
   * ids of the lines ticked to receive (existing or just created).
   */
  private async applyEdit(
    tx: Tx,
    companyId: string,
    order: { id: string; vendor_id: string },
    dto: UpdatePurchaseOrderDto,
  ): Promise<string[]> {
    if (dto.vendor_id && dto.vendor_id !== order.vendor_id) {
      const vendor = await tx.vendor.findFirst({
        where: { id: dto.vendor_id, company_id: companyId },
        select: { name: true, is_active: true, type: true },
      });
      if (!vendor) throw new NotFoundException('Supplier not found');
      if (!vendor.is_active || vendor.type === 'SALE') {
        throw new BadRequestException(`${vendor.name} is not an active supplier to buy from`);
      }
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { vendor_id: dto.vendor_id } });
    }
    if (!dto.lines) return [];
    const lines = dto.lines;

    const existing = await tx.purchaseOrderItem.findMany({
      where: { purchase_order_id: order.id },
      select: {
        id: true,
        name: true,
        unit: true,
        receipt_id: true,
        tax_rate_bps: true,
        inventory_item_id: true,
        position: true,
      },
    });
    const byId = new Map(existing.map((l) => [l.id, l]));
    for (const line of lines) {
      if (!line.id) continue;
      const found = byId.get(line.id);
      if (!found) throw new BadRequestException('A line is not on this order');
      if (found.receipt_id) throw new BadRequestException('A line already received cannot be changed');
    }
    for (const line of lines) {
      if (!line.id && !line.item_id) throw new BadRequestException('A new line needs an item');
    }
    // A line keeps its item unless the screen names another.
    const itemOf = (l: OrderLineDto) => l.item_id ?? (l.id ? byId.get(l.id)!.inventory_item_id : null);
    const itemIds = lines.map(itemOf).filter((id): id is string => !!id);
    if (new Set(itemIds).size !== itemIds.length) throw new BadRequestException('An item is on the order twice');

    const products = await tx.inventoryItem.findMany({
      where: { id: { in: itemIds }, company_id: companyId, is_active: true },
      select: { id: true, name: true, unit: true, purchase_unit: true, tax_rate_bps: true },
    });
    const product = new Map(products.map((p) => [p.id, p]));
    if (products.length !== new Set(itemIds).size) {
      throw new BadRequestException('Some items are not active products of this company');
    }

    // Awaited lines the screen dropped go.
    const kept = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
    const dropped = existing.filter((l) => !l.receipt_id && !kept.has(l.id)).map((l) => l.id);
    if (dropped.length) await tx.purchaseOrderItem.deleteMany({ where: { id: { in: dropped } } });

    let position = existing.reduce((max, l) => Math.max(max, l.position), -1) + 1;
    const ticked: string[] = [];
    for (const line of lines) {
      const itemId = itemOf(line);
      const p = itemId ? product.get(itemId)! : null;
      const was = line.id ? byId.get(line.id)! : null;
      const taxBps = was ? was.tax_rate_bps : (p?.tax_rate_bps ?? 0);
      const { tax, total } = priceLine(line.quantity, line.rate_minor, taxBps);
      const data = {
        name: p?.name ?? was!.name,
        quantity: line.quantity,
        unit: p ? (p.purchase_unit ?? p.unit).slice(0, 16) : was!.unit,
        unit_price_minor: line.rate_minor,
        tax_rate_bps: taxBps,
        tax_minor: tax,
        line_total_minor: total,
        inventory_item_id: p?.id ?? null,
      };
      const saved = line.id
        ? await tx.purchaseOrderItem.update({ where: { id: line.id }, data, select: { id: true } })
        : await tx.purchaseOrderItem.create({
            data: { ...data, purchase_order_id: order.id, position: position++ },
            select: { id: true },
          });
      if (line.receive) ticked.push(saved.id);
    }

    const sum = await tx.purchaseOrderItem.aggregate({
      where: { purchase_order_id: order.id },
      _sum: { line_total_minor: true },
    });
    const total = sum._sum.line_total_minor ?? 0;
    if (total > MAX_TOTAL_MINOR) throw new BadRequestException('An order this large must be split');
    const updated = await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { total_minor: total },
      select: { paid_minor: true },
    });
    if (updated.paid_minor > total) {
      throw new BadRequestException('The order would come to less than has already been paid on it');
    }
    return ticked;
  }

  async update(companyId: string, userId: string, orderId: string, dto: UpdatePurchaseOrderDto) {
    const writable = await this.writers(companyId, userId);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOpen(tx, companyId, orderId, writable);
      await this.applyEdit(tx, companyId, order, dto);
    });
    return this.view(companyId, userId, orderId);
  }

  async receive(companyId: string, userId: string, orderId: string, dto: ReceivePurchaseOrderDto) {
    const writable = await this.writers(companyId, userId);
    if (!dto.lines?.some((l) => l.receive)) throw new BadRequestException('Tick at least one item to receive');

    // The invoice number is the month's next at the branch; two people
    // receiving at once may pick the same one, so a clash is retried.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const order = await this.lockOpen(tx, companyId, orderId, writable);
          const ticked = await this.applyEdit(tx, companyId, order, dto);

          const photos = await tx.purchaseOrderPhoto.findMany({
            where: { purchase_order_id: order.id, receipt_id: null },
            select: { id: true },
          });
          if (!photos.length) throw new BadRequestException('Add at least one delivery photo to receive');

          const lines = await tx.purchaseOrderItem.findMany({
            where: { id: { in: ticked } },
            select: {
              id: true,
              name: true,
              quantity: true,
              line_total_minor: true,
              inventory_item: { select: { id: true, conversion_qty: true } },
            },
          });
          const receiptTotal = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
          if (dto.paid_minor > receiptTotal) {
            throw new BadRequestException('More is paid than this delivery comes to');
          }

          const now = new Date();
          const receipt = await tx.purchaseReceipt.create({
            data: {
              purchase_order_id: order.id,
              branch_id: order.branch.id,
              invoice_number: await invoiceNumber(tx, order.branch, now, attempt),
              total_minor: receiptTotal,
              paid_minor: dto.paid_minor,
              payment_mode: dto.paid_minor > 0 ? dto.payment_mode : null,
              received_at: now,
              received_by: userId,
            },
            select: { id: true, invoice_number: true },
          });
          await tx.purchaseOrderItem.updateMany({ where: { id: { in: ticked } }, data: { receipt_id: receipt.id } });
          await tx.purchaseOrderPhoto.updateMany({
            where: { id: { in: photos.map((p) => p.id) } },
            data: { receipt_id: receipt.id },
          });

          const vendor = await tx.purchaseOrder.findUniqueOrThrow({
            where: { id: order.id },
            select: { po_number: true, vendor: { select: { name: true } } },
          });
          const stocked = lines.filter((l) => l.inventory_item);
          if (stocked.length) {
            await tx.stockMovement.createMany({
              data: stocked.map((l) => ({
                company_id: companyId,
                branch_id: order.branch.id,
                item_id: l.inventory_item!.id,
                kind: 'PURCHASE' as const,
                quantity: stockQuantity(
                  Number(l.quantity),
                  l.inventory_item!.conversion_qty === null ? null : Number(l.inventory_item!.conversion_qty),
                ),
                occurred_at: now,
                note: `Received ${receipt.invoice_number} (${vendor.po_number}) from ${vendor.vendor.name}`,
                actor_user_id: userId,
                purchase_order_id: order.id,
              })),
            });
          }

          const awaited = await tx.purchaseOrderItem.count({ where: { purchase_order_id: order.id, receipt_id: null } });
          await tx.purchaseOrder.update({
            where: { id: order.id },
            data: {
              paid_minor: { increment: dto.paid_minor },
              ...(awaited === 0 ? { status: 'RECEIVED', received_at: now } : {}),
            },
          });
        });
        return this.view(companyId, userId, orderId);
      } catch (e) {
        const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!clash || attempt >= 4) throw e;
      }
    }
  }

  async cancel(companyId: string, userId: string, orderId: string) {
    const writable = await this.writers(companyId, userId);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOpen(tx, companyId, orderId, writable);
      const receipts = await tx.purchaseReceipt.count({ where: { purchase_order_id: order.id } });
      if (receipts) throw new ConflictException('Part of this order has arrived; it cannot be cancelled');
      if (order.paid_minor > 0) throw new ConflictException('Something has been paid on this order; it cannot be cancelled');
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
      });
    });
    return this.view(companyId, userId, orderId);
  }

  /** The order went to its supplier (on WhatsApp): record when. */
  async markSent(companyId: string, userId: string, orderId: string) {
    const writable = await this.writers(companyId, userId);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOpen(tx, companyId, orderId, writable);
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { whatsapp_sent_at: new Date() } });
    });
    return this.view(companyId, userId, orderId);
  }

  // ── Delivery photos ─────────────────────────────────────────────────────

  async photo(companyId: string, userId: string, orderId: string, photoId: string) {
    await this.find(companyId, orderId, await this.readers(companyId, userId), 'see');
    const photo = await this.prisma.purchaseOrderPhoto.findFirst({
      where: { id: photoId, purchase_order_id: orderId },
      select: { data: true, mime_type: true, file_name: true },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return photo;
  }

  async uploadPhoto(companyId: string, userId: string, orderId: string, dto: UploadOrderPhotoDto) {
    const data = Buffer.from(dto.data, 'base64');
    if (data.length === 0) throw new BadRequestException('The photo is empty');
    if (data.length > MAX_ORDER_PHOTO_BYTES) {
      throw new BadRequestException(`Photo exceeds the ${MAX_ORDER_PHOTO_BYTES / (1024 * 1024)}MB limit`);
    }
    const writable = await this.writers(companyId, userId);
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockOpen(tx, companyId, orderId, writable);
      const count = await tx.purchaseOrderPhoto.count({ where: { purchase_order_id: order.id } });
      if (count >= MAX_ORDER_PHOTOS) throw new ConflictException(`An order can have at most ${MAX_ORDER_PHOTOS} photos`);
      const last = await tx.purchaseOrderPhoto.aggregate({
        where: { purchase_order_id: order.id },
        _max: { position: true },
      });
      const photo = await tx.purchaseOrderPhoto.create({
        data: {
          purchase_order_id: order.id,
          data,
          mime_type: dto.mime_type,
          file_name: dto.file_name ?? null,
          position: (last._max.position ?? -1) + 1,
        },
        select: { id: true, mime_type: true, file_name: true, position: true },
      });
      return { ...photo, received: false };
    });
  }

  /** Only a photo not yet part of a delivery may go. */
  async deletePhoto(companyId: string, userId: string, orderId: string, photoId: string) {
    const writable = await this.writers(companyId, userId);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOpen(tx, companyId, orderId, writable);
      const photo = await tx.purchaseOrderPhoto.findFirst({
        where: { id: photoId, purchase_order_id: order.id },
        select: { id: true, receipt_id: true },
      });
      if (!photo) throw new NotFoundException('Photo not found');
      if (photo.receipt_id) throw new ConflictException('A photo of a delivery already received stays');
      await tx.purchaseOrderPhoto.delete({ where: { id: photo.id } });
    });
  }
}
