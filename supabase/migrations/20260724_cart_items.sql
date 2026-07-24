-- Persistent shopping cart.
--
-- The marketplace cart lived only in React state, so it evaporated on refresh,
-- navigation, or the next login. This table backs it so a signed-in buyer's
-- cart follows their account (any device, until they check out or remove
-- items). We store only a reference to the listing — never a price snapshot —
-- so the cart always reflects the listing's live price and availability.
--
-- One row per (buyer, listing). Deleting either the user or the listing removes
-- the cart row (a sold/removed listing shouldn't linger in a cart).

create table if not exists public.cart_items (
  user_id    uuid not null references auth.users(id)      on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists idx_cart_items_user on public.cart_items(user_id);

-- ── Row-level security ─────────────────────────────────────────────────────
-- A buyer manages only their own cart. Unlike orders (written server-side with
-- the service-role key), the cart is edited straight from the client, so it
-- needs owner insert/delete policies in addition to select.
alter table public.cart_items enable row level security;

drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists cart_items_insert_own on public.cart_items;
create policy cart_items_insert_own on public.cart_items
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items
  for delete to authenticated
  using (auth.uid() = user_id);
