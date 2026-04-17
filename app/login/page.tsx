'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 gap-3">
          <Image
            src="/sports-collective-logo.png"
            alt="Sports Collective"
            width={180}
            height={45}
            priority
          />
        </div>

        <div className="rounded-2xl bg-white p-8 shadow">
          <h1 className="text-2xl font-semibold">
            {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'}
          </h1>
          <p className="mt-1 text-sm text-gray-500 mb-6">
            {mode === 'login'
              ? 'Welcome back to Sports Collective'
              : mode === 'register'
              ? 'Start managing your card sets'
              : "Enter your email and we'll send a reset link"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-300 p-2.5 text-sm"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-sm"
                />
                {mode === 'register' && (
                  <p className="mt-1 text-xs text-gray-400">Minimum 6 characters</p>
                )}
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-sm"
                />
              </div>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-emerald-600">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-blue-600 px-4 py-2.5 text-white font-medium shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {loading
                ? 'Please wait…'
                : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                ? 'Create account'
                : 'Send reset link'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            {mode === 'forgot' ? (
              <>
                Remember your password?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-blue-600 hover:underline font-medium">
                  Sign in
                </button>
              </>
            ) : mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button type="button" onClick={() => switchMode('register')} className="text-blue-600 hover:underline font-medium">
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-blue-600 hover:underline font-medium">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
