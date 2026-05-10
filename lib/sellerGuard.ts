import type { SupabaseClient } from '@supabase/supabase-js';

// Returns true if the user has selling privileges (or is an admin). Used at
// the top of seller-only client pages to gate access. RLS is the hard
// guardrail; this is the UX layer that bounces buyer-only users to a sane
// destination instead of letting them load a broken-looking page.
export async function isSeller(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_profiles')
    .select('can_sell, is_admin')
    .eq('user_id', userId)
    .maybeSingle();
  return !!(data?.can_sell || data?.is_admin);
}
