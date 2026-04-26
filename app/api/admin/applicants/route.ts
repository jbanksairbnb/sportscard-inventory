import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const ADMIN_EMAIL = 'jbanks@sports-collective.com'

const PLUM = '#3d1f4a'
const ORANGE = '#e8742c'
const TEAL = '#2d7a6e'
const CREAM = '#f8ecd0'
const RULE = '#ecdbb8'
const INK_MUTE = '#7a6a8a'

function approvalHtml() {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 30px;">Welcome to the Collective!</h1>
      </div>
      <p style="font-size: 16px; line-height: 1.7;">Great news — your application has been <strong style="color: ${TEAL};">approved</strong>. We're thrilled to have you with us.</p>
      <p style="font-size: 15px; line-height: 1.7;">Sign in to start building your shelf, sharing your favorites, and connecting with other collectors who love the hobby as much as you do.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://sports-collective.com/login"
           style="display: inline-block; background: ${ORANGE}; color: ${CREAM}; padding: 14px 32px; border-radius: 100px; text-decoration: none; font-weight: 700; font-size: 15px; letter-spacing: 0.05em; border: 2px solid ${PLUM};">
          Sign In →
        </a>
      </div>
      <p style="font-size: 14px; line-height: 1.7; color: ${INK_MUTE};">If the button above doesn't work, copy this link into your browser:<br/>
        <a href="https://sports-collective.com/login" style="color: ${ORANGE}; word-break: break-all;">https://sports-collective.com/login</a>
      </p>
      <p style="font-size: 14px; color: ${INK_MUTE}; margin-top: 28px;">Welcome aboard,<br/>— The Sports Collective Team</p>
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">
        Questions? Write to <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a>
      </p>
    </div>
  `
}

function rejectionHtml() {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 26px;">Thank You for Applying</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.7;">Thank you for your interest in joining <strong>Sports Collective</strong>, and for taking the time to share your collection with us.</p>
      <p style="font-size: 15px; line-height: 1.7;">After careful review, we're unable to approve your membership at this time. We know this isn't the answer you were hoping for, and we appreciate your understanding.</p>
      <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 22px 0; font-size: 14px; line-height: 1.6;">
        If you have any questions or would like to share more context about your collecting background, please don't hesitate to reach out — we're always happy to talk hobby.
      </div>
      <p style="font-size: 14px; color: ${INK_MUTE}; margin-top: 28px;">With appreciation,<br/>— The Sports Collective Team</p>
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">
        Contact us at <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a>
      </p>
    </div>
  `
}

async function sendStatusEmail(to: string, status: 'approved' | 'rejected') {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const subject = status === 'approved'
    ? 'Welcome to Sports Collective!'
    : 'Update on your Sports Collective application'
  const html = status === 'approved' ? approvalHtml() : rejectionHtml()
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Sports Collective <noreply@sports-collective.com>', to, subject, html }),
    })
    const data = await res.json()
    console.log(`Resend ${status} to ${to}:`, JSON.stringify(data))
  } catch (e) {
    console.error('Resend error:', e)
  }
}

function authedSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await adminClient()
    .from('user_profiles')
    .select('user_id, application_status, collection_description, ebay_profile, fb_groups, applied_at, display_name, handle, email')
    .not('application_status', 'is', null)
    .order('applied_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ applicants: data || [] })
}

export async function PATCH(req: Request) {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { userId, status } = await req.json()
  if (!userId || !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = adminClient()
  const { data: prev } = await admin
    .from('user_profiles')
    .select('email, application_status')
    .eq('user_id', userId)
    .maybeSingle()

  const { error } = await admin
    .from('user_profiles')
    .update({ application_status: status })
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (
    prev?.email &&
    (status === 'approved' || status === 'rejected') &&
    prev.application_status !== status
  ) {
    await sendStatusEmail(prev.email, status)
  }

  return NextResponse.json({ ok: true })
}
