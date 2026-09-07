// Which rows a CardSight sweep can price, and how a row becomes a card.
//
// Two screens ask this question — one set at a time from the set editor, and
// the whole collection at once from the home page. They have to agree: a card
// the set page prices and the collection page skips would give the same
// collection two different histories depending on where the owner clicked.
// So the gates and the row→card translation live here, once.

import type { CardDescriptor } from '@/components/MarketResearchModal';

export type SweepTarget = {
  key: string;              // stable handle, unique across every set
  setSlug: string;
  setTitle: string | null;
  rowIndex: number;         // index into that set's own rows array
  descriptor: CardDescriptor;
  label: string;            // what to show in the review table
  currentValue: number | null;
};

export type SweepSetContext = {
  slug: string;
  title?: string | null;
  year: number | null;
  brand: string | null;
};

// A set row as the card it describes. Mirrors the set editor's own reading of
// the columns, including the rule that a card counts as graded when the
// Grading Company is filled in — there is no separate yes/no flag.
export function sweepDescriptorForRow(
  row: Record<string, unknown>,
  ctx: SweepSetContext,
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

// The Value column as a number, or null when the cell is blank or unparseable.
export function currentValueOf(row: Record<string, unknown>): number | null {
  const raw = String(row['Value'] ?? '').replace(/[^0-9.\-]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Rows the sweep can actually price. Three gates, each for its own reason:
//
//  - Owned. Pricing a card you don't have is answering a question nobody
//    asked, and it buries the cards you do own in a review list several
//    times longer than it needs to be.
//  - Graded, with both a company and a grade. CardSight's sold data is keyed
//    to a graded population; an ungraded card has no comparable set to take a
//    median of, so the route returns no value for one anyway. Filtering here
//    rather than there means those cards never cost an API call and never
//    appear as a row of dashes the owner has to read past.
//  - Enough identity to look up at all — a row missing a year, number or
//    player can't be resolved, so it's left out rather than reported as a
//    failure two hundred times over.
export function sweepTargetsForSet(
  ctx: SweepSetContext,
  rows: Array<Record<string, unknown>>,
): SweepTarget[] {
  const out: SweepTarget[] = [];
  rows.forEach((row, i) => {
    if (String(row['Owned'] || '') !== 'Yes') return;
    const d = sweepDescriptorForRow(row, ctx);
    if (!d.grading_company || !d.grade) return;
    if (!d.year || !d.card_number || !d.player) return;
    out.push({
      // Scoped by slug: a collection-wide sweep holds targets from every set
      // in one map, and row 4 of one set is not row 4 of another.
      key: `${ctx.slug}:${i}:${d.card_number}`,
      setSlug: ctx.slug,
      setTitle: ctx.title ?? null,
      rowIndex: i,
      descriptor: d,
      // Every target is graded by construction, so the condition is always
      // the company and grade.
      label: [d.card_number ? `#${d.card_number}` : '', d.player, `${d.grading_company} ${d.grade}`]
        .filter(Boolean).join(' · '),
      currentValue: currentValueOf(row),
    });
  });
  return out;
}

// The Value column's stored format. The set editor writes currency strings,
// so a sweep that wrote bare numbers would leave the column inconsistent
// depending on which screen last touched the row.
export function formatSweepValue(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(n);
}
