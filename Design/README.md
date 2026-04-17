# Handoff: Sports Collective — Collector Homepage

## Overview
Sports Collective is a social network for sportscard collectors. This handoff covers the **authenticated user's homepage/profile** — a single page that combines dashboard (the user's own view) and public profile (what others see), switched by a tab bar. It includes identity (avatar, cover, bio), a collector record strip, sets in progress, a favorite-cards showcase, a personalized activity feed with want-list matches and comments, and a trade call-out.

## About the Design Files
The files in this bundle are **design references created in HTML + React (via Babel)** — prototypes showing intended look, behavior, and layout. They are **not production code to ship directly**. Your task is to **recreate these designs in the Sports Collective codebase** using the app's established framework, component library, design tokens, and patterns. If no environment exists yet, choose an appropriate stack (React + Vite/Next, etc.) and implement there. Typography, spacing, and colors should come from the design tokens documented below; component structure should follow the app's conventions.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and component states are finalized and should be recreated pixel-accurately using the target codebase's libraries. The 70s-retro visual identity (Alfa Slab One display, Pacifico script wordmark, plum/orange/mustard palette, offset drop-shadow buttons, rainbow-arc and sunburst motifs) is intentional — don't normalize it to a generic theme.

## Screens / Views

The page is a single scrolling layout, top to bottom:

### 1. Top Nav (sticky)
- **Height:** ~60px, 28px horizontal padding, max-width 1280px centered.
- **Background:** `rgba(248, 236, 208, 0.94)` with 8px backdrop blur.
- **Border-bottom:** 3px solid `--plum` (#3d1f4a).
- **Left:** Logo badge (see §Logo) + wordmark stack ("Sports" in Pacifico 22px `--orange`, "COLLECTIVE" in Alfa Slab 13px `--plum`, letter-spacing 0.04em).
- **Center:** Nav links (My Shelf, Feed, Discover, Sets, Trades) — 11.5px bold uppercase, letter-spacing 0.12em, active item has 3px `--orange` underline with 4px padding-bottom.
- **Right:** Search input (260px, pill-shaped, 2px plum border, cream bg, with ⌘K badge on mustard bg) + bell icon button with orange notification dot.

### 2. Logo Showcase Section
- Max-width 1280px, 24px margin top, 28px padding.
- Card: cream bg, 2px plum border, 16px radius, `0 4px 0 --plum` offset shadow, 24px/28px inner padding.
- 3-column grid (auto / 1fr / auto): **Logo (150px)** | **Wordmark stack + tagline** | **Rainbow arc + chip row**.
- Background: faint sunburst SVG at 25% opacity behind content.
- Tagline: "A home for collectors. Manage your binder, chase want lists, and swap doubles with the crew."
- Chips: "Collect" (rust), "Trade" (gold), "Connect" (forest/teal).

### 3. Hero / Cover + Identity Band
- **Cover:** 360px tall, full-bleed, border-bottom 3px plum.
  - Default background: `linear-gradient(135deg, #3d1f4a 0%, #2a1434 40%, #1f5a50 100%)`.
  - Overlay SVG: sunburst rays from bottom-center (16 polygons alternating `rgba(229,181,61,0.25)` and `rgba(232,116,44,0.18)`), 4 concentric rainbow arcs (rust/orange/mustard/teal, 22px stroke), 7 sparkle stars in gold at 0.8 opacity, ghost "Welcome to the Collective" in Pacifico 38px at 30% cream opacity.
  - Top-left chip: "Charter Member · Est. 2023" (gold chip).
  - Top-right: "Change cover" button (ghost style, triggers `<input type="file">`).
- **Identity band:** Overlaps cover by -86px.
  - Avatar: 172px, circle shape by default. Cream border 4px, plum outline 3px, plum offset shadow `0 4px 0 --plum` + soft drop-shadow. Hover camera button to upload.
  - Name: Alfa Slab 62px plum, line-height 0.95.
  - Above name: eyebrow "★ Collector · Vienna, Virginia ★" in orange.
  - Below name: @handle · city (pin icon) · "Rooting for the **Dodgers**".
  - Right-aligned: "Propose trade" (outline btn) + "Follow" (primary orange btn).

### 4. Sub Nav (tabs + page actions)
- Pill-container tabs (cream bg, 2px plum border, 100px radius, `0 2px 0 --plum`): Home | Collection | Want List | Trades | Activity.
- Active tab: plum bg, mustard text. Inactive: 11.5px bold uppercase ink-soft.
- Right: "Share profile" / "Edit page" chips.

### 5. Stats Strip
- 5-column grid, 24px gap, ~24/28 padding.
- Same panel-bordered style (cream + 2px plum + `0 4px 0 plum`).
- Top-left badge overlay: pill "★ The Record ★" in orange on plum border, sticking up -12px.
- Each stat: eyebrow label (11px uppercase tracked) + big Alfa Slab 38px plum numeral + mono 10px sub-label.
- Dotted 2px plum dividers between stats.
- Columns: Cards owned (4,281), Sets tracked (12), Trades done (87), Want list (316), Est. value ($142k).

### 6. Main Grid (1fr / 320px, gap 28px, padding 28/80)

**Left column (main):**

#### 6a. Sets in Progress
- Section head: "★ Sets in Progress ★" eyebrow + 3px gradient rule (orange → mustard → teal).
- 2-column grid of set cards. Each card:
  - 58px year-tile on left (`'53`, `'56`, etc.) colored from rotation [orange, teal, plum, mustard, rust], plum border, offset shadow.
  - Right: set name (14px 700 plum) + chunky progress bar (10px tall, pill, 1.5px plum border, inner highlight).
  - Below bar: mono label "have / total" and "nn%" justified.

#### 6b. Favorite Cards Showcase
- Plum panel, 2px border, 16px radius, `0 4px 0 --plum-deep`.
- Full-bleed SVG background: 14 radiating rays from bottom-center, 4 rainbow arcs (opacity 0.7), 4 gold stars.
- Title: "Favorite Cards" in Pacifico 52px orange, layered text-shadow `3px 3px 0 mustard, 6px 6px 0 plum-deep`.
- 6-column grid of card faces (130px wide), each rotated -2.5° to +2.5° based on index for scattered "pinned" look.

#### 6c. Your Feed
- Section head "★ Your Feed ★" + filter chip row (All activity / Want-list hits / Comments / Following / Auctions — "All activity" is rust).
- Stacked panels (14px gap). Three item types:
  - **Want-list hit:** Card face (115px) left, right: chip row (rust "Want-list match" + optional navy "Auction · ends 2d 14h") + Alfa Slab 22px title "1968 Topps — Nolan Ryan RC" + mono meta line + orange-accent blockquote note + price (Alfa Slab 26px orange) + "View listing"/"Make offer" btns + heart/comment counters.
  - **Comment:** User avatar (44px colored bg, plum border, offset shadow) + name + "commented on {target}" + 14px quoted body + Reply/Like.
  - **Post:** User avatar (38px) + name · handle · time, 14.5px body, optional 220px photo placeholder (plum-to-teal gradient with halftone), heart/comment counters.

**Right column (sidebar, sticky):**

#### 6d. About the Collector
- Panel-bordered. Eyebrow "★ The Collector ★".
- Italic bio quote.
- 2-column definition list: Home, Team (with 9px team-color dot), Roster (chip list of favorite players), Chasing ("Topps runs '53 – '80"). Labels in orange eyebrow style.

#### 6e. Activity
- Panel. Eyebrow "★ Activity ★".
- Vertical list: 8px colored dot + activity text + mono time.
- "View all" outline button at bottom.

#### 6f. Open for Trade
- Plum bg panel, 16px radius, offset plum-deep shadow.
- SVG sunburst bg at 30% opacity.
- Eyebrow "★ Open for Trade ★" in mustard.
- "47 doubles" in Alfa Slab 30px orange with mustard 2px 2px text-shadow.
- Body: "Chasing '53 hi-numbers and any Koufax."
- Full-width mustard button "See trade binder →" with cream border + cream offset shadow.

### 7. Footer
- 3px plum top border.
- Left: wordmark. Right: "Est. 2023" · "Keep on collectin'" in uppercase tracked bold plum.

## Interactions & Behavior

- **Avatar upload:** Click camera button → native file input → FileReader → data URL → avatar `<img src>` updates live.
- **Cover upload:** Same pattern on the cover's "Change cover" button.
- **Tabs:** Purely client state; no navigation on this page.
- **Feed like button:** Toggles local `liked` state; counter increments by 1 optimistically; color changes to `--orange` when active.
- **Hover on card faces:** `translateY(-4px) rotate(-0.8deg)` + expanded drop shadow, 0.18s ease.
- **Button press:** `translateY(1px)` on active.
- **Top nav:** sticky with 8px backdrop blur.
- **Sidebar:** `position: sticky; top: 20px` on screens ≥1000px.
- **Responsive:** Below 1000px, main grid collapses to single column; sidebar stacks below.

## State Management
Local React state on this page:
- `active: string` — selected tab
- `avatar: string | null` — data URL
- `cover: string | null` — data URL
- `tweaks: { accent, avatarShape, vintage }` — view tweaks (can be dropped for production; it's a design-review affordance)
- Per feed item: `liked: boolean`

In production, persist avatar/cover/likes through the Sports Collective API. Mock data is in `src/data.js`.

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| `--plum` | `#3d1f4a` | Primary dark / borders / ink |
| `--plum-deep` | `#2a1434` | Shadows, deepest ink |
| `--orange` | `#e8742c` | Accent / CTAs / highlights |
| `--orange-deep` | `#c55a1d` | Hover state |
| `--mustard` | `#e5b53d` | Secondary accent, gold chips |
| `--mustard-deep` | `#c99528` | — |
| `--teal` | `#2d7a6e` | Tertiary accent |
| `--teal-deep` | `#1f5a50` | — |
| `--rust` | `#c54a2c` | Red chip / badges |
| `--cream` | `#f5e9d0` | Panel backgrounds |
| `--cream-warm` | `#ecdbb8` | Progress bar track |
| `--paper` | `#f8ecd0` | Body background |
| `--ink` | `#2a1434` | Body text |
| `--ink-soft` | `#4a2d5a` | Secondary text |
| `--ink-mute` | `#7a5f8a` | Tertiary / timestamps |
| `--rule` | `#d9b668` | Decorative rules |

### Typography
- **Display:** `"Alfa Slab One"` — for names, big stats, card titles, `'53`-style year tiles.
- **Wordmark:** `"Pacifico"` — script; "Sports" wordmark and section titles like "Favorite Cards".
- **Body:** `"DM Sans"` weights 400/500/600/700.
- **Mono:** `"JetBrains Mono"` 400/500/600/700 — timestamps, stats under numerals, keyboard shortcuts.
- Google Fonts URL: `https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Pacifico&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap`

### Spacing & Radii
- Layout gaps: 14 / 16 / 20 / 24 / 28 px.
- Section outer padding: 28px horizontal, max-width 1280px.
- Panel border-radius: 14px (panel), 16px (panel-bordered, showcase, trade block), 100px (pills, chips, progress bar, avatar circle).
- Card-face border-radius: 8px.

### Borders & Shadows (the 70s "offset drop" look)
- Primary panel: `2px solid --plum` + `box-shadow: 0 3px 0 --plum`.
- Bordered panel: `2px solid --plum` + `box-shadow: 0 4px 0 --plum`.
- Primary button: `2px solid --plum` + `inset 0 -3px 0 --orange-deep` + `0 2px 0 --plum`.
- Avatar: layered `0 4px 0 --plum, 0 10px 24px rgba(42,20,52,0.25)`.
- No blurry modern card shadows — keep the hard-edged offset.

### Motifs
- **Sunburst rays:** 12–20 polygons from a central point, alternating mustard/orange, 0.3–0.55 opacity.
- **Rainbow arcs:** 4 concentric semicircles, strokes in order: rust → orange → mustard → teal, 14–22px stroke-width.
- **Sparkle stars:** 8-point stars (see `Star` component) in mustard or orange, 4–14px.
- **Halftone:** `radial-gradient(rgba(0,0,0,0.4) 1px, transparent 1.2px)` 5×5px, `mix-blend-mode: multiply`, opacity scaled by `--vintage`.
- **Section heads:** small-caps eyebrow + 3px gradient rule (orange → mustard → teal).

## The Logo

SVG badge, 200×200 viewBox (see `SCLogo` in `src/primitives-retro.jsx`):

1. **Plum disc** (r=96) with **cream ring** (r=88, 2px stroke).
2. **Gold dot rope** — 44 mustard dots evenly spaced on r=92 circle.
3. **Arched "SPORTS"** along top arc in Alfa Slab 22px orange, letter-spacing 2.
4. **Sunburst** — 12 mustard triangular rays behind the ball.
5. **Crossed bats** — two cream bats with plum outlines, teal handle (-20°) and rust handle (+20°).
6. **Baseball** — cream circle r=18, plum 2px outline, rust curved seam lines + 5 pairs of stitches.
7. **Plum ribbon** — curved band across bottom with mustard outline; "COLLECTIVE" in Alfa Slab 18px orange along the arc, letter-spacing 3.
8. **Sparkle stars** at 4 outer corners.

The logo is responsive via the `size` prop. It should be componentized identically in the target codebase (e.g. `<SportsCollectiveLogo size={150} />`).

## Assets
No external images. Everything is SVG or CSS. Profile picture and cover image are user uploads (stubbed as data URLs in this prototype).

## Files
Reference these in the handoff bundle:

- `Sports Collective.html` — entry point; shows script ordering and font links.
- `styles-retro.css` — all CSS tokens, typography, buttons, chips, progress, tabs, avatar, halftone, panel styles.
- `src/data.js` — mock data (user, stats, sets, favorites, feed, activity) shaped for the API you'll build.
- `src/primitives-retro.jsx` — `SCLogo`, `Wordmark`, `RainbowArc`, `Star`, `Avatar`, `CardFace`, `ProgressBar`, `Stat`, icon components.
- `src/sections-retro.jsx` — `Hero`, `SubNav`, `StatsStrip`, `FeedItem`, `SetsSection`, `FavoritesSection`, `Sidebar`, `UserAvatar`.
- `src/app-retro.jsx` — `TopNav`, `LogoShowcase`, `TweaksPanel`, `App` (page composition).

## Implementation Notes
- The Tweaks panel in the prototype (bottom-right) is a design-review affordance for trying accent colors, avatar shapes, and vintage intensity. **Do not ship it.** Instead, pick one accent (the user chose `orange` with `avatarShape: circle` and `vintage: 0.75`) and bake those values in as the production defaults.
- The `--vintage` CSS variable scales paper grain and halftone opacity; keep the system so it can be dialed down later if needed.
- All mock data lives in `src/data.js`. Replace with real API calls (`/me`, `/me/stats`, `/me/sets`, `/me/favorites`, `/me/feed`, `/me/activity`).
- Avatar and cover upload should POST to the media API and persist the URL on the user record. Keep the optimistic client-side FileReader preview for snappiness.
