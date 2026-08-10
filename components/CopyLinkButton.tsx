'use client';

import React, { useState } from 'react';

// One-click "copy this page's link" button. On a server-rendered page we
// can't know the absolute URL at build time, so we read it from the browser
// at click time: origin + pathname, deliberately dropping any query string
// (e.g. ?from=…) so the copied address stays short and clean.

export default function CopyLinkButton({
  className = 'btn btn-outline btn-sm',
  label = 'Copy link',
  copiedLabel = 'Copied!',
}: {
  className?: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older browsers / non-secure contexts.
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
    <button type="button" onClick={copy} className={className}
      title="Copy a shareable link to this set">
      {copied ? `✓ ${copiedLabel}` : `🔗 ${label}`}
    </button>
  );
}
