-- Collapse duplicate price-history marks and stop new ones being written.
--
-- Two different things looked like "duplicates" on a card's price history:
--
--   1. The same analysis saved twice. A double click, a retry, a second tab, or
--      a restore racing a normal save writes the identical snapshot (same
--      comps, same notes, same value) twice. That is never information — it is
--      deleted below, and the dedupe_key added here makes the database refuse
--      the copy from now on.
--
--   2. The same value in different months. That is a real observation ("the
--      market held at $X") and is KEPT in the data; the app folds consecutive
--      same-valued marks into one entry ("unchanged through …") when it
--      displays them. Nothing here touches those.
--
-- Safe to re-run.

alter table public.card_value_history
  add column if not exists mark_kind text not null default 'research';
alter table public.card_value_history
  add column if not exists dedupe_key text;

-- ── 1. Key for marks a person made ───────────────────────────────────────────
-- MUST match markDedupeKey() in lib/cardValueHistory.ts:
--   mark:<card identity>:<content_hash>:<previous mark id | none>
-- "On top of the same previous mark" is what makes a double-write a duplicate
-- while a genuine A -> B -> A sequence (the second A sits on B) is not.
create or replace function public.mark_dedupe_key(
  p_year int, p_number text, p_brand text,
  p_company text, p_grade text, p_raw_grade text,
  p_hash text, p_prev uuid
) returns text language sql immutable as $$
  select 'mark:'
    || coalesce(p_year::text, '')            || '|'
    || lower(btrim(coalesce(p_number, '')))  || '|'
    || lower(btrim(coalesce(p_brand, '')))   || '|'
    || lower(btrim(coalesce(p_company, ''))) || '|'
    || lower(btrim(coalesce(p_grade, '')))   || '|'
    || lower(btrim(coalesce(p_raw_grade, '')))
    || ':' || p_hash
    || ':' || coalesce(p_prev::text, 'none');
$$;

-- ── 2. Delete exact repeats of the immediately preceding mark ───────────────
-- A mark is a duplicate when the mark right before it, on the same card, is the
-- same kind, byte-identical (comps, notes, value) and was made the same UTC day.
-- "Immediately preceding" matters: A -> B -> A on one day is a real return to A
-- and is kept, because B sits between the two A's.
-- Of a pair, the later copy goes — except a recovery seed (source_session_id)
-- yields to the mark a person actually committed. Marks derived from a deleted
-- copy just lose their lineage link (the FK is ON DELETE SET NULL).
do $$
declare removed int;
begin
  with seq as (
    select id, mark_kind, snapshot,
           (created_at at time zone 'utc')::date as day,
           (source_session_id is not null) as seed,
           lag(id)          over w as prev_id,
           lag(mark_kind)   over w as prev_kind,
           lag(snapshot)    over w as prev_snapshot,
           lag((created_at at time zone 'utc')::date) over w as prev_day,
           lag(source_session_id is not null) over w as prev_seed
    from public.card_value_history
    window w as (
      partition by
        user_id, card_year,
        lower(btrim(coalesce(card_number, ''))),
        lower(btrim(coalesce(card_brand, ''))),
        lower(btrim(coalesce(card_grading_company, ''))),
        lower(btrim(coalesce(card_grade, ''))),
        lower(btrim(coalesce(card_raw_grade, '')))
      order by created_at, id
    )
  ),
  victims as (
    select case when not seed and prev_seed then prev_id else id end as victim
    from seq
    where prev_id is not null
      and mark_kind in ('research', 'manual')
      and mark_kind = prev_kind
      and day = prev_day
      and snapshot = prev_snapshot
  )
  delete from public.card_value_history h
  where h.id in (select victim from victims);
  get diagnostics removed = row_count;
  raise notice 'value history: removed % exact duplicate mark(s)', removed;
end $$;

-- ── 3. Backfill the key on surviving research / manual marks ─────────────────
-- Recovery seeds (content_hash 'seed:…') are already unique per session via
-- ux_cvh_source_session and are left alone. Only the first row for any key is
-- stamped, so building the unique index below cannot fail on a leftover.
with chain as (
  select id, user_id, card_year, card_number, card_brand,
         card_grading_company, card_grade, card_raw_grade, content_hash,
         lag(id) over (
           partition by
             user_id, card_year,
             lower(btrim(coalesce(card_number, ''))),
             lower(btrim(coalesce(card_brand, ''))),
             lower(btrim(coalesce(card_grading_company, ''))),
             lower(btrim(coalesce(card_grade, ''))),
             lower(btrim(coalesce(card_raw_grade, '')))
           order by created_at, id
         ) as prev_id
  from public.card_value_history
),
keyed as (
  select c.id, c.user_id,
         public.mark_dedupe_key(c.card_year, c.card_number, c.card_brand,
           c.card_grading_company, c.card_grade, c.card_raw_grade,
           c.content_hash, c.prev_id) as k
  from chain c
  join public.card_value_history h on h.id = c.id
  where h.mark_kind in ('research', 'manual')
    and h.dedupe_key is null
    and h.content_hash not like 'seed:%'
),
firsts as (
  select id, k,
         row_number() over (partition by user_id, k order by id) as rn
  from keyed
)
update public.card_value_history h
set dedupe_key = f.k
from firsts f
where h.id = f.id and f.rn = 1
  and not exists (
    select 1 from public.card_value_history o
    where o.user_id = h.user_id and o.dedupe_key = f.k and o.id <> h.id
  );

-- ── 4. The guard ─────────────────────────────────────────────────────────────
-- Same index 20260908 creates for imported marks; repeated so this migration
-- stands alone. Partial: marks without a key never collide.
create unique index if not exists ux_cvh_dedupe_key
  on public.card_value_history (user_id, dedupe_key)
  where dedupe_key is not null;
