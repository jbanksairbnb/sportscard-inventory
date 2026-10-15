-- Singles & Items: bring the item fields in line with the set tables.
--
--   condition / raw_grade / grading_company / grade
--                    the Raw-or-Graded selector and the grade it carries
--   date_purchased, purchased_from, notes, tag_number, sale_price
--                    the same bookkeeping columns a set row has
--   image_1, image_2 front and back photos (card-images bucket URLs)
--   owned            false while an item is listed or after it sells, exactly
--                    like Owned = No on a set row; owned = false items drop out
--                    of collection value
--
-- Items listed or sold from the marketplace flip `owned` through the same
-- source-row link set rows use (listings.source_set_slug = 'items',
-- source_row_id = the item's id).
--
-- Safe to re-run, with one caveat: the grade lift at the bottom re-applies to any
-- row still carrying a grade in its description, so a row you have since set
-- back to Raw on purpose would be flipped to Graded again. Run it once.

alter table public.collection_items
  add column if not exists condition        text    not null default 'raw',
  add column if not exists raw_grade        text,
  add column if not exists grading_company  text,
  add column if not exists grade            text,
  add column if not exists date_purchased   date,
  add column if not exists purchased_from   text,
  add column if not exists notes            text,
  add column if not exists tag_number       text,
  add column if not exists sale_price       numeric,
  add column if not exists image_1          text,
  add column if not exists image_2          text,
  add column if not exists owned            boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collection_items_condition_check') then
    alter table public.collection_items
      add constraint collection_items_condition_check check (condition in ('raw', 'graded'));
  end if;
end $$;

-- Items entered before this existed carried their grade in the description
-- ("#50 PSA 7", "Update US175 BGS 9.5"). Lift it into the new fields so those
-- rows read as graded and keep the same price-history identity. Only rows with
-- no grading data yet are touched.
update public.collection_items i
set condition = 'graded',
    grading_company = upper(m[1]),
    grade = m[2]
from (
  select id, regexp_match(description,
    '\y(PSA|BGS|BVG|SGC|CGC|CSG|HGA|GAI)\s*-?\s*(10|[0-9](?:\.5)?)\y', 'i') as m
  from public.collection_items
  where description is not null
) x
where i.id = x.id
  and x.m is not null
  and i.grading_company is null
  and i.condition = 'raw';
