-- Distinguish how a value mark was produced.
--
-- card_value_history used to hold research analyses only. We now also log a
-- snapshot whenever a card's Value is set directly (typed in the table or on the
-- inventory view), so movement is tracked no matter how the value was reached.
-- `mark_kind` tells the two apart: 'research' rows carry comps in `snapshot.rows`;
-- 'manual' rows carry an empty comp list and just record the number + date.
--
-- Existing rows are all research analyses, so the default backfills them
-- correctly and the column is safe to add non-null.

alter table public.card_value_history
  add column if not exists mark_kind text not null default 'research';
