import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BranchStatus, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { InventoryService } from './inventory.service.js';
import type { RecordTransferDto, TransferStockQueryDto } from './transfer.dto.js';

/** "TR-260925-": the start of every transfer number on a source-local day. */
export function transferPrefix(localDate: string): string {
  return `TR-${localDate.slice(2).replace(/-/g, '')}-`;
}

/** Thousandths, so 0.1 + 0.2 compares as it reads. */
const milli = (n: number) => Math.round(n * 1000);

/** Whether sending `quantity` leaves the source at or above nothing. Pure, for testing. */
export function fitsOnHand(quantity: number, onHand: number): boolean {
  return milli(quantity) <= milli(onHand);
}

/** A stock figure to at most three decimals: 825.15, 4. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Stock transfers — goods one outlet sends another, landing there at once.
 *
 * A raw-material line moves stock, in ONE transaction: a TRANSFER_OUT at the
 * source and a TRANSFER_IN at the destination, both tied to the transfer.
 * The source must have that much on hand; the items' rows are locked while
 * it is checked, so two transfers cannot both spend the same stock. A menu
 * product line (not stock-tracked) is recorded on the transfer and moves
 * nothing.
 *
 * Who may: inventory.transfer at the SOURCE, proved for that branch. The
 * destination is any other active branch of the company — a central kitchen
 * sends to outlets whose staff it does not manage.
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private async sources(companyId: string, userId: string) {
    const sources = await this.inventory.branchesWith(companyId, userId, [PERMISSION_KEYS.INVENTORY_TRANSFER]);
    if (sources.length === 0) throw new ForbiddenException('You cannot transfer stock from any branch of this company');
    return sources;
  }

  /** Where the caller may send from, and every outlet stock may go to. */
  async options(companyId: string, userId: string) {
    const sources = await this.sources(companyId, userId);
    const destinations = await this.prisma.branch.findMany({
      where: { company_id: companyId, status: BranchStatus.ACTIVE },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { sources: sources.map(({ id, name }) => ({ id, name })), destinations };
  }

  /**
   * What an outlet can send: every raw material with its stock on hand
   * (those it holds first), and the company's menu products. Without an
   * outlet, the products alone.
   */
  async stock(companyId: string, userId: string, query: TransferStockQueryDto) {
    const sources = await this.sources(companyId, userId);
    const products = await this.prisma.menuProduct.findMany({
      where: { company_id: companyId, is_active: true },
      select: { id: true, name: true, category: true, unit: true },
      orderBy: { name: 'asc' },
    });
    if (!query.branch_id) return { raw_materials: [], products };
    if (!sources.some((b) => b.id === query.branch_id)) {
      throw new ForbiddenException('You cannot transfer stock from that branch');
    }

    // Every active raw material, with what the outlet holds of it: those it
    // has come first (they can be sent), then the rest at 0 — listed, so the
    // outlet can see what it lacks, but not sendable.
    const onHand = await this.onHand(this.prisma, query.branch_id);
    const items = await this.prisma.inventoryItem.findMany({
      where: { company_id: companyId, is_active: true },
      select: { id: true, name: true, unit: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const listed = items.map((i) => ({ ...i, on_hand: round3(onHand.get(i.id) ?? 0) }));
    const held = (r: { on_hand: number }) => milli(r.on_hand) > 0;
    return {
      raw_materials: [...listed.filter(held), ...listed.filter((r) => !held(r))],
      products,
    };
  }

  /** Item id -> stock at a branch: the sum of every movement there. */
  private async onHand(
    db: Pick<Prisma.TransactionClient, 'stockMovement'>,
    branchId: string,
    itemIds?: readonly string[],
  ): Promise<Map<string, number>> {
    const sums = await db.stockMovement.groupBy({
      by: ['item_id'],
      where: { branch_id: branchId, ...(itemIds ? { item_id: { in: [...itemIds] } } : {}) },
      _sum: { quantity: true },
    });
    return new Map(sums.map((s) => [s.item_id, Number(s._sum.quantity ?? 0)]));
  }

  async record(companyId: string, userId: string, dto: RecordTransferDto) {
    const sources = await this.sources(companyId, userId);
    const from = sources.find((b) => b.id === dto.from_branch_id);
    if (!from) throw new ForbiddenException('You cannot transfer stock from that branch');
    if (dto.to_branch_id === from.id) throw new BadRequestException('Send to a different outlet');
    const to = await this.prisma.branch.findFirst({
      where: { id: dto.to_branch_id, company_id: companyId, status: BranchStatus.ACTIVE },
      select: { id: true, name: true },
    });
    if (!to) throw new NotFoundException('Destination outlet not found');

    const keys = dto.lines.map((l) => `${l.kind}:${l.id}`);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('An item is on the transfer twice');

    const rawIds = dto.lines.filter((l) => l.kind === 'RAW').map((l) => l.id);
    const productIds = dto.lines.filter((l) => l.kind === 'PRODUCT').map((l) => l.id);
    const [items, products] = await Promise.all([
      rawIds.length
        ? this.prisma.inventoryItem.findMany({
            where: { id: { in: rawIds }, company_id: companyId, is_active: true },
            select: { id: true, name: true, unit: true },
          })
        : [],
      productIds.length
        ? this.prisma.menuProduct.findMany({
            where: { id: { in: productIds }, company_id: companyId, is_active: true },
            select: { id: true, name: true, unit: true },
          })
        : [],
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const productById = new Map(products.map((p) => [p.id, p]));
    if (items.length !== rawIds.length || products.length !== productIds.length) {
      throw new BadRequestException('Some items are not active raw materials or products of this company');
    }

    const lines = dto.lines.map((line, position) => {
      const thing = line.kind === 'RAW' ? itemById.get(line.id)! : productById.get(line.id)!;
      return { ...line, position, name: thing.name, unit: thing.unit };
    });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: from.timezone }).format(new Date());

    // The number is the day's next; two people sending at once may pick the
    // same one, so a clash on the (source, number) key is retried.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (rawIds.length) {
            // Hold the items still while their stock is counted and spent.
            const sorted = [...rawIds].sort();
            await tx.$queryRaw`SELECT id FROM inventory_items WHERE id IN (${Prisma.join(
              sorted.map((id) => Prisma.sql`${id}::uuid`),
            )}) ORDER BY id FOR UPDATE`;
            const onHand = await this.onHand(tx, from.id, rawIds);
            for (const l of lines) {
              if (l.kind !== 'RAW') continue;
              const have = onHand.get(l.id) ?? 0;
              if (!fitsOnHand(l.quantity, have)) {
                throw new BadRequestException(
                  `Only ${round3(Math.max(have, 0))} ${l.unit} of ${l.name} on hand at ${from.name}`,
                );
              }
            }
          }

          const prefix = transferPrefix(today);
          const sameDay = await tx.stockTransfer.count({
            where: { from_branch_id: from.id, number: { startsWith: prefix } },
          });
          const now = new Date();
          const transfer = await tx.stockTransfer.create({
            data: {
              company_id: companyId,
              from_branch_id: from.id,
              to_branch_id: to.id,
              number: `${prefix}${sameDay + 1 + attempt}`,
              note: dto.note ?? null,
              created_by: userId,
              created_at: now,
              lines: {
                create: lines.map((l) => ({
                  inventory_item_id: l.kind === 'RAW' ? l.id : null,
                  menu_product_id: l.kind === 'PRODUCT' ? l.id : null,
                  name: l.name,
                  unit: l.unit,
                  quantity: l.quantity,
                  position: l.position,
                })),
              },
            },
            select: { id: true, number: true },
          });
          const raw = lines.filter((l) => l.kind === 'RAW');
          if (raw.length) {
            await tx.stockMovement.createMany({
              data: raw.flatMap((l) => [
                {
                  company_id: companyId,
                  branch_id: from.id,
                  item_id: l.id,
                  kind: 'TRANSFER_OUT' as const,
                  quantity: -l.quantity,
                  occurred_at: now,
                  note: `Transfer ${transfer.number} to ${to.name}`,
                  actor_user_id: userId,
                  transfer_id: transfer.id,
                },
                {
                  company_id: companyId,
                  branch_id: to.id,
                  item_id: l.id,
                  kind: 'TRANSFER_IN' as const,
                  quantity: l.quantity,
                  occurred_at: now,
                  note: `Transfer ${transfer.number} from ${from.name}`,
                  actor_user_id: userId,
                  transfer_id: transfer.id,
                },
              ]),
            });
          }
          return { ...transfer, from: from.name, to: to.name, items: lines.length };
        });
      } catch (e) {
        const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!clash || attempt >= 4) throw e;
      }
    }
  }
}
