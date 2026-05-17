import { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

// Compute a new rows[] for a set after toggling Owned for one or more cards.
//
// When marking Owned=No, we move the Image 1 / Image 2 URLs into hidden
// "Image 1 Archived" / "Image 2 Archived" slots so the row stops showing
// images on the set page. When the card comes back (Owned flips to Yes),
// the archived URLs are restored. The image files in storage are never
// deleted — only the row's pointers change.
export function applyOwnedTransition(
  rows: Row[],
  cardNumbers: Set<string>,
  owned: boolean,
): { nextRows: Row[]; touched: boolean; ownedCount: number } {
  const desired = owned ? 'Yes' : 'No'
  let touched = false
  const nextRows = rows.map(r => {
    const card = String(r['Card #'] ?? '').trim()
    if (!cardNumbers.has(card)) return r
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
  }
): Promise<number> {
  const { buyerUserId, year, brand, cardNumber } = args;
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
  let totalUpdated = 0;

  for (const set of sets) {
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
// Returns true if a matching row was found and updated.
export async function markSourceRowOwned(
  supabase: SupabaseClient,
  args: { sellerUserId: string; setSlug: string; cardNumber: string; owned: boolean }
): Promise<boolean> {
  const { sellerUserId, setSlug, cardNumber, owned } = args
  if (!sellerUserId || !setSlug || !cardNumber) return false

  const { data: set } = await supabase
    .from('sets')
    .select('rows')
    .eq('user_id', sellerUserId)
    .eq('slug', setSlug)
    .maybeSingle()
  if (!set) return false

  const rows = Array.isArray(set.rows) ? set.rows as Row[] : []
  const { nextRows, touched, ownedCount } = applyOwnedTransition(
    rows,
    new Set([String(cardNumber).trim()]),
    owned,
  )
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
