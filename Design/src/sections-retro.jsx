// Sports Collective — 70s retro sections

const { useState: useStateSR, useRef: useRefSR } = React;

function Hero({ user, avatar, cover, onAvatarChange, onCoverChange, avatarShape }) {
  const coverRef = useRefSR(null);
  function handleCoverClick() { coverRef.current?.click(); }
  function handleCoverFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onCoverChange(r.result);
    r.readAsDataURL(f);
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <div className="halftone" style={{
        position: "relative",
        height: 360,
        background: cover
          ? `url(${cover}) center/cover`
          : "linear-gradient(135deg, #3d1f4a 0%, #2a1434 40%, #1f5a50 100%)",
        borderBottom: "3px solid var(--plum)",
        overflow: "hidden",
      }}>
        {!cover && (
          <svg viewBox="0 0 1280 360" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {/* Sunburst rays from bottom center */}
            <g transform="translate(640 360)">
              {Array.from({ length: 16 }).map((_, i) => {
                const a = -Math.PI + (i / 15) * Math.PI;
                const color = i % 2 === 0 ? "rgba(229,181,61,0.25)" : "rgba(232,116,44,0.18)";
                return (
                  <polygon
                    key={i}
                    points="-40,0 40,0 0,-700"
                    fill={color}
                    transform={`rotate(${(a * 180) / Math.PI})`}
                  />
                );
              })}
            </g>
            {/* Rainbow arcs */}
            <g>
              {[
                { c: "#c54a2c", r: 220 },
                { c: "#e8742c", r: 190 },
                { c: "#e5b53d", r: 160 },
                { c: "#2d7a6e", r: 130 },
              ].map((b, i) => (
                <path key={i}
                  d={`M ${640 - b.r} 360 A ${b.r} ${b.r} 0 0 1 ${640 + b.r} 360`}
                  fill="none" stroke={b.c} strokeWidth="22" />
              ))}
            </g>
            {/* Sparkle stars */}
            {[
              [120, 60, 14], [220, 120, 8], [1100, 80, 16], [1180, 160, 10],
              [90, 200, 10], [1200, 260, 12], [1060, 220, 7],
            ].map(([x, y, s], i) => (
              <polygon key={i}
                points={`${x},${y - s} ${x + s/3},${y - s/3} ${x + s},${y} ${x + s/3},${y + s/3} ${x},${y + s} ${x - s/3},${y + s/3} ${x - s},${y} ${x - s/3},${y - s/3}`}
                fill="#e5b53d" opacity="0.8" />
            ))}
            {/* Big ghost wordmark */}
            <text x="640" y="90" textAnchor="middle" fontFamily="Pacifico, cursive" fontSize="38" fill="rgba(245,233,208,0.3)">
              Welcome to the Collective
            </text>
          </svg>
        )}

        <div style={{ position: "absolute", top: 18, right: 22, display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleCoverClick} style={{ background: "rgba(245, 233, 208, 0.95)" }}>
            <CameraIcon size={13} /> Change cover
          </button>
          <input ref={coverRef} type="file" accept="image/*" onChange={handleCoverFile} style={{ display: "none" }} />
        </div>

        <div style={{ position: "absolute", top: 18, left: 22 }}>
          <span className="chip chip-gold">
            <DiamondIcon size={10} /> Charter Member · {user.joined}
          </span>
        </div>
      </div>

      {/* Identity band */}
      <div style={{ position: "relative" }}>
        <div style={{
          maxWidth: 1280, margin: "0 auto", padding: "0 28px",
          display: "flex", alignItems: "flex-start", gap: 24,
          marginTop: -86, position: "relative",
        }}>
          <Avatar src={avatar} name={user.name} shape={avatarShape} size={172} onChange={onAvatarChange} editable />

          <div style={{ flex: 1, paddingTop: 96 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6, color: "var(--orange)" }}>★ Collector · Vienna, Virginia ★</div>
                <h1 className="display" style={{ fontSize: 62, margin: 0, color: "var(--plum)", lineHeight: 0.95 }}>
                  {user.name}
                </h1>
                <div style={{
                  display: "flex", alignItems: "center", gap: 14,
                  marginTop: 12, fontSize: 13, color: "var(--ink-soft)", fontWeight: 500,
                }}>
                  <span className="mono" style={{ fontWeight: 600 }}>@{user.handle}</span>
                  <span style={{ color: "var(--rule)" }}>●</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <PinIcon size={12} /> {user.city}
                  </span>
                  <span style={{ color: "var(--rule)" }}>●</span>
                  <span>Rooting for the <strong style={{ color: "var(--plum)" }}>{user.team}</strong></span>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <button className="btn btn-outline">
                  <TradeIcon size={13} /> Propose trade
                </button>
                <button className="btn btn-primary">
                  <PlusIcon size={13} /> Follow
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SubNav({ tabs, active, setActive }) {
  return (
    <div style={{
      maxWidth: 1280, margin: "0 auto",
      padding: "0 28px", display: "flex",
      alignItems: "center", justifyContent: "space-between",
      gap: 16, marginBottom: 28,
    }}>
      <div className="tabs">
        {tabs.map(t => (
          <button key={t} className="tab" aria-selected={active === t} onClick={() => setActive(t)}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="chip">Share profile</button>
        <button className="chip">Edit page</button>
      </div>
    </div>
  );
}

function StatsStrip({ stats }) {
  const fmt = n => n.toLocaleString();
  return (
    <section className="panel-bordered" style={{
      padding: "24px 28px", marginBottom: 28,
      display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 24,
      position: "relative",
    }}>
      <div style={{
        position: "absolute", top: -12, left: 24,
        background: "var(--orange)",
        color: "var(--cream)",
        padding: "3px 14px",
        border: "2px solid var(--plum)",
        borderRadius: 100,
        fontFamily: "var(--font-body)",
        fontSize: 10.5, fontWeight: 700,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        boxShadow: "0 2px 0 var(--plum)",
      }}>
        ★ The Record ★
      </div>
      <Stat label="Cards owned" value={fmt(stats.cards)} sub="12 binders" />
      <div style={{ borderLeft: "2px dotted var(--plum)" }} />
      <Stat label="Sets tracked" value={fmt(stats.sets)} sub="7 Topps runs" />
      <div style={{ borderLeft: "2px dotted var(--plum)" }} />
      <Stat label="Trades done" value={fmt(stats.trades)} sub="100% feedback" />
      <div style={{ borderLeft: "2px dotted var(--plum)" }} />
      <Stat label="Want list" value={fmt(stats.wantlist)} sub="chasing" />
      <div style={{ borderLeft: "2px dotted var(--plum)" }} />
      <Stat label="Est. value" value={"$" + fmt(Math.round(stats.value/1000)) + "k"} sub="book price" />
    </section>
  );
}

function FeedItem({ item }) {
  const [liked, setLiked] = useStateSR(false);
  const likes = item.likes + (liked ? 1 : 0);

  if (item.kind === "wantlist-hit") {
    return (
      <article className="panel" style={{ padding: 16, display: "flex", gap: 16 }}>
        <CardFace card={item.card} width={115} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="chip chip-rust"><DiamondIcon size={9} /> Want-list match</span>
            {item.action === "auction" && <span className="chip chip-navy">Auction · ends {item.auctionEnds}</span>}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-mute)", marginLeft: "auto", fontWeight: 600 }}>
              {item.time}
            </span>
          </div>
          <h3 className="display" style={{ fontSize: 22, margin: "4px 0 2px", color: "var(--plum)" }}>
            {item.card.year} {item.card.set} — {item.card.player}
          </h3>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8, fontWeight: 500 }}>
            {item.card.num} · {item.card.grade} · listed by <strong style={{ color: "var(--plum)" }}>@{item.user.handle}</strong>
            {item.user.verified && <span style={{ color: "var(--mustard)", marginLeft: 4 }}>✓</span>}
          </div>
          {item.note && (
            <p style={{
              margin: "8px 0", fontSize: 13.5, color: "var(--ink-soft)",
              fontStyle: "italic",
              borderLeft: "3px solid var(--mustard)",
              paddingLeft: 12,
            }}>
              "{item.note}"
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <div className="stat-num" style={{ fontSize: 26, color: "var(--orange)" }}>
              ${item.price.toLocaleString()}
            </div>
            <button className="btn btn-primary btn-sm">View listing</button>
            <button className="btn btn-outline btn-sm">Make offer</button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 14, color: "var(--ink-mute)", fontSize: 12, fontWeight: 600 }}>
              <button onClick={() => setLiked(!liked)} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                color: liked ? "var(--orange)" : "var(--ink-mute)",
              }}>
                <HeartIcon size={13} filled={liked} /> {likes}
              </button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <CommentIcon size={13} /> {item.comments}
              </span>
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === "comment") {
    return (
      <article className="panel" style={{ padding: 16, display: "flex", gap: 12 }}>
        <UserAvatar u={item.user} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong style={{ color: "var(--plum)" }}>{item.user.name}</strong>{" "}
            <span style={{ color: "var(--ink-mute)" }}>commented on {item.target}</span>
            <span style={{ float: "right", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-mute)", fontWeight: 600 }}>
              {item.time}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>"{item.body}"</p>
          <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11.5, fontWeight: 700, color: "var(--ink-mute)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <button style={{ color: "inherit" }}>Reply</button>
            <button style={{ color: "inherit" }}>Like</button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <UserAvatar u={item.user} size={38} />
        <div>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: "var(--plum)" }}>{item.user.name}</strong>
            <span style={{ color: "var(--ink-mute)" }}> · @{item.user.handle}</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-mute)", fontWeight: 600 }}>{item.time}</div>
        </div>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-soft)" }}>{item.body}</p>
      {item.photo && (
        <div className="halftone" style={{
          height: 220,
          background: "linear-gradient(135deg, #2d7a6e 0%, #3d1f4a 100%)",
          borderRadius: 8,
          border: "2px solid var(--plum)",
          display: "grid", placeItems: "center",
          fontFamily: "var(--font-display)",
          color: "rgba(245,233,208,0.35)", fontSize: 32,
        }}>
          [ photo of completed '75 mini set ]
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, color: "var(--ink-mute)", fontWeight: 600 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><HeartIcon size={13}/> {item.likes}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CommentIcon size={13}/> {item.comments}</span>
      </div>
    </article>
  );
}

function UserAvatar({ u, size = 38 }) {
  const palette = ["#3d1f4a", "#e8742c", "#2d7a6e", "#c54a2c", "#e5b53d"];
  const hash = (u.av || "A").charCodeAt(0);
  const color = palette[hash % palette.length];
  const textColor = color === "#e5b53d" ? "#3d1f4a" : "#f5e9d0";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color, color: textColor,
      display: "grid", placeItems: "center",
      fontFamily: "var(--font-display)", fontSize: size * 0.44,
      border: "2px solid var(--plum)",
      boxShadow: "0 2px 0 var(--plum)",
      flexShrink: 0,
    }}>
      {u.av}
    </div>
  );
}

function SetsSection({ sets }) {
  const setColors = ["#e8742c", "#2d7a6e", "#3d1f4a", "#e5b53d", "#c54a2c", "#2d7a6e", "#e8742c", "#3d1f4a"];
  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-head">
        <span className="eyebrow" style={{ fontSize: 12 }}>★ Sets in Progress ★</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {sets.map((s, i) => {
          const color = setColors[i % setColors.length];
          return (
            <div key={s.year} className="panel" style={{ padding: 14, display: "flex", gap: 14, alignItems: "center" }}>
              <div style={{
                width: 58, height: 58,
                background: color, color: "var(--cream)",
                display: "grid", placeItems: "center",
                fontFamily: "var(--font-display)", fontSize: 22,
                borderRadius: 10,
                border: "2px solid var(--plum)",
                boxShadow: "0 2px 0 var(--plum)",
                flexShrink: 0,
              }}>
                '{String(s.year).slice(2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 7, color: "var(--plum)" }}>
                  {s.year} {s.name}
                </div>
                <ProgressBar have={s.have} total={s.total} color={color} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FavoritesSection({ favorites }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-head">
        <span className="eyebrow" style={{ fontSize: 12 }}>★ The Showcase ★</span>
      </div>
      <div style={{
        position: "relative",
        padding: "32px 20px 24px",
        background: "var(--plum)",
        border: "2px solid var(--plum)",
        borderRadius: 16,
        boxShadow: "0 4px 0 var(--plum-deep)",
        overflow: "hidden",
      }}>
        {/* Groovy background rays */}
        <svg viewBox="0 0 800 320" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.55 }}>
          <g transform="translate(400 320)">
            {Array.from({ length: 14 }).map((_, i) => {
              const a = -Math.PI + (i / 13) * Math.PI;
              const c = i % 2 === 0 ? "#e5b53d" : "#e8742c";
              return (
                <polygon key={i} points="-42,0 42,0 0,-700" fill={c}
                  opacity="0.35"
                  transform={`rotate(${(a * 180) / Math.PI})`} />
              );
            })}
          </g>
          {/* rainbow arcs */}
          {[
            { c: "#c54a2c", r: 280 },
            { c: "#e8742c", r: 240 },
            { c: "#e5b53d", r: 200 },
            { c: "#2d7a6e", r: 160 },
          ].map((b, i) => (
            <path key={i}
              d={`M ${400 - b.r} 320 A ${b.r} ${b.r} 0 0 1 ${400 + b.r} 320`}
              fill="none" stroke={b.c} strokeWidth="14" opacity="0.7" />
          ))}
          {/* stars */}
          {[[60, 40, 8], [740, 60, 10], [120, 180, 6], [700, 200, 7]].map(([x, y, s], i) => (
            <polygon key={i}
              points={`${x},${y - s} ${x + s/3},${y - s/3} ${x + s},${y} ${x + s/3},${y + s/3} ${x},${y + s} ${x - s/3},${y + s/3} ${x - s},${y} ${x - s/3},${y - s/3}`}
              fill="#e5b53d" />
          ))}
        </svg>

        {/* Curved title */}
        <div style={{ position: "relative", textAlign: "center", marginBottom: 20 }}>
          <div className="wordmark" style={{ fontSize: 52, color: "var(--orange)", textShadow: "3px 3px 0 var(--mustard), 6px 6px 0 var(--plum-deep)" }}>
            Favorite Cards
          </div>
        </div>

        <div style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 16,
        }}>
          {favorites.map((c, i) => (
            <div key={c.id} style={{
              transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (1.2 + (i % 3) * 0.5)}deg)`,
            }}>
              <CardFace card={c} width={130} onClick={() => {}} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sidebar({ user, activity }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 20, alignSelf: "start" }}>
      <div className="panel-bordered" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>★ The Collector ★</div>

        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-soft)", fontStyle: "italic" }}>
          "{user.bio}"
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 14px", fontSize: 12.5 }}>
          <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: "center", color: "var(--orange)" }}>Home</span>
          <span style={{ fontWeight: 500 }}>{user.city}</span>

          <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: "center", color: "var(--orange)" }}>Team</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#005A9C", outline: "1.5px solid var(--plum)" }} />
            {user.team}
          </span>

          <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: "start", paddingTop: 2, color: "var(--orange)" }}>Roster</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {user.players.map(p => (
              <span key={p} className="chip" style={{ fontSize: 9.5 }}>{p}</span>
            ))}
          </div>

          <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: "center", color: "var(--orange)" }}>Chasing</span>
          <span style={{ fontWeight: 500 }}>Topps runs '53 – '80</span>
        </div>
      </div>

      <div className="panel" style={{ padding: 18 }}>
        <div className="section-head" style={{ marginBottom: 12 }}>
          <span className="eyebrow">★ Activity ★</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
          {activity.map(a => (
            <li key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.dot, marginTop: 6, flexShrink: 0, outline: "1.5px solid var(--plum)" }} />
              <span style={{ flex: 1, color: "var(--ink-soft)" }}>{a.text}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-mute)", fontWeight: 600 }}>{a.time}</span>
            </li>
          ))}
        </ul>
        <button className="btn btn-outline btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>
          View all
        </button>
      </div>

      <div style={{
        padding: 22,
        background: "var(--plum)",
        color: "var(--cream)",
        borderRadius: 16,
        position: "relative",
        border: "2px solid var(--plum)",
        boxShadow: "0 4px 0 var(--plum-deep)",
        overflow: "hidden",
      }}>
        <svg viewBox="0 0 280 200" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.3 }}>
          <g transform="translate(140 200)">
            {Array.from({ length: 10 }).map((_, i) => {
              const a = -Math.PI + (i / 9) * Math.PI;
              return <polygon key={i} points="-15,0 15,0 0,-300" fill="#e5b53d"
                transform={`rotate(${(a * 180) / Math.PI})`} />;
            })}
          </g>
        </svg>
        <div style={{ position: "relative" }}>
          <div className="eyebrow" style={{ color: "var(--mustard)", marginBottom: 10 }}>★ Open for Trade ★</div>
          <div className="display" style={{ fontSize: 30, color: "var(--orange)", marginBottom: 8, textShadow: "2px 2px 0 var(--mustard)" }}>
            47 doubles
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "rgba(245,233,208,0.85)" }}>
            Chasing '53 hi-numbers and any Koufax.
          </p>
          <button className="btn" style={{
            background: "var(--mustard)", color: "var(--plum)",
            width: "100%", justifyContent: "center", fontWeight: 700,
            border: "2px solid var(--cream)",
            boxShadow: "0 2px 0 var(--cream)",
          }}>
            See trade binder →
          </button>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { Hero, SubNav, StatsStrip, FeedItem, SetsSection, FavoritesSection, Sidebar });
