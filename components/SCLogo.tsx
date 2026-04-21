'use client';

import React, { useId } from 'react';

function Star({
  cx, cy, size = 6, fill = '#e5b53d',
}: {
  cx: number; cy: number; size?: number; fill?: string;
}) {
  const s = size;
  return (
    <polygon
      points={`${cx},${cy - s} ${cx + s / 3},${cy - s / 3} ${cx + s},${cy} ${cx + s / 3},${cy + s / 3} ${cx},${cy + s} ${cx - s / 3},${cy + s / 3} ${cx - s},${cy} ${cx - s / 3},${cy - s / 3}`}
      fill={fill}
    />
  );
}

const ROPE_DOTS = Array.from({ length: 44 }, (_, i) => {
  const a = (i / 44) * Math.PI * 2 - Math.PI / 2;
  return { cx: 100 + Math.cos(a) * 92, cy: 100 + Math.sin(a) * 92 };
});

const SUNBURST_ANGLES = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);


export default function SCLogo({ size = 80 }: { size?: number }) {
  const uid = useId();
  const arcTopId = `arc-top-${uid}`;
  const arcBotId = `arc-bot-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      style={{ display: 'block', flexShrink: 0 }}
      aria-label="Sports Collective"
    >
      <defs>
        <path id={arcTopId} d="M 25 100 A 75 75 0 0 1 175 100" fill="none" />
        <path id={arcBotId} d="M 40 118 A 62 62 0 0 0 160 118" fill="none" />
      </defs>

      <circle cx="100" cy="100" r="96" fill="#3d1f4a" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="#f5e9d0" strokeWidth="2" />

{ROPE_DOTS.map((dot, i) => (
  <circle key={i} cx={dot.cx} cy={dot.cy} r="1.8" fill="#e5b53d" />
))}

      <text fontFamily="Alfa Slab One, Cooper Black, Georgia, serif" fontSize="22" fill="#e8742c" letterSpacing="2">
        <textPath href={`#${arcTopId}`} startOffset="50%" textAnchor="middle">SPORTS</textPath>
      </text>

      <g transform="translate(100 100)">
{SUNBURST_ANGLES.map((a, i) => (
  <polygon key={i} points="-4,-22 4,-22 0,-54" fill="#e5b53d" transform={`rotate(${(a * 180) / Math.PI})`} />
))}
      </g>

      <g transform="translate(100 100) rotate(-20)">
        <rect x="-42" y="-3" width="84" height="6" rx="3" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="1.5" />
        <rect x="-42" y="-3" width="18" height="6" fill="#2d7a6e" stroke="#3d1f4a" strokeWidth="1.5" />
      </g>
      <g transform="translate(100 100) rotate(20)">
        <rect x="-42" y="-3" width="84" height="6" rx="3" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="1.5" />
        <rect x="-42" y="-3" width="18" height="6" fill="#c54a2c" stroke="#3d1f4a" strokeWidth="1.5" />
      </g>

      <g transform="translate(100 100)">
        <circle r="18" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="2" />
        <path d="M -12 -10 Q -6 0 -12 10" fill="none" stroke="#c54a2c" strokeWidth="1.5" />
        <path d="M 12 -10 Q 6 0 12 10" fill="none" stroke="#c54a2c" strokeWidth="1.5" />
        {Array.from({ length: 5 }).map((_, i) => {
          const y = -8 + i * 4;
          return (
            <g key={i}>
              <line x1="-10" y1={y} x2="-7" y2={y - 1} stroke="#c54a2c" strokeWidth="1" />
              <line x1="7" y1={y} x2="10" y2={y - 1} stroke="#c54a2c" strokeWidth="1" />
            </g>
          );
        })}
      </g>

      <path d="M 30 138 Q 100 158 170 138 L 170 158 Q 100 178 30 158 Z" fill="#3d1f4a" stroke="#e5b53d" strokeWidth="1.5" />
      <text fontFamily="Alfa Slab One, Cooper Black, Georgia, serif" fontSize="18" fill="#e8742c" letterSpacing="3" textAnchor="middle">
        <textPath href={`#${arcBotId}`} startOffset="50%">COLLECTIVE</textPath>
      </text>

      <Star cx={32}  cy={38}  size={6} fill="#e5b53d" />
      <Star cx={168} cy={38}  size={6} fill="#e5b53d" />
      <Star cx={20}  cy={100} size={4} fill="#e8742c" />
      <Star cx={180} cy={100} size={4} fill="#e8742c" />
    </svg>
  );
}
