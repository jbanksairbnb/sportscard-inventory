// Supabase Storage image transformations.
//
// Storage's `/object/public/<bucket>/<path>` endpoint serves the original
// upload (often a 2–5 MB phone photo). The `/render/image/public/<bucket>/<path>`
// endpoint accepts `width`, `height`, `quality`, `resize` query params and
// returns a CDN-cached resized variant — same auth surface, just smaller.
//
// Requires the Image Transformations add-on on the Supabase project.

export function thumbUrl(url: string | null | undefined, width: number, quality = 70): string {
  if (!url) return "";
  const idx = url.indexOf("/storage/v1/object/public/");
  if (idx === -1) return url; // not a Supabase public storage URL — leave alone
  const transformed = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const sep = transformed.includes("?") ? "&" : "?";
  return `${transformed}${sep}width=${width}&quality=${quality}&resize=contain`;
}
