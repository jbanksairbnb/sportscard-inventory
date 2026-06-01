// PostgREST (and the supabase-js client) caps any unbounded query at 1000
// rows. Inventories larger than that get silently truncated — and because our
// search/filtering runs client-side over whatever was loaded, cards beyond row
// 1000 become invisible to both the count badges and the search box.
//
// fetchAll walks the result set in 1000-row windows via `.range()` until a
// short page signals the end, returning the complete list. It stays lenient
// like the original callers (`data || []`): on error it returns whatever has
// been gathered so far rather than throwing, so a hiccup degrades to a partial
// list instead of a blank page.
const CHUNK = 1000;

type RangeQuery<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAll<T>(
  makeQuery: (from: number, to: number) => RangeQuery<T>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery(from, from + CHUNK - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}
