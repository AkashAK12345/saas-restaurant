import PDFDocument from 'pdfkit';

/** What the order PDF prints: the order as the detail endpoint returns it. */
export interface OrderForPdf {
  /** "Purchase Order" unless told otherwise ("Purchase Invoice" for one delivery). */
  heading?: string;
  po_number: string;
  status: string;
  ordered_at: Date;
  created_by: string | null;
  vendor: { name: string; phone: string | null };
  branch: { name: string };
  total_minor: number;
  paid_minor: number;
  lines: Array<{
    name: string;
    quantity: number;
    unit: string | null;
    unit_price_minor: number;
    tax_rate_bps: number;
    tax_minor: number;
    line_total_minor: number;
    received: boolean;
  }>;
  receipts: Array<{ invoice_number: string; received_at: Date; items: number }>;
}

// The built-in PDF fonts have no rupee sign: amounts read "Rs 1,234.50".
const AMOUNT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const rs = (minor: number) => `Rs ${AMOUNT.format(minor / 100)}`;

function when(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

/**
 * A purchase order as an A4 PDF — what the supplier is sent on WhatsApp
 * beside the message. Times are the branch's own clock.
 */
export function orderPdf(order: OrderForPdf, timeZone: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const status = order.status === 'RECEIVED' ? 'Received' : order.status === 'CANCELLED' ? 'Cancelled' : 'Awaiting delivery';

    doc.font('Helvetica-Bold').fontSize(20).text(order.heading ?? 'Purchase Order', { align: 'center' });
    doc.font('Helvetica').fontSize(12).text(order.po_number, { align: 'center' });
    doc.fontSize(9).fillColor('#555').text(`${when(order.ordered_at, timeZone)} · ${status}`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.5).stroke();
    doc.moveDown(0.8);

    const top = doc.y;
    const half = width / 2;
    doc.fontSize(8).fillColor('#555').text('SUPPLIER', left, top);
    doc.fontSize(11).fillColor('#000').font('Helvetica-Bold').text(order.vendor.name, left, doc.y, { width: half - 12 });
    doc.font('Helvetica').fontSize(10);
    if (order.vendor.phone) doc.text(order.vendor.phone, { width: half - 12 });
    const leftEnd = doc.y;
    doc.fontSize(8).fillColor('#555').text('DELIVER TO', left + half, top);
    doc.fontSize(11).fillColor('#000').font('Helvetica-Bold').text(order.branch.name, left + half, doc.y, { width: half });
    doc.font('Helvetica').fontSize(10);
    if (order.created_by) doc.text(`Raised by ${order.created_by}`, { width: half });
    doc.y = Math.max(leftEnd, doc.y) + 16;

    // #, item, qty, rate, GST, amount.
    const cols = [
      { x: 0, w: 24, align: 'left' as const },
      { x: 24, w: width - 24 - 80 - 80 - 44 - 90, align: 'left' as const },
      { x: width - 80 - 80 - 44 - 90, w: 80, align: 'right' as const },
      { x: width - 80 - 44 - 90, w: 80, align: 'right' as const },
      { x: width - 44 - 90, w: 44, align: 'right' as const },
      { x: width - 90, w: 90, align: 'right' as const },
    ];
    const row = (cells: string[], bold = false) => {
      if (doc.y + 22 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
      let bottom = y;
      cells.forEach((text, i) => {
        doc.text(text, left + cols[i].x, y, { width: cols[i].w - 4, align: cols[i].align });
        bottom = Math.max(bottom, doc.y);
      });
      doc.y = bottom + 5;
      doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2).lineWidth(bold ? 1 : 0.5).strokeColor(bold ? '#000' : '#bbb').stroke();
      doc.strokeColor('#000');
      doc.y += 3;
    };
    row(['#', 'Item', 'Qty', 'Rate', 'GST', 'Amount'], true);
    order.lines.forEach((l, i) =>
      row([
        String(i + 1),
        l.received ? `${l.name} (received)` : l.name,
        `${QTY.format(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
        rs(l.unit_price_minor),
        l.tax_rate_bps ? `${l.tax_rate_bps / 100}%` : '-',
        rs(l.line_total_minor),
      ]),
    );

    const tax = order.lines.reduce((s, l) => s + l.tax_minor, 0);
    const total = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
      doc.text(label, left + width - 240, y, { width: 120 });
      doc.text(value, left + width - 120, y, { width: 120, align: 'right' });
      doc.y = Math.max(doc.y, y + 14) + 2;
    };
    doc.moveDown(0.5);
    total('GST', rs(tax));
    total('Grand Total', rs(order.total_minor), true);
    if (order.paid_minor) total('Paid', rs(order.paid_minor));
    if (order.status !== 'CANCELLED') total('Due', rs(order.total_minor - order.paid_minor));

    if (order.receipts.length) {
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(8).fillColor('#555').text('RECEIPTS', left, doc.y);
      doc.fillColor('#000').fontSize(9.5);
      for (const r of order.receipts) {
        doc.text(`Inv ${r.invoice_number} · ${r.items} ${r.items === 1 ? 'item' : 'items'} · ${when(r.received_at, timeZone)}`, left, doc.y);
      }
    }

    doc.end();
  });
}
