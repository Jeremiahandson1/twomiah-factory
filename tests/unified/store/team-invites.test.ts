// ADAPTED COPY of tests/store/team-invites.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged
// except the lines marked "unified:", where the store's team routes are the engine's (/api/company/users, the shared
// company module), a user has a first and last name, and the engine's invite flow (by lastLogin) is the ledger's.
// The original keeps running against the template.
// crm-store — teammates are INVITED by email and choose their own password, as Shopify does it. (10/14)
//
// The store had the owner set a teammate's password and pass it on ("there is deliberately no invite email"). The CRMs
// moved to emailed invites on 10/14; owner, asking what Shopify does: invite by email, 7 days, the owner never knows a
// teammate's password. A password the owner sets is still accepted, for a shop that hands logins over in person.
// Email is answered here (the provider is stubbed at its transport); nothing leaves the machine.
process.env.RESEND_API_KEY = 'test-resend-key'
process.env.FRONTEND_URL = 'https://inviteshop-shop-api.test' /* unified: the invite link is the app's own address (FRONTEND_URL; one app, no separate back office) */
process.env.JWT_SECRET ||= 'invite-test-secret'
process.env.JWT_REFRESH_SECRET ||= 'invite-test-refresh-secret'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer' /* unified: the app's email service sends through a nodemailer transport (server/core/email.ts) */

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const mails: any[] = []
let mailUp = true
;(nodemailer as any).createTransport = () => ({ sendMail: async (m: any) => { if (!mailUp) throw new Error('down'); mails.push(m); return { messageId: 'm1' } } }) /* unified: the provider stubbed at its transport, before the app is built — RESEND_API_KEY picks Resend's SMTP (smtp.resend.com), not the HTTP API the template's fetch stub answered; the message as it would leave is kept and never sent, and a refused send throws as the provider's refusal does */

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, storeSettings, users } = await import('./db/schema.ts') /* unified: the business is the company row (decision 1) */
await db.update(company).set({ name: 'Invite Shop' } as any) /* unified: the shop's name is the company row's */
await db.insert(storeSettings).values({ currency: 'usd' } as any) /* unified: the commerce settings keep the currency */
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@inviteshop.test`, passwordHash: await Bun.password.hash('OwnerPass123!', 'bcrypt'), firstName: name.split(' ')[0], lastName: name.split(' ')[1] || 'Shop', role } as any).returning())[0] /* unified: a user's first and last name, not name */
// The owner is the one signed in making every request below (x-test-user stands in for that sign-in, which stamps lastLogin).
const owner = await mk('owner', 'Olive Owner'), manager = await mk('manager', 'mgr'), staff = await mk('staff', 'stf')
await db.update(users).set({ lastLogin: new Date() } as any).where(eq(users.id, owner.id)) /* unified: the engine's invite rule is "never signed in" (lastLogin; ledger: the engine's invite flow by lastLogin), and the owner making these requests has signed in — see the report */

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default) /* unified: the store's /api/admin/users is the engine's team routes, /api/company/users */
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const tokenIn = (html: string) => decodeURIComponent((html.match(/reset-password\?token=([^&"]+)"/) || [])[1] || '') /* unified: the engine's link is /reset-password?token=<token> (the template added &invite=1 for its screen; the engine's screen asks nothing of it) */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ /* unified: the engine's invite token is a fresh random uuid — the template's `invite_` prefix marked an invite because its users had no lastLogin; here "never signed in" is what an invite is (packages/tenant-backend auth.ts) */

let inviteToken = ''
{
  const r = await call(owner, 'POST', '/api/company/users', { firstName: 'Sam', lastName: 'Staff', email: 'Sam@InviteShop.test', role: 'field' }) /* unified: first and last name; the store's staff seat is the shared `field` rung (verticals/store/settings.ts team.roles) */
  check(`no password → invited by email (${r.status})`, r.status === 201 && r.json?.invited === true && r.json?.inviteSent === true, r.json) /* unified: the engine's create reply is the login with invited / inviteSent; that the invite is waiting is the team list's invitePending, asserted next */
  const m = mails.at(-1)
  check('the invite went to them, from the store, saying who invited them and as what', m?.to === 'sam@inviteshop.test' && /You're invited to join Invite Shop/.test(m?.subject) && /Olive Owner/.test(m?.html) && /Staff/.test(m?.html), { to: m?.to, subject: m?.subject })
  inviteToken = tokenIn(m?.html || '')
  check('…with a 7-day set-your-password link on this store', UUID.test(inviteToken) && /https:\/\/inviteshop-shop-api\.test\/reset-password\?token=/.test(m?.html) && /expires in 7 days/.test(m?.html), inviteToken) /* unified: the token's shape (see UUID) */
  const [row] = await db.select().from(users).where(eq(users.email, 'sam@inviteshop.test'))
  const days = (new Date(row.resetTokenExp as any).getTime() - Date.now()) / 86400000
  check('…which really lasts 7 days', days > 6.9 && days <= 7.01, days)
}
{
  const list = await call(owner, 'GET', '/api/company/users') /* unified: the engine's team list */
  const sam = list.json?.find?.((u: any) => u.email === 'sam@inviteshop.test') /* unified: the engine's team list is the rows themselves (the shared company module's reply), not { data } */
  check('the team list shows the invite waiting', sam?.invitePending === true, sam)
  check('…and never the token itself', !JSON.stringify(list.json).includes(inviteToken) && sam?.resetToken === undefined && sam?.resetTokenExp === undefined) /* unified: the token itself is looked for (it has no `invite_` prefix to search) */
  const oliv = list.json?.find?.((u: any) => u.role === 'owner') /* unified: the rows themselves */
  check('the owner is not "invite pending"', oliv?.invitePending === false, oliv)
}
{
  const notYet = await call(null, 'POST', '/api/auth/login', { email: 'sam@inviteshop.test', password: 'Whatever123!' })
  check('before accepting, nobody can sign in as them (the stand-in password is random)', notYet.status === 401, notYet.status)
  const set = await call(null, 'POST', '/api/auth/reset-password', { token: inviteToken, password: 'SamsOwn123!' })
  check(`the link sets THEIR password (${set.status})`, set.status === 200, set.json)
  const login = await call(null, 'POST', '/api/auth/login', { email: 'sam@inviteshop.test', password: 'SamsOwn123!' })
  check(`…and they sign in with it (${login.status})`, login.status === 200 && !!login.json?.accessToken, login.status)
  const again = await call(null, 'POST', '/api/auth/reset-password', { token: inviteToken, password: 'Other12345!' })
  check('the link works once', again.status === 400, again.json)
  const list = await call(owner, 'GET', '/api/company/users') /* unified: the engine's team list */
  check('…and the list no longer says invite pending', list.json?.find?.((u: any) => u.email === 'sam@inviteshop.test')?.invitePending === false) /* unified: the rows themselves */
  const sam = list.json?.find?.((u: any) => u.email === 'sam@inviteshop.test') /* unified: the rows themselves */
  const resend = await call(owner, 'POST', `/api/company/users/${sam.id}/invite`) /* unified: the engine's Resend invite */
  check(`Resend is refused once they have chosen a password — Forgot password is the way (${resend.status})`, resend.status === 409 && /Forgot password/.test(resend.json?.error || ''), resend.json)
}
{
  const r = await call(owner, 'POST', '/api/company/users', { firstName: 'Mo', lastName: 'Manager', email: 'mo@inviteshop.test', role: 'manager' }) /* unified: the engine's team routes; first and last name */
  const first = tokenIn(mails.at(-1)?.html || '')
  const re = await call(owner, 'POST', `/api/company/users/${r.json.id}/invite`) /* unified: the engine's Resend invite */
  const second = tokenIn(mails.at(-1)?.html || '')
  check(`Resend while waiting: a fresh link goes out (${re.status})`, re.status === 200 && re.json?.inviteSent === true && UUID.test(second) && second !== first, { first, second }) /* unified: the token's shape (see UUID) */
  const old = await call(null, 'POST', '/api/auth/reset-password', { token: first, password: 'MoMoMo12345!' })
  check('…and the old link no longer works', old.status === 400, old.json)
  await db.update(users).set({ resetTokenExp: new Date(Date.now() - 1000) } as any).where(eq(users.email, 'mo@inviteshop.test'))
  const late = await call(null, 'POST', '/api/auth/reset-password', { token: second, password: 'MoMoMo12345!' })
  check('an expired invite says to ask the store owner — not "request a reset"', late.status === 400 && /Ask whoever invited you to send it again/.test(late.json?.error || '') && late.json?.code === 'invite_expired', late.json) /* unified: the engine's sentence for every vertical, "Ask whoever invited you to send it again" (ledger: an expired invitation says so), with its code */
  const list = await call(owner, 'GET', '/api/company/users') /* unified: the engine's team list */
  check('…and an expired invite is no longer shown as waiting', list.json?.find?.((u: any) => u.email === 'mo@inviteshop.test')?.invitePending === false) /* unified: the rows themselves */
}
{
  mailUp = false
  const r = await call(owner, 'POST', '/api/company/users', { firstName: 'No', lastName: 'Mail', email: 'nomail@inviteshop.test', role: 'field' }) /* unified: the engine's team routes; first and last name; staff is `field` */
  check('mail down: the login is still added, and the owner is TOLD the invite did not go out', r.status === 201 && r.json?.inviteSent === false, r.json)
  mailUp = true
}
{
  const before = mails.length
  const r = await call(owner, 'POST', '/api/company/users', { firstName: 'Handed', lastName: 'Over', email: 'hand@inviteshop.test', password: 'Handover123!', role: 'field' }) /* unified: the engine's team routes; first and last name; staff is `field` */
  check('a password the owner sets still works — no email sent', r.status === 201 && r.json?.invited === undefined && mails.length === before, r.json)
  const login = await call(null, 'POST', '/api/auth/login', { email: 'hand@inviteshop.test', password: 'Handover123!' })
  check('…and they sign in with it', login.status === 200)
}
{
  const m = await call(manager, 'POST', '/api/company/users', { firstName: 'X', lastName: 'X', email: 'x@inviteshop.test', role: 'field' }) /* unified: the engine's team routes; first and last name; staff is `field` */
  const s = await call(staff, 'POST', '/api/company/users', { firstName: 'Y', lastName: 'Y', email: 'y@inviteshop.test', role: 'field' }) /* unified: the engine's team routes; first and last name; staff is `field` */
  check(`only the owner invites — a manager and staff are refused (${m.status}, ${s.status})`, m.status === 403 && s.status === 403)
  const o = (await db.select().from(users).where(eq(users.role, 'owner')))[0]
  const ro = await call(owner, 'POST', `/api/company/users/${o.id}/invite`) /* unified: the engine's Resend invite */
  check('the owner is never sent an invite', ro.status === 409, ro.json)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
