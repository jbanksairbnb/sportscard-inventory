import jsPDF from 'jspdf';

// Buyer-facing checklist PDF for a public set showcase: every card in number
// order with an included/missing mark, condition, and (optionally) value.

export type ChecklistRow = {
  cardNumber: string;
  player: string;
  condition: string;
  owned: boolean;
  value: number | null;
};

export type SetChecklistPdfOptions = {
  setTitle: string;
  subtitle: string;      // e.g. "312 of 320 cards · Set value $8,121.48"
  pageUrl: string;
  showValues: boolean;
  rows: ChecklistRow[];
};

const PLUM = '#3D1F4A';
const ORANGE = '#E25A1C';
const INK = '#2C1B33';
const INK_SOFT = '#554260';
const TEAL = '#2D7A6E';
const RUST = '#C54A2C';
const PAPER = '#FBF3DD';
const RULE = '#C8B8D0';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function generateSetChecklistPdf(opts: SetChecklistPdfOptions): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mx = 36;
  const bottom = 40;
  const rowH = 14;

  function header(first: boolean): number {
    doc.setFillColor(PAPER);
    doc.rect(0, 0, pageW, 58, 'F');
    doc.setDrawColor(PLUM);
    doc.setLineWidth(2);
    doc.line(0, 58, pageW, 58);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(ORANGE);
    doc.text('SPORTS', mx, 30);
    doc.setFontSize(8);
    doc.setTextColor(PLUM);
    doc.text('COLLECTIVE', mx, 42);
    doc.setFontSize(12);
    doc.text('SET CHECKLIST', pageW - mx, 30, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(INK_SOFT);
    doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), pageW - mx, 43, { align: 'right' });
    let y = 80;
    if (first) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(PLUM);
      doc.text(opts.setTitle, mx, y);
      y += 15;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(INK_SOFT);
      doc.text(opts.subtitle, mx, y);
      y += 18;
    }
    // Column headings
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(PLUM);
    doc.text('#', mx + 14, y);
    doc.text('PLAYER', mx + 52, y);
    doc.text('CONDITION', pageW - mx - (opts.showValues ? 150 : 70), y);
    if (opts.showValues) doc.text('VALUE', pageW - mx, y, { align: 'right' });
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.5);
    doc.line(mx, y + 4, pageW - mx, y + 4);
    return y + 16;
  }

  function fit(text: string, maxW: number): string {
    if (doc.getTextWidth(text) <= maxW) return text;
    let cut = text.length;
    while (cut > 1 && doc.getTextWidth(text.slice(0, cut) + '…') > maxW) cut--;
    return text.slice(0, cut) + '…';
  }

  let y = header(true);
  const condX = pageW - mx - (opts.showValues ? 150 : 70);
  for (const r of opts.rows) {
    if (y > pageH - bottom - 10) {
      doc.addPage();
      y = header(false);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    // Filled dot = included, hollow = missing (the standard PDF fonts have no
    // check-mark glyph).
    doc.setDrawColor(r.owned ? TEAL : RUST);
    doc.setFillColor(r.owned ? TEAL : PAPER);
    doc.setLineWidth(0.8);
    doc.circle(mx + 4, y - 3, 3.2, r.owned ? 'FD' : 'S');
    doc.setTextColor(INK);
    doc.text(r.cardNumber, mx + 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(fit(r.player || '', condX - (mx + 52) - 10), mx + 52, y);
    doc.setTextColor(INK_SOFT);
    doc.text(r.owned ? (r.condition || '') : 'Missing', condX, y);
    if (opts.showValues && r.owned && r.value !== null) {
      doc.setTextColor(INK);
      doc.text(money(r.value), pageW - mx, y, { align: 'right' });
    }
    y += rowH;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(INK_SOFT);
    doc.text(opts.pageUrl, mx, pageH - 20);
    doc.text(`Page ${p} of ${pages}`, pageW - mx, pageH - 20, { align: 'right' });
  }
  return doc.output('blob');
}
