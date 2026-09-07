-- cardsight_cards: our card identity → CardSight AI's card UUID.
--
-- CardSight prices by their own card id, so every comp lookup would otherwise
-- start with a catalog resolution call. Resolution is the expensive half of
-- the integration — one request per distinct card, against a free tier of 750
-- calls/month and 4 requests per window — while the pricing half is cheap and
-- bulk-able. Caching the id turns a per-research resolution into a one-time
-- cost per card in the catalog.
--
-- The table is deliberately GLOBAL, not per-user: "1980 Topps #482 Rickey
-- Henderson" maps to the same CardSight card for every collector on the site,
-- so the first person to research it pays the call and everyone benefits.
-- That also means no user data lives here — it's a public lookup table — so
-- reads are open to any authenticated user and writes go through the service
-- role from the API route.
--
-- A miss is a result worth caching too. CardSight's pre-war coverage has real
-- holes (1940 Play Ball is absent entirely, and baseball releases jump from
-- 1939 to 1941), so `not_found` rows stop us re-spending a call on a card we
-- already know isn't there. `checked_at` lets a future backfill retry the
-- misses after their catalog grows.

create table if not exists public.cardsight_cards (
  id                uuid primary key default gen_random_uuid(),
  -- identity tuple, normalized (lowercased/trimmed) by the caller so the
  -- unique index actually collapses "Topps" and "topps ".
  card_year         int not null,
  card_brand        text not null default '',
  card_number       text not null,
  card_player       text not null,
  -- resolution result
  cardsight_card_id text,           -- null when not_found
  not_found         boolean not null default false,
  -- what CardSight thinks this card is, kept for display and for spotting a
  -- bad match ("we asked for 1986 Fleer and got a 2006 reprint").
  matched_release   text,
  matched_set       text,
  matched_year      text,
  matched_name      text,
  checked_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- Self-heal deployments that predate any column.
alter table public.cardsight_cards add column if not exists cardsight_card_id text;
alter table public.cardsight_cards add column if not exists not_found boolean not null default false;
alter table public.cardsight_cards add column if not exists matched_release text;
alter table public.cardsight_cards add column if not exists matched_set text;
alter table public.cardsight_cards add column if not exists matched_year text;
alter table public.cardsight_cards add column if not exists matched_name text;
alter table public.cardsight_cards add column if not exists checked_at timestamptz not null default now();

-- One row per identity tuple — this is the cache key.
create unique index if not exists ux_cardsight_identity
  on public.cardsight_cards(card_year, card_brand, card_number, card_player);

-- Lets a backfill sweep the misses once their catalog grows.
create index if not exists ix_cardsight_not_found
  on public.cardsight_cards(checked_at)
  where not_found;

-- cardsight_grades: grader + grade → CardSight's grade UUID.
--
-- The pricing endpoint filters by grade_id, and filtering matters for more
-- than tidiness: the 500-row response cap is shared across every bucket, so
-- an unfiltered lookup on a busy card starves the one grade we care about.
-- Asking for the grade by id spends the whole budget on it.
--
-- Tiny and effectively static (a grading company adds a tier about never), so
-- we mirror the whole table once and read it locally forever after.
create table if not exists public.cardsight_grades (
  id             uuid primary key default gen_random_uuid(),
  company        text not null,          -- 'PSA', 'SGC', 'BGS', ...
  grade          text not null,          -- '8.5', '10', 'Authentic'
  condition      text,                   -- 'NM-MT', 'Gem Mint', 'Pristine'
  cardsight_grade_id text not null,
  created_at     timestamptz not null default now()
);

-- Grade value is not unique within a company — SGC numbers both "Pristine"
-- and "Gem Mint" as 10 — so the condition is part of the key.
create unique index if not exists ux_cardsight_grade
  on public.cardsight_grades(company, grade, coalesce(condition, ''));

alter table public.cardsight_grades enable row level security;

drop policy if exists "cardsight_grades_read" on public.cardsight_grades;
create policy "cardsight_grades_read" on public.cardsight_grades
  for select using (auth.role() = 'authenticated');

alter table public.cardsight_cards enable row level security;

-- Public lookup data: any signed-in user may read it. Writes are service-role
-- only (the API route resolves and upserts), so no insert/update policy here.
drop policy if exists "cardsight_read" on public.cardsight_cards;
create policy "cardsight_read" on public.cardsight_cards
  for select using (auth.role() = 'authenticated');
