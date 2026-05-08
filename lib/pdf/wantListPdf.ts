import jsPDF from 'jspdf';

export type WantRow = {
  cardNumber: string;
  description: string;
  targetGrade: string;
};

export type WantListPdfOptions = {
  setTitle: string;
  yearBrand: string;
  defaultTargetLine: string | null;
  rows: WantRow[];
  collectorName?: string;
  contactNote?: string;
};

const PLUM = '#3D1F4A';
const ORANGE = '#E25A1C';
const INK = '#2C1B33';
const INK_SOFT = '#554260';
const PAPER = '#FBF3DD';
const RULE = '#C8B8D0';

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch('/sports-collective-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateWantListPdf(opts: WantListPdfOptions): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const marginTop = 36;
  const marginBottom = 36;

  const logo = await loadLogoDataUrl();

  // ── HEADER (drawn on every page) ─────────────────────
  function drawHeader() {
    // Paper-colored band
    doc.setFillColor(PAPER);
    doc.rect(0, 0, pageW, 78, 'F');
    // Plum rule under the band
    doc.setDrawColor(PLUM);
    doc.setLineWidth(2);
    doc.line(0, 78, pageW, 78);

    if (logo) {
      try { doc.addImage(logo, 'PNG', marginX, 18, 44, 44); } catch {}
    }

    // Wordmark
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(ORANGE);
    doc.text('SPORTS', marginX + 56, 38);
    doc.setFontSize(9);
    doc.setTextColor(PLUM);
    doc.text('COLLECTIVE', marginX + 56, 52);

    // Right side: WANT LIST + date
    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(PLUM);
    doc.text('WANT LIST', pageW - marginX, 36, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(INK_SOFT);
    doc.text(today, pageW - marginX, 52, { align: 'right' });
  }

  // ── TITLE BLOCK (page 1 only) ────────────────────────
  function drawTitleBlock(yStart: number): number {
    let y = yStart;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(PLUM);
    const titleLines = doc.splitTextToSize(opts.setTitle || 'Untitled set', pageW - marginX * 2);
    doc.text(titleLines, marginX, y);
    y += titleLines.length * 17;

    if (opts.yearBrand) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(INK_SOFT);
      doc.text(opts.yearBrand, marginX, y);
      y += 13;
    }

    if (opts.defaultTargetLine) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(ORANGE);
      doc.text('Targeting: ', marginX, y);
      const labelW = doc.getTextWidth('Targeting: ');
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(INK);
      doc.text(opts.defaultTargetLine, marginX + labelW, y);
      y += 13;
    }

    if (opts.collectorName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(INK_SOFT);
      doc.text(`Collector: ${opts.collectorName}`, marginX, y);
      y += 12;
    }

    // Helper line
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(INK_SOFT);
    doc.text(
      'Check the box next to each card you can supply. Bring this sheet to the table.',
      marginX, y,
    );
    y += 14;
    return y;
  }

  // ── FOOTER (drawn on every page) ─────────────────────
  function drawFooter(pageNum: number, pageCount: number) {
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.5);
    doc.line(marginX, pageH - marginBottom + 6, pageW - marginX, pageH - marginBottom + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(INK_SOFT);
    if (opts.contactNote) {
      doc.text(opts.contactNote, marginX, pageH - marginBottom + 18);
    }
    doc.text(
      `Page ${pageNum} of ${pageCount}  ·  sports-collective.com`,
      pageW - marginX, pageH - marginBottom + 18, { align: 'right' },
    );
  }

  // ── BODY: 3 columns of checklist rows ────────────────
  const COLS = 3;
  const COL_GAP = 12;
  const colW = (pageW - marginX * 2 - COL_GAP * (COLS - 1)) / COLS;
  const rowH = 14;
  const checkboxSize = 9;

  drawHeader();
  let bodyTop = drawTitleBlock(96);
  // small breathing room
  bodyTop += 4;

  const rowsPerCol = Math.floor((pageH - bodyTop - marginBottom - 18) / rowH);
  const rowsPerPage = rowsPerCol * COLS;
  if (rowsPerPage <= 0) {
    throw new Error('Page is too small to fit any rows');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  for (let i = 0; i < opts.rows.length; i++) {
    const localIndex = i % rowsPerPage;
    if (i > 0 && localIndex === 0) {
      doc.addPage();
      drawHeader();
      bodyTop = 96; // no title block on continuation pages
    }
    const colIndex = Math.floor(localIndex / rowsPerCol);
    const rowInCol = localIndex % rowsPerCol;
    const x = marginX + colIndex * (colW + COL_GAP);
    const y = bodyTop + rowInCol * rowH;

    const row = opts.rows[i];

    // Checkbox
    doc.setDrawColor(PLUM);
    doc.setLineWidth(0.7);
    doc.rect(x, y - checkboxSize + 1, checkboxSize, checkboxSize);

    // Card number (bold, fixed width-ish)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(PLUM);
    const numText = `#${row.cardNumber || '—'}`;
    doc.text(numText, x + checkboxSize + 5, y);
    const numW = doc.getTextWidth(numText);

    // Description (player / card title) — truncated to fit column
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(INK);
    const remaining = colW - (checkboxSize + 5 + numW + 6);
    const reservedForGrade = row.targetGrade ? 36 : 0;
    const descMaxW = Math.max(20, remaining - reservedForGrade);
    const descLines = doc.splitTextToSize(row.description || '', descMaxW);
    const descLine = (descLines[0] || '').toString();
    doc.text(descLine, x + checkboxSize + 5 + numW + 4, y);

    // Target grade (right-aligned in column)
    if (row.targetGrade) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(ORANGE);
      doc.text(row.targetGrade, x + colW, y, { align: 'right' });
    }
  }

  // After we know total pages, paint footers.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(p, total);
  }

  return doc.output('blob');
}

export function downloadPdf(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
