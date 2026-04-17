// Sports Collective logo + retro-specific primitives

const { useState: useStateR, useRef: useRefR } = React;

// ——— The LOGO ———
// Circular badge: rope border, radiating sunburst, baseball, crossed bats,
// arched "SPORTS" on top, straight "COLLECTIVE" on bottom ribbon.
function SCLogo({ size = 80 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ display: "block" }}>
      <defs>
        <path id={"arc-top-" + id}
          d="M 25 100 A 75 75 0 0 1 175 100"
          fill="none" />
        <path id={"arc-bot-" + id}
          d="M 40 118 A 62 62 0 0 0 160 118"
          fill="none" />
      </defs>

      {/* Outer plum disc */}
      <circle cx="100" cy="100" r="96" fill="#3d1f4a" />
      {/* Inner cream ring */}
      <circle cx="100" cy="100" r="88" fill="none" stroke="#f5e9d0" strokeWidth="2" />
      {/* Rope / dot border */}
      {Array.from({ length: 44 }).map((_, i) => {
        const a = (i / 44) * Math.PI * 2 - Math.PI / 2;
        const r = 92;
        return (
          <circle
            key={i}
            cx={100 + Math.cos(a) * r}
            cy={100 + Math.sin(a) * r}
            r="1.8"
            fill="#e5b53d"
          />
        );
      })}

      {/* Arched SPORTS */}
      <text fontFamily="Alfa Slab One, Cooper Black, Georgia, serif" fontSize="22" fill="#e8742c" letterSpacing="2">
        <textPath href={"#arc-top-" + id} startOffset="50%" textAnchor="middle">
          SPORTS
        </textPath>
      </text>

      {/* Sunburst rays behind baseball */}
      <g transform="translate(100 100)">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <polygon
              key={i}
              points="-4,-22 4,-22 0,-54"
              fill="#e5b53d"
              transform={`rotate(${(a * 180) / Math.PI})`}
            />
          );
        })}
      </g>

      {/* Crossed bats */}
      <g transform="translate(100 100) rotate(-20)">
        <rect x="-42" y="-3" width="84" height="6" rx="3" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="1.5" />
        {/* handle */}
        <rect x="-42" y="-3" width="18" height="6" fill="#2d7a6e" stroke="#3d1f4a" strokeWidth="1.5" />
      </g>
      <g transform="translate(100 100) rotate(20)">
        <rect x="-42" y="-3" width="84" height="6" rx="3" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="1.5" />
        <rect x="-42" y="-3" width="18" height="6" fill="#c54a2c" stroke="#3d1f4a" strokeWidth="1.5" />
      </g>

      {/* Baseball */}
      <g transform="translate(100 100)">
        <circle r="18" fill="#f5e9d0" stroke="#3d1f4a" strokeWidth="2" />
        <path d="M -12 -10 Q -6 0 -12 10" fill="none" stroke="#c54a2c" strokeWidth="1.5" />
        <path d="M 12 -10 Q 6 0 12 10" fill="none" stroke="#c54a2c" strokeWidth="1.5" />
        {/* stitches */}
        {Array.from({ length: 5 }).map((_, i) => {
          const y = -8 + i * 4;
          return <g key={i}>
            <line x1="-10" y1={y} x2="-7" y2={y - 1} stroke="#c54a2c" strokeWidth="1" />
            <line x1="7" y1={y} x2="10" y2={y - 1} stroke="#c54a2c" strokeWidth="1" />
          </g>;
        })}
      </g>

      {/* Bottom ribbon */}
      <g>
        <path d="M 30 138 Q 100 158 170 138 L 170 158 Q 100 178 30 158 Z"
          fill="#3d1f4a" stroke="#e5b53d" strokeWidth="1.5" />
        <text fontFamily="Alfa Slab One, Cooper Black, Georgia, serif" fontSize="18" fill="#e8742c" letterSpacing="3" textAnchor="middle">
          <textPath href={"#arc-bot-" + id} startOffset="50%">
            COLLECTIVE
          </textPath>
        </text>
      </g>

      {/* Small sparkle stars */}
      <Star cx={32} cy={38} size={6} fill="#e5b53d" />
      <Star cx={168} cy={38} size={6} fill="#e5b53d" />
      <Star cx={20} cy={100} size={4} fill="#e8742c" />
      <Star cx={180} cy={100} size={4} fill="#e8742c" />
    </svg>
  );
}

function Star({ cx, cy, size = 6, fill = "#e5b53d" }) {
  const s = size;
  return (
    <polygon
      points={`${cx},${cy - s} ${cx + s/3},${cy - s/3} ${cx + s},${cy} ${cx + s/3},${cy + s/3} ${cx},${cy + s} ${cx - s/3},${cy + s/3} ${cx - s},${cy} ${cx - s/3},${cy - s/3}`}
      fill={fill}
    />
  );
}

// Inline wordmark for nav — badge + script text
function Wordmark({ size = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <SCLogo size={size + 20} />
      <div style={{ lineHeight: 0.95 }}>
        <div className="wordmark" style={{ fontSize: size, color: "var(--orange)" }}>Sports</div>
        <div className="display" style={{ fontSize: size * 0.6, color: "var(--plum)", letterSpacing: "0.04em" }}>COLLECTIVE</div>
      </div>
    </div>
  );
}

// Rainbow arc decoration
function RainbowArc({ width = 280, height = 60 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 280 60" style={{ display: "block" }}>
      {[
        { c: "#c54a2c", r: 54 },
        { c: "#e8742c", r: 44 },
        { c: "#e5b53d", r: 34 },
        { c: "#2d7a6e", r: 24 },
      ].map((b, i) => (
        <path
          key={i}
          d={`M ${140 - b.r} 60 A ${b.r} ${b.r} 0 0 1 ${140 + b.r} 60`}
          fill="none"
          stroke={b.c}
          strokeWidth="8"
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

// Edit avatar (same API)
function Avatar({ src, name, shape = "circle", size = 168, onChange, editable = false }) {
  const fileRef = useRefR(null);
  function handleClick() { if (editable && fileRef.current) fileRef.current.click(); }
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange && onChange(reader.result);
    reader.readAsDataURL(file);
  }
  const initials = name?.split(" ").map(s => s[0]).slice(0, 2).join("") || "?";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div className="avatar" data-shape={shape} style={{ width: size, height: size }}>
        {src ? <img src={src} alt={name} /> : (
          <div style={{
            width: "100%", height: "100%",
            display: "grid", placeItems: "center",
            background: "linear-gradient(135deg, var(--plum) 0%, var(--plum-deep) 100%)",
            color: "var(--mustard)",
            fontFamily: "var(--font-display)",
            fontSize: size * 0.38,
          }}>
            {initials}
          </div>
        )}
      </div>
      {editable && (
        <>
          <button onClick={handleClick} title="Change profile picture" style={{
            position: "absolute",
            right: shape === "hex" || shape === "pennant" ? "50%" : 4,
            bottom: shape === "pennant" ? -6 : 4,
            transform: shape === "hex" || shape === "pennant" ? "translateX(50%)" : "none",
            width: 38, height: 38, borderRadius: "50%",
            background: "var(--orange)", color: "var(--cream)",
            display: "grid", placeItems: "center",
            border: "2.5px solid var(--plum)",
            boxShadow: "0 2px 0 var(--plum)",
          }}>
            <CameraIcon size={16} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </>
      )}
    </div>
  );
}

// Retro CardFace — a card drawn with 70s palette
function CardFace({ card, width = 120, onClick }) {
  const palette = [
    ["#e8742c", "#3d1f4a"],
    ["#2d7a6e", "#e5b53d"],
    ["#c54a2c", "#f5e9d0"],
    ["#3d1f4a", "#e8742c"],
    ["#e5b53d", "#3d1f4a"],
    ["#2d7a6e", "#e8742c"],
  ];
  const seed = (card.year + card.player.length) % palette.length;
  const [c1, c2] = card.colors || palette[seed];
  const height = width * 1.4;
  const initials = card.player.replace(" RC", "").split(" ").map(s => s[0]).slice(0, 2).join("");
  return (
    <div
      onClick={onClick}
      style={{
        width, height, position: "relative",
        background: "var(--cream)",
        border: "2px solid var(--plum)",
        boxShadow: "0 3px 0 var(--plum)",
        borderRadius: 8,
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.18s, box-shadow 0.18s",
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (!onClick) return;
        e.currentTarget.style.transform = "translateY(-4px) rotate(-0.8deg)";
        e.currentTarget.style.boxShadow = "0 10px 0 var(--plum), 0 16px 24px rgba(42,20,52,0.2)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "0 3px 0 var(--plum)";
      }}
    >
      <div style={{ position: "absolute", inset: 5, border: `1.5px solid ${c1}`, borderRadius: 5 }} />
      <div className="halftone" style={{
        position: "absolute",
        top: 10, left: 10, right: 10,
        height: height * 0.6,
        background: `radial-gradient(circle at 30% 30%, ${c2} 0%, ${c1} 100%)`,
        display: "grid", placeItems: "center",
        overflow: "hidden", borderRadius: 3,
      }}>
        <span style={{
          fontFamily: "var(--font-display)",
          color: "rgba(255,255,255,0.85)",
          fontSize: width * 0.34,
          mixBlendMode: "overlay",
        }}>
          {initials}
        </span>
      </div>
      <div style={{
        position: "absolute",
        left: 10, right: 10,
        top: height * 0.6 + 14,
        background: c1,
        color: "var(--cream)",
        padding: "4px 6px",
        fontFamily: "var(--font-display)",
        fontSize: Math.max(9, width * 0.095),
        lineHeight: 1.05,
        borderRadius: 4,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        border: "1px solid var(--plum)",
      }}>
        {card.player.replace(" RC", "")}
      </div>
      <div style={{
        position: "absolute",
        left: 10, right: 10, bottom: 8,
        display: "flex", justifyContent: "space-between",
        fontFamily: "var(--font-mono)",
        fontSize: Math.max(7, width * 0.07),
        color: "var(--plum)",
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}>
        <span>{card.team}</span>
        <span>{card.num}</span>
      </div>
      <div style={{
        position: "absolute",
        top: 8, left: 12,
        fontFamily: "var(--font-display)",
        fontSize: Math.max(8, width * 0.08),
        color: "var(--plum)",
        background: "var(--mustard)",
        padding: "1px 5px",
        border: "1px solid var(--plum)",
        borderRadius: 3,
      }}>
        '{String(card.year).slice(2)}
      </div>
      {card.grade && (
        <div style={{
          position: "absolute",
          top: 8, right: 12,
          fontFamily: "var(--font-mono)",
          fontSize: Math.max(7, width * 0.06),
          color: "var(--cream)",
          background: c1,
          padding: "2px 5px",
          borderRadius: 3,
          fontWeight: 700,
        }}>
          {card.grade}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ have, total, color }) {
  const pct = Math.round((have / total) * 100);
  return (
    <div>
      <div className="progress">
        <span style={{ width: `${pct}%`, background: color || "var(--orange)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-soft)", fontWeight: 600, letterSpacing: "0.04em" }}>
        <span>{have} / {total}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ textAlign: "left" }}>
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 38 }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-mute)", marginTop: 3, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

// Icons — same shapes, same API
function CameraIcon({ size = 16 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>); }
function HeartIcon({ size = 14, filled }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>); }
function CommentIcon({ size = 14 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>); }
function TradeIcon({ size = 14 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>); }
function BellIcon({ size = 16 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>); }
function SearchIcon({ size = 16 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>); }
function PinIcon({ size = 13 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>); }
function DiamondIcon({ size = 13 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="4" width="16" height="16" transform="rotate(45 12 12)"/></svg>); }
function PlusIcon({ size = 14 }) { return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>); }

Object.assign(window, {
  SCLogo, Wordmark, RainbowArc, Star, Avatar, CardFace, ProgressBar, Stat,
  CameraIcon, HeartIcon, CommentIcon, TradeIcon, BellIcon, SearchIcon, PinIcon, DiamondIcon, PlusIcon,
});
