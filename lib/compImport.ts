// Turns comps read from a screenshot into research-table rows. Pure helpers,
// no React or network, so the mapping rules live in one place.

import type { ExtractedComp } from '@/lib/ai/comp-extraction';

export type ImportedRow = {
  source: 'ebay_sold_auction' | 'ebay_sold_bin' | 'other';
  source_label: string;
  grade_company: string;
  grade_value: string;
  sale_date: string;
  price: string;
  notes: string;
  // True when the sale's printed grade isn't the grade of the card being
  // researched, so the caller can flag it for review.
  gradeMismatch: boolean;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

// eBay sales map onto the two eBay sources (auction vs. fixed price / offer).
// Anything else — Goldin, Fanatics, Heritage, PWCC… — has no dedicated source,
// so it goes in as "Other" with the venue as the label.
export function compToRow(c: ExtractedComp, card: { company: string; grade: string }): ImportedRow {
  const isEbay = /ebay/i.test(c.venue);
  const isAuction = /auction/i.test(c.sale_type ?? '');
  const source = isEbay ? (isAuction ? 'ebay_sold_auction' : 'ebay_sold_bin') : 'other';
  // "EBAY - MINTINK TRADING CARDS" -> seller goes in the note, not the label.
  const seller = isEbay ? c.venue.replace(/^\s*ebay\s*[-–:]?\s*/i, '').trim() : '';
  const label = isEbay ? '' : [c.venue, c.sale_type].filter(Boolean).join(' · ');

  const company = c.grade_company ?? card.company;
  const grade = c.grade_value ?? card.grade;
  const mismatch = !!(card.company && card.grade)
    && (norm(company) !== norm(card.company) || norm(grade) !== norm(card.grade));

  const notes = [c.title, isEbay && seller ? `seller: ${seller}` : '', isEbay && c.sale_type && !isAuction ? c.sale_type : '']
    .filter(Boolean).join(' — ').slice(0, 300);

  return {
    source,
    source_label: label,
    grade_company: company,
    grade_value: grade,
    sale_date: c.sale_date ?? '',
    price: c.price !== null ? String(c.price) : '',
    notes,
    gradeMismatch: mismatch,
  };
}

// Downscale a screenshot so the request stays well under the host's body limit.
// Text in a sold list stays legible at ~1800px wide.
export async function imageToPayload(file: Blob, maxWidth = 1800): Promise<{ image_base64: string; media_type: 'image/jpeg' }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return { image_base64: dataUrl.slice(dataUrl.indexOf(',') + 1), media_type: 'image/jpeg' };
}
