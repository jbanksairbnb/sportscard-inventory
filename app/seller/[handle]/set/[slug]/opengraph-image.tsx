import { ImageResponse } from 'next/og';
import { loadShowcase } from './loadShowcase';
import { buildShowcaseCards, completionOf, topCardsByValue, fmtMoney } from '@/lib/setShowcase';
import { thumbUrlFromOriginal } from '@/lib/thumbnail';

// The picture Facebook (and other sites) show when the showcase link is
// pasted into a post: set title, value, price and the top four cards.

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Set showcase';

const PLUM = '#3d1f4a';
const ORANGE = '#e8742c';
const TEAL = '#2d7a6e';
const PAPER = '#f8ecd0';
const INK_SOFT = '#4a2d5a';

// Fetch an image and inline it; satori only renders PNG/JPEG reliably, and a
// broken remote image would fail the whole render.
async function inline(url: string | null): Promise<string | null> {
  if (!url) return null;
  for (const candidate of [thumbUrlFromOriginal(url), url].filter(Boolean) as string[]) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (type !== 'image/jpeg' && type !== 'image/png') continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 4_000_000) continue;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export default async function Image(props: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await props.params;
  const data = await loadShowcase(handle, slug);
  if (!data) {
    return new ImageResponse(
      (<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PAPER, color: PLUM, fontSize: 48 }}>Sports Collective</div>),
      size,
    );
  }

  const cards = buildShowcaseCards(data.rows, data.set.year, data.set.brand, data.marksByKey);
  const completion = completionOf(cards);
  const seen = new Set<string>();
  let value = 0;
  for (const c of cards) {
    if (c.owned && c.value !== null && !seen.has(c.key)) { seen.add(c.key); value += c.value; }
  }
  const price = data.settings.asking_price ?? data.listing?.askingPrice ?? null;
  const top = topCardsByValue(cards, 8).filter(c => c.imageFront);
  const images = (await Promise.all(top.slice(0, 6).map(c => inline(c.imageFront)))).filter(Boolean).slice(0, 4) as string[];

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: PAPER, borderBottom: `14px solid ${PLUM}` }}>
        <div style={{ width: 560, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 44px' }}>
          <div style={{ display: 'flex', fontSize: 24, color: ORANGE, fontWeight: 700, letterSpacing: 4 }}>
            {[data.set.year, data.set.brand].filter(Boolean).join(' · ').toUpperCase()}
          </div>
          <div style={{ display: 'flex', fontSize: 54, color: PLUM, fontWeight: 800, lineHeight: 1.05, marginTop: 10 }}>
            {data.set.title}
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: INK_SOFT, marginTop: 18 }}>
            {completion.missing.length === 0 ? `Complete set · ${completion.total} cards` : `${completion.owned} of ${completion.total} cards`}
          </div>
          {value > 0 && (
            <div style={{ display: 'flex', fontSize: 30, color: INK_SOFT, marginTop: 10 }}>
              Market value&nbsp;<span style={{ color: ORANGE, fontWeight: 800 }}>{fmtMoney(value)}</span>
            </div>
          )}
          {price !== null && (
            <div style={{ display: 'flex', marginTop: 22 }}>
              <div style={{ display: 'flex', background: TEAL, color: PAPER, fontSize: 36, fontWeight: 800, padding: '10px 22px', borderRadius: 14 }}>
                {fmtMoney(price)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 22, color: PLUM, marginTop: 'auto', fontWeight: 700 }}>
            Sports Collective · {data.seller.displayName}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28, background: PLUM }}>
          {images.length === 0 ? (
            <div style={{ display: 'flex', color: PAPER, fontSize: 40, fontWeight: 800 }}>{data.set.title}</div>
          ) : images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" width={images.length > 2 ? 250 : 270} height={images.length > 2 ? 270 : 380}
              style={{ objectFit: 'contain', borderRadius: 10 }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
