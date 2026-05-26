'use client'

import React, { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

// This page is the redirect target for Supabase password-recovery emails.
// Supabase can deliver the recovery credential in three different shapes
// depending on the project's auth flow type and email template:
//   1. ?code=<pkce-code>                  (PKCE — default for @supabase/ssr)
//   2. ?token_hash=<hash>&type=recovery   (token_hash flow, cross-device safe)
//   3. #access_token=...&type=recovery    (legacy implicit flow, hash fragment)
// We must consume the credential client-side: a server route handler can't
// read hash fragments, and the PKCE verifier cookie only exists in the
// browser that originally requested the reset.
type Status = 'verifying' | 'ready' | 'error'

export default function ResetPasswordPage() {
  // useSearchParams forces a client-side-render bailout, which Next requires
  // be wrapped in a Suspense boundary so prerendering can still emit a shell.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  )
}

function ResetPasswordInner() {
  const [status, setStatus] = useState<Status>('verifying')
  const [initError, setInitError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const ranRef = useRef(false)

  useEffect(() => {
    // Strict Mode double-invokes effects in dev; the code/token_hash can only
    // be exchanged once, so guard against running the consume step twice.
    if (ranRef.current) return
    ranRef.current = true

    const supabase = createClient()
    const code = searchParams.get('code')
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')
    const urlError = searchParams.get('error_description') || searchParams.get('error')

    if (urlError) {
      setInitError(urlError)
      setStatus('error')
      return
    }

    // PASSWORD_RECOVERY fires when the browser client picks up the recovery
    // tokens from a hash fragment (#access_token=...&type=recovery). Listening
    // covers the implicit-flow case where detectSessionInUrl handles parsing.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setStatus('ready')
      }
    })

    async function consume() {
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type: type as 'recovery',
          token_hash: tokenHash,
        })
        if (error) {
          setInitError(error.message)
          setStatus('error')
          return
        }
        setStatus('ready')
        return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setInitError(error.message)
          setStatus('error')
          return
        }
        setStatus('ready')
        return
      }

      // No query params — either the implicit flow is in progress (the
      // auth-state listener above will flip status to ready) or the user
      // is already in a recovery session from a previous step.
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setStatus('ready')
        return
      }

      // Give the implicit-flow listener a moment to fire before giving up.
      setTimeout(() => {
        setStatus((s) => {
          if (s === 'verifying') {
            setInitError('This password reset link is invalid or has expired. Please request a new one.')
            return 'error'
          }
          return s
        })
      }, 2500)
    }

    consume()

    return () => { sub.subscription.unsubscribe() }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.push('/home')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Image src="/sports-collective-logo.png" alt="Sports Collective" width={180} height={45} priority />
        </div>
        <div className="rounded-2xl bg-white p-8 shadow">
          {status === 'verifying' && (
            <>
              <h1 className="text-2xl font-semibold">Verifying link…</h1>
              <p className="mt-1 text-sm text-gray-500">One moment while we confirm your reset link.</p>
            </>
          )}

          {status === 'error' && (
            <>
              <h1 className="text-2xl font-semibold">Link expired</h1>
              <p className="mt-1 text-sm text-gray-500 mb-4">{initError}</p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="w-full rounded-2xl bg-blue-600 px-4 py-2.5 text-white font-medium shadow hover:bg-blue-700"
              >
                Back to sign in
              </button>
            </>
          )}

          {status === 'ready' && (
            <>
              <h1 className="text-2xl font-semibold">Set new password</h1>
              <p className="mt-1 text-sm text-gray-500 mb-6">Enter and confirm your new password.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-sm"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-2.5 text-white font-medium shadow hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
