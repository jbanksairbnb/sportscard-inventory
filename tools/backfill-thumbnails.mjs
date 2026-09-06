#!/usr/bin/env node
// One-time backfill: generate a static `.thumb.jpg` for every existing image
// in the `card-images` bucket that doesn't already have one.
//
// New uploads generate their thumbnail automatically (see
// lib/upload-card-image.ts). This script covers images uploaded BEFORE that
// change so they also load as fast static objects instead of leaning on the
// on-the-fly render/image transform endpoint.
//
// It reuses the render endpoint exactly once per image — fetching a resized
// copy and storing those bytes as the permanent `.thumb.jpg` sibling — so no
// image library is needed.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node tools/backfill-thumbnails.mjs [--dry-run] [--delay=<ms>]
//
//   --dry-run     list what would be generated, write nothing
//   --delay=<ms>  pause between folder listings (default 60). Raise it if the
//                 project still reports "Too many connections issued to the
//                 database"; lower it to 0 on a small bucket.
//
// Safe to re-run: images that already have a thumbnail are skipped, so you can
// stop it any time and run it again to finish. Transient errors are retried
// with backoff, and a folder that stays unreadable is reported and skipped
// rather than discarding the whole run.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'card-images';
const THUMB_SUFFIX = '.thumb.jpg';
const THUMB_WIDTH = 700;
const THUMB_QUALITY = 72;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const isThumb = (name) => name.endsWith(THUMB_SUFFIX);
const toThumbName = (name) => {
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? name : name.slice(0, dot)) + THUMB_SUFFIX;
};

let generated = 0;
let skipped = 0;
let failed = 0;
let failedFolders = 0;

// Pause between folder listings, in ms. Override with --delay=<ms> if the
// project still trips its connection limit (or drop it to 0 on a small one).
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const LIST_DELAY_MS = delayArg ? Number(delayArg.split('=')[1]) : 60;

// Transient failures are the norm on a large bucket, not the exception.
// Storage keeps one folder per card row, so a 700-card set is 700 list calls
// back to back — enough to exhaust Supabase's database connection pool. The
// server answers "Too many connections issued to the database", which is a
// "slow down", not "this is broken": the same call succeeds moments later.
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
 * Only retries errors that look transient — a genuine 404 or a bad key fails
 * immediately rather than burning a minute proving it.
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

// List one folder (paginated). Supabase returns files (with metadata) and
// subfolders (metadata === null) intermixed.
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

async function makeThumb(originalPath) {
  const renderUrl =
    `${SUPABASE_URL}/storage/v1/render/image/public/${BUCKET}/` +
    `${originalPath.split('/').map(encodeURIComponent).join('/')}` +
    `?width=${THUMB_WIDTH}&quality=${THUMB_QUALITY}&resize=contain`;
  const bytes = await withRetry(`render ${originalPath}`, async () => {
    const res = await fetch(renderUrl);
    if (!res.ok) throw new Error(`render ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  const thumbPath = toThumbName(originalPath);
  await withRetry(`upload ${thumbPath}`, async () => {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath, bytes, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw new Error(error.message);
  });
}

async function walk(prefix) {
  const entries = await listFolder(prefix);
  const files = entries.filter((e) => e.id !== null && e.metadata);
  const folders = entries.filter((e) => e.id === null || !e.metadata);

  const names = new Set(files.map((f) => f.name));
  for (const f of files) {
    if (isThumb(f.name)) continue;
    if (names.has(toThumbName(f.name))) { skipped++; continue; }
    const path = prefix ? `${prefix}/${f.name}` : f.name;
    if (DRY_RUN) { console.log(`would generate: ${toThumbName(path)}`); generated++; continue; }
    try {
      await makeThumb(path);
      generated++;
      if (generated % 50 === 0) console.log(`  …${generated} thumbnails generated`);
    } catch (err) {
      failed++;
      console.warn(`  ! failed ${path}: ${err.message}`);
    }
  }

  for (const folder of folders) {
    if (isThumb(folder.name)) continue;
    // A short pause between folders keeps a deep bucket from opening
    // hundreds of connections a second. It costs a couple of minutes on a
    // large collection and is the difference between finishing and aborting.
    await sleep(LIST_DELAY_MS);
    try {
      await walk(prefix ? `${prefix}/${folder.name}` : folder.name);
    } catch (err) {
      // One unreachable folder shouldn't discard an hour of completed work.
      // Generated thumbnails are already durable, and the run is re-runnable,
      // so note it and keep going.
      failedFolders++;
      console.warn(`  ! skipped folder ${prefix ? `${prefix}/${folder.name}` : folder.name}: ${err.message}`);
    }
  }
}

console.log(`Backfilling thumbnails in "${BUCKET}"${DRY_RUN ? ' (dry run)' : ''}…`);
await walk('');
console.log(
  `\nDone. generated=${generated} skipped(existing)=${skipped} failed=${failed}` +
  (failedFolders ? ` unreadable-folders=${failedFolders}` : ''),
);
if (failedFolders || failed) {
  console.log('Re-run to retry what failed — finished thumbnails are skipped.');
}
