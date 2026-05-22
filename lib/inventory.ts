import { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

// Stable per-row identifier. Set rows are stored as a JSON blob, so they
// have no inherent DB row id — we generate one client-side the first time
// we see a row that's missing one. Keying ownership/listing transitions
// off this instead of "Card #" is what lets sellers have duplicate cards
// (e.g. two graded Brosnan #2's) and manage them independently.
export function ensureRowId(r: Row): Row {
  if (typeof r['_id'] === 'string' && r['_id']) return r;
  // crypto.randomUUID is available in browsers + Node 18+; fall back to a
  // timestamp+random string in case neither is present.
  let id = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      id = crypto.randomUUID();
    }
  } catch {}
  if (!id) id = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return { ...r, _id: id };
}
export function ensureRowIds(rows: Row[]): Row[] {
  return rows.map(ensureRowId);
}

// Selector accepted by applyOwnedTransition. Prefer rowIds for new code
// — it's the only thing that disambiguates duplicate cards. cardNumbers
// is kept for legacy call sites (auction "go live" still flips by card #
// because it doesn't know which specific set row a lot came from).
export type RowSelector =
  | { rowIds: Set<string> }
  | { cardNumbers: Set<string> };

// Compute a new rows[] for a set after toggling Owned for one or more
// rows. The "image archive" behavior is unchanged.
export function applyOwnedTransition(
  rows: Row[],
  selector: RowSelector,
  owned: boolean,
): { nextRows: Row[]; touched: boolean; ownedCount: number } {
  const desired = owned ? 'Yes' : 'No'
  let touched = false
  const nextRows = rows.map(r => {
    const matches = 'rowIds' in selector
      ? selector.rowIds.has(String(r['_id'] ?? ''))
      : selector.cardNumbers.has(String(r['Card #'] ?? '').trim());
    if (!matches) return r
    if (String(r['Owned'] ?? '') === desired) return r
    touched = true
    const next: Row = { ...r, Owned: desired }
    if (owned) {
      // Restore archived images if present.
      const a1 = next['Image 1 Archived']
      const a2 = next['Image 2 Archived']
      if (a1) next['Image 1'] = a1
      if (a2) next['Image 2'] = a2
      delete next['Image 1 Archived']
      delete next['Image 2 Archived']
    } else {
      // Archive current images (so the row goes "imageless" while listed).
      const i1 = next['Image 1']
      const i2 = next['Image 2']
      if (i1) {
        next['Image 1 Archived'] = i1
        delete next['Image 1']
      }
      if (i2) {
        next['Image 2 Archived'] = i2
        delete next['Image 2']
      }
    }
    return next
  })
  const ownedCount = nextRows.filter(r => String(r['Owned'] ?? '') === 'Yes').length
  return { nextRows, touched, ownedCount }
}

// Populate a buyer's matching set rows after a marketplace purchase.
// Finds every row in any of the buyer's sets where (year, brand, card #)
// matches the purchased listing AND the row isn't already marked Owned.
// On each match: flip Owned = Yes and fill in the buyer's bookkeeping
// fields. Existing-owned rows are left untouched (buyer's call to
// manually update if they're upgrading condition).
//
// Returns the number of rows updated.
export async function claimPurchaseIntoBuyerSets(
  supabase: SupabaseClient,
  args: {
    buyerUserId: string;
    year: number | null;
    brand: string | null;
    cardNumber: string | null;
    condition_type: 'raw' | 'graded' | null;
    raw_grade: string | null;
    grading_company: string | null;
    grade: string | null;
    purchasePrice: number | null;
    sellerLabel: string | null;
    photos: string[] | null;
    // Optional whitelist of set slugs to restrict the claim to.
    // Empty / undefined / null means "every matching set".
    setSlugs?: string[] | null;
  }
): Promise<number> {
  const { buyerUserId, year, brand, cardNumber, setSlugs } = args;
  if (!buyerUserId || !year || !brand || !cardNumber) return 0;

  // Only fetch sets whose top-level year + brand match — keeps the
  // payload small even for buyers with hundreds of sets.
  const { data: sets } = await supabase
    .from('sets')
    .select('user_id, slug, rows')
    .eq('user_id', buyerUserId)
    .eq('year', year)
    .ilike('brand', brand);
  if (!sets || sets.length === 0) return 0;

  const today = new Date();
  const mmddyyyy = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
  const cardKey = String(cardNumber).trim();
  const allowedSlugs = setSlugs && setSlugs.length > 0 ? new Set(setSlugs) : null;
  let totalUpdated = 0;

  for (const set of sets) {
    if (allowedSlugs && !allowedSlugs.has(set.slug)) continue;
    const rows = Array.isArray(set.rows) ? set.rows as Row[] : [];
    let touched = false;
    const nextRows = rows.map(r => {
      const card = String(r['Card #'] ?? '').trim();
      if (card !== cardKey) return r;
      if (String(r['Owned'] ?? '') === 'Yes') return r;
      touched = true;
      const next: Row = { ...r, Owned: 'Yes' };

      // Restore any archived images from a prior "Not Owned" cycle.
      const a1 = next['Image 1 Archived'];
      const a2 = next['Image 2 Archived'];
      if (a1) next['Image 1'] = a1;
      if (a2) next['Image 2'] = a2;
      delete next['Image 1 Archived'];
      delete next['Image 2 Archived'];

      // Fill blank images with the listing's photos (don't clobber any
      // existing user-uploaded scans on the row).
      const photos = Array.isArray(args.photos) ? args.photos : [];
      if (!next['Image 1'] && photos[0]) next['Image 1'] = photos[0];
      if (!next['Image 2'] && photos[1]) next['Image 2'] = photos[1];

      if (args.purchasePrice != null && !next['Cost']) {
        next['Cost'] = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(args.purchasePrice);
      }
      if (!next['Date Purchased']) next['Date Purchased'] = mmddyyyy;
      if (args.sellerLabel && !next['Purchased From']) next['Purchased From'] = args.sellerLabel;

      if (args.condition_type === 'graded') {
        if (args.grading_company && !next['Grading Company']) next['Grading Company'] = args.grading_company;
        if (args.grade && !next['Grade']) next['Grade'] = args.grade;
      } else if (args.condition_type === 'raw') {
        if (args.raw_grade && !next['Raw Grade']) next['Raw Grade'] = args.raw_grade;
      }
      return next;
    });
    if (!touched) continue;
    const ownedCount = nextRows.filter(r => String(r['Owned'] ?? '') === 'Yes').length;
    const total = nextRows.length;
    const ownedPct = total > 0 ? (ownedCount / total) * 100 : 0;
    await supabase
      .from('sets')
      .update({ rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now() })
      .eq('user_id', buyerUserId)
      .eq('slug', set.slug);
    totalUpdated += nextRows.filter(r => String(r['Card #'] ?? '').trim() === cardKey && String(r['Owned'] ?? '') === 'Yes').length;
  }
  return totalUpdated;
}

// Set the `Owned` flag on a row inside a set (jsonb rows[] in `sets`).
// Used by the auction "go live" flow and by marketplace purchase / cancel
// flows to keep a seller's set inventory in sync with active sales.
//
// Returns true if a matching row was found and updated. Prefers rowId
// when supplied (disambiguates duplicate cards); falls back to cardNumber
// for legacy listings created before listings.source_row_id existed.
export async function markSourceRowOwned(
  supabase: SupabaseClient,
  args: { sellerUserId: string; setSlug: string; cardNumber: string; owned: boolean; rowId?: string | null }
): Promise<boolean> {
  const { sellerUserId, setSlug, cardNumber, owned, rowId } = args
  if (!sellerUserId || !setSlug || (!rowId && !cardNumber)) return false

  const { data: set } = await supabase
    .from('sets')
    .select('rows')
    .eq('user_id', sellerUserId)
    .eq('slug', setSlug)
    .maybeSingle()
  if (!set) return false

  const rows = Array.isArray(set.rows) ? set.rows as Row[] : []
  const selector: RowSelector = rowId
    ? { rowIds: new Set([rowId]) }
    : { cardNumbers: new Set([String(cardNumber).trim()]) };
  const { nextRows, touched, ownedCount } = applyOwnedTransition(rows, selector, owned)
  if (!touched) return false

  const total = nextRows.length
  const ownedPct = total > 0 ? (ownedCount / total) * 100 : 0
  await supabase
    .from('sets')
    .update({ rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now() })
    .eq('user_id', sellerUserId)
    .eq('slug', setSlug)
  return true
}
