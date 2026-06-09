import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// eBay OAuth (user tokens) for the two-way integration. Sandbox-aware so we can
// prove the flow end-to-end against a test seller before flipping EBAY_ENV to
// 'production'. This module owns: the authorize URL, the code→token and refresh
// exchanges, at-rest encryption of the refresh token, and persistence of the
// per-seller connection row. It deliberately does NOT touch the existing
// app-token Browse feed (lib stays separate so the live feed is never at risk).

export type EbayEnv = 'sandbox' | 'production'

export const EBAY_ENV: EbayEnv =
  process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox'

// The selling scopes we request. Scope identifiers always use the api.ebay.com
// host even in sandbox — only the auth/api *hosts* differ by environment.
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
]

type EbayConfig = {
  appId: string
  certId: string
  ruName: string
  authHost: string
  apiHost: string
}

// Read the right credentials for the active environment. Sandbox uses its own
// EBAY_SANDBOX_* vars so it never collides with the production keys that power
// the existing Browse feed.
export function ebayConfig(): EbayConfig {
  if (EBAY_ENV === 'production') {
    const appId = process.env.EBAY_APP_ID
    const certId = process.env.EBAY_CERT_ID
    const ruName = process.env.EBAY_RUNAME
    if (!appId || !certId || !ruName) {
      throw new Error('Missing EBAY_APP_ID / EBAY_CERT_ID / EBAY_RUNAME')
    }
    return { appId, certId, ruName, authHost: 'auth.ebay.com', apiHost: 'api.ebay.com' }
  }
  const appId = process.env.EBAY_SANDBOX_APP_ID
  const certId = process.env.EBAY_SANDBOX_CERT_ID
  const ruName = process.env.EBAY_SANDBOX_RUNAME
  if (!appId || !certId || !ruName) {
    throw new Error('Missing EBAY_SANDBOX_APP_ID / EBAY_SANDBOX_CERT_ID / EBAY_SANDBOX_RUNAME')
  }
  return { appId, certId, ruName, authHost: 'auth.sandbox.ebay.com', apiHost: 'api.sandbox.ebay.com' }
}

// Where eBay sends the browser after consent is configured under the RuName in
// the developer portal. In the OAuth requests themselves the redirect_uri
// PARAMETER is the RuName string (not the URL) — eBay maps it to the URL.
export function buildAuthorizeUrl(state: string): string {
  const { appId, ruName, authHost } = ebayConfig()
  const url = new URL(`https://${authHost}/oauth2/authorize`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', ruName)
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { appId, certId, apiHost } = ebayConfig()
  const auth = Buffer.from(`${appId}:${certId}`).toString('base64')
  const res = await fetch(`https://${apiHost}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) {
    // eBay error bodies can echo request context; keep them server-side only.
    throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as TokenResponse
}

export function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { ruName } = ebayConfig()
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ruName,
  })
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES.join(' '),
  })
}

// ── At-rest encryption for the refresh token ───────────────────────────────
// AES-256-GCM with a key derived (sha256) from EBAY_TOKEN_ENC_KEY so any
// reasonable key string works. When the key is absent we fall back to
// plaintext + token_enc='none'; the row is still service-role-only, but set
// the key in production for defense-in-depth.
function encKey(): Buffer | null {
  const raw = process.env.EBAY_TOKEN_ENC_KEY
  if (!raw) return null
  return crypto.createHash('sha256').update(raw).digest()
}

export function encryptToken(plain: string): { value: string; mode: 'aesgcm' | 'none' } {
  const key = encKey()
  if (!key) return { value: plain, mode: 'none' }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { value: `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`, mode: 'aesgcm' }
}

export function decryptToken(value: string, mode: string): string {
  if (mode !== 'aesgcm') return value
  const key = encKey()
  if (!key) throw new Error('EBAY_TOKEN_ENC_KEY missing but token is encrypted')
  const [ivB64, tagB64, dataB64] = value.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

// ── Persistence (service-role only) ─────────────────────────────────────────
export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export type EbayConnectionRow = {
  user_id: string
  environment: string
  ebay_user: string | null
  refresh_token: string
  refresh_token_expires_at: string | null
  token_enc: string
  scopes: string | null
  fulfillment_policy_id: string | null
  payment_policy_id: string | null
  return_policy_id: string | null
  merchant_location_key: string | null
  last_order_poll_at: string | null
}

export async function saveConnection(userId: string, tokens: TokenResponse): Promise<void> {
  if (!tokens.refresh_token) throw new Error('eBay did not return a refresh_token')
  const enc = encryptToken(tokens.refresh_token)
  const expiresAt = tokens.refresh_token_expires_in
    ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString()
    : null
  const { error } = await serviceClient()
    .from('ebay_connections')
    .upsert(
      {
        user_id: userId,
        environment: EBAY_ENV,
        refresh_token: enc.value,
        token_enc: enc.mode,
        refresh_token_expires_at: expiresAt,
        scopes: SCOPES.join(' '),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`saveConnection failed: ${error.message}`)
}

export async function getConnection(userId: string): Promise<EbayConnectionRow | null> {
  const { data } = await serviceClient()
    .from('ebay_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as EbayConnectionRow | null) ?? null
}

export async function deleteConnection(userId: string): Promise<void> {
  await serviceClient().from('ebay_connections').delete().eq('user_id', userId)
}

// Mint a fresh access token for a connected seller. Used by the listing-push
// and order-poll paths (Phase 2+). Refreshes transparently from the stored
// refresh token; the access token is short-lived and never persisted.
export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await getConnection(userId)
  if (!conn) throw new Error('No eBay connection for user')
  const refresh = decryptToken(conn.refresh_token, conn.token_enc)
  const tokens = await refreshAccessToken(refresh)
  return tokens.access_token
}
