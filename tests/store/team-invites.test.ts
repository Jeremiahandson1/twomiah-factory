// crm-store — teammates are INVITED by email and choose their own password, as Shopify does it. (10/14)
//
// The store had the owner set a teammate's password and pass it on ("there is deliberately no invite email"). The CRMs
// moved to emailed invites on 10/14; owner, asking what Shopify does: invite by email, 7 days, the owner never knows a
// teammate's password. A password the owner sets is still accepted, for a shop that hands logins over in person.
// Email is answered here (the Resend API is stubbed); nothing leaves the machine.
process.env.RESEND_API_KEY = 'test-resend-key'
process.env.BACKEND_URL = 'https://inviteshop-shop-api.test'
process.env.JWT_SECRET ||= 'invite-test-secret'
process.env.JWT_REFRESH_SECRET ||= 'invite-test-refresh-secret'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const mails: any[] = []
let mailUp = true
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (url !== 'https://api.resend.com/emails') return realFetch(input, init)
  if (!mailUp) return new Response('{"error":"down"}', { status: 500 })
  mails.push(JSON.parse(init.body))
  return new Response('{"id":"m1"}', { status: 200 })
}) as any

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { storeSettings, users } = await import('./db/schema.ts')
await db.insert(storeSettings).values({ companyName: 'Invite Shop', currency: 'usd' } as any)
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@inviteshop.test`, passwordHash: await Bun.password.hash('OwnerPass123!', 'bcrypt'), name, role } as any).returning())[0]
const owner = await mk('owner', 'Olive Owner'), manager = await mk('manager', 'mgr'), staff = await mk('staff', 'stf')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/admin/users', (await import('./src/routes/users.ts')).default)
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const tokenIn = (html: string) => decodeURIComponent((html.match(/reset-password\?token=([^&"]+)&amp;invite=1/) || html.match(/reset-password\?token=([^&"]+)&invite=1/) || [])[1] || '')

let inviteToken = ''
{
  const r = await call(owner, 'POST', '/api/admin/users', { name: 'Sam Staff', email: 'Sam@InviteShop.test', role: 'staff' })
  check(`no password → invited by email (${r.status})`, r.status === 201 && r.json?.invited === true && r.json?.inviteSent === true && r.json?.invitePending === true, r.json)
  const m = mails.at(-1)
  check('the invite went to them, from the store, saying who invited them and as what', m?.to === 'sam@inviteshop.test' && /You're invited to join Invite Shop/.test(m?.subject) && /Olive Owner/.test(m?.html) && /Staff/.test(m?.html), { to: m?.to, subject: m?.subject })
  inviteToken = tokenIn(m?.html || '')
  check('…with a 7-day set-your-password link on this store', inviteToken.startsWith('invite_') && /https:\/\/inviteshop-shop-api\.test\/reset-password\?token=/.test(m?.html) && /expires in 7 days/.test(m?.html), inviteToken)
  const [row] = await db.select().from(users).where(eq(users.email, 'sam@inviteshop.test'))
  const days = (new Date(row.resetTokenExp as any).getTime() - Date.now()) / 86400000
  check('…which really lasts 7 days', days > 6.9 && days <= 7.01, days)
}
{
  const list = await call(owner, 'GET', '/api/admin/users')
  const sam = list.json?.data?.find((u: any) => u.email === 'sam@inviteshop.test')
  check('the team list shows the invite waiting', sam?.invitePending === true, sam)
  check('…and never the token itself', !JSON.stringify(list.json).includes('invite_') && sam?.resetToken === undefined && sam?.resetTokenExp === undefined)
  const oliv = list.json?.data?.find((u: any) => u.role === 'owner')
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
  const list = await call(owner, 'GET', '/api/admin/users')
  check('…and the list no longer says invite pending', list.json?.data?.find((u: any) => u.email === 'sam@inviteshop.test')?.invitePending === false)
  const sam = list.json?.data?.find((u: any) => u.email === 'sam@inviteshop.test')
  const resend = await call(owner, 'POST', `/api/admin/users/${sam.id}/invite`)
  check(`Resend is refused once they have chosen a password — Forgot password is the way (${resend.status})`, resend.status === 409 && /Forgot password/.test(resend.json?.error || ''), resend.json)
}
{
  const r = await call(owner, 'POST', '/api/admin/users', { name: 'Mo Manager', email: 'mo@inviteshop.test', role: 'manager' })
  const first = tokenIn(mails.at(-1)?.html || '')
  const re = await call(owner, 'POST', `/api/admin/users/${r.json.id}/invite`)
  const second = tokenIn(mails.at(-1)?.html || '')
  check(`Resend while waiting: a fresh link goes out (${re.status})`, re.status === 200 && re.json?.inviteSent === true && second.startsWith('invite_') && second !== first, { first, second })
  const old = await call(null, 'POST', '/api/auth/reset-password', { token: first, password: 'MoMoMo12345!' })
  check('…and the old link no longer works', old.status === 400, old.json)
  await db.update(users).set({ resetTokenExp: new Date(Date.now() - 1000) } as any).where(eq(users.email, 'mo@inviteshop.test'))
  const late = await call(null, 'POST', '/api/auth/reset-password', { token: second, password: 'MoMoMo12345!' })
  check('an expired invite says to ask the store owner — not "request a reset"', late.status === 400 && /Ask the store owner to send it again/.test(late.json?.error || ''), late.json)
  const list = await call(owner, 'GET', '/api/admin/users')
  check('…and an expired invite is no longer shown as waiting', list.json?.data?.find((u: any) => u.email === 'mo@inviteshop.test')?.invitePending === false)
}
{
  mailUp = false
  const r = await call(owner, 'POST', '/api/admin/users', { name: 'No Mail', email: 'nomail@inviteshop.test', role: 'staff' })
  check('mail down: the login is still added, and the owner is TOLD the invite did not go out', r.status === 201 && r.json?.inviteSent === false, r.json)
  mailUp = true
}
{
  const before = mails.length
  const r = await call(owner, 'POST', '/api/admin/users', { name: 'Handed Over', email: 'hand@inviteshop.test', password: 'Handover123!', role: 'staff' })
  check('a password the owner sets still works — no email sent', r.status === 201 && r.json?.invited === undefined && mails.length === before, r.json)
  const login = await call(null, 'POST', '/api/auth/login', { email: 'hand@inviteshop.test', password: 'Handover123!' })
  check('…and they sign in with it', login.status === 200)
}
{
  const m = await call(manager, 'POST', '/api/admin/users', { name: 'X', email: 'x@inviteshop.test', role: 'staff' })
  const s = await call(staff, 'POST', '/api/admin/users', { name: 'Y', email: 'y@inviteshop.test', role: 'staff' })
  check(`only the owner invites — a manager and staff are refused (${m.status}, ${s.status})`, m.status === 403 && s.status === 403)
  const o = (await db.select().from(users).where(eq(users.role, 'owner')))[0]
  const ro = await call(owner, 'POST', `/api/admin/users/${o.id}/invite`)
  check('the owner is never sent an invite', ro.status === 409, ro.json)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
