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
