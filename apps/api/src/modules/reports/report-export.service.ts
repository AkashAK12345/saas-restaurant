import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportResponse, ReportValueType } from './report-contract.js';

/**
 * Rendering a report into a file.
 *
 * FORMAT-AGNOSTIC BY CONSTRUCTION: this service only ever sees a
 * ReportResponse — the same envelope the JSON endpoint returns. It has no
 * knowledge of queues, banquets or tasks, so a future module's report becomes
 * exportable the moment it registers, with nothing added here.
 *
 * READ BY PEOPLE IN INDIA, IN THE BRANCH'S TIME. Dates print dd/MM/yyyy, times
 * on the en-IN clock, amounts with Indian digit grouping, and every instant is
 * shown as the branch's own wall clock — never UTC, never the server's zone. A
 * file handed to an accountant must say what happened at the branch, when it
 * happened there.
 *
 * BOUNDED OUTPUT. An export runs synchronously and streams into memory, so it
 * is capped at EXPORT_MAX_ROWS. That is generous for an operational report and
 * small enough that no single request can exhaust the process. Anything larger
 * is a narrower date range or a background-job feature nobody has asked for
 * yet — deliberately not built.
 */
export const EXPORT_MAX_ROWS = 5_000;

export type ExportFormat = 'xlsx' | 'pdf';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['xlsx', 'pdf'];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);
}

export interface RenderedExport {
  body: Buffer;
  contentType: string;
  filename: string;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const LOCALE = 'en-IN';

/** "2026-03-01" → "01/03/2026". The label is already a branch-local day. */
export function indianDate(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : label;
}

/** The wall-clock parts of an instant in a zone, or null for a bad value/zone. */
function wallClock(value: unknown, timezone: string) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    return { d, y: get('year'), mo: get('month'), da: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
  } catch {
    return null;
  }
}

/** An instant as "dd/MM/yyyy, h:mm am" at the branch. */
export function indianDateTime(value: unknown, timezone: string): string {
  const clock = wallClock(value, timezone);
  if (!clock) return value === null || value === undefined ? '' : String(value);
  const date = `${String(clock.da).padStart(2, '0')}/${String(clock.mo).padStart(2, '0')}/${clock.y}`;
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(clock.d);
  return `${date}, ${time}`;
}

@Injectable()
export class ReportExportService {
  /**
   * A filename an operator can find again: report key, branch dates, format.
   * Sanitised because it goes into a Content-Disposition header. ISO dates are
   * kept here on purpose: they sort correctly in a folder.
   */
  filenameFor(report: ReportResponse, format: ExportFormat): string {
    const safe = `${report.key}_${report.filters.from}_${report.filters.to}`
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .slice(0, 120);
    return `${safe}.${format}`;
  }

  async render(report: ReportResponse, format: ExportFormat): Promise<RenderedExport> {
    if (!isExportFormat(format)) {
      throw new BadRequestException(`Unsupported export format "${String(format)}"`);
    }
    // Refuse on the TOTAL, not on the rows in hand. The service already caps
    // the page at EXPORT_MAX_ROWS, so checking `rows.length` alone could never
    // fire — a 20,000-row report would quietly produce a 5,000-row file that
    // looks complete. A partial export presented as a whole one is worse than
    // no export at all.
    const available = Math.max(report.meta.total, report.rows.length);
    if (available > EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `This export would contain ${available} rows; the limit is ${EXPORT_MAX_ROWS}. Narrow the date range or apply a filter.`,
      );
    }

    const body = format === 'xlsx' ? await this.toExcel(report) : await this.toPdf(report);
    return { body, contentType: CONTENT_TYPE[format], filename: this.filenameFor(report, format) };
  }

  // ── formatting ────────────────────────────────────────────────────────────

  private dateRange(report: ReportResponse): string {
    return `${indianDate(report.filters.from)} to ${indianDate(report.filters.to)} (${report.timezone})`;
  }

  /**
   * Money crosses the wire as INTEGER MINOR UNITS, and is divided in exactly
   * one place — here, for display. Nothing upstream ever holds a fraction.
   */
  private displayValue(value: unknown, type: ReportValueType, timezone: string): string {
    if (value === null || value === undefined) return '';
    switch (type) {
      case 'money': {
        const minor = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(minor)
          ? new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)
          : '';
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? new Intl.NumberFormat(LOCALE).format(n) : String(value);
      }
      case 'percent':
        return typeof value === 'number' ? `${value}%` : String(value);
      case 'duration': {
        const seconds = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(seconds)) return '';
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${String(s).padStart(2, '0')}s`;
      }
      case 'datetime':
        return indianDateTime(value, timezone);
      case 'date':
        return indianDate(value instanceof Date ? value.toISOString().slice(0, 10) : String(value));
      default:
        return String(value);
    }
  }

  /**
   * Excel keeps numbers numeric and dates as real dates, so the sheet can be
   * totalled, sorted and filtered. Excel has no timezone: an instant is written
   * as the BRANCH's wall clock, which is what the reader means by "when".
   */
  private cellValue(value: unknown, type: ReportValueType, timezone: string): string | number | Date | null {
    if (value === null || value === undefined) return null;
    if (type === 'money') {
      const minor = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(minor) ? minor / 100 : null;
    }
    if (type === 'number' || type === 'percent' || type === 'duration') {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (type === 'datetime') {
      const clock = wallClock(value, timezone);
      return clock ? new Date(Date.UTC(clock.y, clock.mo - 1, clock.da, clock.h, clock.mi, clock.s)) : String(value);
    }
    if (type === 'date') {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value instanceof Date ? value.toISOString() : String(value));
      return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : String(value);
    }
    return String(value);
  }

  // ── Excel ─────────────────────────────────────────────────────────────────

  private async toExcel(report: ReportResponse): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SAMCO';
    workbook.created = new Date(report.generated_at);

    const sheet = workbook.addWorksheet('Report');

    // Provenance first: which report, which branch, which dates, which zone.
    sheet.addRow([report.name]).font = { bold: true, size: 14 };
    sheet.addRow([report.description]);
    sheet.addRow(['Report', report.key]);
    sheet.addRow(['Branch', report.branch_name || report.filters.branch_id]);
    sheet.addRow(['Dates', this.dateRange(report)]);
    sheet.addRow(['Generated', indianDateTime(report.generated_at, report.timezone)]);
    for (const [key, value] of Object.entries(report.filters.options)) {
      sheet.addRow([key, value]);
    }
    sheet.addRow([]);

    if (report.metrics.length > 0) {
      sheet.addRow(['Summary']).font = { bold: true };
      for (const metric of report.metrics) {
        sheet.addRow([metric.label, this.cellValue(metric.value, metric.type, report.timezone)]);
      }
      sheet.addRow([]);
    }

    const header = sheet.addRow(report.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F3' } };
    });

    for (const row of report.rows) {
      sheet.addRow(report.columns.map((c) => this.cellValue(row[c.key], c.type, report.timezone)));
    }

    report.columns.forEach((column, index) => {
      const col = sheet.getColumn(index + 1);
      col.width = Math.min(Math.max(column.label.length + 4, 12), 40);
      // Indian grouping (##,##,##0) is a locale setting of the reader's Excel;
      // the explicit pattern keeps two decimals everywhere.
      if (column.type === 'money') col.numFmt = '#,##0.00';
      if (column.type === 'datetime') col.numFmt = 'dd/mm/yyyy hh:mm';
      if (column.type === 'date') col.numFmt = 'dd/mm/yyyy';
    });

    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  // ── PDF ───────────────────────────────────────────────────────────────────

  private toPdf(report: ReportResponse): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(report.name, { continued: false });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .fillColor('#555')
        .text(`${report.branch_name || report.filters.branch_id} · ${this.dateRange(report)}`)
        .text(`Report ${report.key} · generated ${indianDateTime(report.generated_at, report.timezone)}`);
      doc.fillColor('#000').moveDown(0.8);

      if (report.metrics.length > 0) {
        doc.fontSize(11).text('Summary');
        doc.moveDown(0.3);
        doc.fontSize(9);
        for (const metric of report.metrics) {
          const currency = metric.type === 'money' && metric.currency ? ` ${metric.currency}` : '';
          doc.text(`${metric.label}: ${this.displayValue(metric.value, metric.type, report.timezone)}${currency}`);
        }
        doc.moveDown(0.8);
      }

      const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnWidth = usable / Math.max(report.columns.length, 1);
      const rowHeight = 16;

      const drawHeader = () => {
        const y = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        report.columns.forEach((c, i) => {
          doc.text(c.label, doc.page.margins.left + i * columnWidth, y, {
            width: columnWidth - 4,
            ellipsis: true,
          });
        });
        doc.font('Helvetica');
        doc.y = y + rowHeight;
        doc
          .moveTo(doc.page.margins.left, doc.y - 4)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y - 4)
          .strokeColor('#cccccc')
          .stroke();
      };

      if (report.rows.length === 0) {
        doc.fontSize(10).fillColor('#666').text('No data for this period.');
      } else {
        drawHeader();
        for (const row of report.rows) {
          // Paginate by hand: pdfkit will not start a new page for a manually
          // positioned row, and a silently clipped export would be worse than
          // a long one.
          if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            drawHeader();
          }
          const y = doc.y;
          doc.fontSize(8);
          report.columns.forEach((c, i) => {
            doc.text(this.displayValue(row[c.key], c.type, report.timezone), doc.page.margins.left + i * columnWidth, y, {
              width: columnWidth - 4,
              ellipsis: true,
            });
          });
          doc.y = y + rowHeight;
        }
      }

      doc.end();
    });
  }
}
