'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { thumbUrl as renderThumbUrl } from '@/lib/image-transform';
import { thumbUrlFromOriginal } from '@/lib/thumbnail';

// Self-healing thumbnail image.
//
// Replaces raw `<img src={thumbUrl(url, w)} />`. It prefers the static
// pre-generated thumbnail (a small CDN object, no per-view resizing) and
// falls back automatically on load error:
//
//   1. static sibling `.thumb.jpg`        — fast, scales to any volume
//   2. Supabase render/image transform    — for images not yet backfilled
//   3. the original full-resolution file  — last resort, always exists
//
// Because a failed load steps to the next source instead of showing the
// browser's broken-image icon, the "images break until I reload" problem
// disappears even for images that never got a static thumbnail.

type ThumbProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width'> & {
  url: string;
  /** Target display width, used only for the render-endpoint fallback. */
  width: number;
  quality?: number;
};

export default function Thumb({ url, width, quality = 70, ...imgProps }: ThumbProps) {
  const sources = useMemo(() => {
    const list: string[] = [];
    const staticThumb = thumbUrlFromOriginal(url);
    if (staticThumb) list.push(staticThumb);
    const render = renderThumbUrl(url, width, quality);
    if (render && !list.includes(render)) list.push(render);
    if (url && !list.includes(url)) list.push(url);
    return list.length ? list : [url];
  }, [url, width, quality]);

  const [tier, setTier] = useState(0);
  // Restart at the preferred source whenever the underlying image changes.
  useEffect(() => { setTier(0); }, [sources]);

  const src = sources[Math.min(tier, sources.length - 1)];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      loading="lazy"
      decoding="async"
      alt=""
      {...imgProps}
      src={src}
      onError={(e) => {
        setTier(t => (t < sources.length - 1 ? t + 1 : t));
        imgProps.onError?.(e);
      }}
    />
  );
}
