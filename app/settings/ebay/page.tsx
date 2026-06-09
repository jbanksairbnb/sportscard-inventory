'use client'

import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

// Settings → eBay: connect / disconnect the seller's eBay account. The actual
// OAuth handshake happens in the /api/ebay/* routes; this page just shows
// status and the button. Connecting is a full-page navigation to
// /api/ebay/connect (which redirects to eBay), so we use a plain link.

type Status =
  | { connected: false }
  | {
      connected: true
      environment: string
      ebayUser: string | null
      refreshTokenExpiresAt: string | null
      setupComplete: boolean
    }

const ERROR_MESSAGES: Record<string, string> = {
  declined: 'Connection cancelled — you declined access on eBay.',
  state: 'Connection could not be verified (security check failed). Please try again.',
  exchange: 'eBay rejected the connection. Please try again, or check that selling scopes are enabled.',
}

export default function EbaySettingsPage() {
  return (
    <Suspense fallback={null}>
      <EbaySettingsInner />
    </Suspense>
  )
}

function EbaySettingsInner() {
  const params = useSearchParams()
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const justConnected = params.get('connected') === '1'
  const errorCode = params.get('error')

  async function load() {
    const res = await fetch('/api/ebay/status')
    if (res.ok) setStatus(await res.json())
  }

  useEffect(() => {
    load()
  }, [])

  async function disconnect() {
    if (!confirm('Disconnect your eBay account? You can reconnect at any time.')) return
    setBusy(true)
    await fetch('/api/ebay/disconnect', { method: 'POST' })
    setBusy(false)
    load()
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <Link href="/home" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>
        ← Back
      </Link>
      <h1 style={{ fontSize: 28, marginTop: 12 }}>eBay connection</h1>
      <p style={{ color: '#6b7280', lineHeight: 1.5 }}>
        Link your eBay account so the app can list your cards on eBay and keep inventory in sync —
        a sale on either side automatically pulls the card from the other.
      </p>

      {justConnected && (
        <Banner color="#065f46" bg="#d1fae5">✓ Your eBay account is connected.</Banner>
      )}
      {errorCode && (
        <Banner color="#991b1b" bg="#fee2e2">{ERROR_MESSAGES[errorCode] ?? 'Something went wrong.'}</Banner>
      )}

      <div style={{ marginTop: 24, padding: 20, border: '1px solid #e5e7eb', borderRadius: 12 }}>
        {status === null ? (
          <p style={{ color: '#9ca3af' }}>Checking connection…</p>
        ) : status.connected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#10b981', display: 'inline-block' }} />
              <strong>Connected</strong>
              <span style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {status.environment}
              </span>
            </div>
            {status.ebayUser && <p style={{ margin: '8px 0 0', color: '#374151' }}>Seller: {status.ebayUser}</p>}
            <p style={{ margin: '8px 0 0', color: status.setupComplete ? '#065f46' : '#92400e', fontSize: 14 }}>
              {status.setupComplete
                ? 'Listing setup complete (policies + location).'
                : 'Listing setup will finish automatically the first time you publish a card.'}
            </p>
            <button
              onClick={disconnect}
              disabled={busy}
              style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ marginTop: 0, color: '#374151' }}>Your eBay account isn’t connected yet.</p>
            <a
              href="/api/ebay/connect"
              style={{ display: 'inline-block', marginTop: 8, padding: '10px 20px', borderRadius: 8, background: '#3665f3', color: '#fff', textDecoration: 'none', fontWeight: 600 }}
            >
              Connect eBay
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function Banner({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: bg, color }}>
      {children}
    </div>
  )
}
