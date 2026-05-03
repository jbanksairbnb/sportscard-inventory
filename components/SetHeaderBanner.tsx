'use client';

import { useEffect, useState } from 'react';

type Header = {
  id: string;
  year: number;
  brand: string;
  title: string;
  image_url: string | null;
  description: string | null;
};

export default function SetHeaderBanner({
  year, brand, title,
}: {
  year: string | number | null;
  brand: string | null;
  title: string | null;
}) {
  const [header, setHeader] = useState<Header | null>(null);

  useEffect(() => {
    if (!year || !brand || !title) return;
    const params = new URLSearchParams({
      year: String(year),
      brand: String(brand),
      title: String(title),
    });
    let cancelled = false;
    fetch(`/api/set-headers?${params.toString()}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setHeader(data?.header || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [year, brand, title]);

  if (!header || (!header.image_url && !header.description)) return null;

  return (
    <div className="panel-bordered" style={{
      padding: 0, overflow: 'hidden', background: 'var(--paper)',
      display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap',
    }}>
      {header.image_url && (
        <div style={{
          width: 280, minHeight: 180, flexShrink: 0,
          background: `var(--cream) url(${header.image_url}) center/cover no-repeat`,
          borderRight: '2px solid var(--plum)',
        }} />
      )}
      <div style={{ flex: 1, minWidth: 280, padding: '20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="eyebrow" style={{ fontSize: 10.5, color: 'var(--orange)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.18em' }}>
          ★ About this set ★
        </div>
        <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 8 }}>
          {header.title}
        </div>
        {header.description && (
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>
            {header.description}
          </p>
        )}
      </div>
    </div>
  );
}
