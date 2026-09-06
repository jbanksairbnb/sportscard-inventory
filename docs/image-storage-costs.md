# Image storage: what it costs, and how it's kept from growing

Everything the app stores lives in one Supabase Storage bucket, `card-images`:
set-row scans, listing photos, lot collages, and profile avatars / covers.
This is the model for what that bucket costs as a personal collection is
photographed end to end, and what changed to keep the bill flat.

All prices below are Supabase's published rates as of September 2026 and are
per month.

## What one card costs to store

Each card is two images (front + back), and each image is stored twice: the
original, plus the small static `.thumb.jpg` the tables and grids load
(see `lib/thumbnail.ts` — this is what stops the set editor from firing
hundreds of on-the-fly resize requests per page view).

|                   | Original | Thumbnail | Per image | Per card |
| ----------------- | -------- | --------- | --------- | -------- |
| Before the change | ~3.0 MB  | ~75 KB    | ~3.1 MB   | ~6.2 MB  |
| After the change  | ~450 KB  | ~75 KB    | ~525 KB   | ~1.1 MB  |

"Before" is the raw capture: `cropScanPadding` re-encoded a phone photo or
flatbed scan at quality 0.92 and **never downscaled it**, so a 4032×3024
capture went to the bucket at full resolution. Uploads now pass through
`downscaleOriginal` (`lib/thumbnail.ts`), which caps the stored original at
`ORIGINAL_MAX_DIM` — 2000 px on the long edge, roughly 570 DPI across a 3.5"
card. That is still far more detail than the lightbox shows or the AI grader
uses (it downsamples its inputs anyway), and it is a **~6× reduction**.

The cap is opt-out: pass `maxDim: null` to `uploadCardImageWithThumb`. Lot
collages do this, because they pack a dozen cards into one canvas.

## What a full collection costs

Supabase Pro is **$25/month** and includes **100 GB** of file storage;
past that, storage is **$0.0213 per GB**. The Free plan's 1 GB ceiling is
reached at roughly 160 cards at the old sizes (~950 after the cap), so Pro is
the floor for any real collection.

| Cards   | Stored before | Stored after | Storage overage before | Storage overage after |
| ------- | ------------- | ------------ | ---------------------- | --------------------- |
| 1,000   | 6.2 GB        | 1.1 GB       | $0                     | $0                    |
| 5,000   | 31 GB         | 5.3 GB       | $0                     | $0                    |
| 10,000  | 62 GB         | 11 GB        | $0                     | $0                    |
| 25,000  | 154 GB        | 26 GB        | $1.15                  | $0                    |
| 50,000  | 308 GB        | 53 GB        | $4.42                  | $0                    |
| 100,000 | 615 GB        | 105 GB       | $10.97                 | $0.11                 |

**The headline: storage is not the thing that will hurt.** Even the
unoptimized 100,000-card case adds $11/month to a $25 plan. A typical personal
collection — call it 10,000 cards fully front-and-backed — now sits at about
11 GB, comfortably inside what Pro already includes, and the whole bill is
the flat $25.

Two things can hurt, and both are worth watching more than the per-GB rate:

### Egress

Pro includes **250 GB/month** of egress, then **$0.09/GB** (uncached) or
**$0.03/GB** (cached). Egress scales with *viewing*, not with collection size.

A 660-card set page loads 1,320 thumbnails at ~70 KB — about **92 MB per full
page view**. Hitting the 250 GB allowance takes roughly 2,700 such page loads
in a month. Private use will not get close. What could: public share links, a
seller storefront, or the marketplace being crawled. If egress ever starts
climbing, that is the number to look at, not stored GB.

### The image-transformation add-on

`Thumb` (`components/Thumb.tsx`) falls back to Supabase's `/render/image/`
endpoint for any image that has no static `.thumb.jpg` sibling. That endpoint
bills at **$5 per 1,000 origin images** when the add-on is enabled — so
20,000 originals missing their thumbnails is a $100/month line item for
pictures that could have been free static objects.

Uploads have generated thumbnails since `uploadCardImageWithThumb` landed, so
this only affects images uploaded before that. Run the backfill once and the
fallback never engages:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node tools/backfill-thumbnails.mjs --dry-run
```

## Deleting inventory now frees the storage

Deleting a row, a set, or a listing used to remove only the database record.
The JPEG stayed in the bucket and kept billing, with no way to find it again
short of hand-auditing the bucket. That is fixed in both directions:

**Going forward** — `lib/image-cleanup.ts` prunes on every delete path: rows
deleted in the set editor, a whole set deleted from My Shelf, a listing photo
removed or replaced, and single or bulk listing deletes. Thumbnails go with
their originals.

The rule it follows is *delete the database record first, then prune what that
orphaned* — because one stored object can have several referrers:

- "Duplicate rows" copies image URLs verbatim, so two rows can share an object.
- Listing a card copies the row's URL onto the listing, so a listing and a set
  row share an object — deleting the row's file would blank the live listing.
- Profile avatars, covers, and showcase slots live in the same bucket.

So `pruneCardImages` re-reads what the user still points at and removes only
what nothing references any more. Doing the read *after* the write is also
what makes it safe to run while another tab is editing.

**For what already leaked** — `tools/prune-orphan-images.mjs` walks the bucket,
builds the full reference set from the database, and reports (or deletes)
everything unreferenced. It defaults to a dry run and skips objects newer than
a day, so an upload whose row has not been saved yet is never swept up:

```bash
# See what's reclaimable
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node tools/prune-orphan-images.mjs --dry-run

# Then actually reclaim it
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node tools/prune-orphan-images.mjs --yes
```

One deliberate exception remains: **replacing** a row's image leaves the old
object in place (see the comment in `handleImageUpload`). A listing created
from that row copies the URL, so deleting on re-upload would blank the
listing's photo. Those are the orphans the script is for — re-scanning a card
a few times over its life leaves a couple of stale files behind, and a
periodic prune sweeps them up.

## Is Supabase the right place for this?

For this collection size, yes — and it is not close.

| Option                | Storage        | Egress                        | Notes                                                              |
| --------------------- | -------------- | ----------------------------- | ------------------------------------------------------------------ |
| **Supabase Storage**  | $0.0213/GB     | 250 GB included, then $0.09   | Already paid for; RLS, auth, and signed URLs come free              |
| **Cloudflare R2**     | $0.015/GB      | **$0** — no egress charges    | 10 GB free; needs its own auth story; $4.50/M writes, $0.36/M reads |
| **Backblaze B2**      | ~$0.007/GB     | Free to 3× stored, then $0.01 | Cheapest per GB; free egress through Cloudflare/Fastly              |
| **AWS S3**            | $0.023/GB      | $0.09/GB                      | Strictly worse than Supabase here                                   |
| **Cloudinary/imgix**  | Bundle pricing | Bundled                       | Pays for transformations this app doesn't need any more             |

The case for staying:

1. **Storage is not the bill.** At 10,000 cards you are inside what the $25
   plan already includes. Moving to R2 to save $0.006/GB on 11 GB saves about
   seven cents a month.
2. **The integration is doing real work.** Storage RLS ties every object to
   `auth.uid()` through the `<userId>/…` path prefix, and the buyer photo cap
   (`lib/scanQuota.ts`) counts against the same tables. A second provider means
   re-solving authorization, signed URLs, and per-user quotas.
3. **The expensive parts are already fixed in the app, not the vendor.** Static
   thumbnails killed the per-view transform cost; the size cap killed the
   per-image cost; pruning killed the pay-forever-for-deleted-cards cost. Those
   wins move with you to any provider — and without them, R2 would have been
   billing for the same 6× oversized files.

When to revisit: **stored data approaching 500 GB** (roughly 450,000 cards at
current sizes), or **egress consistently over 250 GB/month**, which would mean
the public marketplace has real traffic. Either one makes R2 worth the
migration — it is S3-compatible and charges nothing for egress, so the move
would be a bucket copy plus a URL rewrite, with `storagePathFromCardImageUrl`
already isolating the URL-parsing in one place.

## Related: the write pattern, not the storage bill

Worth knowing, since it shows up on the database side rather than storage: a
set's rows are one JSONB blob, and every autosave rewrites the entire array.
On a 660-row set that is a ~700 KB write, debounced to every 600 ms while
typing. It is well within the Pro plan's disk and IO, but it is also why two
surfaces editing the same set can overwrite each other — the reason the scan
flows now re-read the set immediately before writing rather than saving the
snapshot they loaded with.
