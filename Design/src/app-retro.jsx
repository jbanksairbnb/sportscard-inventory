// Sports Collective — 70s retro app shell with logo showcase

const { useState: useStateAR, useEffect: useEffectAR } = React;

function TopNav() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(248, 236, 208, 0.94)",
      backdropFilter: "blur(8px)",
      borderBottom: "3px solid var(--plum)",
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "12px 28px",
        display: "flex", alignItems: "center", gap: 28,
      }}>
        <Wordmark size={22} />

        <nav style={{ display: "flex", gap: 22, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-soft)" }}>
          <a style={{ color: "var(--plum)", borderBottom: "3px solid var(--orange)", paddingBottom: 4 }}>My Shelf</a>
          <a>Feed</a>
          <a>Discover</a>
          <a>Sets</a>
          <a>Trades</a>
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px",
            border: "2px solid var(--plum)",
            borderRadius: 100,
            background: "var(--cream)",
            width: 260,
          }}>
            <SearchIcon size={14} />
            <input placeholder="Find cards, sets, collectors…" style={{
              border: "none", outline: "none", background: "transparent",
              font: "inherit", fontSize: 12.5, flex: 1, color: "var(--plum)",
            }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--plum)", padding: "1px 5px", background: "var(--mustard)", borderRadius: 4, fontWeight: 700 }}>⌘K</span>
          </div>

          <button style={{ position: "relative", padding: 8, color: "var(--plum)" }} title="Notifications">
            <BellIcon size={18} />
            <span style={{ position: "absolute", top: 5, right: 5, width: 9, height: 9, borderRadius: "50%", background: "var(--orange)", border: "2px solid var(--cream)" }} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ——— Logo showcase block (top of page, since user asked to see the logo) ———
function LogoShowcase() {
  return (
    <section style={{
      maxWidth: 1280,
      margin: "28px auto 24px",
      padding: "24px 28px",
    }}>
      <div style={{
        position: "relative",
        background: "var(--cream)",
        border: "2px solid var(--plum)",
        borderRadius: 16,
        boxShadow: "0 4px 0 var(--plum)",
        padding: "24px 28px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 28,
        alignItems: "center",
        overflow: "hidden",
      }}>
        {/* Sunburst bg */}
        <svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.25, pointerEvents: "none" }}>
          <g transform="translate(400 100)">
            {Array.from({ length: 20 }).map((_, i) => {
              const a = (i / 20) * Math.PI * 2;
              return <polygon key={i} points="-18,0 18,0 0,-500" fill={i % 2 === 0 ? "#e5b53d" : "#e8742c"}
                transform={`rotate(${(a * 180) / Math.PI})`} />;
            })}
          </g>
        </svg>

        <div style={{ position: "relative" }}>
          <SCLogo size={150} />
        </div>

        <div style={{ position: "relative" }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: "var(--orange)" }}>★ Introducing ★</div>
          <div className="wordmark" style={{ fontSize: 60, color: "var(--orange)", lineHeight: 1, textShadow: "3px 3px 0 var(--mustard), 5px 5px 0 var(--plum)" }}>
            Sports
          </div>
          <div className="display" style={{ fontSize: 44, color: "var(--plum)", letterSpacing: "0.04em", marginTop: -4 }}>
            COLLECTIVE
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--ink-soft)", maxWidth: 460, lineHeight: 1.5, fontWeight: 500 }}>
            A home for collectors. Manage your binder, chase want lists, and swap doubles with the crew.
          </p>
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <RainbowArc width={200} height={44} />
          <div style={{ display: "flex", gap: 6 }}>
            <span className="chip chip-rust">Collect</span>
            <span className="chip chip-gold">Trade</span>
            <span className="chip chip-forest">Connect</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TweaksPanel({ visible, tweaks, setTweak }) {
  if (!visible) return null;
  const accents = [
    { key: "orange", label: "Orange", color: "#e8742c", dark: "#c55a1d" },
    { key: "plum",   label: "Plum",   color: "#3d1f4a", dark: "#2a1434" },
    { key: "teal",   label: "Teal",   color: "#2d7a6e", dark: "#1f5a50" },
    { key: "mustard",label: "Mustard",color: "#e5b53d", dark: "#c99528" },
    { key: "rust",   label: "Rust",   color: "#c54a2c", dark: "#962b0f" },
  ];
  const shapes = [
    { key: "circle",  label: "Circle" },
    { key: "card",    label: "Card" },
    { key: "hex",     label: "Hex" },
    { key: "pennant", label: "Pennant" },
  ];
  return (
    <div style={{
      position: "fixed", right: 20, bottom: 20, zIndex: 200, width: 280,
      background: "var(--cream)",
      border: "2px solid var(--plum)",
      borderRadius: 16,
      boxShadow: "0 6px 0 var(--plum), 0 20px 40px rgba(42,20,52,0.2)",
      padding: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 10, color: "var(--orange)" }}>Sports Collective</div>
          <div className="display" style={{ fontSize: 24, color: "var(--plum)" }}>Tweaks</div>
        </div>
        <SCLogo size={44} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 8 }}>Accent color</div>
        <div style={{ display: "flex", gap: 8 }}>
          {accents.map(a => (
            <button key={a.key} onClick={() => setTweak("accent", a.key)} title={a.label} style={{
              width: 32, height: 32, borderRadius: "50%",
              background: a.color,
              border: tweaks.accent === a.key ? "3px solid var(--plum)" : "2px solid var(--cream)",
              outline: tweaks.accent === a.key ? "1.5px solid var(--plum)" : "1.5px solid var(--rule)",
              outlineOffset: 2,
            }} />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 8 }}>Avatar shape</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {shapes.map(s => (
            <button key={s.key} onClick={() => setTweak("avatarShape", s.key)} style={{
              padding: "7px 4px",
              border: "2px solid var(--plum)",
              background: tweaks.avatarShape === s.key ? "var(--plum)" : "var(--paper)",
              color: tweaks.avatarShape === s.key ? "var(--mustard)" : "var(--plum)",
              fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              borderRadius: 100,
            }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span className="eyebrow" style={{ fontSize: 9.5 }}>Vintage intensity</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-mute)", fontWeight: 600 }}>{Math.round(tweaks.vintage * 100)}%</span>
        </div>
        <input type="range" min="0" max="100" step="5" value={tweaks.vintage * 100}
          onChange={e => setTweak("vintage", +e.target.value / 100)}
          style={{ width: "100%", accentColor: "var(--orange)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
          <span>MODERN</span><span>RETRO</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const data = window.CARDSTOCK_DATA;
  const [active, setActive] = useStateAR("Home");
  const [avatar, setAvatar] = useStateAR(null);
  const [cover, setCover] = useStateAR(null);
  const [tweaksVisible, setTweaksVisible] = useStateAR(false);
  const [tweaks, setTweaks] = useStateAR(() => window.TWEAK_DEFAULTS);

  function setTweak(key, value) {
    setTweaks(t => {
      const next = { ...t, [key]: value };
      try { window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, "*"); } catch(e) {}
      return next;
    });
  }

  useEffectAR(() => {
    const accents = {
      orange:  ["#e8742c", "#c55a1d"],
      plum:    ["#3d1f4a", "#2a1434"],
      teal:    ["#2d7a6e", "#1f5a50"],
      mustard: ["#e5b53d", "#c99528"],
      rust:    ["#c54a2c", "#962b0f"],
    };
    const [a, ad] = accents[tweaks.accent] || accents.orange;
    document.documentElement.style.setProperty("--accent", a);
    document.documentElement.style.setProperty("--accent-dark", ad);
    document.documentElement.style.setProperty("--vintage", tweaks.vintage);
  }, [tweaks]);

  useEffectAR(() => {
    function onMsg(e) {
      if (e.data?.type === "__activate_edit_mode") setTweaksVisible(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksVisible(false);
    }
    window.addEventListener("message", onMsg);
    try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch(e) {}
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div>
      <TopNav />
      <LogoShowcase />
      <Hero user={data.user} avatar={avatar} cover={cover}
        onAvatarChange={setAvatar} onCoverChange={setCover}
        avatarShape={tweaks.avatarShape} />
      <SubNav tabs={data.tabs} active={active} setActive={setActive} />

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px 20px" }}>
        <StatsStrip stats={data.stats} />
      </div>

      <div className="home-grid">
        <main style={{ minWidth: 0 }}>
          <SetsSection sets={data.sets} />
          <FavoritesSection favorites={data.favorites} />
          <section>
            <div className="section-head">
              <span className="eyebrow" style={{ fontSize: 12 }}>★ Your Feed ★</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <span className="chip chip-rust">All activity</span>
              <span className="chip">Want-list hits</span>
              <span className="chip">Comments</span>
              <span className="chip">Following</span>
              <span className="chip">Auctions</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.feed.map(item => <FeedItem key={item.id} item={item} />)}
            </div>
          </section>
        </main>
        <Sidebar user={data.user} activity={data.activity} />
      </div>

      <footer style={{
        maxWidth: 1280, margin: "40px auto 0", padding: "28px 28px 60px",
        borderTop: "3px solid var(--plum)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        color: "var(--plum)", fontSize: 11.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700,
      }}>
        <Wordmark size={18} />
        <div style={{ display: "flex", gap: 20 }}>
          <span>Est. 2023</span>
          <span>Keep on collectin'</span>
        </div>
      </footer>

      <TweaksPanel visible={tweaksVisible} tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
