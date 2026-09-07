-- One imported price-history mark per card, per month — enforced by the
-- database rather than by the client remembering.
--
-- Importing CardSight's monthly medians was guarded only in the browser: the
-- modal compared each candidate month against the marks it had in state and
-- skipped the ones it recognized. That guard read `mark_kind = 'cardsight'`,
-- and on a database where the mark_kind column was never added it matched
-- nothing at all — insertValueHistoryRow() retries without the column when
-- PostgREST rejects it, so every import wrote an untagged row and every later
-- import saw a clean slate. The result was a price-history chart with each bar
-- drawn twice (5/29, 5/29, 6/25, 6/25 …), which reads as market movement and
-- is nothing of the kind.
--
-- A client-side guard can't be the only guard, because the failure mode is
-- precisely the client not knowing what's already stored. So: give every
-- machine-imported mark a key naming exactly what it is — this card, this
-- month — and make the database refuse the second one.

-- ── 0. Self-heal the column this migration depends on ───────────────────────
-- Migration 20260813 adds mark_kind, and a deployment that skipped it is
-- exactly the one carrying duplicates, so this cannot assume it ran. Repeating
-- it verbatim is idempotent where it did.
alter table public.card_value_history
  add column if not exists mark_kind text not null default 'research';

alter table public.card_value_history
  add column if not exists dedupe_key text;

comment on column public.card_value_history.dedupe_key is
  'Idempotency key for machine-imported marks (cardsight:<card identity>:<YYYY-MM>). Null for marks a person made.';

-- ── 1. Recover the tag on marks that were written without it ────────────────
-- Adding mark_kind stamps every existing row 'research' — including the
-- imports, which would then look exactly like the owner's own analyses: the
-- cleanup below would skip them, no dedupe_key would be written, and the next
-- import would deposit a third copy.
--
-- So identify them by the only evidence they carry: the note text, which the
-- importer generates and a person does not type. Both generated shapes are
-- matched — 'CardSight median of N sold comps in YYYY-MM' from the first
-- version, 'CardSight YYYY-MM: …' from the current one. The pattern is
-- deliberately exact rather than a 'CardSight%' prefix, so a hand-written note
-- that happens to mention CardSight is not swept up and deduplicated.
update public.card_value_history
set mark_kind = 'cardsight'
where mark_kind <> 'cardsight'
  and snapshot->>'notes' ~ '^CardSight (median of [0-9]+ sold comps in [0-9]{4}-[0-9]{2}|[0-9]{4}-[0-9]{2}:)';

-- ── 2. The key ──────────────────────────────────────────────────────────────
-- The identity half has to match cardValueKey() in lib/cardValueHistory.ts
-- exactly, or the client would compute a key the backfilled rows don't share
-- and every existing month would import a second time.
create or replace function public.cardsight_dedupe_key(
  p_year int, p_number text, p_brand text,
  p_company text, p_grade text, p_raw_grade text,
  p_month text
) returns text language sql immutable as $$
  select 'cardsight:'
    || coalesce(p_year::text, '')            || '|'
    || lower(btrim(coalesce(p_number, '')))  || '|'
    || lower(btrim(coalesce(p_brand, '')))   || '|'
    || lower(btrim(coalesce(p_company, ''))) || '|'
    || lower(btrim(coalesce(p_grade, '')))   || '|'
    || lower(btrim(coalesce(p_raw_grade, '')))
    || ':' || p_month;
$$;

-- ── 3. Collapse the duplicates already stored ───────────────────────────────
-- Keep the oldest row for each (owner, card, month): it's the one the price
-- history and any "derived from" lineage already point at. Marks are otherwise
-- immutable, so this is the one place we rewrite them — and only to remove
-- copies that should never have existed. Marks a person made are untouched:
-- two analyses of one card in one month are two real analyses.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id, card_year, lower(btrim(coalesce(card_number, ''))),
        lower(btrim(coalesce(card_brand, ''))),
        lower(btrim(coalesce(card_grading_company, ''))),
        lower(btrim(coalesce(card_grade, ''))),
        lower(btrim(coalesce(card_raw_grade, ''))),
        to_char(created_at at time zone 'utc', 'YYYY-MM')
      order by created_at, id
    ) as rn
  from public.card_value_history
  where mark_kind = 'cardsight'
)
delete from public.card_value_history h
using ranked r
where h.id = r.id and r.rn > 1;

-- ── 4. Re-date the survivors to the close of their month ────────────────────
-- An imported mark describes a month, not a day, so it belongs at the month's
-- end — that is what makes the chart read as an evenly spaced monthly series
-- instead of labelling each point with whichever day that month's last sale
-- happened to land on. The month still in progress has no close yet, so it
-- clamps to now. The month's actual last-sale date is preserved in the
-- snapshot's comps, which is where it was always the more useful fact.
update public.card_value_history
set created_at = least(
      (date_trunc('month', created_at at time zone 'utc')
         + interval '1 month' - interval '1 day' + interval '12 hours') at time zone 'utc',
      now()
    )
where mark_kind = 'cardsight';

-- ── 5. Backfill the key and lock it in ──────────────────────────────────────
update public.card_value_history
set dedupe_key = public.cardsight_dedupe_key(
      card_year, card_number, card_brand,
      card_grading_company, card_grade, card_raw_grade,
      to_char(created_at at time zone 'utc', 'YYYY-MM')
    )
where mark_kind = 'cardsight' and dedupe_key is null;

-- Partial, so the null keys on human-made marks don't collide with each other.
create unique index if not exists ux_cvh_dedupe_key
  on public.card_value_history (user_id, dedupe_key)
  where dedupe_key is not null;
