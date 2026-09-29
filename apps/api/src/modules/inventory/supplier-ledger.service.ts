import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toReportNumber } from '../reports/report-values.js';
import { InventoryService, type InventoryBranch } from './inventory.service.js';
import { orderPdf } from './purchase-order-pdf.js';
import { ledgerPdf, statementPdf } from './supplier-ledger-pdf.js';
import type { PaymentMode } from './purchase-order.dto.js';
import type { PayAllDto, RecordPaymentDto, SupplierLedgerQueryDto } from './supplier-ledger.dto.js';

const CURRENCY = 'INR';
const num = (v: unknown) => (v === null || v === undefined ? 0 : toReportNumber(v));

/** Closing = what was owed before the cycle, plus its purchases, less its payments. Pure. */
export function closing(opening: number, purchases: number, paid: number): number {
  return opening + purchases - paid;
}

type Tx = Prisma.TransactionClient;

/**
 * The supplier ledger — what the company owes each supplier, cycle by cycle.
 *
 * A supplier's invoices are its deliveries (receipts, GST included) and its
 * payments are dated PurchasePayment rows. For a cycle [from, to], on each
 * branch's own days:
 *   opening   = invoiced before `from` − paid before `from`
 *   purchases = invoiced in the cycle;  paid = paid in the cycle
 *   closing   = opening + purchases − paid   (what is still due)
 *
 * Reading needs inventory.view at the branches read; paying an invoice
 * needs inventory.purchase.create at its branch.
 */
@Injectable()
export class SupplierLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private period(from: string, to: string) {
    if (from > to) throw new BadRequestException('The period ends before it starts');
  }

  private async scope(companyId: string, userId: string, branchId?: string): Promise<InventoryBranch[]> {
    const visible = await this.inventory.visibleBranches(companyId, userId);
    if (!branchId) return visible;
    const one = visible.filter((b) => b.id === branchId);
    if (!one.length) throw new ForbiddenException('You do not have inventory access at that branch');
    return one;
  }

  private writers(companyId: string, userId: string) {
    return this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE]);
  }

  /** Invoiced and paid per supplier: before the cycle, and in it. */
  private async figures(companyId: string, ids: string[], from: string, to: string, vendorId?: string) {
    const vendor = vendorId ? Prisma.sql`AND po."vendor_id" = ${vendorId}::uuid` : Prisma.empty;
    const payVendor = vendorId ? Prisma.sql`AND p."vendor_id" = ${vendorId}::uuid` : Prisma.empty;
    const [invoiced, paid] = await Promise.all([
      this.prisma.$queryRaw<Array<{ vendor_id: string; before: unknown; within: unknown }>>(Prisma.sql`
        SELECT po."vendor_id",
               SUM(r."total_minor") FILTER (WHERE (r."received_at" AT TIME ZONE b."timezone")::date < ${from}::date) AS "before",
               SUM(r."total_minor") FILTER (WHERE (r."received_at" AT TIME ZONE b."timezone")::date BETWEEN ${from}::date AND ${to}::date) AS "within"
        FROM "purchase_receipts" r
        JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
        JOIN "branches" b ON b."id" = r."branch_id"
        WHERE po."company_id" = ${companyId}::uuid AND r."branch_id" = ANY(${ids}::uuid[]) AND po."status" <> 'CANCELLED' ${vendor}
        GROUP BY po."vendor_id"
      `),
      this.prisma.$queryRaw<Array<{ vendor_id: string; before: unknown; within: unknown }>>(Prisma.sql`
        SELECT p."vendor_id",
               SUM(p."amount_minor") FILTER (WHERE (p."paid_at" AT TIME ZONE b."timezone")::date < ${from}::date) AS "before",
               SUM(p."amount_minor") FILTER (WHERE (p."paid_at" AT TIME ZONE b."timezone")::date BETWEEN ${from}::date AND ${to}::date) AS "within"
        FROM "purchase_payments" p
        JOIN "branches" b ON b."id" = p."branch_id"
        WHERE p."company_id" = ${companyId}::uuid AND p."branch_id" = ANY(${ids}::uuid[]) ${payVendor}
        GROUP BY p."vendor_id"
      `),
    ]);
    const out = new Map<string, { opening: number; purchases: number; paid: number }>();
    const row = (id: string) => out.get(id) ?? out.set(id, { opening: 0, purchases: 0, paid: 0 }).get(id)!;
    for (const i of invoiced) {
      const r = row(i.vendor_id);
      r.opening += num(i.before);
      r.purchases += num(i.within);
    }
    for (const p of paid) {
      const r = row(p.vendor_id);
      r.opening -= num(p.before);
      r.paid += num(p.within);
    }
    return out;
  }

  // ── The ledger ──────────────────────────────────────────────────────────

  async ledger(companyId: string, userId: string, q: SupplierLedgerQueryDto) {
    this.period(q.from, q.to);
    const branches = await this.scope(companyId, userId, q.branch_id);
    const figures = await this.figures(companyId, branches.map((b) => b.id), q.from, q.to);
    const needle = q.q?.trim();
    const vendors = figures.size
      ? await this.prisma.vendor.findMany({
          where: {
            id: { in: [...figures.keys()] },
            ...(needle
              ? {
                  OR: [
                    { name: { contains: needle, mode: 'insensitive' as const } },
                    { label: { contains: needle, mode: 'insensitive' as const } },
                    { phone: { contains: needle } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            label: true,
            phone: true,
            bank_account_name: true,
            bank_account_number: true,
            bank_ifsc: true,
            bank_name: true,
            upi_id: true,
          },
        })
      : [];
    const suppliers = vendors
      .map((v) => {
        const f = figures.get(v.id)!;
        return {
          vendor_id: v.id,
          name: v.name,
          label: v.label,
          phone: v.phone,
          bank: {
            account_name: v.bank_account_name,
            account_number: v.bank_account_number,
            ifsc: v.bank_ifsc,
            bank_name: v.bank_name,
            upi_id: v.upi_id,
          },
          opening_minor: f.opening,
          purchases_minor: f.purchases,
          paid_minor: f.paid,
          closing_minor: closing(f.opening, f.purchases, f.paid),
        };
      })
      // Nothing owed and nothing happening: nothing to show.
      .filter((s) => s.opening_minor || s.purchases_minor || s.paid_minor)
      .sort((a, b) => b.closing_minor - a.closing_minor || a.name.localeCompare(b.name));
    return {
      from: q.from,
      to: q.to,
      currency: CURRENCY,
      summary: {
        purchases_minor: suppliers.reduce((s, x) => s + x.purchases_minor, 0),
        paid_minor: suppliers.reduce((s, x) => s + x.paid_minor, 0),
        pending_minor: suppliers.reduce((s, x) => s + x.closing_minor, 0),
      },
      suppliers,
    };
  }

  /**
   * One supplier in a cycle: its invoices (those of the cycle, and older
   * ones still due) and its payments in the cycle.
   */
  async supplier(companyId: string, userId: string, vendorId: string, q: SupplierLedgerQueryDto) {
    this.period(q.from, q.to);
    const branches = await this.scope(companyId, userId, q.branch_id);
    const ids = branches.map((b) => b.id);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, company_id: companyId },
      select: {
        id: true,
        name: true,
        phone: true,
        gstin: true,
        bank_account_name: true,
        bank_account_number: true,
        bank_ifsc: true,
        bank_name: true,
        upi_id: true,
      },
    });
    if (!vendor) throw new NotFoundException('Supplier not found');

    const [invoices, payments, writable, figures] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          receipt_id: string;
          order_id: string;
          po_number: string;
          invoice_number: string;
          local_date: string;
          branch_id: string;
          branch: string;
          total_minor: number;
          paid_minor: number;
        }>
      >(Prisma.sql`
        SELECT r."id" AS "receipt_id", po."id" AS "order_id", po."po_number", r."invoice_number",
               to_char((r."received_at" AT TIME ZONE b."timezone")::date, 'YYYY-MM-DD') AS "local_date",
               r."branch_id", b."name" AS "branch", r."total_minor", r."paid_minor"
        FROM "purchase_receipts" r
        JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
        JOIN "branches" b ON b."id" = r."branch_id"
        WHERE po."company_id" = ${companyId}::uuid AND po."vendor_id" = ${vendorId}::uuid
          AND r."branch_id" = ANY(${ids}::uuid[]) AND po."status" <> 'CANCELLED'
          AND (
            (r."received_at" AT TIME ZONE b."timezone")::date BETWEEN ${q.from}::date AND ${q.to}::date
            OR ((r."received_at" AT TIME ZONE b."timezone")::date < ${q.from}::date AND r."total_minor" > r."paid_minor")
          )
        ORDER BY r."received_at" DESC, r."invoice_number" DESC
      `),
      this.prisma.$queryRaw<Array<{ id: string; local_date: string; invoice_number: string; payment_mode: string; amount_minor: number }>>(Prisma.sql`
        SELECT p."id", to_char((p."paid_at" AT TIME ZONE b."timezone")::date, 'YYYY-MM-DD') AS "local_date",
               r."invoice_number", p."payment_mode", p."amount_minor"
        FROM "purchase_payments" p
        JOIN "purchase_receipts" r ON r."id" = p."receipt_id"
        JOIN "branches" b ON b."id" = p."branch_id"
        WHERE p."company_id" = ${companyId}::uuid AND p."vendor_id" = ${vendorId}::uuid
          AND p."branch_id" = ANY(${ids}::uuid[])
          AND (p."paid_at" AT TIME ZONE b."timezone")::date BETWEEN ${q.from}::date AND ${q.to}::date
        ORDER BY p."paid_at" DESC
      `),
      this.writers(companyId, userId),
      this.figures(companyId, ids, q.from, q.to, vendorId),
    ]);
    const mayPay = new Set(writable.map((b) => b.id));
    const f = figures.get(vendorId) ?? { opening: 0, purchases: 0, paid: 0 };
    return {
      vendor,
      from: q.from,
      to: q.to,
      branch: q.branch_id ? branches[0].name : 'All branches',
      opening_minor: f.opening,
      purchases_minor: f.purchases,
      paid_minor: f.paid,
      closing_minor: closing(f.opening, f.purchases, f.paid),
      invoices: invoices.map((i) => ({
        receipt_id: i.receipt_id,
        order_id: i.order_id,
        po_number: i.po_number,
        invoice_number: i.invoice_number,
        date: i.local_date,
        branch: i.branch,
        total_minor: i.total_minor,
        paid_minor: i.paid_minor,
        due_minor: i.total_minor - i.paid_minor,
        // Before the cycle: carried in the opening balance.
        earlier: i.local_date < q.from,
        may_pay: mayPay.has(i.branch_id) && i.total_minor > i.paid_minor,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        date: p.local_date,
        invoice_number: p.invoice_number,
        payment_mode: p.payment_mode,
        amount_minor: p.amount_minor,
      })),
      may_pay_all: invoices.some((i) => mayPay.has(i.branch_id) && i.total_minor > i.paid_minor),
    };
  }

  // ── Paying ──────────────────────────────────────────────────────────────

  /** Pay `amount` (at most what is due) on one delivery, in one transaction. */
  private async pay(tx: Tx, companyId: string, userId: string, receiptId: string, amount: number | 'due', mode: PaymentMode, writable: Set<string>) {
    const [r] = await tx.$queryRaw<Array<{ order_id: string }>>`
      SELECT po."id" AS "order_id" FROM "purchase_receipts" r JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
      WHERE r."id" = ${receiptId}::uuid AND po."company_id" = ${companyId}::uuid
      FOR UPDATE OF po
    `;
    if (!r) throw new NotFoundException('Invoice not found');
    const receipt = await tx.purchaseReceipt.findUniqueOrThrow({
      where: { id: receiptId },
      select: {
        id: true,
        branch_id: true,
        total_minor: true,
        paid_minor: true,
        invoice_number: true,
        order: { select: { id: true, vendor_id: true, status: true, total_minor: true, paid_minor: true } },
      },
    });
    if (!writable.has(receipt.branch_id)) throw new ForbiddenException('You cannot record payments at that branch');
    const due = receipt.total_minor - receipt.paid_minor;
    const pay = amount === 'due' ? due : amount;
    if (due <= 0) throw new ConflictException(`${receipt.invoice_number} is already paid`);
    if (pay > due) throw new BadRequestException(`Only ${(due / 100).toFixed(2)} is due on ${receipt.invoice_number}`);
    const now = new Date();
    await tx.purchasePayment.create({
      data: {
        company_id: companyId,
        vendor_id: receipt.order.vendor_id,
        branch_id: receipt.branch_id,
        purchase_order_id: receipt.order.id,
        receipt_id: receipt.id,
        amount_minor: pay,
        payment_mode: mode,
        paid_at: now,
        created_by: userId,
      },
    });
    await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: { paid_minor: receipt.paid_minor + pay, payment_mode: mode },
    });
    const orderPaid = receipt.order.paid_minor + pay;
    await tx.purchaseOrder.update({
      where: { id: receipt.order.id },
      data: {
        paid_minor: orderPaid,
        // A received order paid in full says so on the Received tab.
        ...(receipt.order.status === 'RECEIVED' && orderPaid >= receipt.order.total_minor ? { paid_at: now, payment_mode: mode } : {}),
      },
    });
    return pay;
  }

  async recordPayment(companyId: string, userId: string, receiptId: string, dto: RecordPaymentDto) {
    const writable = new Set((await this.writers(companyId, userId)).map((b) => b.id));
    const paid = await this.prisma.$transaction((tx) => this.pay(tx, companyId, userId, receiptId, dto.amount_minor, dto.payment_mode, writable));
    return { paid_minor: paid };
  }

  /** Every invoice still due from the supplier, at branches the caller may pay at. */
  async payAll(companyId: string, userId: string, vendorId: string, dto: PayAllDto) {
    const visible = await this.scope(companyId, userId, dto.branch_id);
    const writable = new Set((await this.writers(companyId, userId)).map((b) => b.id));
    const ids = visible.map((b) => b.id).filter((id) => writable.has(id));
    if (!ids.length) throw new ForbiddenException('You cannot record payments at that branch');
    const due = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT r."id" FROM "purchase_receipts" r JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
      WHERE po."company_id" = ${companyId}::uuid AND po."vendor_id" = ${vendorId}::uuid
        AND r."branch_id" = ANY(${ids}::uuid[]) AND po."status" <> 'CANCELLED' AND r."total_minor" > r."paid_minor"
      ORDER BY r."received_at"
    `);
    if (!due.length) throw new ConflictException('Nothing is due to this supplier');
    const paid = await this.prisma.$transaction(async (tx) => {
      let sum = 0;
      for (const r of due) sum += await this.pay(tx, companyId, userId, r.id, 'due', dto.payment_mode, writable);
      return sum;
    });
    return { invoices: due.length, paid_minor: paid };
  }

  // ── PDFs ────────────────────────────────────────────────────────────────

  async statement(companyId: string, userId: string, vendorId: string, q: SupplierLedgerQueryDto) {
    const s = await this.supplier(companyId, userId, vendorId, q);
    const data = await statementPdf({
      supplier: s.vendor,
      from: s.from,
      to: s.to,
      branch: s.branch,
      opening_minor: s.opening_minor,
      purchases_minor: s.purchases_minor,
      paid_minor: s.paid_minor,
      closing_minor: s.closing_minor,
      invoices: s.invoices.map((i) => ({ ...i })),
      payments: s.payments.map((p) => ({ date: p.date, invoice_number: p.invoice_number, mode: p.payment_mode, amount_minor: p.amount_minor })),
    });
    return { filename: `statement-${s.vendor.name.replace(/[^A-Za-z0-9]+/g, '-')}-${s.from}-to-${s.to}.pdf`, data };
  }

  async ledgerDocument(companyId: string, userId: string, q: SupplierLedgerQueryDto) {
    const l = await this.ledger(companyId, userId, q);
    const branch = q.branch_id ? (await this.scope(companyId, userId, q.branch_id))[0].name : 'All branches';
    const data = await ledgerPdf({
      from: l.from,
      to: l.to,
      branch,
      totals: l.summary,
      suppliers: l.suppliers,
    });
    return { filename: `supplier-ledger-${l.from}-to-${l.to}.pdf`, data };
  }

  /** One delivery as a PDF: its lines, what it came to and what is paid. */
  async invoice(companyId: string, userId: string, receiptId: string) {
    const visible = await this.inventory.visibleBranches(companyId, userId);
    const r = await this.prisma.purchaseReceipt.findFirst({
      where: { id: receiptId, order: { company_id: companyId } },
      select: {
        invoice_number: true,
        received_at: true,
        total_minor: true,
        paid_minor: true,
        branch: { select: { id: true, name: true, timezone: true } },
        order: { select: { status: true, created_by: true, vendor: { select: { name: true, phone: true } } } },
        lines: {
          orderBy: { position: 'asc' },
          select: { name: true, quantity: true, unit: true, unit_price_minor: true, tax_rate_bps: true, tax_minor: true, line_total_minor: true },
        },
      },
    });
    if (!r) throw new NotFoundException('Invoice not found');
    if (!visible.some((b) => b.id === r.branch.id)) throw new ForbiddenException('You do not have inventory access at that branch');
    const data = await orderPdf(
      {
        heading: 'Purchase Invoice',
        po_number: r.invoice_number,
        status: 'RECEIVED',
        ordered_at: r.received_at,
        created_by: null,
        vendor: r.order.vendor,
        branch: { name: r.branch.name },
        total_minor: r.total_minor,
        paid_minor: r.paid_minor,
        lines: r.lines.map((l) => ({ ...l, quantity: Number(l.quantity), received: false })),
        receipts: [],
      },
      r.branch.timezone,
    );
    return { filename: `${r.invoice_number}.pdf`, data };
  }
}
