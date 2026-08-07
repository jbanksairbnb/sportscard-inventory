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
//     node tools/backfill-thumbnails.mjs [--dry-run]
//
// Safe to re-run: images that already have a thumbnail are skipped, so you can
// stop it any time and run it again to finish.

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

// List one folder (paginated). Supabase returns files (with metadata) and
// subfolders (metadata === null) intermixed.
async function listFolder(prefix) {
  const all = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
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
  const res = await fetch(renderUrl);
  if (!res.ok) throw new Error(`render ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const thumbPath = toThumbName(originalPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, bytes, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw new Error(`upload ${thumbPath}: ${error.message}`);
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
    await walk(prefix ? `${prefix}/${folder.name}` : folder.name);
  }
}

console.log(`Backfilling thumbnails in "${BUCKET}"${DRY_RUN ? ' (dry run)' : ''}…`);
await walk('');
console.log(
  `\nDone. generated=${generated} skipped(existing)=${skipped} failed=${failed}`,
);
