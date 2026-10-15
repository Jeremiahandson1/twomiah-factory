// Hiring and onboarding emails (ported from CVHC services/emailService.js: sendCaregiverWelcome,
// sendOnboardingPacketInvite, sendAdminBgcResult). The agency's name comes from its own record.
// Every send is best effort — a caller never blocks a hire or a poll on email.
import { sendRaw } from './email.ts'
import { getAgencyProfile } from './agencyProfile.ts'

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const wrap = (agencyName: string, inner: string) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
<h2 style="margin:0 0 16px;color:#111827;">${esc(agencyName)}</h2>
${inner}
</div></body></html>`

const appUrl = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '')

export async function sendCaregiverWelcome({ to, firstName, tempPassword }: { to: string; firstName: string; tempPassword: string }) {
  const agency = await getAgencyProfile()
  const loginUrl = appUrl() || '/'
  return sendRaw({
    to,
    subject: `Welcome to ${agency.name}!`,
    html: wrap(agency.name, `
      <h3 style="color:#047857;">Welcome aboard, ${esc(firstName)}!</h3>
      <p>You've been hired as a caregiver at ${esc(agency.name)}. Your account is ready to go.</p>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px;font-weight:700;color:#065F46;">Your Login Credentials</p>
        <p style="margin:4px 0;"><strong>Email:</strong> ${esc(to)}</p>
        <p style="margin:4px 0;"><strong>Temporary Password:</strong> ${esc(tempPassword)}</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${esc(loginUrl)}" style="background:#047857;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Log In to the App</a>
      </p>
      <p style="color:#4b5563;font-size:0.9rem;">Use the link above or go to <strong>${esc(loginUrl)}</strong> on your phone or computer. We recommend changing your password after your first login.</p>
      <p style="color:#4b5563;font-size:0.9rem;">If you have any questions, please contact the office. We're glad to have you on the team!</p>
    `),
  })
}

export async function sendOnboardingPacketInvite({ to, firstName, packetUrl, expiresAt, runsWorcs }: {
  to: string; firstName: string; packetUrl: string; expiresAt: Date; runsWorcs: boolean
}) {
  const agency = await getAgencyProfile()
  const expiresStr = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: agency.timezone })
  const why = runsWorcs
    ? 'your consent to run the Wisconsin caregiver background check'
    : 'your consent to run your caregiver background check'
  return sendRaw({
    to,
    subject: `Welcome to ${agency.name} — complete your onboarding`,
    html: wrap(agency.name, `
      <h3 style="color:#047857;">Welcome aboard, ${esc(firstName)}!</h3>
      <p>We're excited to have you join the ${esc(agency.name)} team. Before your first shift, we need a little more information from you and ${why}.</p>
      <p>This should take about 10–15 minutes and can be done from your phone or computer. Please complete it as soon as you can — we can't schedule you for shifts until this is done.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${esc(packetUrl)}" style="background:#047857;color:#ffffff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1.05rem;display:inline-block;">Complete Your Onboarding</a>
      </div>
      <p style="color:#6b7280;font-size:0.85rem;">This link expires on <strong>${esc(expiresStr)}</strong>. If it expires before you finish, contact the office and we'll send you a new one.</p>
      <p style="color:#4b5563;font-size:0.9rem;margin-top:24px;">You'll still receive a separate email with login credentials for the caregiver app. Please complete this onboarding packet first so we can finish setting up your account.</p>
    `),
  })
}

export async function sendAdminBgcResult({ to, caregiverName, status, summary, matches }: {
  to: string; caregiverName: string; status: string; summary: string; matches: Array<{ statute: string; short_title: string; severity: string }>
}) {
  const agency = await getAgencyProfile()
  const matchList = (matches || []).length === 0
    ? '<p style="color:#065F46;">No statutory matches detected.</p>'
    : '<ul style="color:#374151;padding-left:18px;">' +
      matches.map((m) => `<li><strong>${esc(m.statute)}</strong> — ${esc(m.short_title)} (${esc(m.severity)})</li>`).join('') + '</ul>'
  const statusColor = status === 'clear' ? '#047857' : status === 'disqualified' ? '#B91C1C' : '#B45309'
  const statusLabel = status === 'clear' ? 'Cleared'
    : status === 'disqualified' ? 'Disqualified'
    : status === 'rehab_review' ? 'Rehabilitation Review Required'
    : 'Flagged for Review'
  return sendRaw({
    to,
    subject: `Background check result for ${caregiverName}: ${statusLabel}`,
    html: wrap(agency.name, `
      <p>Background check processing complete for <strong>${esc(caregiverName)}</strong>.</p>
      <div style="background:#F9FAFB;border-left:4px solid ${statusColor};padding:12px 16px;margin:16px 0;border-radius:6px;">
        <div style="font-weight:700;color:${statusColor};font-size:1rem;">${statusLabel}</div>
        <div style="color:#374151;margin-top:6px;">${esc(summary)}</div>
      </div>
      <p style="color:#6B7280;font-size:0.9rem;margin-top:20px;">Matched statutes:</p>
      ${matchList}
      <p style="color:#4b5563;font-size:0.9rem;margin-top:16px;">Log in to the CRM to review the full WORCS report and make a hiring decision.</p>
    `),
  })
}
