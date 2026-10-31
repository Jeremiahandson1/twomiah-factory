// The member's private "update your card" page (salon gap #2, decision of 2026-10-30): after a membership is paused for a
// declined card, the member is emailed a link here. It is a plain page with one button; the button opens Stripe's own card
// page on the salon's OWN account (never a card typed here, nothing on Twomiah's account), and the card that is saved
// starts the membership again (membershipBilling.ts resume, told by cardOnFile.onSaved).
//
// The link carries a long random token, kept on the paused enrolment only while it is paused: resumed, cancelled or
// changed by hand, the token is cleared and the link answers "no longer needed". It shows nothing about the member.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { membershipEnrollment, membershipPlan, company } from '../../db/schema/index.ts'
import { escHtml } from '../../core/email.ts'
import type { CrmDeps } from '../deps.ts'
import type { CardOnFile } from './cardOnFile.ts'

const page = (title: string, name: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:30rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px}h1{font-size:1.4rem;margin:0 0 .5rem}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer}p.s{color:#475569}</style></head>
<body><main><p class="s">${escHtml(name)}</p>${inner}</main></body></html>`

export function createMemberCardRoutes(d: CrmDeps, cards: CardOnFile) {
  const { db } = d
  const app = new Hono()

  async function byToken(token: string) {
    if (!token || token.length < 20) return null
    const [enr] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.cardUpdateToken, token), eq(membershipEnrollment.status, 'paused'))).limit(1)
    if (!enr) return null
    const [plan] = await db.select({ name: membershipPlan.name }).from(membershipPlan).where(eq(membershipPlan.id, enr.planId)).limit(1)
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, enr.companyId)).limit(1)
    return { enr, plan: plan?.name || 'your membership', salon: co?.name || '' }
  }

  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('Cache-Control', 'no-store') })

  app.get('/:token', async (c) => {
    const found = await byToken(c.req.param('token'))
    if (!found) return c.html(page('Card', '', '<h1>This link is no longer needed</h1><p>Your membership is not waiting for a new card. If you think that is wrong, please contact the salon.</p>'), 404)
    const { plan, salon } = found
    return c.html(page('Update your card', salon, `<h1>Update your card</h1><p>We could not take payment for ${escHtml(plan)}, so it is paused until a card works. Give us a new card on our payment provider&rsquo;s secure page and it starts again — the unpaid amount is taken then.</p>
<form method="post" action=""><button type="submit">Update my card</button></form>`))
  })

  app.post('/:token', async (c) => {
    const found = await byToken(c.req.param('token'))
    if (!found) return c.html(page('Card', '', '<h1>This link is no longer needed</h1><p>Your membership is not waiting for a new card.</p>'), 404)
    const { enr } = found
    let started: { url: string } | null = null
    try { started = await cards.startSetup(enr.companyId, enr.contactId, 'client_online', null, undefined, { membership_enrollment_id: enr.id }) }
    catch (e: any) { d.logger.warn('[memberships] card page not opened', { error: e?.message || String(e) }) }
    if (!started) return c.html(page('Card', found.salon, '<h1>Card page not available</h1><p>We could not open the card page right now. Please try again later or contact the salon.</p>'), 503)
    return c.redirect(started.url, 303)
  })

  return app
}
