import { SupabaseClient } from '@supabase/supabase-js'

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
    .select('rows, owned_count, owned_pct, row_count')
    .eq('user_id', sellerUserId)
    .eq('slug', setSlug)
    .maybeSingle()
  if (!set) return false

  const rows = Array.isArray(set.rows) ? set.rows : []
  let touched = false
  const desired = owned ? 'Yes' : 'No'
  const target = String(cardNumber).trim()
  const nextRows = rows.map((r: Record<string, unknown>) => {
    const rowCard = String(r['Card #'] ?? '').trim()
    if (rowCard !== target) return r
    if (String(r['Owned'] ?? '') === desired) return r
    touched = true
    return { ...r, Owned: desired }
  })
  if (!touched) return false

  const total = nextRows.length
  const ownedCount = nextRows.filter((r: Record<string, unknown>) => String(r['Owned'] ?? '') === 'Yes').length
  const ownedPct = total > 0 ? (ownedCount / total) * 100 : 0

  await supabase
    .from('sets')
    .update({ rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now() })
    .eq('user_id', sellerUserId)
    .eq('slug', setSlug)
  return true
}
