import { NextRequest, NextResponse } from 'next/server'

const PLUM = '#3d1f4a'
const ORANGE = '#e8742c'
const CREAM = '#f8ecd0'
const RULE = '#ecdbb8'
const INK_MUTE = '#7a6a8a'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function adminNotificationHtml(applicantEmail: string, collectionDescription: string, ebayProfile: string, fbGroups: string) {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM};">
      <h2 style="color: ${ORANGE}; border-bottom: 3px solid ${PLUM}; padding-bottom: 10px;">
        ★ New Sports Collective Application ★
      </h2>
      <p><strong>Email:</strong> ${escapeHtml(applicantEmail)}</p>
      <hr style="border-color: ${RULE};" />
      <p><strong>About Their Collection:</strong></p>
      <p style="background: ${CREAM}; padding: 12px; border-left: 4px solid ${ORANGE};">
        ${escapeHtml(collectionDescription || '—').replace(/\n/g, '<br/>')}
      </p>
      <p><strong>eBay Profile:</strong><br/>
        ${ebayProfile ? `<a href="${escapeHtml(ebayProfile)}" style="color: ${ORANGE};">${escapeHtml(ebayProfile)}</a>` : '—'}
      </p>
      <p><strong>Facebook Collecting Groups:</strong></p>
      <p style="background: ${CREAM}; padding: 12px; border-left: 4px solid ${PLUM};">
        ${escapeHtml(fbGroups || '—').replace(/\n/g, '<br/>')}
      </p>
      <hr style="border-color: ${RULE};" />
      <p style="font-size: 13px; color: ${INK_MUTE};">
        Review and approve at <a href="https://sports-collective.com/admin" style="color: ${ORANGE};">sports-collective.com/admin</a>
      </p>
    </div>
  `
}

function applicantConfirmationHtml() {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">Application Received</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.7;">Thank you for applying to join <strong>Sports Collective</strong>. We've received your application and a member of our team will review it personally.</p>
      <p style="font-size: 15px; line-height: 1.7;">We typically respond within <strong>1–3 business days</strong>. We may reach out via your eBay profile or ask for a reference from one of your Facebook collecting groups to verify your activity in the hobby.</p>
      <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 22px 0; font-size: 14px; line-height: 1.6;">
        We appreciate your patience and look forward to welcoming you to the Collective. Until then — happy collecting!
      </div>
      <p style="font-size: 13px; color: ${INK_MUTE}; margin-top: 28px;">— The Sports Collective Team</p>
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">
        Questions? Reply to this email or write to <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a>
      </p>
    </div>
  `
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { applicantEmail, collectionDescription, ebayProfile, fbGroups } = body

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, warning: 'Email not configured' })
  }

  const sendEmail = (to: string, subject: string, html: string) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Sports Collective <noreply@sports-collective.com>', to, subject, html }),
    }).then(r => r.json())

  const [adminResult, applicantResult] = await Promise.all([
    sendEmail(
      'jbanks@sports-collective.com',
      `New Application: ${applicantEmail}`,
      adminNotificationHtml(applicantEmail, collectionDescription, ebayProfile, fbGroups)
    ),
    sendEmail(
      applicantEmail,
      'We received your Sports Collective application',
      applicantConfirmationHtml()
    ),
  ])

  console.log('Resend admin:', JSON.stringify(adminResult))
  console.log('Resend applicant:', JSON.stringify(applicantResult))

  return NextResponse.json({ ok: true })
}
