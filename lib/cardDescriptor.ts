// How a set row becomes the card the research modal prices.
//
// Mirrors the set editor's own reading of the columns, including the rule that
// a card counts as graded when the Grading Company is filled in — there is no
// separate yes/no flag.

import type { CardDescriptor } from '@/components/MarketResearchModal';
import { itemName, type CollectionItem } from '@/lib/collectionItems';

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

// A grader and grade written in free text — "PSA 7", "BGS 9.5", "SGC6".
const GRADE_RE = /\b(PSA|BGS|BVG|SGC|CGC|CSG|HGA|GAI)\s*-?\s*(10|[0-9](?:\.5)?)\b/i;

export function parseGradeFromText(text: string | null | undefined): { company: string; grade: string } | null {
  const m = GRADE_RE.exec(text ?? '');
  return m ? { company: m[1].toUpperCase(), grade: m[2] } : null;
}

// How an item in the Singles & Items list becomes the card the research modal
// prices. Each item is its own series: the "card number" is the item's id, so
// two lines that happen to share a year and brand (two different boxes, say)
// never blend their price history. The grade comes from the description when
// it names one; anything else is priced as raw.
export function descriptorForItem(
  item: Pick<CollectionItem, 'id' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description'>,
): CardDescriptor {
  const g = parseGradeFromText(item.description);
  const who = [item.first_name, item.last_name].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  return {
    year: item.year ?? null,
    brand: (item.brand ?? '').trim() || null,
    card_number: `item:${item.id}`,
    player: who || (item.description ?? '').trim() || null,
    grade: g?.grade ?? null,
    grading_company: g?.company ?? null,
    raw_grade: null,
    set_slug: 'items',
    set_card_number: item.id,
    display_title: itemName(item),
  };
}
