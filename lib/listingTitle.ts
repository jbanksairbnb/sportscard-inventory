// Shared listing-title builder. The canonical formula is:
//   "<year> <brand> #<card_number> <player> <condition>"
// where <condition> is either "<grading_company> <grade> <LABEL>" for graded
// cards or just the raw_grade label for raw cards.
//
// This lived inline in app/listings/page.tsx until the AI grader started
// rewriting raw_grade post-save — scan-batch needs the same builder to
// keep titles in sync when the AI grade lands.

export const GRADE_LABELS: Record<string, string> = {
  '10': 'GEM MT', '9.5': 'GEM MT', '9': 'MINT',
  '8.5': 'NM-MT+', '8': 'NM-MT', '7.5': 'NM+', '7': 'NM',
  '6.5': 'EX-MT+', '6': 'EX-MT', '5.5': 'EX+', '5': 'EX',
  '4.5': 'VG-EX+', '4': 'VG-EX', '3.5': 'VG+', '3': 'VG',
  '2.5': 'GOOD+', '2': 'GOOD', '1.5': 'FAIR', '1': 'POOR',
};

export type ListingTitleFields = {
  year?: number | null;
  brand?: string | null;
  card_number?: string | null;
  player?: string | null;
  condition_type?: 'raw' | 'graded' | null;
  raw_grade?: string | null;
  grading_company?: string | null;
  grade?: string | null;
};

export function buildListingTitle(d: ListingTitleFields): string {
  let condition = '';
  if (d.condition_type === 'graded' && d.grading_company && d.grade) {
    const label = GRADE_LABELS[String(d.grade)] || '';
    condition = label ? `${d.grading_company} ${d.grade} ${label}` : `${d.grading_company} ${d.grade}`;
  } else if (d.condition_type === 'raw' && d.raw_grade) {
    condition = d.raw_grade;
  }
  const parts = [
    d.year ? String(d.year) : '',
    d.brand || '',
    d.card_number ? `#${d.card_number}` : '',
    d.player || '',
    condition,
  ].filter(Boolean);
  return parts.join(' ').trim();
}
