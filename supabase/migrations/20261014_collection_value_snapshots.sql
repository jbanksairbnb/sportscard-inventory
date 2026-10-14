-- Collection value snapshots: one row per user per calendar month recording the
-- total value of every card they own (personal + inventory sets).
--
-- `source` says how the month's figure was produced:
--   month_end     — taken at the close of the month by the monthly cron job
--                   (app/api/cron/collection-snapshot). The authoritative figure.
--   reconstructed — rebuilt after the fact from card_value_history marks, using
--                   the cards owned today. Used to back-fill months that were
--                   never snapshotted live.
--   live          — month-to-date figure written whenever the page is opened;
--                   replaced by month_end (or a reconstruction) once the month
--                   closes.
--
-- `card_values` keeps each card's value at the time (key -> [value, name,
-- condition, set title]) so a later month can be diffed against it to show which
-- cards moved, were added, or left the collection.

create table if not exists public.collection_value_snapshots (
  user_id       uuid not null,
  month         text not null,                 -- 'YYYY-MM'
  total_value   numeric not null default 0,
  total_cost    numeric not null default 0,
  owned_cards   int not null default 0,
  valued_cards  int not null default 0,
  coverage      numeric,                       -- reconstructed only: share of cards with a mark by month end
  by_purpose    jsonb not null default '{}'::jsonb,
  by_set        jsonb not null default '[]'::jsonb,
  top_cards     jsonb not null default '[]'::jsonb,
  card_values   jsonb not null default '{}'::jsonb,
  source        text not null default 'live',
  taken_at      timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.collection_value_snapshots enable row level security;

drop policy if exists "cvs_owner_select" on public.collection_value_snapshots;
create policy "cvs_owner_select" on public.collection_value_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists "cvs_owner_insert" on public.collection_value_snapshots;
create policy "cvs_owner_insert" on public.collection_value_snapshots
  for insert with check (auth.uid() = user_id);

drop policy if exists "cvs_owner_update" on public.collection_value_snapshots;
create policy "cvs_owner_update" on public.collection_value_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
