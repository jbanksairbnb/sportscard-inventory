#!/usr/bin/env node
// Reclaim storage: delete objects in the `card-images` bucket that nothing in
// the database points at any more.
//
// Deleting a set row, a whole set, or a listing used to remove only the
// DATABASE record — the JPEG stayed in the bucket and kept billing. The app
// now prunes as it deletes (see lib/image-cleanup.ts), but every image
// orphaned BEFORE that change is still sitting there. This script finds them.
//
// What counts as "referenced":
//   - sets.rows[].'Image 1'/'Image 2'/'Image 3' and their '… Archived' twins
//   - listings.photos[]           (every status, 'removed' included)
//   - fb_claim_sale_lots.collage_url / back_collage_url
//   - user_profiles.avatar_url / cover_url / favorite_cards[]
// A thumbnail (`*.thumb.jpg`) is referenced whenever its original is, since
// the app derives the thumbnail URL from the original rather than storing it.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node tools/prune-orphan-images.mjs [--dry-run] [--yes] [--min-age-days=7]
//
//   --dry-run          list what would be deleted, delete nothing (default)
//   --yes              actually delete
//   --min-age-days=N   skip objects newer than N days (default 1) so an
//                      upload that's mid-flight — bytes stored, row not saved
//                      yet — is never swept up
//
// Start with a dry run and read the list before passing --yes.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'card-images';
const THUMB_SUFFIX = '.thumb.jpg';

const APPLY = process.argv.includes('--yes');
const minAgeArg = process.argv.find((a) => a.startsWith('--min-age-days='));
const MIN_AGE_DAYS = minAgeArg ? Number(minAgeArg.split('=')[1]) : 1;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}
if (!Number.isFinite(MIN_AGE_DAYS) || MIN_AGE_DAYS < 0) {
  console.error('--min-age-days must be a non-negative number.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});


// Transient failures are the norm on a large bucket. Storage keeps one folder
// per card row, so a 700-card set is 700 list calls back to back — enough to
// exhaust Supabase's database connection pool, which answers "Too many
// connections issued to the database". That means "slow down", not "broken":
// the same call succeeds moments later.
const RETRYABLE = [
  'too many connections',
  'rate limit',
  'timeout',
  'timed out',
  'fetch failed',
  'econnreset',
  'socket hang up',
  'service unavailable',
  'gateway',
  '429',
  '500',
  '502',
  '503',
  '504',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(message) {
  const m = String(message || '').toLowerCase();
  return RETRYABLE.some((needle) => m.includes(needle));
}

/**
 * Run `fn` until it succeeds, backing off 1s, 2s, 4s, 8s, 16s between tries.
 * Only transient-looking errors are retried — a bad key fails immediately.
 */
async function withRetry(label, fn, attempts = 6) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err?.message) || attempt === attempts) throw err;
      const waitMs = 1000 * 2 ** (attempt - 1);
      console.warn(`  … ${label} hit "${err.message}" — retrying in ${waitMs / 1000}s (${attempt}/${attempts - 1})`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// Pause between folder listings, in ms. Override with --delay=<ms>.
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const LIST_DELAY_MS = delayArg ? Number(delayArg.split('=')[1]) : 60;

const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const RENDER_MARKER = `/storage/v1/render/image/public/${BUCKET}/`;

const isThumb = (p) => p.split(/[?#]/)[0].endsWith(THUMB_SUFFIX);

/** The original's path for any path — a thumbnail maps back to its original. */
function originalOf(path) {
  if (!isThumb(path)) return path;
  return path.slice(0, -THUMB_SUFFIX.length);
}

/** Bucket-relative path for a stored URL, or null if it points elsewhere. */
function pathFromUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  for (const marker of [PUBLIC_MARKER, RENDER_MARKER]) {
    const idx = url.indexOf(marker);
    if (idx === -1) continue;
    const raw = url.slice(idx + marker.length).split(/[?#]/)[0];
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}

/**
 * Every path the database still points at, keyed on the ORIGINAL's path so a
 * reference to either the original or its thumbnail protects both. Stored
 * without extension-stripping beyond the thumbnail suffix.
 */
async function collectReferenced() {
  const referenced = new Set();
  const add = (url) => {
    const path = pathFromUrl(url);
    if (path) referenced.add(originalOf(path));
  };

  // Fetch in pages — a large collection is far more rows than one request
  // returns, and silently truncating here would delete live images.
  async function eachRow(table, columns, handler) {
    const PAGE = 500;
    for (let from = 0; ; from += PAGE) {
      const data = await withRetry(`read ${table}`, async () => {
        const res = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
        if (res.error) throw new Error(res.error.message);
        return res.data;
      });
      if (!data || data.length === 0) return;
      for (const row of data) handler(row);
      if (data.length < PAGE) return;
    }
  }

  const IMAGE_FIELDS = [
    'Image 1', 'Image 2', 'Image 3',
    'Image 1 Archived', 'Image 2 Archived', 'Image 3 Archived',
  ];

  await eachRow('sets', 'rows', (set) => {
    for (const row of set.rows || []) {
      if (!row) continue;
      for (const field of IMAGE_FIELDS) add(row[field]);
    }
  });
  await eachRow('listings', 'photos', (l) => {
    for (const photo of l.photos || []) add(photo);
  });
  await eachRow('user_profiles', 'avatar_url, cover_url, favorite_cards', (p) => {
    add(p.avatar_url);
    add(p.cover_url);
    if (Array.isArray(p.favorite_cards)) for (const fav of p.favorite_cards) add(fav);
  });
  // Lot collages are optional — the table may not exist on every deployment.
  try {
    await eachRow('fb_claim_sale_lots', 'collage_url, back_collage_url', (lot) => {
      add(lot.collage_url);
      add(lot.back_collage_url);
    });
  } catch (err) {
    console.warn(`  ! skipping fb_claim_sale_lots: ${err.message}`);
  }

  return referenced;
}

/** List one storage folder (paginated). Subfolders come back with no metadata. */
async function listFolder(prefix) {
  const all = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const data = await withRetry(`list ${prefix || '/'}`, async () => {
      const res = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

const cutoff = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
const orphans = [];
let keptReferenced = 0;
let keptTooNew = 0;
let bytesOrphaned = 0;

async function walk(prefix, referenced) {
  const entries = await listFolder(prefix);
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const isFile = entry.id !== null && entry.metadata;
    if (!isFile) {
      // A short pause keeps a deep bucket from opening hundreds of
      // connections a second.
      await sleep(LIST_DELAY_MS);
      // Deliberately NOT caught: a folder we failed to read looks empty, and
      // an empty folder here means "these images are orphaned". Deleting on
      // an incomplete scan is the one unrecoverable mistake this script could
      // make, so a failed listing aborts the whole run instead.
      await walk(path, referenced);
      continue;
    }

    if (referenced.has(originalOf(path))) { keptReferenced++; continue; }

    const createdAt = Date.parse(entry.created_at || entry.updated_at || '');
    if (Number.isFinite(createdAt) && createdAt > cutoff) { keptTooNew++; continue; }

    orphans.push(path);
    bytesOrphaned += Number(entry.metadata?.size || 0);
  }
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

console.log(`Reading database references…`);
const referenced = await collectReferenced();
console.log(`  ${referenced.size} distinct images referenced.`);

console.log(`Scanning "${BUCKET}"…`);
await walk('', referenced);

console.log(
  `\nreferenced=${keptReferenced} too-new(<${MIN_AGE_DAYS}d)=${keptTooNew} ` +
  `orphaned=${orphans.length} (${mb(bytesOrphaned)} MB)`,
);

if (orphans.length === 0) {
  console.log('Nothing to reclaim.');
  process.exit(0);
}

if (!APPLY) {
  for (const path of orphans.slice(0, 50)) console.log(`  would delete: ${path}`);
  if (orphans.length > 50) console.log(`  …and ${orphans.length - 50} more`);
  console.log(`\nDry run — nothing deleted. Re-run with --yes to reclaim ${mb(bytesOrphaned)} MB.`);
  process.exit(0);
}

let deleted = 0;
const CHUNK = 100;
for (let i = 0; i < orphans.length; i += CHUNK) {
  const slice = orphans.slice(i, i + CHUNK);
  const { error } = await supabase.storage.from(BUCKET).remove(slice);
  if (error) { console.warn(`  ! delete failed for ${slice.length} objects: ${error.message}`); continue; }
  deleted += slice.length;
  console.log(`  …${deleted}/${orphans.length} deleted`);
}
console.log(`\nDone. deleted=${deleted} reclaimed≈${mb(bytesOrphaned)} MB`);
