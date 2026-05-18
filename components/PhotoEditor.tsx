'use client';

import React, { useEffect, useRef, useState } from 'react';

type Rect = { x: number; y: number; w: number; h: number };

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to load image'));
    i.src = url;
  });
}

function rotated(img: HTMLImageElement, deg: number): HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  const r = ((deg % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return c;
}

export default function PhotoEditor({
  url, onSave, onClose,
}: {
  url: string;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; startCrop: Rect | null } | null>(null);

  useEffect(() => {
    let alive = true;
    loadImg(url).then(i => { if (alive) setImg(i); }).catch(() => alive && setImg(null));
    return () => { alive = false; };
  }, [url]);

  const rotatedCanvas = img ? rotated(img, rotation) : null;
  const imgW = rotatedCanvas?.width || 0;
  const imgH = rotatedCanvas?.height || 0;

  useEffect(() => {
    if (!wrapRef.current || !imgW) return;
    const maxW = Math.min(window.innerWidth - 80, 720);
    const maxH = Math.min(window.innerHeight - 280, 600);
    const r = Math.min(maxW / imgW, maxH / imgH, 1);
    setContainerSize({ w: Math.round(imgW * r), h: Math.round(imgH * r) });
  }, [imgW, imgH]);

  const scale = imgW > 0 && containerSize.w > 0 ? containerSize.w / imgW : 1;

  function clampRect(r: Rect): Rect {
    const x = Math.max(0, Math.min(imgW - 10, r.x));
    const y = Math.max(0, Math.min(imgH - 10, r.y));
    const w = Math.max(10, Math.min(imgW - x, r.w));
    const h = Math.max(10, Math.min(imgH - y, r.h));
    return { x, y, w, h };
  }

  function clientToImg(e: React.PointerEvent): { x: number; y: number } {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!cropMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = clientToImg(e);
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as 'move' | 'nw' | 'ne' | 'sw' | 'se' | undefined;
    if (handle && crop) {
      dragRef.current = { mode: handle, startX: p.x, startY: p.y, startCrop: { ...crop } };
    } else {
      const initial: Rect = { x: p.x, y: p.y, w: 0, h: 0 };
      setCrop(initial);
      dragRef.current = { mode: 'new', startX: p.x, startY: p.y, startCrop: initial };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const p = clientToImg(e);
    const d = dragRef.current;
    const dx = p.x - d.startX, dy = p.y - d.startY;
    if (d.mode === 'new') {
      const x = Math.min(d.startX, p.x), y = Math.min(d.startY, p.y);
      setCrop(clampRect({ x, y, w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY) }));
    } else if (d.startCrop) {
      const c = d.startCrop;
      if (d.mode === 'move') setCrop(clampRect({ x: c.x + dx, y: c.y + dy, w: c.w, h: c.h }));
      else if (d.mode === 'nw') setCrop(clampRect({ x: c.x + dx, y: c.y + dy, w: c.w - dx, h: c.h - dy }));
      else if (d.mode === 'ne') setCrop(clampRect({ x: c.x, y: c.y + dy, w: c.w + dx, h: c.h - dy }));
      else if (d.mode === 'sw') setCrop(clampRect({ x: c.x + dx, y: c.y, w: c.w - dx, h: c.h + dy }));
      else if (d.mode === 'se') setCrop(clampRect({ x: c.x, y: c.y, w: c.w + dx, h: c.h + dy }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    if (crop && (crop.w < 10 || crop.h < 10)) setCrop(null);
  }

  function rotate(delta: number) {
    setRotation(r => (((r + delta) % 360) + 360) % 360);
    setCrop(null);
  }

  async function handleSave() {
    if (!rotatedCanvas) return;
    setBusy(true);
    try {
      let outCanvas: HTMLCanvasElement = rotatedCanvas;
      if (crop) {
        const c = document.createElement('canvas');
        c.width = Math.round(crop.w);
        c.height = Math.round(crop.h);
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(rotatedCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        outCanvas = c;
      }
      const blob = await new Promise<Blob | null>(res => outCanvas.toBlob(b => res(b), 'image/jpeg', 0.92));
      if (!blob) { alert('Could not generate image.'); return; }
      await onSave(blob);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const dirty = rotation !== 0 || crop !== null;
  const dataUrl = rotatedCanvas ? rotatedCanvas.toDataURL('image/jpeg', 0.85) : null;

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(42,20,52,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflow: 'auto',
      }}>
      <div onClick={e => e.stopPropagation()}
        className="panel-bordered"
        style={{ background: 'var(--cream)', padding: 20, maxWidth: 800, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>Edit Photo</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        {!img ? (
          <div className="mono" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div ref={wrapRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  position: 'relative',
                  width: containerSize.w, height: containerSize.h,
                  border: '2px solid var(--plum)', borderRadius: 6,
                  background: 'var(--paper)',
                  cursor: cropMode ? 'crosshair' : 'default',
                  touchAction: 'none', userSelect: 'none',
                }}>
                {dataUrl && (
                  <img loading="lazy" decoding="async" src={dataUrl} alt="" draggable={false}
                    style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
                )}
                {cropMode && crop && (
                  <div data-handle="move"
                    style={{
                      position: 'absolute',
                      left: crop.x * scale, top: crop.y * scale,
                      width: crop.w * scale, height: crop.h * scale,
                      border: '2px solid var(--orange)',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                      cursor: 'move',
                    }}>
                    {(['nw', 'ne', 'sw', 'se'] as const).map(h => (
                      <div key={h} data-handle={h}
                        style={{
                          position: 'absolute',
                          width: 14, height: 14,
                          background: 'var(--orange)',
                          border: '2px solid var(--cream)',
                          borderRadius: '50%',
                          top: h.startsWith('n') ? -8 : 'auto',
                          bottom: h.startsWith('s') ? -8 : 'auto',
                          left: h.endsWith('w') ? -8 : 'auto',
                          right: h.endsWith('e') ? -8 : 'auto',
                          cursor: `${h}-resize`,
                        }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
              <button type="button" onClick={() => rotate(-90)} className="btn btn-ghost btn-sm">↺ Rotate left</button>
              <button type="button" onClick={() => rotate(90)} className="btn btn-ghost btn-sm">↻ Rotate right</button>
              <button type="button" onClick={() => { setCropMode(m => !m); if (cropMode) setCrop(null); }}
                className={`btn btn-sm ${cropMode ? 'btn-primary' : 'btn-outline'}`}>
                {cropMode ? '✓ Crop active — drag to draw' : '✂ Crop'}
              </button>
              {crop && (
                <button type="button" onClick={() => setCrop(null)} className="btn btn-ghost btn-sm">Clear crop</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1.5px solid var(--rule)', paddingTop: 12 }}>
              <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
              <button type="button" onClick={handleSave} disabled={busy || !dirty} className="btn btn-primary">
                {busy ? 'Saving…' : '💾 Save photo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
