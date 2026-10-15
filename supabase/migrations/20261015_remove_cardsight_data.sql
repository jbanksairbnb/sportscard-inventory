-- OPTIONAL, DESTRUCTIVE — run only once you are sure you want CardSight's data gone.
--
-- The CardSight integration (comps pull, monthly import, collection sweep) has
-- been removed from the app. The app still READS marks it already wrote — they
-- show up in price histories with a "CardSight" tag — so nothing breaks if you
-- never run this. Running it:
--
--   * deletes every price-history mark imported from CardSight ('cardsight')
--     or written by a collection sweep ('sweep');
--   * drops CardSight's lookup tables.
--
-- It does not touch research analyses or typed values. Marks cannot be restored
-- afterwards, so take a backup (or run the SELECTs first) before applying.
--
--   select mark_kind, count(*) from public.card_value_history
--   where mark_kind in ('cardsight', 'sweep') group by 1;
--
-- Collection-value snapshots stored as 'reconstructed' were built partly from
-- these marks; they are rebuilt from what remains the next time the Collection
-- Value page opens once the rows below are cleared.

delete from public.card_value_history
where mark_kind in ('cardsight', 'sweep');

delete from public.collection_value_snapshots
where source = 'reconstructed';

drop table if exists public.cardsight_grades;
drop table if exists public.cardsight_cards;
drop function if exists public.cardsight_dedupe_key(int, text, text, text, text, text, text);
