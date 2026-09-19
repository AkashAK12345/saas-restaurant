import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEventType, ChecklistItemKind, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { TaskCompanyContext } from './tasks-context.js';
import type { ChecklistTemplateView, ReferenceChecklistView } from './tasks-views.js';
import { REFERENCE_CHECKLISTS } from './reference-checklists.js';
import type { CreateChecklistTemplateDto, UpdateChecklistTemplateDto } from './tasks.dto.js';

const TEMPLATE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.ChecklistTemplateInclude;

type TemplateRecord = Prisma.ChecklistTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const AUDIT_TEMPLATE = 'CHECKLIST_TEMPLATE';

/**
 * Reusable checklist definitions. COMPANY-scoped, like Customer and
 * BanquetPackage, so one "Opening checks" list serves every branch.
 *
 * A template is a DEFINITION, never live state. Tasks copy the items they need
 * at creation time (TasksService.snapshotChecklist), so editing a template
 * here can never change what a task in flight requires, nor make a completed
 * task retroactively incomplete.
 */
@Injectable()
export class ChecklistTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  async list(
    companyId: string,
    page: { limit: number; offset: number },
  ): Promise<Paginated<ChecklistTemplateView>> {
    const where = { company_id: companyId };
    const [rows, total] = await Promise.all([
      this.prisma.checklistTemplate.findMany({
        where,
        include: TEMPLATE_INCLUDE,
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.checklistTemplate.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: { total, limit: page.limit, offset: page.offset },
    };
  }

  /** Scoped by id AND company in one query; 404 for anything out of scope. */
  async get(templateId: string, companyId: string): Promise<ChecklistTemplateView> {
    const template = await this.prisma.checklistTemplate.findFirst({
      where: { id: templateId, company_id: companyId },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new NotFoundException();
    return this.toView(template);
  }

  async create(
    ctx: TaskCompanyContext,
    dto: CreateChecklistTemplateDto,
  ): Promise<ChecklistTemplateView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const template = await tx.checklistTemplate.create({
          data: {
            company_id: ctx.companyId,
            name: dto.name,
            description: dto.description ?? null,
            items: {
              create: dto.items.map((item, index) => ({
                label: item.label,
                position: index,
                kind: item.kind ?? ChecklistItemKind.CHECK,
                is_required: item.is_required ?? true,
                section: item.section ?? null,
              })),
            },
          },
          include: TEMPLATE_INCLUDE,
        });
        await this.audit(tx, ctx, AuditEventType.CREATE, template.id, {
          action: 'create_checklist_template',
          name: dto.name,
          item_count: template.items.length,
        });
        return this.toView(template);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A checklist with this name already exists in this company');
      }
      throw e;
    }
  }

  async update(
    ctx: TaskCompanyContext,
    templateId: string,
    dto: UpdateChecklistTemplateDto,
  ): Promise<ChecklistTemplateView> {
    await this.get(templateId, ctx.companyId); // scope check first

    const data: Prisma.ChecklistTemplateUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.checklistTemplate.update({ where: { id: templateId }, data });

        if (dto.items !== undefined) {
          // Wholesale replacement. Tasks already created keep their own
          // snapshots, so nothing historical moves.
          await tx.checklistTemplateItem.deleteMany({ where: { template_id: templateId } });
          for (const [index, item] of dto.items.entries()) {
            await tx.checklistTemplateItem.create({
              data: {
                template_id: templateId,
                label: item.label,
                position: index,
                kind: item.kind ?? ChecklistItemKind.CHECK,
                is_required: item.is_required ?? true,
                section: item.section ?? null,
              },
            });
          }
        }

        const template = await tx.checklistTemplate.findUniqueOrThrow({
          where: { id: templateId },
          include: TEMPLATE_INCLUDE,
        });
        await this.audit(tx, ctx, AuditEventType.UPDATE, templateId, {
          action: 'update_checklist_template',
          changed_fields: Object.keys(dto),
        });
        return this.toView(template);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A checklist with this name already exists in this company');
      }
      throw e;
    }
  }

  // ── Reference library ─────────────────────────────────────────────────────

  /** The starter definitions, marked where the company already has one by that name. */
  async library(companyId: string): Promise<ReferenceChecklistView[]> {
    const existing = await this.prisma.checklistTemplate.findMany({
      where: { company_id: companyId, name: { in: REFERENCE_CHECKLISTS.map((r) => r.name) } },
      select: { name: true },
    });
    const names = new Set(existing.map((e) => e.name));
    return REFERENCE_CHECKLISTS.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      items: r.items.map((i) => ({ ...i, kind: i.kind as ChecklistItemKind })),
      installed: names.has(r.name),
    }));
  }

  /**
   * Install one reference definition as an ordinary, editable company
   * template — through the same create path, audit and uniqueness rule as a
   * template written by hand.
   */
  async installReference(ctx: TaskCompanyContext, key: string): Promise<ChecklistTemplateView> {
    const reference = REFERENCE_CHECKLISTS.find((r) => r.key === key);
    if (!reference) throw new NotFoundException('No reference checklist with that key');
    const view = await this.create(ctx, {
      name: reference.name,
      description: reference.description,
      items: reference.items.map((i) => ({
        label: i.label,
        kind: i.kind as ChecklistItemKind,
        is_required: i.is_required,
        section: i.section,
      })),
    });
    return view;
  }

  private audit(
    tx: Prisma.TransactionClient,
    ctx: TaskCompanyContext,
    eventType: AuditEventType,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogService.create(
      {
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        branchId: null,
        eventType,
        entityType: AUDIT_TEMPLATE,
        entityId,
        payload,
      },
      tx,
    );
  }

  private toView(template: TemplateRecord): ChecklistTemplateView {
    return {
      id: template.id,
      company_id: template.company_id,
      name: template.name,
      description: template.description,
      status: template.status,
      items: template.items.map((i) => ({
        id: i.id,
        label: i.label,
        position: i.position,
        kind: i.kind,
        is_required: i.is_required,
        section: i.section,
      })),
      created_at: template.created_at,
      updated_at: template.updated_at,
    };
  }
}
