'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SCLogo from '@/components/SCLogo'

type Mode = 'login' | 'register' | 'forgot'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setMessage('')
    setConfirmPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    if (mode === 'register') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else {
        setMessage('Account created! You can now sign in.')
        switchMode('login')
      }
    } else if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
      })
      if (error) {
        setError(error.message)
      } else {
        setMessage('Password reset email sent! Check your inbox.')
      }
    }

    setLoading(false)
  }

  const headings: Record<Mode, { title: string; sub: string }> = {
    login:    { title: 'Sign in',        sub: 'Welcome back to the Collective' },
    register: { title: 'Create account', sub: 'Start managing your card sets' },
    forgot:   { title: 'Reset password', sub: "Enter your email and we'll send a reset link" },
  }
  const { title, sub } = headings[mode]

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '28px 16px',
    }}>
      <svg
        viewBox="0 0 600 600"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80vmin',
          height: '80vmin',
          opacity: 0.06,
          pointerEvents: 'none',
          zIndex: 0,
        }}
        aria-hidden
      >
        <g transform="translate(300 300)">
          {Array.from({ length: 20 }).map((_, i) => {
            const a = (i / 20) * Math.PI * 2;
            return (
              <polygon
                key={i}
                points="-20,0 20,0 0,-400"
                fill={i % 2 === 0 ? '#e5b53d' : '#e8742c'}
                transform={`rotate(${(a * 180) / Math.PI})`}
              />
            );
          })}
        </g>
      </svg>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <SCLogo size={96} />
          <div style={{ textAlign: 'center', lineHeight: 0.9 }}>
            <div className="wordmark" style={{ fontSize: 36, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', letterSpacing: '0.04em' }}>
              COLLECTIVE
            </div>
          </div>
        </div>

        <div className="panel-bordered" style={{ padding: '32px 28px' }}>
          <div style={{ marginBottom: 24 }}>
            <h1 className="display" style={{ fontSize: 28, color: 'var(--plum)', margin: '0 0 6px' }}>
              {title}
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>{sub}</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label className="input-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input-sc"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label className="input-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="input-sc"
                />
                {mode === 'register' && (
                  <p className="mono" style={{ margin: '5px 0 0', fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
                    Minimum 6 characters
                  </p>
                )}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="input-label" htmlFor="confirm-password">Confirm Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="input-sc"
                />
              </div>
            )}

            {mode === 'login' && (
              <div style={{ textAlign: 'right', marginTop: -8 }}>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  style={{
                    fontSize: 12,
                    color: 'var(--orange)',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div style={{
                background: 'rgba(197, 74, 44, 0.1)',
                border: '1.5px solid var(--rust)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--rust)',
                fontWeight: 600,
              }}>
                {error}
              </div>
            )}
            {message && (
              <div style={{
                background: 'rgba(45, 122, 110, 0.1)',
                border: '1.5px solid var(--teal)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--teal)',
                fontWeight: 600,
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 4 }}
            >
              {loading
                ? 'Please wait…'
                : mode === 'login'
                ? 'Sign in →'
                : mode === 'register'
                ? 'Create account →'
                : 'Send reset link →'}
            </button>
          </form>

          <div style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: '1.5px solid var(--rule)',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--ink-soft)',
          }}>
            {mode === 'forgot' ? (
              <>
                Remember your password?{' '}
                <button type="button" onClick={() => switchMode('login')}
                  style={{ color: 'var(--orange)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  Sign in
                </button>
              </>
            ) : mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button type="button" onClick={() => switchMode('register')}
                  style={{ color: 'var(--orange)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')}
                  style={{ color: 'var(--orange)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        <div className="eyebrow" style={{ textAlign: 'center', marginTop: 20, color: 'var(--ink-mute)', fontSize: 9.5 }}>
          ★ A home for collectors ★
        </div>
      </div>
    </div>
  )
}
