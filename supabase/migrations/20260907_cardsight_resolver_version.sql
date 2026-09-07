-- Version the CardSight resolution cache so improving the resolver can
-- invalidate what the old one got wrong.
--
-- The first resolver passed our free-text player field straight into
-- CardSight's `name` filter, which is a substring match against their clean
-- card name. Any extra word the seller typed — a team, an "RC" — made it match
-- nothing: "Rickey Henderson - Oakland Athletics RC" returned zero rows for a
-- card that plainly exists. Those misses were then cached as `not_found`,
-- which is the whole point of the cache and also means the fix alone wouldn't
-- reach them.
--
-- Rows resolved by an older resolver are treated as cache misses and looked up
-- again on next use, so the correction rolls out lazily rather than as a
-- 33,000-card backfill. Bump CARDSIGHT_RESOLVER_VERSION in the route whenever
-- the matching logic changes materially.

alter table public.cardsight_cards
  add column if not exists resolver_version int not null default 1;

-- Successful matches are re-verified lazily like everything else, but the
-- misses are the ones we know were wrong, so clear them outright: a deleted
-- row is a clean miss, and re-resolving costs one call the next time someone
-- researches that card.
delete from public.cardsight_cards where not_found;

create index if not exists ix_cardsight_resolver_version
  on public.cardsight_cards (resolver_version);
