import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Sports Collective — Built by a collector, for the collection';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8ecd0',
          backgroundImage:
            'radial-gradient(#3d1f4a22 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px',
          padding: 80,
          fontFamily: 'serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 8,
            color: '#e8742c',
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          ★ FOR VINTAGE SPORTS CARD COLLECTORS ★
        </div>

        <div
          style={{
            fontSize: 168,
            lineHeight: 1,
            color: '#e8742c',
            textShadow:
              '6px 6px 0 #e5b53d, 11px 11px 0 #3d1f4a',
            fontWeight: 800,
            marginBottom: 4,
          }}
        >
          Sports
        </div>
        <div
          style={{
            fontSize: 96,
            color: '#3d1f4a',
            letterSpacing: 8,
            fontWeight: 700,
            marginBottom: 36,
          }}
        >
          COLLECTIVE
        </div>

        <div
          style={{
            fontSize: 36,
            color: '#3d1f4a',
            textAlign: 'center',
            maxWidth: 920,
            lineHeight: 1.25,
          }}
        >
          Built by a collector, for the collection.
        </div>

        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 36,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          <div style={{ background: '#c54a2c', color: '#f8ecd0', padding: '8px 22px', borderRadius: 100 }}>Collect</div>
          <div style={{ background: '#e5b53d', color: '#3d1f4a', padding: '8px 22px', borderRadius: 100 }}>Trade</div>
          <div style={{ background: '#2d7a6e', color: '#f8ecd0', padding: '8px 22px', borderRadius: 100 }}>Connect</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
