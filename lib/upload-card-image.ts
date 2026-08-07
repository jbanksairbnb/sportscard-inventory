// Shared card-image upload: writes the original AND a small static
// thumbnail beside it, so views can load the thumbnail without hitting
// Supabase's on-the-fly image transform endpoint. See lib/thumbnail.ts.
//
// The thumbnail write is best-effort: if it fails (odd format, canvas
// hiccup) the original still uploads and the <Thumb> component falls back
// to the render endpoint / original, so the image is never lost.

import type { SupabaseClient } from '@supabase/supabase-js';
import { makeThumbnailBlob, toThumbPath } from '@/lib/thumbnail';

const BUCKET = 'card-images';

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
