-- Per-seller eBay account connection (OAuth user tokens).
--
-- Phase 1 of the two-way eBay integration: a seller links their eBay account
-- once, and we keep their long-lived refresh token so the app can mint
-- short-lived access tokens on demand (to create/withdraw listings and read
-- orders) without the seller re-consenting each time.
--
-- One row per app user (single eBay account per seller for now). The refresh
-- token is the only real secret here; it is encrypted at rest when
-- EBAY_TOKEN_ENC_KEY is configured (token_enc = 'aesgcm'), otherwise stored
-- as-is (token_enc = 'none'). Either way the table is service-role-only — see
-- the RLS note at the bottom — so it is never exposed to the browser.
--
-- The policy / location columns cache the one-time Sell-API setup
-- (business-policy IDs + inventory location) so we don't re-run that handshake
-- on every listing push. last_order_poll_at is the incremental watermark for
-- the eBay → site order poller (Phase B).

create table if not exists public.ebay_connections (
  user_id                  uuid primary key,
  environment              text not null default 'sandbox',  -- 'sandbox' | 'production'
  ebay_user                text,                              -- eBay username, filled when known
  refresh_token            text not null,
  refresh_token_expires_at timestamptz,
  token_enc                text not null default 'none',      -- 'none' | 'aesgcm'
  scopes                   text,
  -- one-time Sell-API setup, cached after first listing push
  fulfillment_policy_id    text,
  payment_policy_id        text,
  return_policy_id         text,
  merchant_location_key    text,
  -- incremental order-poll watermark (Phase B)
  last_order_poll_at       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ── Row-level security ─────────────────────────────────────────────────────
-- RLS is ENABLED with NO policies on purpose: this table holds a secret
-- (the refresh token) and PostgREST/anon+authenticated roles must never read
-- it. Every access goes through server routes using the service-role key,
-- which bypasses RLS. The status endpoint returns only safe, derived fields.
alter table public.ebay_connections enable row level security;
