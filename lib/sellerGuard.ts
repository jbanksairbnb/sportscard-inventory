import type { SupabaseClient } from '@supabase/supabase-js';

export type SellerStatus = {
  // Has the admin granted selling privileges?
  canSell: boolean;
  // Has the user accepted the seller T&C? Required for selling tools to work.
  termsAccepted: boolean;
  // Convenience: true when the user can actually use seller tools end-to-end
  // (admin granted + terms accepted, OR they're an admin).
  isFullSeller: boolean;
};

// Resolves the user's seller state in one round-trip. RLS enforces the
// hard guardrail; this helper drives client-side routing and nav hiding.
export async function getSellerStatus(supabase: SupabaseClient, userId: string): Promise<SellerStatus> {
  const { data } = await supabase
    .from('user_profiles')
    .select('can_sell, is_admin, seller_terms_accepted_at')
    .eq('user_id', userId)
    .maybeSingle();
  const canSell = !!(data?.can_sell || data?.is_admin);
  const termsAccepted = !!data?.seller_terms_accepted_at || !!data?.is_admin;
  return {
    canSell,
    termsAccepted,
    isFullSeller: canSell && termsAccepted,
  };
}

// Legacy helper — kept for the existing call sites in the scan and listings
// routes. Returns true when the user has fully activated selling. Buyer-only
// users and approved-but-not-yet-accepted-terms users both get false.
export async function isSeller(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const status = await getSellerStatus(supabase, userId);
  return status.isFullSeller;
}
