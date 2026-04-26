import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { applicantEmail, collectionDescription, ebayProfile, fbGroups } = body

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, warning: 'Email not configured' })
  }

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #3d1f4a;">
      <h2 style="color: #e8742c; border-bottom: 3px solid #3d1f4a; padding-bottom: 10px;">
        ★ New Sports Collective Application ★
      </h2>
      <p><strong>Email:</strong> ${applicantEmail}</p>
      <hr style="border-color: #ecdbb8;" />
      <p><strong>About Their Collection:</strong></p>
      <p style="background: #f8ecd0; padding: 12px; border-left: 4px solid #e8742c;">
        ${(collectionDescription || '—').replace(/\n/g, '<br/>')}
      </p>
      <p><strong>eBay Profile:</strong><br/>
        ${ebayProfile ? `<a href="${ebayProfile}" style="color: #e8742c;">${ebayProfile}</a>` : '—'}
      </p>
      <p><strong>Facebook Collecting Groups:</strong></p>
      <p style="background: #f8ecd0; padding: 12px; border-left: 4px solid #3d1f4a;">
        ${(fbGroups || '—').replace(/\n/g, '<br/>')}
      </p>
      <hr style="border-color: #ecdbb8;" />
      <p style="font-size: 13px; color: #7a6a8a;">
        Review and approve at <a href="https://sports-collective.com/admin" style="color: #e8742c;">sports-collective.com/admin</a>
      </p>
    </div>
  `

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@sportscollective.com',
      to: 'jbanks@sportscollective.com',
      subject: `New Application: ${applicantEmail}`,
      html,
    }),
  })

  return NextResponse.json({ ok: true })
}
