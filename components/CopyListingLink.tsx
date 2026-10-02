'use client';

import React, { useState } from 'react';

// Copies the public, no-login page address for a listing (/l/<id>) so a
// seller can paste it into a Facebook post. Built from the current origin
// at click time so it works on any deployment/preview domain.

// Short form: the first 12 hex characters of the listing id (e.g.
// /l/3f9a1c2b7d4e). The public page also still accepts the full id, so links
// posted earlier keep working.
export function listingPublicPath(id: string): string {
  return `/l/${id.replace(/-/g, '').slice(0, 12)}`;
}

export default function CopyListingLink({
  listingId,
  className = 'btn btn-outline btn-sm',
  label = 'Copy public link',
  style,
}: {
  listingId: string;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${listingPublicPath(listingId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" onClick={copy} className={className} style={style}
      title="Copy a public link (no login needed) to paste into Facebook">
      {copied ? '✓ Link copied' : `🔗 ${label}`}
    </button>
  );
}
