import type { SupabaseClient } from '@supabase/supabase-js';

// Client-side helpers for the persistent shopping cart (cart_items table).
//
// The cart stores only listing references — never price snapshots — so callers
// join back to `listings` for live price/availability. Every helper is written
// to degrade gracefully if the table isn't present yet (migration not applied):
// reads return empty, writes no-op, so the marketplace keeps working and simply
// behaves like the old in-memory cart until the migration lands.

// Fired on `window` whenever the cart changes so the nav CartIcon (and any other
// listener) can refresh its badge without a shared store.
export const CART_CHANGED_EVENT = 'sc-cart-changed';

export function emitCartChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
  }
}

// Returns the set of listing ids currently in the user's cart.
export async function fetchCartIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('cart_items')
    .select('listing_id')
    .eq('user_id', userId);
  if (error) { console.warn('[cart.fetchCartIds]', error.message); return new Set(); }
  return new Set((data || []).map(r => r.listing_id as string));
}

// Current cart item count (for the nav badge). Uses a HEAD count to avoid
// pulling rows.
export async function fetchCartCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('cart_items')
    .select('listing_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) { console.warn('[cart.fetchCartCount]', error.message); return 0; }
  return count || 0;
}

// Add a listing to the cart. The marketplace enforces single-seller carts, so
// when `replaceOtherSellers` is set we first clear any existing items (the
// caller has already confirmed the swap with the buyer).
export async function addToCart(
  supabase: SupabaseClient,
  userId: string,
  listingId: string,
  opts: { replaceOtherSellers?: boolean } = {},
): Promise<void> {
  if (opts.replaceOtherSellers) {
    await supabase.from('cart_items').delete().eq('user_id', userId).neq('listing_id', listingId);
  }
  const { error } = await supabase
    .from('cart_items')
    .upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id' });
  if (error) console.warn('[cart.addToCart]', error.message);
  else emitCartChanged();
}

export async function removeFromCart(
  supabase: SupabaseClient,
  userId: string,
  listingId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cart_items').delete().eq('user_id', userId).eq('listing_id', listingId);
  if (error) console.warn('[cart.removeFromCart]', error.message);
  else emitCartChanged();
}

export async function clearCart(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('user_id', userId);
  if (error) console.warn('[cart.clearCart]', error.message);
  else emitCartChanged();
}
