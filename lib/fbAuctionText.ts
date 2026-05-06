export type AuctionListing = {
  id: string;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  player: string | null;
  card_number: string | null;
  condition_type?: 'raw' | 'graded' | null;
  grade?: string | null;
  grading_company?: string | null;
  raw_grade?: string | null;
};

export function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export function conditionNote(l: AuctionListing): string {
  if (l.condition_type === 'graded' && l.grading_company && l.grade) return `${l.grading_company} ${l.grade}`;
  if (l.condition_type === 'raw' && l.raw_grade) return l.raw_grade;
  return '';
}

export function listingVars(l: AuctionListing, lotNumber?: number, minBidOverride?: string): Record<string, string> {
  const startingBid = minBidOverride !== undefined && minBidOverride !== '' ? minBidOverride : '';
  return {
    lot_number: lotNumber !== undefined ? String(lotNumber) : '',
    year: l.year ? String(l.year) : '',
    brand: l.brand || '',
    player: l.player || '',
    card_number: l.card_number || '',
    title: l.title || '',
    grade: l.grade || '',
    grading_company: l.grading_company || '',
    raw_grade: l.raw_grade || '',
    condition_note: conditionNote(l),
    starting_bid: startingBid,
    description: l.description || '',
  };
}
