// How a set row becomes the card the research modal prices.
//
// Mirrors the set editor's own reading of the columns, including the rule that
// a card counts as graded when the Grading Company is filled in — there is no
// separate yes/no flag.

import type { CardDescriptor } from '@/components/MarketResearchModal';
import { itemName, parseGradeFromText, type CollectionItem } from '@/lib/collectionItems';

export { parseGradeFromText };

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

// How an item in the Singles & Items list becomes the card the research modal
// prices. Each item is its own series: the "card number" is the item's id, so
// two lines that happen to share a year and brand (two different boxes, say)
// never blend their price history. The grade comes from the description when
// it names one; anything else is priced as raw.
export function descriptorForItem(
  item: Pick<CollectionItem, 'id' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description'
    | 'condition' | 'raw_grade' | 'grading_company' | 'grade'>,
): CardDescriptor {
  // The Raw/Graded selector is authoritative. A row with no grade entered at
  // all falls back to one written in the description, as before the selector
  // existed, so older rows keep their price history.
  const explicitGraded = item.condition === 'graded' && !!item.grading_company && !!item.grade;
  const g = explicitGraded
    ? { company: item.grading_company as string, grade: item.grade as string }
    : (item.condition === 'raw' && item.raw_grade) || item.condition === 'graded'
      ? null
      : parseGradeFromText(item.description);
  const rawGrade = !g && item.condition === 'raw' ? (item.raw_grade || null) : null;
  const who = [item.first_name, item.last_name].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  return {
    year: item.year ?? null,
    brand: (item.brand ?? '').trim() || null,
    card_number: `item:${item.id}`,
    player: who || (item.description ?? '').trim() || null,
    grade: g?.grade ?? null,
    grading_company: g?.company ?? null,
    raw_grade: rawGrade,
    set_slug: 'items',
    set_card_number: item.id,
    display_title: itemName(item),
  };
}
