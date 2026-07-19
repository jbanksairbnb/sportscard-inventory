-- Card value history: an append-only log of committed market-value analyses.
--
-- Until now research lived in mutable `market_research_sessions` rows — every
-- save overwrote the session's comps, and "use this analysis" reused the same
-- session id, so editing a past analysis destroyed it. There was no price
-- history and no way to see whether a card's value is trending up or down.
--
-- This table records one IMMUTABLE snapshot each time a user commits an
-- analysis (Save research / Use value). Each row carries the full analysis
-- (comps + notes + resulting value) as `snapshot` JSONB so it can always be
-- re-opened later, a `content_hash` fingerprint for change-detection, and the
-- same card-identity tuple the research modal matches on. The series of rows
-- per card is what powers the price history view and the up/down trend badge.

create table if not exists public.card_value_history (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  -- card identity (mirrors market_research_sessions so history groups the same way)
  card_year            int,
  card_brand           text,
  card_number          text,
  card_player          text,
  card_grade           text,
  card_grading_company text,
  card_raw_grade       text,
  -- breadcrumbs back to where the value is used
  listing_id           uuid,
  set_slug             text,
  set_card_number      text,
  -- the committed analysis
  market_value         numeric not null,
  content_hash         text not null,
  snapshot             jsonb not null,
  -- provenance: the session this was seeded from (backfill only), and the prior
  -- history entry it was derived from when the user reused "this analysis".
  source_session_id    uuid,
  derived_from_id      uuid,
  created_at           timestamptz not null default now()
);

-- Self-heal deployments that predate any column.
alter table public.card_value_history add column if not exists card_year int;
alter table public.card_value_history add column if not exists card_brand text;
alter table public.card_value_history add column if not exists card_number text;
alter table public.card_value_history add column if not exists card_player text;
alter table public.card_value_history add column if not exists card_grade text;
alter table public.card_value_history add column if not exists card_grading_company text;
alter table public.card_value_history add column if not exists card_raw_grade text;
alter table public.card_value_history add column if not exists listing_id uuid;
alter table public.card_value_history add column if not exists set_slug text;
alter table public.card_value_history add column if not exists set_card_number text;
alter table public.card_value_history add column if not exists market_value numeric;
alter table public.card_value_history add column if not exists content_hash text;
alter table public.card_value_history add column if not exists snapshot jsonb;
alter table public.card_value_history add column if not exists source_session_id uuid;
alter table public.card_value_history add column if not exists derived_from_id uuid;
alter table public.card_value_history add column if not exists created_at timestamptz not null default now();

create index if not exists ix_cvh_user on public.card_value_history(user_id);
create index if not exists ix_cvh_card on public.card_value_history(user_id, card_year, card_number, card_brand);
create index if not exists ix_cvh_set  on public.card_value_history(user_id, set_slug);
-- One seed row per legacy session — makes the backfill below idempotent.
create unique index if not exists ux_cvh_source_session
  on public.card_value_history(source_session_id)
  where source_session_id is not null;

-- Self-referential provenance link (nullable; a deleted parent just detaches).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'card_value_history_derived_from_fkey') then
    alter table public.card_value_history
      add constraint card_value_history_derived_from_fkey
      foreign key (derived_from_id) references public.card_value_history(id) on delete set null;
  end if;
end $$;

alter table public.card_value_history enable row level security;

drop policy if exists "cvh_owner_select" on public.card_value_history;
create policy "cvh_owner_select" on public.card_value_history
  for select using (auth.uid() = user_id);

drop policy if exists "cvh_owner_insert" on public.card_value_history;
create policy "cvh_owner_insert" on public.card_value_history
  for insert with check (auth.uid() = user_id);

drop policy if exists "cvh_owner_update" on public.card_value_history;
create policy "cvh_owner_update" on public.card_value_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cvh_owner_delete" on public.card_value_history;
create policy "cvh_owner_delete" on public.card_value_history
  for delete using (auth.uid() = user_id);

-- ── Backfill from existing research sessions ────────────────────────────────
-- So existing users see their prior analyses as history immediately. Seed one
-- snapshot per session that has a computed value, guarded on the (out-of-band)
-- research tables actually existing and idempotent via ux_cvh_source_session.
do $$
begin
  if to_regclass('public.market_research_sessions') is not null
     and to_regclass('public.market_research_data_points') is not null then
    insert into public.card_value_history
      (user_id, card_year, card_brand, card_number, card_player,
       card_grade, card_grading_company, card_raw_grade,
       listing_id, set_slug, set_card_number,
       market_value, content_hash, snapshot, source_session_id, created_at)
    select
      s.user_id, s.card_year, s.card_brand, s.card_number, s.card_player,
      s.card_grade, s.card_grading_company, s.card_raw_grade,
      s.listing_id, s.set_slug, s.set_card_number,
      s.market_value,
      'seed:' || s.id::text,
      jsonb_build_object(
        'notes', s.notes,
        'market_value', s.market_value,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', d.position, 'source', d.source, 'source_label', d.source_label,
            'grade_company', d.grade_company, 'grade_value', d.grade_value,
            'sale_date', d.sale_date, 'price', d.price, 'weight_pct', d.weight_pct,
            'url', d.url, 'notes', d.notes
          ) order by d.position)
          from public.market_research_data_points d where d.session_id = s.id
        ), '[]'::jsonb)
      ),
      s.id,
      s.created_at
    from public.market_research_sessions s
    where s.market_value is not null
      and not exists (
        select 1 from public.card_value_history h where h.source_session_id = s.id
      );
  end if;
end $$;
