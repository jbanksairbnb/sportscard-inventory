'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// 2 rows × 3 cols multi-card image splitter.
// Lossless: each cell is extracted via canvas.drawImage with no scaling and
// exported as PNG, so the bytes for each card are bit-for-bit identical to
// the corresponding rectangle of the source image (no recompression).

export type CellRect = { left: number; top: number; right: number; bottom: number }; // fractions 0..1

export type SplitResult = {
  blobs: Blob[];          // length 6, in row-major order (positions 1..6)
  previews: string[];     // matching object URLs for thumbnails
  cellPixelRects: { x: number; y: number; w: number; h: number }[]; // length 6
};

type Bounds = {
  topMargin: number;       // 0..0.5
  rightMargin: number;
  bottomMargin: number;
  leftMargin: number;
  horizontalDivider: number;  // between topMargin and (1 - bottomMargin)
  vertical1: number;          // between leftMargin and vertical2
  vertical2: number;          // between vertical1 and (1 - rightMargin)
};

const DEFAULT_BOUNDS: Bounds = {
  topMargin: 0.02,
  rightMargin: 0.02,
  bottomMargin: 0.02,
  leftMargin: 0.02,
  horizontalDivider: 0.5,
  vertical1: 0.333,
  vertical2: 0.666,
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function cellRects(b: Bounds): CellRect[] {
  // Row-major: positions 1..6 => row 0 cols 0..2, then row 1 cols 0..2.
  const xs = [b.leftMargin, b.vertical1, b.vertical2, 1 - b.rightMargin];
  const ys = [b.topMargin, b.horizontalDivider, 1 - b.bottomMargin];
  const out: CellRect[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({ left: xs[c], top: ys[r], right: xs[c + 1], bottom: ys[r + 1] });
    }
  }
  return out;
}

export default function MultiCardSplitter({
  file,
  onSplit,
  splitting,
}: {
  file: File;
  onSplit: (result: SplitResult) => void;
  splitting?: boolean;
}) {
  const [imgUrl, setImgUrl] = useState<string>('');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  const [activeHandle, setActiveHandle] = useState<keyof Bounds | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onLoadImg() {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    // Draw to a hidden source canvas at native resolution for lossless extraction.
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(img, 0, 0);
    sourceCanvasRef.current = c;
  }

  // Drag handlers: convert pointer position into a fraction of the displayed image.
  function startDrag(handle: keyof Bounds) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveHandle(handle);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!activeHandle || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    setBounds(prev => {
      const next = { ...prev };
      switch (activeHandle) {
        case 'leftMargin':
          next.leftMargin = clamp(fx, 0, prev.vertical1 - 0.02);
          break;
        case 'rightMargin':
          next.rightMargin = clamp(1 - fx, 0, 1 - prev.vertical2 - 0.02);
          break;
        case 'topMargin':
          next.topMargin = clamp(fy, 0, prev.horizontalDivider - 0.02);
          break;
        case 'bottomMargin':
          next.bottomMargin = clamp(1 - fy, 0, 1 - prev.horizontalDivider - 0.02);
          break;
        case 'horizontalDivider':
          next.horizontalDivider = clamp(fy, prev.topMargin + 0.02, 1 - prev.bottomMargin - 0.02);
          break;
        case 'vertical1':
          next.vertical1 = clamp(fx, prev.leftMargin + 0.02, prev.vertical2 - 0.02);
          break;
        case 'vertical2':
          next.vertical2 = clamp(fx, prev.vertical1 + 0.02, 1 - prev.rightMargin - 0.02);
          break;
      }
      return next;
    });
  }
  function endDrag(e: React.PointerEvent) {
    setActiveHandle(null);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  const cells = useMemo(() => cellRects(bounds), [bounds]);

  async function doSplit() {
    if (!sourceCanvasRef.current || !natural) return;
    const src = sourceCanvasRef.current;
    const blobs: Blob[] = [];
    const previews: string[] = [];
    const cellPixelRects: SplitResult['cellPixelRects'] = [];
    for (const cell of cells) {
      const x = Math.round(cell.left * natural.w);
      const y = Math.round(cell.top * natural.h);
      const w = Math.round((cell.right - cell.left) * natural.w);
      const h = Math.round((cell.bottom - cell.top) * natural.h);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
      if (blob) {
        blobs.push(blob);
        previews.push(URL.createObjectURL(blob));
        cellPixelRects.push({ x, y, w, h });
      }
    }
    onSplit({ blobs, previews, cellPixelRects });
  }

  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'var(--orange)',
    border: '2px solid var(--plum)',
    borderRadius: 4,
    boxShadow: '0 1px 0 var(--plum)',
    cursor: 'grab',
    touchAction: 'none',
    zIndex: 10,
  };

  return (
    <div>
      {/* Image + overlay */}
      <div
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {imgUrl && (
          <img
            ref={imgRef}
            src={imgUrl}
            alt="Source"
            onLoad={onLoadImg}
            style={{ width: '100%', display: 'block', pointerEvents: 'none' }}
          />
        )}
        {natural && cells.map((cell, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${cell.left * 100}%`,
            top: `${cell.top * 100}%`,
            width: `${(cell.right - cell.left) * 100}%`,
            height: `${(cell.bottom - cell.top) * 100}%`,
            border: '2px solid var(--orange)',
            background: 'rgba(232, 116, 44, 0.08)',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}>
            <span style={{
              position: 'absolute', top: 6, left: 6,
              background: 'var(--plum)', color: 'var(--mustard)',
              padding: '2px 8px', borderRadius: 100,
              fontSize: 12, fontWeight: 700,
              fontFamily: 'var(--font-display)',
            }}>{i + 1}</span>
          </div>
        ))}

        {/* Outer edge handles */}
        {natural && (
          <>
            <div onPointerDown={startDrag('topMargin')}
              style={{ ...handleStyle, top: `calc(${bounds.topMargin * 100}% - 6px)`, left: '50%', transform: 'translateX(-50%)', width: 36, height: 12, cursor: 'ns-resize' }} />
            <div onPointerDown={startDrag('bottomMargin')}
              style={{ ...handleStyle, top: `calc(${(1 - bounds.bottomMargin) * 100}% - 6px)`, left: '50%', transform: 'translateX(-50%)', width: 36, height: 12, cursor: 'ns-resize' }} />
            <div onPointerDown={startDrag('leftMargin')}
              style={{ ...handleStyle, left: `calc(${bounds.leftMargin * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)', width: 12, height: 36, cursor: 'ew-resize' }} />
            <div onPointerDown={startDrag('rightMargin')}
              style={{ ...handleStyle, left: `calc(${(1 - bounds.rightMargin) * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)', width: 12, height: 36, cursor: 'ew-resize' }} />
            {/* Interior dividers */}
            <div onPointerDown={startDrag('horizontalDivider')}
              style={{ ...handleStyle, top: `calc(${bounds.horizontalDivider * 100}% - 6px)`, left: '50%', transform: 'translateX(-50%)', width: 48, height: 12, cursor: 'ns-resize' }} />
            <div onPointerDown={startDrag('vertical1')}
              style={{ ...handleStyle, left: `calc(${bounds.vertical1 * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)', width: 12, height: 48, cursor: 'ew-resize' }} />
            <div onPointerDown={startDrag('vertical2')}
              style={{ ...handleStyle, left: `calc(${bounds.vertical2 * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)', width: 12, height: 48, cursor: 'ew-resize' }} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setBounds(DEFAULT_BOUNDS)} className="btn btn-ghost btn-sm">↺ Reset grid</button>
        <button type="button" onClick={doSplit} disabled={!natural || splitting} className="btn btn-primary">
          {splitting ? 'Splitting…' : '✂️ Split into 6 cards →'}
        </button>
      </div>

      <p className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'center', marginTop: 8 }}>
        Drag the orange handles to align the grid with the cards. Each cell becomes one PNG at full resolution — no recompression.
      </p>
    </div>
  );
}
