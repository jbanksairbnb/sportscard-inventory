-- Collection items: singles, boxes, packs and anything else a collector tracks
-- that does not belong to a set. One row per line item (qty covers duplicates).
--
-- `value` and `cost` are PER UNIT; the app multiplies by qty for totals, so
-- changing qty never rewrites history.
--
-- `value_history` is a small append-only log of {at, value} (per-unit) written
-- whenever the value is set or changed. It is what lets the Collection Value
-- tracker price an item as of a past month — the same "most recent price
-- before the month ended" rule it uses for cards in sets.

create table if not exists public.collection_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_type      text not null default 'single',     -- single | box | pack | other
  first_name     text,
  last_name      text,
  year           int,
  brand          text,
  description    text,
  qty            int  not null default 1 check (qty >= 0),
  cost           numeric not null default 0,
  value          numeric not null default 0,
  value_history  jsonb not null default '[]'::jsonb,
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ix_collection_items_user on public.collection_items(user_id, sort_order, created_at);

alter table public.collection_items enable row level security;

drop policy if exists "ci_owner_select" on public.collection_items;
create policy "ci_owner_select" on public.collection_items
  for select using (auth.uid() = user_id);

drop policy if exists "ci_owner_insert" on public.collection_items;
create policy "ci_owner_insert" on public.collection_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "ci_owner_update" on public.collection_items;
create policy "ci_owner_update" on public.collection_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ci_owner_delete" on public.collection_items;
create policy "ci_owner_delete" on public.collection_items
  for delete using (auth.uid() = user_id);
