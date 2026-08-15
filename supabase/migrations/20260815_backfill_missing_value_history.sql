-- Recover research analyses that were saved but never logged as value marks.
--
-- Every write to card_value_history goes through a client insert whose failure
-- was, until now, only a console warning. So any period where the insert was
-- rejected — most plainly a deployment that hadn't yet run
-- 20260813_card_value_mark_kind.sql, which made PostgREST reject the whole row
-- over the unknown `mark_kind` column — silently produced completed analyses
-- with no price-history entry and therefore no % change against the prior mark.
--
-- The working session for each of those analyses still exists and still carries
-- its comps, so the analysis itself is recoverable: seed one history row per
-- research session whose value was never recorded for that card.
--
-- Guards, so re-running this is safe and it can't manufacture duplicates:
--   * ux_cvh_source_session already makes one-seed-per-session unique;
--   * sessions whose value is already in this card's history (committed
--     normally, where source_session_id is null) are skipped, so a healthy
--     analysis never gains a second, flat-looking mark.
-- `mark_kind` is intentionally left to its column default ('research').

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
          -- distinct on (position): concurrent autosaves could double-write a
          -- session's comps, and a doubled comp list reads back as doubled
          -- weights (200% total), which no longer totals to a valid analysis.
          select jsonb_agg(jsonb_build_object(
            'position', d.position, 'source', d.source, 'source_label', d.source_label,
            'grade_company', d.grade_company, 'grade_value', d.grade_value,
            'sale_date', d.sale_date, 'price', d.price, 'weight_pct', d.weight_pct,
            'url', d.url, 'notes', d.notes
          ) order by d.position)
          from (
            select distinct on (dp.position) dp.*
            from public.market_research_data_points dp
            where dp.session_id = s.id
            order by dp.position, dp.id
          ) d
        ), '[]'::jsonb)
      ),
      s.id,
      -- Date the mark when the analysis was last worked on, not when the draft
      -- was first opened: a resumed session's created_at predates its numbers.
      coalesce(s.updated_at, s.created_at)
    from public.market_research_sessions s
    where s.market_value is not null
      -- not already seeded from this session
      and not exists (
        select 1 from public.card_value_history h where h.source_session_id = s.id
      )
      -- and this card doesn't already carry that value as a mark (i.e. the
      -- analysis committed normally and needs no recovery)
      and not exists (
        select 1 from public.card_value_history h
        where h.user_id = s.user_id
          and h.card_year            is not distinct from s.card_year
          and h.card_number          is not distinct from s.card_number
          and h.card_brand           is not distinct from s.card_brand
          and h.card_grade           is not distinct from s.card_grade
          and h.card_grading_company is not distinct from s.card_grading_company
          and h.card_raw_grade       is not distinct from s.card_raw_grade
          and abs(h.market_value - s.market_value) < 0.005
      );
  end if;
end $$;
