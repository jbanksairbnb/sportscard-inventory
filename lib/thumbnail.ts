// Static pre-generated thumbnails.
//
// Historically every thumbnail in the app was produced on the fly by
// Supabase Storage's `/render/image/` transformation endpoint (see
// lib/image-transform.ts). That endpoint resizes the original 2–5 MB
// upload per request, and when a page renders hundreds of thumbnails at
// once (e.g. the set editor, 600+ rows × 2 images) the cold-cache burst
// rate-limits the endpoint and images come back broken.
//
// The durable fix is to resize ONCE, at upload time, and store a small
// JPEG next to the original. The table then loads static CDN objects with
// no per-view resizing, which scales to any number of images.
//
// Convention: the thumbnail lives beside its original with the final
// extension swapped for `.thumb.jpg`:
//
//   <userId>/<slug>/<rowId>/img1-<token>.jpg
//     ->  <userId>/<slug>/<rowId>/img1-<token>.thumb.jpg
//
// so the thumbnail's storage path (and public URL) can be derived from the
// original by pure string manipulation — no second field to persist. The
// per-upload token in the originals (see lib/upload-card-image.ts) means a
// thumbnail path is never reused either.

const THUMB_SUFFIX = '.thumb.jpg';

// Longest edge of the generated thumbnail, in pixels. The largest on-screen
// use is a ~500px marketplace card, so 700 keeps every current display
// crisp (roughly 1.4×–4× the CSS size) while staying tiny on disk. The
// full-resolution original is still used for lightboxes / zoom.
export const THUMB_MAX_DIM = 700;
const THUMB_QUALITY = 0.72;

/** True for a storage path/URL that already points at a generated thumbnail. */
export function isThumbPath(pathOrUrl: string): boolean {
  return pathOrUrl.split(/[?#]/)[0].endsWith(THUMB_SUFFIX);
}

/**
 * Swap a file's final extension for `.thumb.jpg`. Operates on either a bare
 * storage path (`a/b/img1.png`) or the path portion of a URL. If the last
 * segment has no extension the suffix is appended.
 */
export function toThumbPath(path: string): string {
  if (isThumbPath(path)) return path;
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1);
  const name = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  return `${dir}${stem}${THUMB_SUFFIX}`;
}

/**
 * Given a public storage URL for an original image, return the public URL of
 * its sibling thumbnail. Returns null when the input isn't a Supabase public
 * storage URL (so callers can fall back to the original).
 *
 * The query string is deliberately PRESERVED. Row image URLs carry a
 * `?t=<upload time>` cache-buster, and both the browser cache and the storage
 * CDN key on the full URL including that query. Dropping it here meant the
 * original was re-fetched after an upload while the thumbnail was served from
 * cache — so a re-scanned card showed the previous image's thumbnail in the
 * table while the lightbox showed the new scan. Carrying the buster across
 * keeps the two views in step.
 */
export function thumbUrlFromOriginal(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const [base, query = ''] = splitQuery(url);
  if (isThumbPath(base)) return url; // already a thumbnail URL
  return `${toThumbPath(base)}${query}`;
}

/** Split a URL into its path portion and its `?…`/`#…` remainder. */
function splitQuery(url: string): [string, string] {
  const cut = url.search(/[?#]/);
  return cut === -1 ? [url, ''] : [url.slice(0, cut), url.slice(cut)];
}

/**
 * Downscale an image File to a JPEG thumbnail whose longest edge is at most
 * `maxDim` px (never upscaled). Returns null if the browser can't decode the
 * file or the canvas can't produce a blob — callers treat a null thumbnail as
 * "skip, the original still works via fallback".
 *
 * Client-side only (uses the DOM canvas), mirroring lib/scanAutoCrop.ts.
 */
export async function makeThumbnailBlob(
  file: File,
  maxDim = THUMB_MAX_DIM,
  quality = THUMB_QUALITY,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  if (!file.type.startsWith('image/')) return null;

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  URL.revokeObjectURL(url);
  if (!w || !h) return null;

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, outW, outH);

  try {
    return await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', quality),
    );
  } catch {
    return null;
  }
}
