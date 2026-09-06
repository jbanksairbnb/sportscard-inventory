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

// Longest edge of the ORIGINAL we keep in Storage, in pixels.
//
// Phone and flatbed scans arrive at 3000–6000 px and 3–6 MB apiece. Nothing
// in the app ever displays more than a full-screen lightbox, and the AI
// grader downsamples its inputs anyway, so storing the raw capture buys no
// visible quality — it just multiplies the storage bill by ~6× for the same
// picture. 2000 px on the long edge is ~570 DPI across a 3.5" card: still
// far more detail than a lightbox or a corner/edge inspection needs, at
// roughly 400–600 KB per image.
//
// Pass `maxDim: null` to uploadCardImageWithThumb to opt a specific upload
// out (lot collages, which pack many cards into one canvas, do this).
export const ORIGINAL_MAX_DIM = 2000;
const ORIGINAL_QUALITY = 0.85;

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
  return resizeToJpeg(file, maxDim, quality);
}

/**
 * Cap the stored original's longest edge at `maxDim` px, re-encoding as JPEG.
 *
 * Returns the input untouched when it's already small enough, isn't an image,
 * or can't be decoded — so this is always safe to run in the upload path: the
 * worst case is that the full-size file uploads exactly as it did before.
 *
 * This is the single biggest lever on the Storage bill. See ORIGINAL_MAX_DIM.
 */
export async function downscaleOriginal(
  file: File,
  maxDim = ORIGINAL_MAX_DIM,
  quality = ORIGINAL_QUALITY,
): Promise<File> {
  if (!(maxDim > 0)) return file;
  // A JPEG already inside the cap has nothing to gain from a round-trip. Any
  // other format does, even at a small pixel size: the multi-card splitter
  // hands us PNG sub-cards that are a few megabytes at 1500 px, because PNG
  // is lossless and a card scan is a photograph.
  const alreadyFine = file.type === 'image/jpeg' && !(await exceedsMaxDim(file, maxDim));
  if (alreadyFine) return file;
  const blob = await resizeToJpeg(file, maxDim, quality);
  if (!blob) return file;
  // Only take the resized copy if it actually saved bytes. A tiny, heavily
  // compressed source can come back LARGER after a JPEG round-trip.
  if (blob.size >= file.size) return file;
  const stem = file.name.replace(/\.[^.]+$/, '') || 'upload';
  return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

/**
 * Shared canvas resize: decode `file`, scale so its longest edge is at most
 * `maxDim` (never upscaled), and encode as JPEG. Returns null when the
 * environment has no DOM, the file isn't an image, decoding fails, or — with
 * `skipIfSmaller` — the image is already within `maxDim`.
 */
async function resizeToJpeg(
  file: File,
  maxDim: number,
  quality: number,
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
  // JPEG has no alpha channel, and an undrawn canvas is transparent black —
  // so a source with transparency would come back with black where it was
  // see-through. Lay down white first.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  try {
    return await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', quality),
    );
  } catch {
    return null;
  }
}

/** True when the image's longest edge is over `maxDim`. False if undecodable. */
async function exceedsMaxDim(file: File, maxDim: number): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = url;
    });
    return Math.max(img.naturalWidth, img.naturalHeight) > maxDim;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}
