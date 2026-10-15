// How a set row becomes the card the research modal prices.
//
// Mirrors the set editor's own reading of the columns, including the rule that
// a card counts as graded when the Grading Company is filled in — there is no
// separate yes/no flag.

import type { CardDescriptor } from '@/components/MarketResearchModal';

export type SetRowContext = {
  slug: string;
  title?: string | null;
  year: number | null;
  brand: string | null;
};

export function descriptorForSetRow(
  row: Record<string, unknown>,
  ctx: SetRowContext,
): CardDescriptor {
  const grade = String(row['Grade'] || '').trim() || null;
  const gradingCompany = String(row['Grading Company'] || '').trim() || null;
  const rawGrade = String(row['Raw Grade'] || '').trim() || null;
  const isGraded = !!gradingCompany;
  const number = String(row['Card #'] || '').trim() || null;
  return {
    year: ctx.year ?? null,
    brand: ctx.brand || null,
    card_number: number,
    player: String(row['Player'] || '').trim() || null,
    grade: isGraded ? grade : null,
    grading_company: isGraded ? gradingCompany : null,
    raw_grade: !isGraded ? rawGrade : null,
    set_slug: ctx.slug,
    set_card_number: number,
    image_front: String(row['Image 1'] || '').trim() || null,
    image_back: String(row['Image 2'] || '').trim() || null,
  };
}
