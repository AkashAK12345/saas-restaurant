import PDFDocument from 'pdfkit';

// The built-in PDF fonts have no rupee sign: amounts read "Rs 1,234.50".
const AMOUNT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (minor: number) => `Rs ${AMOUNT.format(minor / 100)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "16 Sep 2026" from "2026-09-16". */
const day = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
};

export interface LedgerFigures {
  opening_minor: number;
  purchases_minor: number;
  paid_minor: number;
  closing_minor: number;
}

export interface StatementForPdf extends LedgerFigures {
  supplier: {
    name: string;
    phone: string | null;
    gstin: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_ifsc: string | null;
    bank_name: string | null;
    upi_id: string | null;
  };
  from: string;
  to: string;
  branch: string;
  invoices: Array<{ date: string; invoice_number: string; branch: string; total_minor: number; paid_minor: number; due_minor: number }>;
  payments: Array<{ date: string; invoice_number: string; mode: string; amount_minor: number }>;
}

export interface LedgerForPdf {
  from: string;
  to: string;
  branch: string;
  totals: { purchases_minor: number; paid_minor: number; pending_minor: number };
  suppliers: Array<LedgerFigures & { name: string }>;
}

function collect(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

/** A table: header row, then rows, a new page (and header) when one fills. */
function table(doc: PDFKit.PDFDocument, cols: Array<{ label: string; width: number; right?: boolean }>, rows: string[][]) {
  const left = doc.page.margins.left;
  const draw = (cells: string[], bold: boolean) => {
    if (doc.y + 20 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let x = left;
    let bottom = y;
    cells.forEach((text, i) => {
      doc.text(text, x, y, { width: cols[i].width - 6, align: cols[i].right ? 'right' : 'left' });
      bottom = Math.max(bottom, doc.y);
      x += cols[i].width;
    });
    doc.y = bottom + 4;
    const width = cols.reduce((s, c) => s + c.width, 0);
    doc.moveTo(left, doc.y - 1).lineTo(left + width, doc.y - 1).lineWidth(bold ? 1 : 0.4).strokeColor(bold ? '#000' : '#bbb').stroke();
    doc.strokeColor('#000');
    doc.y += 3;
  };
  draw(cols.map((c) => c.label), true);
  for (const r of rows) draw(r, false);
}

function heading(doc: PDFKit.PDFDocument, title: string, lines: string[]) {
  doc.font('Helvetica-Bold').fontSize(18).text(title, { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  for (const l of lines) doc.text(l, { align: 'center' });
  doc.fillColor('#000').moveDown(0.8);
}

function figures(doc: PDFKit.PDFDocument, f: LedgerFigures) {
  const left = doc.page.margins.left;
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
    doc.text(label, left, y, { width: 200 });
    doc.text(value, left + 200, y, { width: 160, align: 'right' });
    doc.y = Math.max(doc.y, y + 14) + 2;
  };
  row('Opening balance', rs(f.opening_minor));
  row('Purchases', rs(f.purchases_minor));
  row('Paid', rs(f.paid_minor));
  row('Closing balance (due)', rs(f.closing_minor), true);
  doc.moveDown(0.8);
}

/** One supplier's statement for a cycle: balances, its invoices and payments, where to pay. */
export function statementPdf(s: StatementForPdf): Promise<Buffer> {
  return collect((doc) => {
    heading(doc, 'Supplier Statement', [
      s.supplier.name + (s.supplier.phone ? ` · ${s.supplier.phone}` : ''),
      `${day(s.from)} to ${day(s.to)} · ${s.branch}`,
      ...(s.supplier.gstin ? [`GSTIN ${s.supplier.gstin}`] : []),
    ]);
    figures(doc, s);

    doc.font('Helvetica-Bold').fontSize(11).text('Invoices', doc.page.margins.left);
    doc.moveDown(0.3);
    if (s.invoices.length) {
      table(
        doc,
        [
          { label: 'Date', width: 70 },
          { label: 'Invoice', width: 120 },
          { label: 'Branch', width: 110 },
          { label: 'Amount', width: 80, right: true },
          { label: 'Paid', width: 70, right: true },
          { label: 'Due', width: 75, right: true },
        ],
        s.invoices.map((i) => [day(i.date), i.invoice_number, i.branch, rs(i.total_minor), rs(i.paid_minor), rs(i.due_minor)]),
      );
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('None in this period.').fillColor('#000');
    }
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text('Payments', doc.page.margins.left);
    doc.moveDown(0.3);
    if (s.payments.length) {
      table(
        doc,
        [
          { label: 'Date', width: 90 },
          { label: 'Invoice', width: 160 },
          { label: 'Mode', width: 110 },
          { label: 'Amount', width: 100, right: true },
        ],
        s.payments.map((p) => [day(p.date), p.invoice_number, p.mode, rs(p.amount_minor)]),
      );
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('None in this period.').fillColor('#000');
    }

    const bank = [
      s.supplier.bank_account_name && `Account holder: ${s.supplier.bank_account_name}`,
      s.supplier.bank_account_number && `Account number: ${s.supplier.bank_account_number}`,
      s.supplier.bank_ifsc && `IFSC: ${s.supplier.bank_ifsc}`,
      s.supplier.bank_name && `Bank: ${s.supplier.bank_name}`,
      s.supplier.upi_id && `UPI: ${s.supplier.upi_id}`,
    ].filter(Boolean) as string[];
    if (bank.length) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(11).text('Bank details', doc.page.margins.left);
      doc.font('Helvetica').fontSize(10);
      for (const b of bank) doc.text(b);
    }
  });
}

/** Every supplier's balances for a cycle, with the totals above. */
export function ledgerPdf(l: LedgerForPdf): Promise<Buffer> {
  return collect((doc) => {
    heading(doc, 'Supplier Ledger', [`${day(l.from)} to ${day(l.to)} · ${l.branch}`]);
    const left = doc.page.margins.left;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Purchases ${rs(l.totals.purchases_minor)}    Paid ${rs(l.totals.paid_minor)}    Pending ${rs(l.totals.pending_minor)}`, left);
    doc.moveDown(0.8);
    table(
      doc,
      [
        { label: 'Supplier', width: 175 },
        { label: 'Opening', width: 85, right: true },
        { label: 'Purchases', width: 85, right: true },
        { label: 'Paid', width: 80, right: true },
        { label: 'Closing', width: 85, right: true },
      ],
      l.suppliers.map((s) => [s.name, rs(s.opening_minor), rs(s.purchases_minor), rs(s.paid_minor), rs(s.closing_minor)]),
    );
  });
}
