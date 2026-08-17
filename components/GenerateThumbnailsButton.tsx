'use client';

import React, { useState } from 'react';

// Top-bar action that generates static thumbnails for every image in the
// current set, so buyers viewing the shared set load small cached files
// instead of leaning on the on-the-fly resizer (which breaks under the burst
// of a large set). It also rebuilds thumbnails that have fallen behind their
// original — the repair for a row whose image was replaced. The work runs
// server-side in batches (see /api/generate-thumbnails); this button just
// collects the image paths, drives the batch loop, and shows progress.
// Available to any signed-in owner.

const STORAGE_MARKER = '/storage/v1/object/public/card-images/';
const THUMB_SUFFIX = '.thumb.jpg';
const BATCH = 40;

function storagePathFromUrl(url: string): string | null {
  const idx = url.indexOf(STORAGE_MARKER);
  if (idx === -1) return null;
  const path = url.slice(idx + STORAGE_MARKER.length).split(/[?#]/)[0];
  if (!path || path.endsWith(THUMB_SUFFIX)) return null;
  return path;
}

export default function GenerateThumbnailsButton({ imageUrls }: { imageUrls: string[] }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState('');

  async function run() {
    if (running) return;
    setResult('');

    // Unique original storage paths for this set's images.
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const url of imageUrls) {
      const p = storagePathFromUrl(url || '');
      if (p && !seen.has(p)) { seen.add(p); paths.push(p); }
    }
    if (paths.length === 0) { setResult('No images to process.'); return; }

    setRunning(true);
    setTotal(paths.length);
    setDone(0);
    let made = 0, skipped = 0, failed = 0;

    try {
      for (let i = 0; i < paths.length; i += BATCH) {
        const batch = paths.slice(i, i + BATCH);
        const res = await fetch('/api/generate-thumbnails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: batch }),
        });
        if (!res.ok) {
          const msg = res.status === 401 ? 'Please sign in and try again.' : `Server error (${res.status}).`;
          setResult(msg);
          setRunning(false);
          return;
        }
        const data = await res.json();
        made += data.made || 0;
        skipped += data.skipped || 0;
        failed += data.failed || 0;
        setDone(Math.min(i + batch.length, paths.length));
      }
      setResult(
        `Done — ${made} created` +
        (skipped ? `, ${skipped} already up to date` : '') +
        (failed ? `, ${failed} failed (try again)` : '') + '.'
      );
    } catch {
      setResult('Network error — try again.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={running}
        className="btn btn-sm btn-outline"
        title="Create fast-loading thumbnails so buyers don't see broken images on your shared set">
        {running ? `Generating… ${done}/${total}` : '🖼 Generate Thumbnails'}
      </button>
      {!running && result && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600, maxWidth: 220 }}>
          {result}
        </span>
      )}
    </>
  );
}
