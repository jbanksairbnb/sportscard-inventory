'use client';

import React from 'react';

// Shared pager for the listings + marketplace grids. Pagination is a *display*
// concern here: the parent fully filters/searches its rows, then hands us the
// total so we can render page controls and a "showing X–Y of N" readout. The
// parent slices the page itself. Defaults to 100 per page, expandable to 500.
interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({
  total,
  page,
  pageSize,
  pageSizeOptions = [100, 500],
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Nothing to page through until results exceed the smallest page size.
  if (total <= pageSizeOptions[0]) return null;

  const cur = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const end = Math.min(cur * pageSize, total);

  // Windowed page numbers: first, last, and the current page ±1, with ellipses
  // bridging any gaps so the control stays compact across hundreds of pages.
  const pages: (number | '…')[] = [];
  const window = [cur - 1, cur, cur + 1].filter(n => n >= 1 && n <= totalPages);
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  if (window[0] > 2) pages.push('…');
  window.forEach(add);
  if (window[window.length - 1] < totalPages - 1) pages.push('…');
  add(totalPages);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 10, flexWrap: 'wrap', margin: '20px 0',
    }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" disabled={cur <= 1}
          onClick={() => onPageChange(cur - 1)}
          style={{ opacity: cur <= 1 ? 0.45 : 1 }}>‹ Prev</button>
        {pages.map((p, i) => p === '…'
          ? <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--ink-mute)', fontWeight: 700 }}>…</span>
          : <button key={p} onClick={() => onPageChange(p)}
              className={`btn btn-sm ${p === cur ? 'btn-primary' : 'btn-ghost'}`}>{p}</button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={cur >= totalPages}
          onClick={() => onPageChange(cur + 1)}
          style={{ opacity: cur >= totalPages ? 0.45 : 1 }}>Next ›</button>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 6 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700, letterSpacing: '0.06em' }}>
          PER PAGE
        </span>
        {pageSizeOptions.map(s => (
          <button key={s} onClick={() => onPageSizeChange(s)}
            className={`btn btn-sm ${s === pageSize ? 'btn-primary' : 'btn-ghost'}`}>{s}</button>
        ))}
      </div>
    </div>
  );
}
