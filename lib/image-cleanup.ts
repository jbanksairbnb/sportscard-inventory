// Storage garbage collection for card images.
//
// Deleting a row, or a whole set, used to remove only the DATABASE record —
// the JPEG it pointed at stayed in the `card-images` bucket forever. Every
// deleted card therefore kept billing storage, and there was no way to get
// that space back short of hand-auditing the bucket.
//
// Deleting eagerly isn't safe either, because a single stored object can be
// referenced from more than one place:
//
//   - "Duplicate rows" copies the row verbatim, image URLs included, so two
//     set rows can share one object.
//   - Listing a card copies the row's image URL onto the listing
//     (`image_front` / `photos[]`), so the listing and the set row share one
//     object. Deleting the row's file would blank the live listing's photo.
//   - Profile avatar / cover / favorite-card slots live in the same bucket.
//
// So the flow is always: write the deletion to the database FIRST, then call
// pruneCardImages with the URLs that deletion orphaned. It re-reads what the
// user still references and removes only the objects nothing points at any
// more. Doing the read after the write is what makes it safe to run
// concurrently with other edits — a URL that got re-referenced in the
// meantime is simply still referenced, and survives.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isThumbPath, toThumbPath } from '@/lib/thumbnail';
import { removeCardImagesByUrls, storagePathFromCardImageUrl } from '@/lib/upload-card-image';

/** Row fields that can hold a card-image URL. */
const ROW_IMAGE_FIELDS = [
  'Image 1',
  'Image 2',
  'Image 3',
  'Image 1 Archived',
  'Image 2 Archived',
  'Image 3 Archived',
] as const;

/** Every card-image URL referenced by the given set rows. */
export function collectRowImageUrls(rows: Array<Record<string, unknown>> | null | undefined): string[] {
  const urls: string[] = [];
  for (const row of rows || []) {
    if (!row) continue;
    for (const field of ROW_IMAGE_FIELDS) {
      const url = String(row[field] ?? '').trim();
      if (url) urls.push(url);
    }
  }
  return urls;
}

/** Bucket-relative paths for a batch of URLs, thumbnails folded in. */
function pathsOf(urls: Iterable<string | null | undefined>): Set<string> {
  const paths = new Set<string>();
  for (const url of urls) {
    const path = storagePathFromCardImageUrl(url);
    if (!path) continue;
    // Compare on the ORIGINAL's path so a reference to the original also
    // protects its thumbnail (and vice versa).
    paths.add(isThumbPath(path) ? path : toThumbPath(path));
    paths.add(path);
  }
  return paths;
}

/**
 * Remove the objects behind `candidateUrls` that the user no longer
 * references anywhere. Call this AFTER the database deletion has been
 * committed.
 *
 * Returns the number of storage paths removed (originals + thumbnails), or 0
 * when everything was still in use. Never throws: a failed prune leaves an
 * orphan, which is strictly better than failing the user's delete.
 */
export async function pruneCardImages(
  supabase: SupabaseClient,
  userId: string,
  candidateUrls: Iterable<string | null | undefined>,
): Promise<number> {
  const candidates = pathsOf(candidateUrls);
  if (candidates.size === 0 || !userId) return 0;

  try {
    const referenced = await collectReferencedPaths(supabase, userId);
    const orphanUrls: string[] = [];
    for (const url of candidateUrls) {
      const path = storagePathFromCardImageUrl(url);
      if (!path) continue;
      const key = isThumbPath(path) ? path : toThumbPath(path);
      if (referenced.has(path) || referenced.has(key)) continue;
      orphanUrls.push(String(url));
    }
    if (orphanUrls.length === 0) return 0;
    return await removeCardImagesByUrls(supabase, orphanUrls);
  } catch {
    return 0;
  }
}

/**
 * Every card-image path this user still points at: set rows (including the
 * archived-image slots a "Not Owned" card keeps), listing photos, and the
 * profile avatar / cover / favorite-card slots.
 *
 * Listings of EVERY status are scanned, `removed` included — a soft-deleted
 * listing is kept precisely so its sales history still renders its photos.
 */
async function collectReferencedPaths(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const urls: string[] = [];

  const { data: sets } = await supabase.from('sets').select('rows').eq('user_id', userId);
  for (const set of (sets || []) as Array<{ rows: Array<Record<string, unknown>> | null }>) {
    urls.push(...collectRowImageUrls(set.rows));
  }

  const { data: listings } = await supabase.from('listings').select('photos').eq('user_id', userId);
  for (const listing of (listings || []) as Array<{ photos: string[] | null }>) {
    for (const photo of listing.photos || []) if (photo) urls.push(photo);
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('avatar_url, cover_url, favorite_cards')
    .eq('user_id', userId)
    .maybeSingle();
  if (profile) {
    const p = profile as { avatar_url?: string | null; cover_url?: string | null; favorite_cards?: unknown };
    if (p.avatar_url) urls.push(p.avatar_url);
    if (p.cover_url) urls.push(p.cover_url);
    if (Array.isArray(p.favorite_cards)) {
      for (const fav of p.favorite_cards) if (typeof fav === 'string' && fav) urls.push(fav);
    }
  }

  return pathsOf(urls);
}
