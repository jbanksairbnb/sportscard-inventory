// Shared card-image upload: writes the original AND a small static
// thumbnail beside it, so views can load the thumbnail without hitting
// Supabase's on-the-fly image transform endpoint. See lib/thumbnail.ts.
//
// The thumbnail write is best-effort: if it fails (odd format, canvas
// hiccup) the original still uploads and the <Thumb> component falls back
// to the render endpoint / original, so the image is never lost.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isThumbPath, makeThumbnailBlob, toThumbPath } from '@/lib/thumbnail';

const BUCKET = 'card-images';
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

type UploadOptions = { upsert?: boolean; contentType?: string };

/**
 * Upload `file` to `path` in the card-images bucket and, on success, upload a
 * generated thumbnail to the sibling `.thumb.jpg` path. Returns the original
 * upload's `{ error }` so callers keep their existing error handling; the
 * thumbnail result is intentionally not surfaced.
 */
export async function uploadCardImageWithThumb(
  supabase: SupabaseClient,
  path: string,
  file: Blob,
  options: UploadOptions = {},
): Promise<{ error: { message: string } | null }> {
  const uploadOpts: { upsert: boolean; contentType?: string } = { upsert: options.upsert ?? false };
  if (options.contentType) uploadOpts.contentType = options.contentType;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, uploadOpts);
  if (error) return { error };

  // Best-effort thumbnail — never blocks or fails the primary upload.
  try {
    const thumbFile = file instanceof File
      ? file
      : new File([file], 'upload.jpg', { type: (file as Blob).type || 'image/jpeg' });
    const thumb = await makeThumbnailBlob(thumbFile);
    if (thumb) {
      await supabase.storage
        .from(BUCKET)
        .upload(toThumbPath(path), thumb, { upsert: true, contentType: 'image/jpeg' });
    }
  } catch {
    // ignore — original is safely stored
  }

  return { error: null };
}


/**
 * Storage path for one set row's image.
 *
 * Every upload gets a FRESH path. Paths used to be `<user>/<slug>/<rowIndex>/img1.jpg`
 * — reused verbatim on every re-scan, and keyed by the row's position in the
 * table. Two things went wrong with that:
 *
 *   1. Inserting or removing a row shifts every later row's index, so a new
 *      upload could land on the object another card had been using — silently
 *      overwriting that card's scan.
 *   2. Overwriting an object leaves the old bytes cached at the CDN under an
 *      identical URL, so views kept showing the previous image.
 *
 * Keying on the row's stable `_id` fixes (1); the per-upload token fixes (2),
 * because a brand-new path can't have a stale cache entry. `rowKey` falls back
 * to the row index for legacy rows that predate `_id`.
 */
export function setImageStoragePath(opts: {
  userId: string;
  slug: string;
  rowKey: string;
  slot: 1 | 2;
  ext?: string;
  token?: string;
}): string {
  const ext = (opts.ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const rowKey = String(opts.rowKey).replace(/[^A-Za-z0-9._-]/g, '') || 'row';
  const token = opts.token || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${opts.userId}/${opts.slug}/${rowKey}/img${opts.slot}-${token}.${ext}`;
}

/** Stable per-row key for image paths: the row's `_id`, else its index. */
export function rowStorageKey(row: Record<string, unknown> | undefined, index: number): string {
  const id = row && typeof row['_id'] === 'string' ? row['_id'] : '';
  return id || `idx${index}`;
}

/**
 * Bucket-relative storage path for a card-images public URL, or null if the
 * URL doesn't point into this bucket (external/hosted images). The stored URL
 * is the only authoritative record of where a row's image actually lives —
 * re-deriving the path from the row's current index deletes the wrong object
 * once rows have moved.
 */
export function storagePathFromCardImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf(PUBLIC_MARKER);
  if (idx === -1) return null;
  const raw = url.slice(idx + PUBLIC_MARKER.length).split(/[?#]/)[0];
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * Delete the object behind a card-image URL along with its generated
 * thumbnail. Best-effort: a failed cleanup only leaves an orphan file, so
 * callers never block on it.
 */
export async function removeCardImageByUrl(
  supabase: SupabaseClient,
  url: string | null | undefined,
): Promise<void> {
  const path = storagePathFromCardImageUrl(url);
  if (!path) return;
  const paths = isThumbPath(path) ? [path] : [path, toThumbPath(path)];
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // ignore — an orphaned object is harmless next to losing the new image
  }
}
