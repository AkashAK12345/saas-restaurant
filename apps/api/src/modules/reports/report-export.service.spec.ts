import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  EXPORT_MAX_ROWS,
  ReportExportService,
  isExportFormat,
} from './report-export.service.js';
import type { ReportResponse } from './report-contract.js';

function makeReport(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return {
    key: 'banquet.payments',
    name: 'Banquet payments',
    description: 'Payments received in the period',
    domain: 'banquet',
    kind: 'rows',
    generated_at: '2026-03-15T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
    filters: {
      branch_id: '22222222-2222-4222-8222-222222222222',
      from: '2026-03-01',
      to: '2026-03-31',
      options: {},
    },
    columns: [
      { key: 'paid_at', label: 'Paid', type: 'datetime' },
      { key: 'method', label: 'Method', type: 'string' },
      { key: 'amount_minor', label: 'Amount', type: 'money' },
      { key: 'wait_seconds', label: 'Wait', type: 'duration' },
    ],
    metrics: [
      { key: 'collected', label: 'Collected', value: 1_234_567, type: 'money', currency: 'INR' },
    ],
    rows: [
      { paid_at: '2026-03-02T05:30:00.000Z', method: 'cash', amount_minor: 250_000, wait_seconds: 95 },
      { paid_at: '2026-03-03T05:30:00.000Z', method: null, amount_minor: 0, wait_seconds: null },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
    ...overrides,
  };
}

async function readSheet(body: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return { sheet, rows };
}

describe('ReportExportService', () => {
  let service: ReportExportService;

  beforeEach(() => {
    service = new ReportExportService();
  });

  describe('format handling', () => {
    it.each(['xlsx', 'pdf'])('accepts %s', (format) => {
      expect(isExportFormat(format)).toBe(true);
    });

    it.each(['csv', 'html', 'XLSX', '', null, undefined, 7])('rejects %j', (format) => {
      expect(isExportFormat(format)).toBe(false);
    });

    it('refuses to render an unsupported format', async () => {
      await expect(
        service.render(makeReport(), 'csv' as unknown as 'pdf'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('filenames', () => {
    it('names the file after the report and the branch-local dates', () => {
      expect(service.filenameFor(makeReport(), 'xlsx')).toBe(
        'banquet.payments_2026-03-01_2026-03-31.xlsx',
      );
    });

    // The name lands in a Content-Disposition header; nothing that could break
    // out of it may survive.
    it('strips anything that is not filename-safe', () => {
      const report = makeReport({
        key: 'evil"; rm -rf /',
        filters: { ...makeReport().filters, from: '2026/03/01', to: '..\\..\\etc' },
      });
      const name = service.filenameFor(report, 'pdf');

      expect(name).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
      expect(name).not.toContain('"');
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
    });
  });

  describe('bounds', () => {
    it('refuses a render larger than the row cap', async () => {
      const rows = Array.from({ length: EXPORT_MAX_ROWS + 1 }, () => ({ method: 'cash' }));
      await expect(service.render(makeReport({ rows }), 'xlsx')).rejects.toThrow(/limit is 5000/i);
    });

    it('renders exactly the cap', async () => {
      const rows = Array.from({ length: EXPORT_MAX_ROWS }, () => ({ method: 'cash' }));
      const report = makeReport({ rows, meta: { total: EXPORT_MAX_ROWS, limit: 5000, offset: 0 } });
      await expect(service.render(report, 'xlsx')).resolves.toBeTruthy();
    });

    // The service caps the page at EXPORT_MAX_ROWS, so the rows in hand can
    // never exceed it. Only the TOTAL reveals that the file would be partial.
    it('refuses a file that would silently hold only part of the report', async () => {
      const rows = Array.from({ length: 5 }, () => ({ method: 'cash' }));
      const report = makeReport({ rows, meta: { total: 20_000, limit: 5000, offset: 0 } });

      await expect(service.render(report, 'xlsx')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.render(report, 'xlsx')).rejects.toThrow(/20000 rows/);
    });

    it('allows a report whose total fits, however it was paged', async () => {
      const rows = Array.from({ length: 2 }, () => ({ method: 'cash' }));
      const report = makeReport({ rows, meta: { total: 2, limit: 5000, offset: 0 } });
      await expect(service.render(report, 'pdf')).resolves.toBeTruthy();
    });
  });

  describe('Excel', () => {
    it('returns a real workbook with the right content type', async () => {
      const rendered = await service.render(makeReport(), 'xlsx');

      expect(rendered.contentType).toContain('spreadsheetml');
      // ZIP magic: a genuine xlsx, not an empty buffer.
      expect(rendered.body.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(rendered.body.length).toBeGreaterThan(1000);
    });

    // Money is stored and transported in integer minor units; this is one of
    // only two places it is ever divided.
    it('writes money as a major-unit number, not minor units', async () => {
      const { rows } = await readSheet((await service.render(makeReport(), 'xlsx')).body);
      const header = rows.findIndex((r) => r[0] === 'Paid' && r[1] === 'Method');
      expect(header).toBeGreaterThan(-1);

      expect(rows[header + 1][2]).toBe(2500);
      expect(rows[header + 2][2]).toBe(0);
    });

    it('carries the provenance an operator needs to trust the file', async () => {
      const { rows } = await readSheet((await service.render(makeReport(), 'xlsx')).body);
      const flat = rows.map((r) => r.join('|')).join('\n');

      expect(flat).toContain('Banquet payments');
      expect(flat).toContain('banquet.payments');
      expect(flat).toContain('2026-03-01 to 2026-03-31 (Asia/Kolkata)');
      expect(flat).toContain('2026-03-15T09:00:00.000Z');
    });

    it('formats money columns so the sheet reads as currency', async () => {
      const { sheet } = await readSheet((await service.render(makeReport(), 'xlsx')).body);
      expect(sheet.getColumn(3).numFmt).toBe('#,##0.00');
    });

    it('renders a report with no rows rather than failing', async () => {
      const rendered = await service.render(makeReport({ rows: [], meta: { total: 0, limit: 50, offset: 0 } }), 'xlsx');
      expect(rendered.body.length).toBeGreaterThan(0);
    });
  });

  describe('PDF', () => {
    it('returns a real PDF with the right content type', async () => {
      const rendered = await service.render(makeReport(), 'pdf');

      expect(rendered.contentType).toBe('application/pdf');
      expect(rendered.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(rendered.body.subarray(-6).toString('latin1')).toContain('%%EOF');
    });

    it('paginates rather than clipping a long report', async () => {
      const rows = Array.from({ length: 400 }, (_, i) => ({ method: `row ${i}`, amount_minor: i }));
      const rendered = await service.render(makeReport({ rows }), 'pdf');

      const pages = rendered.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
      expect(pages.length).toBeGreaterThan(1);
    });

    it('renders a report with no rows', async () => {
      const rendered = await service.render(makeReport({ rows: [] }), 'pdf');
      expect(rendered.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });
  });
});
