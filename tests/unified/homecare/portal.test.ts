// ADAPTED COPY of tests/homecare/portal.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 4 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — the portal area, ported from the source home care CRM.
//
//   · client portal accounts: several logins per client, each with its own password,
//     5-strike / 15-minute lockout, 48-hour invite, 1-hour self-service reset
//   · the migration that moves the old single login off the clients row
//   · an administrator's portal preview, which is read-only
//   · caregivers + their background-check SUMMARY, invoices' per-day lines
//   · the family portal: relatives' logins, the four permission switches, messages + replies
//   · staff notifications: new → handled → archived, the bell counting what the page shows,
//     delivery preferences with quiet hours, and the send-side gate (shouldNotify)
//
// Real routes on Hono, PGlite built from the real migrations. Staff are the x-test-user stub;
// portal and family sign-ins are REAL tokens from the real login routes.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'portal-test-secret'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db, pglite } from './db/index.ts'
import {
  agencies, users, clients, clientPortalAccounts, clientAssignments, schedules, backgroundChecks,
  invoices, invoiceLineItems, notifications, familyMembers, medications, clientNotificationPreferences,
  clientNotifications,
} from './db/schema.ts'

let failed = 0, passed = 0
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema(); const [agency] = await db.insert(agencies).values({ name: 'Portal Test Agency', slug: 'portaltest', state: 'OH' } as any).returning() /* unified: every home-care row carries its company (company_id NOT NULL, docs/UNIFIED_HOMECARE_PLAN.md decision 2): the agency exists before the first block writes clients (the sandbox fills a fixture row's company with the database's one company) */

// ── the migration's copy of the old single login ───────────────────────────────
// The backfill ran on an empty database during setup, so run its INSERT again over
// clients shaped the way the old template left them.
{
  const [a] = await db.insert(clients).values({ firstName: 'Old', lastName: 'Active', portalEmail: ' Old.Active@Test.local ', portalEnabled: true, portalPasswordHash: await Bun.password.hash('oldpass123', 'bcrypt') } as any).returning()
  const [p] = await db.insert(clients).values({ firstName: 'Old', lastName: 'Pending', portalEmail: 'old.pending@test.local', portalEnabled: true, portalToken: 'legacy-setup-token', portalTokenExp: new Date(Date.now() + 86400000) } as any).returning()
  const [off] = await db.insert(clients).values({ firstName: 'Old', lastName: 'Off', portalEmail: 'old.off@test.local', portalEnabled: false, portalPasswordHash: 'x' } as any).returning()
  await db.insert(clients).values({ firstName: 'Old', lastName: 'Dupe', portalEmail: 'OLD.ACTIVE@test.local', portalEnabled: false } as any)

  const sqlText = readFileSync(new URL('./db/migrations/0020_portal.sql', import.meta.url), 'utf8')
  const insert = sqlText.split('--> statement-breakpoint').map((s) => s.trim()).find((s) => /INSERT INTO "client_portal_accounts"/.test(s))!
  await pglite.exec(insert)
  await pglite.exec(insert) // re-running is harmless

  const rows = await db.select().from(clientPortalAccounts)
  const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]))
  check('backfill: one account per portal email, lowercased and trimmed', rows.length === 3 && !!byEmail['old.active@test.local'], rows.map((r) => r.email))
  check('backfill: a client who could sign in keeps a working, enabled login', byEmail['old.active@test.local']?.clientId === a.id && byEmail['old.active@test.local']?.portalEnabled === true && !!byEmail['old.active@test.local']?.passwordHash)
  check('backfill: two clients on one email — the enabled one keeps it', byEmail['old.active@test.local']?.clientId === a.id)
  check('backfill: an invited-not-set-up client keeps the setup link it was sent', byEmail['old.pending@test.local']?.inviteToken === 'legacy-setup-token' && byEmail['old.pending@test.local']?.portalEnabled === false && byEmail['old.pending@test.local']?.clientId === p.id)
  check('backfill: a switched-off portal stays off', byEmail['old.off@test.local']?.portalEnabled === false && byEmail['old.off@test.local']?.clientId === off.id)
  await db.delete(clientPortalAccounts)
}

void agency /* unified: the agency is made before the first clients (below) */
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-portal@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const owner = await mkUser('owner', 'owner')
const caregiver = await mkUser('caregiver', 'cg')
const cg2 = await mkUser('caregiver', 'cgtwo')
const stranger = await mkUser('caregiver', 'stranger')

// ── the migration's conversion of the older notifications.status ('sent', from 0005) ──
{
  await pglite.exec(`INSERT INTO notifications (id, user_id, title, is_read, status) VALUES
    ('legacy-read', '${owner.id}', 'old read', true, 'sent'), ('legacy-unread', '${owner.id}', 'old unread', false, 'sent'),
    ('legacy-null', '${owner.id}', 'old null', true, 'new')`)
  await pglite.exec(`UPDATE notifications SET status = NULL WHERE id = 'legacy-null'`).catch(() => {}) // NOT NULL now: stays 'new'
  const stmts = readFileSync(new URL('./db/migrations/0020_portal.sql', import.meta.url), 'utf8')
    .split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => /^(--[^\n]*\n)*\s*UPDATE "notifications"/.test(s))
  for (const s of stmts) await pglite.exec(s)
  const rows = await db.select().from(notifications)
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))
  check('migration: an old "sent" row that was read becomes handled, with a handled time', by['legacy-read']?.status === 'handled' && !!by['legacy-read']?.handledAt, by['legacy-read'])
  check('migration: an old "sent" row never read becomes new (the bell shows it)', by['legacy-unread']?.status === 'new' && !by['legacy-unread']?.handledAt, by['legacy-unread'])
  check('migration: a read row still marked new is moved to handled', by['legacy-null']?.status === 'handled', by['legacy-null'])
  await db.delete(notifications)
}

const [mary] = await db.insert(clients).values({ firstName: 'Mary', lastName: 'Client', email: 'mary@test.local', isActive: true } as any).returning()
const [bob] = await db.insert(clients).values({ firstName: 'Bob', lastName: 'Other', isActive: true } as any).returning()
const [gone] = await db.insert(clients).values({ firstName: 'Gone', lastName: 'Inactive', isActive: false } as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/portal', 'portal'],
  ['/api/family-portal', 'familyPortal'],
  ['/api/notifications', 'notifications'],
  ['/api/notification-settings', 'notificationSettings'],
  ['/api/push', 'push'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}
const staff = (u: any) => (m: string, p: string, b?: unknown) =>
  call(m, p, { 'x-test-user': u.id, 'x-test-role': u.role, 'x-test-email': u.email }, b)
const bearer = (token: string) => (m: string, p: string, b?: unknown) => call(m, p, { authorization: `Bearer ${token}` }, b)
const anon = (m: string, p: string, b?: unknown) => call(m, p, {}, b)
const asAdmin = staff(admin), asOwner = staff(owner), asCg = staff(caregiver)

// ══ client portal accounts ════════════════════════════════════════════════════════
const inv = await asAdmin('POST', '/api/portal/admin/invite', {
  clientId: mary.id,
  invitees: [{ email: 'Mary@Test.local', name: 'Mary' }, { email: 'tyler@test.local', name: 'Tyler (son)' }],
})
check('an admin invites two people to one client', inv.status === 200 && inv.json.success === true && inv.json.results?.length === 2, inv.json)
check('…each gets their own 48-hour link', inv.json.results?.every((r: any) => /\/portal\/setup\?token=[0-9a-f]{64}$/.test(r.inviteUrl)
  && Math.abs(new Date(r.expiresAt).getTime() - Date.now() - 48 * 3600e3) < 60e3), inv.json.results)
check('…and with no email provider the screen is told the email did NOT go out', inv.json.emailSent === false && /share those links manually/.test(inv.json.message), inv.json)
{
  const r = await asOwner('POST', '/api/portal/admin/invite', { clientId: mary.id, email: 'owner-sent@test.local' })
  check('an owner may invite too (the older single-email shape)', r.status === 200 && r.json.results?.[0]?.email === 'owner-sent@test.local', r.json)
  await asAdmin('DELETE', `/api/portal/admin/accounts/${(await db.select().from(clientPortalAccounts).where(eq(clientPortalAccounts.email, 'owner-sent@test.local')))[0].id}`)
}
{
  const r = await asCg('POST', '/api/portal/admin/invite', { clientId: mary.id, email: 'x@test.local' })
  check('a caregiver cannot invite anyone to a portal', r.status === 403, r)
  const r2 = await asAdmin('POST', '/api/portal/admin/invite', { clientId: bob.id, email: 'tyler@test.local' })
  check('an email already on another client is refused, by name', r2.json.success === false && /different client/.test(r2.json.results?.[0]?.error), r2.json)
  const r3 = await asAdmin('POST', '/api/portal/admin/invite', { clientId: mary.id, email: 'not-an-email' })
  check('a malformed email is refused', r3.status === 400 && /Invalid email address/.test(r3.json.error), r3.json)
  const r4 = await asAdmin('POST', '/api/portal/admin/invite', { clientId: gone.id, email: 'g@test.local' })
  check('an inactive client cannot be invited', r4.status === 404, r4.json)
  const r5 = await asAdmin('POST', '/api/portal/admin/invite', {})
  check('an empty invite is a 400, not a crash', r5.status === 400, r5)
}
const [maryRow] = await db.select().from(clients).where(eq(clients.id, mary.id))
check('inviting turns the client portal on with a live direct link (signable-document emails carry it)', maryRow.portalEnabled === true && !!maryRow.portalToken && new Date(maryRow.portalTokenExp!).getTime() > Date.now())
check('…and the email is stored lowercase', !!(await db.select().from(clientPortalAccounts).where(eq(clientPortalAccounts.email, 'mary@test.local')))[0])

{
  const r = await asAdmin('GET', `/api/portal/admin/clients/${mary.id}/accounts`)
  check('the client\'s logins list one row per person, both invite-pending', r.status === 200 && r.json.length === 2 && r.json.every((a: any) => a.status === 'invite_pending'), r.json)
  check('…and never the password hash or the invite token', !JSON.stringify(r.json).includes('passwordHash') && !JSON.stringify(r.json).includes('inviteToken'))
  const all = await asAdmin('GET', '/api/portal/admin/clients')
  const m = (all.json || []).find((x: any) => x.id === mary.id), b = (all.json || []).find((x: any) => x.id === bob.id)
  check('the all-clients view: Mary invite_pending with 2 accounts, Bob not_invited', m?.portal_status === 'invite_pending' && Number(m?.account_count) === 2 && b?.portal_status === 'not_invited', { m, b })
  check('the all-clients view is office-only', (await asCg('GET', '/api/portal/admin/clients')).status === 403)
}

const tokenFor = (email: string) => db.select().from(clientPortalAccounts).where(eq(clientPortalAccounts.email, email)).then((r) => r[0])
{
  const pending = await anon('POST', '/api/portal/login', { email: 'mary@test.local', password: 'whatever1' })
  check('an invited person who has not set a password cannot sign in', pending.status === 401, pending)
  const short = await anon('POST', '/api/portal/set-password', { token: (await tokenFor('mary@test.local')).inviteToken, password: 'short' })
  check('a password under 8 characters is refused', short.status === 400 && /at least 8/.test(short.json.error), short.json)
  for (const [email, pw] of [['mary@test.local', 'marypass1'], ['tyler@test.local', 'tylerpass1']]) {
    const t = (await tokenFor(email)).inviteToken
    const r = await anon('POST', '/api/portal/set-password', { token: t, password: pw })
    check(`${email} sets a password from their invite`, r.status === 200 && r.json.success === true, r.json)
    const again = await anon('POST', '/api/portal/set-password', { token: t, password: pw })
    check(`…and the link is single-use`, again.status === 400, again.json)
  }
}

const login = (email: string, password: string) => anon('POST', '/api/portal/login', { email, password })
const maryLogin = await login('MARY@test.local', 'marypass1')
check('sign-in is case-insensitive on the email', maryLogin.status === 200 && !!maryLogin.json.token, maryLogin.json)
const maryTok = maryLogin.json.token
const decoded: any = jwt.decode(maryTok)
check('the session says which person and which client, and lasts 8 hours', decoded?.accountEmail === 'mary@test.local' && decoded?.clientId === mary.id && decoded.exp - decoded.iat === 8 * 3600, decoded)
const tylerTok = (await login('tyler@test.local', 'tylerpass1')).json.token
{
  const me = await bearer(tylerTok)('GET', '/api/portal/me')
  check('/me names the person signed in (Tyler), for Mary\'s portal', me.status === 200 && me.json.first_name === 'Mary' && me.json.portal_email === 'tyler@test.local' && me.json.display_name === 'Tyler (son)', me.json)
  const acct = await tokenFor('tyler@test.local')
  check('a sign-in records that person\'s last login', !!acct.lastLogin)
}
{
  const staffTok = jwt.sign({ userId: admin.id, role: 'admin' }, process.env.JWT_SECRET!)
  const r = await bearer(staffTok)('GET', '/api/portal/me')
  check('a staff token does not open the client portal', r.status === 403, r)
  check('no token, no portal', (await anon('GET', '/api/portal/me')).status === 401)
}

// ── lockout: per person, 5 strikes, 15 minutes ──────────────────────────────────
{
  const statuses: number[] = []
  for (let i = 0; i < 5; i++) statuses.push((await login('tyler@test.local', 'wrong-password')).status)
  check('five wrong passwords each answer 401', statuses.every((s) => s === 401), statuses)
  const acct = await tokenFor('tyler@test.local')
  const mins = (new Date(acct.lockedUntil!).getTime() - Date.now()) / 60000
  check('…and the fifth locks the account for 15 minutes', acct.failedLoginCount === 5 && mins > 14.5 && mins <= 15, { count: acct.failedLoginCount, mins })
  const right = await login('tyler@test.local', 'tylerpass1')
  check('while locked even the right password is refused with 423', right.status === 423 && /temporarily locked/.test(right.json.error), right)
  const mary2 = await login('mary@test.local', 'marypass1')
  check('one relative\'s lockout does not lock the client out', mary2.status === 200, mary2)
  await db.update(clientPortalAccounts).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(clientPortalAccounts.id, acct.id))
  const after = await login('tyler@test.local', 'tylerpass1')
  const reset = await tokenFor('tyler@test.local')
  check('after the lock runs out the right password works and the count resets', after.status === 200 && reset.failedLoginCount === 0 && reset.lockedUntil === null, { status: after.status, count: reset.failedLoginCount })
  const four: number[] = []
  for (let i = 0; i < 4; i++) four.push((await login('tyler@test.local', 'nope-nope')).status)
  check('four wrong passwords do not lock', (await tokenFor('tyler@test.local')).lockedUntil === null && four.every((s) => s === 401))
  await db.update(clientPortalAccounts).set({ failedLoginCount: 0 }).where(eq(clientPortalAccounts.email, 'tyler@test.local'))
}

// ── forgot password ────────────────────────────────────────────────────────────
{
  const unknown = await anon('POST', '/api/portal/forgot-password', { email: 'nobody@test.local' })
  const known = await anon('POST', '/api/portal/forgot-password', { email: 'Tyler@test.local' })
  check('forgot-password answers the same whether or not the account exists', unknown.status === 200 && known.status === 200 && unknown.json.message === known.json.message, { unknown: unknown.json, known: known.json })
  check('forgot-password with no email is a 400', (await anon('POST', '/api/portal/forgot-password', {})).status === 400)
  const acct = await tokenFor('tyler@test.local')
  const mins = (new Date(acct.inviteExpiresAt!).getTime() - Date.now()) / 60000
  check('a reset link lasts one hour', !!acct.inviteToken && mins > 59 && mins <= 60, mins)
  check('…and the current password still works until it is used', (await login('tyler@test.local', 'tylerpass1')).status === 200)
  await db.update(clientPortalAccounts).set({ inviteExpiresAt: new Date(Date.now() - 1000) }).where(eq(clientPortalAccounts.id, acct.id))
  const expired = await anon('POST', '/api/portal/set-password', { token: acct.inviteToken, password: 'newtyler12' })
  check('an expired reset link is refused', expired.status === 400 && /Invalid or expired/.test(expired.json.error), expired.json)
  await anon('POST', '/api/portal/forgot-password', { email: 'tyler@test.local' })
  const fresh = await tokenFor('tyler@test.local')
  const used = await anon('POST', '/api/portal/set-password', { token: fresh.inviteToken, password: 'newtyler12' })
  check('a fresh reset link sets the new password', used.status === 200 && (await login('tyler@test.local', 'newtyler12')).status === 200, used.json)
  check('…and the old password stops working', (await login('tyler@test.local', 'tylerpass1')).status === 401)
  await db.update(clientPortalAccounts).set({ failedLoginCount: 0 }).where(eq(clientPortalAccounts.email, 'tyler@test.local'))
}

// ── per-person revocation and the whole-portal switch ───────────────────────────
{
  const tyler2 = (await login('tyler@test.local', 'newtyler12')).json.token
  const tylerAcct = await tokenFor('tyler@test.local')
  const del = await asAdmin('DELETE', `/api/portal/admin/accounts/${tylerAcct.id}`)
  check('an admin removes one relative\'s login', del.status === 200 && del.json.removed === 'tyler@test.local', del.json)
  check('…their live session stops at once', (await bearer(tyler2)('GET', '/api/portal/me')).status === 403)
  check('…Mary\'s does not', (await bearer(maryTok)('GET', '/api/portal/me')).status === 200)
  check('a caregiver cannot remove a login', (await asCg('DELETE', `/api/portal/admin/accounts/${(await tokenFor('mary@test.local')).id}`)).status === 403)

  const bad = await asAdmin('PUT', `/api/portal/admin/clients/${mary.id}/toggle`, {})
  check('the switch needs a true/false', bad.status === 400, bad)
  const off = await asAdmin('PUT', `/api/portal/admin/clients/${mary.id}/toggle`, { enabled: false })
  check('switching the portal off ends every session', off.status === 200 && (await bearer(maryTok)('GET', '/api/portal/me')).status === 403)
  check('…and nobody can sign in', (await login('mary@test.local', 'marypass1')).status === 401)
  const [c1] = await db.select().from(clients).where(eq(clients.id, mary.id))
  const link = await anon('POST', '/api/portal/exchange', { token: c1.portalToken })
  check('…including through the direct link', link.status === 401, link)
  await asAdmin('PUT', `/api/portal/admin/clients/${mary.id}/toggle`, { enabled: true })
  check('switching it back on lets Mary in again', (await login('mary@test.local', 'marypass1')).status === 200)
  const viaLink = await anon('POST', '/api/portal/exchange', { token: c1.portalToken })
  check('the direct link still redeems for a session when the portal is on', viaLink.status === 200 && !!viaLink.json.token, viaLink.json)
  check('…and that session opens /me', (await bearer(viaLink.json.token)('GET', '/api/portal/me')).status === 200)
}

// ── preview ("View As" → Client Portal) ─────────────────────────────────────────
{
  check('a caregiver cannot preview a portal', (await asCg('POST', `/api/portal/admin/preview/${mary.id}`)).status === 403)
  const pv = await asAdmin('POST', `/api/portal/admin/preview/${mary.id}`)
  const d: any = jwt.decode(pv.json.token)
  check('an admin\'s preview token is marked as one and lasts 2 hours', pv.status === 200 && d?.impersonation === true && d.exp - d.iat === 7200, d)
  const me = await bearer(pv.json.token)('GET', '/api/portal/me')
  check('the preview shows the client\'s portal', me.status === 200 && me.json.first_name === 'Mary' && me.json.preview === true, me.json)
  const write = await bearer(pv.json.token)('POST', '/api/portal/messages', { subject: 'hi', body: 'as the client' })
  check('the preview is read-only — an admin cannot write as the client', write.status === 403 && /read-only/.test(write.json.error), write)
  check('previewing a client that does not exist is a 404', (await asAdmin('POST', '/api/portal/admin/preview/nope')).status === 404)
}

// ── caregivers, background checks, invoices ─────────────────────────────────────
{
  await db.insert(clientAssignments).values({ clientId: mary.id, caregiverId: caregiver.id, assignmentDate: '2026-09-01', status: 'active' } as any)
  // Real visits (times + an effective date): "serving" is read from the next four weeks of visits
  // through the schedule engine (Run 3), and a schedule row with no times produces no visit.
  const visitTimes = { startTime: new Date('2026-01-01T09:00:00Z'), endTime: new Date('2026-01-01T11:00:00Z'), effectiveDate: '2026-01-01' }
  await db.insert(schedules).values({ clientId: mary.id, caregiverId: cg2.id, dayOfWeek: 2, isActive: true, status: 'active', ...visitTimes } as any)
  await db.insert(schedules).values({ clientId: bob.id, caregiverId: stranger.id, dayOfWeek: 3, isActive: true, ...visitTimes } as any)
  await db.insert(backgroundChecks).values({ caregiverId: cg2.id, checkType: 'criminal', provider: 'State DOJ', status: 'completed', findings: 'SECRET FINDING', notes: 'SECRET NOTE', cost: '25.00', referenceNumber: 'REF-123' } as any)

  const r = await bearer(maryTok)('GET', '/api/portal/caregivers')
  const ids = (r.json || []).map((x: any) => x.caregiver_id).sort()
  check('caregivers = an active assignment OR a visit in the next four weeks', r.status === 200 && ids.length === 2 && ids.includes(caregiver.id) && ids.includes(cg2.id) && !ids.includes(stranger.id), r.json)
  const bc = await bearer(maryTok)('GET', `/api/portal/caregivers/${cg2.id}/background-checks`)
  const s = JSON.stringify(bc.json)
  check('a scheduled caregiver\'s background check shows as a summary', bc.status === 200 && bc.json.length === 1 && bc.json[0].status === 'completed' && bc.json[0].provider === 'State DOJ', bc.json)
  check('…never the findings, notes, cost or reference number', !/SECRET|25\.00|REF-123/.test(s), s)
  const other = await bearer(maryTok)('GET', `/api/portal/caregivers/${stranger.id}/background-checks`)
  check('a caregiver who does not serve this client is refused', other.status === 403 && /not assigned to you/.test(other.json.error), other)

  const [invRow] = await db.insert(invoices).values({ invoiceNumber: 'INV-P1', clientId: mary.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-07', subtotal: '90', total: '90', sentAt: new Date() } as any).returning()
  for (const [d, h, amt] of [['2026-09-03', '2.00', '60'], [null, '0.50', '15'], ['2026-09-01', '0.50', '15']] as const) {
    await db.insert(invoiceLineItems).values({ invoiceId: invRow.id, caregiverId: caregiver.id, description: 'Personal care', serviceDate: d, hours: h, rate: '30', amount: amt } as any)
  }
  await db.insert(invoices).values({ invoiceNumber: 'INV-B1', clientId: bob.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-07', subtotal: '1', total: '1', sentAt: new Date() } as any)
  const iv = await bearer(maryTok)('GET', '/api/portal/invoices')
  const lines = iv.json?.[0]?.lineItems || []
  check('a client sees only their own invoices', iv.status === 200 && iv.json.length === 1 && iv.json[0].invoiceNumber === 'INV-P1', iv.json)
  check('invoice lines come in date order, undated last (the per-day breakdown)', lines.map((l: any) => l.serviceDate).join(',') === '2026-09-01,2026-09-03,', lines)
  check('…and the hours on them total 3.00', lines.reduce((s: number, l: any) => s + Number(l.hours), 0).toFixed(2) === '3.00')
}

// ── client notifications + preferences ──────────────────────────────────────────
{
  const n = await asAdmin('POST', '/api/portal/admin/notify', { clientId: mary.id, type: 'general', title: 'Hello', message: 'From the office', relatedInvoiceId: 'inv-1' })
  check('the office posts a notification to a client\'s portal', n.status === 201 && n.json.relatedInvoiceId === 'inv-1', n.json)
  check('a caregiver cannot', (await asCg('POST', '/api/portal/admin/notify', { clientId: mary.id, type: 'general', title: 'x' })).status === 403)
  check('notify without a title is a 400', (await asAdmin('POST', '/api/portal/admin/notify', { clientId: mary.id, type: 'x' })).status === 400)
  const list = await bearer(maryTok)('GET', '/api/portal/notifications')
  check('the client sees it', list.json?.some((x: any) => x.title === 'Hello'), list.json)
  await bearer(maryTok)('PUT', '/api/portal/preferences', { scheduleAlerts: false, billingAlerts: 'nonsense' })
  await bearer(maryTok)('PUT', '/api/portal/preferences', { emailEnabled: false })
  const [pref] = await db.select().from(clientNotificationPreferences).where(eq(clientNotificationPreferences.clientId, mary.id))
  check('client preferences save one switch at a time and ignore a non-boolean', pref?.scheduleAlerts === false && pref?.emailEnabled === false && pref?.billingAlerts === true, pref)
}

// ══ family portal ══════════════════════════════════════════════════════════════════
{
  check('a caregiver cannot add a family member', (await asCg('POST', '/api/family-portal/admin/members', { clientId: mary.id, firstName: 'A', email: 'a@x.local', password: 'password1' })).status === 403)
  const missing = await asAdmin('POST', '/api/family-portal/admin/members', { clientId: mary.id, firstName: 'Ann' })
  check('a family member needs client, name, email and password', missing.status === 400, missing.json)
  const created = await asAdmin('POST', '/api/family-portal/admin/members', {
    clientId: mary.id, firstName: 'Ann', lastName: 'Daughter', email: 'Ann@Family.local', phone: '555', relationship: 'child', password: 'annpass12',
  })
  check('an admin adds a relative with the default permissions', created.status === 201 && created.json.name === 'Ann Daughter'
    && created.json.canViewSchedule === true && created.json.canViewCarePlan === true && created.json.canViewMedications === false && created.json.canMessage === true, created.json)
  check('…and the answer carries no password hash', !JSON.stringify(created.json).includes('asswordHash'))
  const dupe = await asAdmin('POST', '/api/family-portal/admin/members', { clientId: bob.id, firstName: 'X', email: 'ann@family.local', password: 'password1' })
  check('the same email twice is refused, whatever its case', dupe.status === 400 && /already exists/.test(dupe.json.error), dupe.json)
  const list = await asAdmin('GET', `/api/family-portal/admin/members?clientId=${mary.id}&status=active`)
  check('the members list names the client and hides the password', list.json?.length === 1 && list.json[0].clientFirstName === 'Mary' && !JSON.stringify(list.json).includes('asswordHash'), list.json)

  const fl = await anon('POST', '/api/family-portal/login', { email: 'ANN@family.local', password: 'annpass12' })
  check('the relative signs in', fl.status === 200 && !!fl.json.token && fl.json.user?.canViewMedications === false, fl.json)
  check('a wrong password does not', (await anon('POST', '/api/family-portal/login', { email: 'ann@family.local', password: 'nope-nope' })).status === 401)
  const fam = bearer(fl.json.token)
  const fd: any = jwt.decode(fl.json.token)
  check('a family session lasts 24 hours', fd.exp - fd.iat === 24 * 3600)

  await db.insert(medications).values({ clientId: mary.id, name: 'Lisinopril', dosage: '10mg', status: 'active' } as any)
  const meds = await fam('GET', '/api/family-portal/portal/medications')
  check('medications are refused while that switch is off', meds.status === 403, meds)
  const flip = await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}`, { canViewMedications: true })
  check('an admin switches medications on', flip.status === 200 && flip.json.canViewMedications === true, flip.json)
  const meds2 = await fam('GET', '/api/family-portal/portal/medications')
  check('…and it applies to the very next request, same session', meds2.status === 200 && meds2.json[0]?.name === 'Lisinopril', meds2.json)

  const cgs = await fam('GET', '/api/family-portal/portal/caregivers')
  check('a relative sees the client\'s caregivers, without phone numbers', cgs.status === 200 && cgs.json.length === 2 && cgs.json.every((x: any) => x.phone === null), cgs.json)
  const fbc = await fam('GET', `/api/family-portal/portal/caregivers/${stranger.id}/background-checks`)
  check('…and only background checks for caregivers serving their loved one', fbc.status === 403 && /loved one/.test(fbc.json.error), fbc)
  check('the client\'s details carry the agency state (for state-specific screening wording)', (await fam('GET', '/api/family-portal/portal/client')).json.agencyState === 'OH')

  await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}`, { canMessage: false })
  check('sending a message is refused with messaging off', (await fam('POST', '/api/family-portal/portal/messages', { message: 'hello' })).status === 403)
  await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}`, { canMessage: true })
  check('an empty message is a 400', (await fam('POST', '/api/family-portal/portal/messages', { message: '   ' })).status === 400)
  const sent = await fam('POST', '/api/family-portal/portal/messages', { subject: 'Mom', message: 'How was today?' })
  check('the relative sends a message', sent.status === 201, sent.json)
  const inbox = await asAdmin('GET', '/api/family-portal/admin/messages')
  const msg = inbox.json?.find((m: any) => m.message === 'How was today?')
  check('the office sees it, unread, with who sent it', !!msg && msg.isRead === false && msg.senderName === 'Ann Daughter' && msg.clientFirstName === 'Mary', inbox.json)
  check('a caregiver cannot read the family inbox', (await asCg('GET', '/api/family-portal/admin/messages')).status === 403)
  check('a reply needs words', (await asAdmin('POST', `/api/family-portal/admin/messages/${msg.id}/reply`, {})).status === 400)
  const rep = await asAdmin('POST', `/api/family-portal/admin/messages/${msg.id}/reply`, { reply: 'She had a good day.' })
  check('the office replies', rep.status === 200, rep.json)
  const mine = await fam('GET', '/api/family-portal/portal/messages')
  const orig = mine.json?.find((m: any) => m.direction === 'inbound')
  const out = mine.json?.find((m: any) => m.direction === 'outbound')
  // Run 4: the reply is its own message, ONCE — the copy kept on the family's row for the office is
  // not sent, or the portal printed every reply twice.
  check('the relative sees the reply once, as its own message', out?.message === 'She had a good day.'
    && mine.json.filter((m: any) => m.message === 'She had a good day.').length === 1 && orig?.reply === undefined, mine.json)

  const off = await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}/status`, { isActive: false })
  check('an admin switches the relative off', off.status === 200)
  check('…their session stops at once', (await fam('GET', '/api/family-portal/portal/client')).status === 403)
  check('…and they cannot sign in', (await anon('POST', '/api/family-portal/login', { email: 'ann@family.local', password: 'annpass12' })).status === 401)
  await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}/status`, { isActive: true })
  const rp = await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}/reset-password`, { password: 'brandnew99' })
  check('an admin resets a relative\'s password', rp.status === 200 && (await anon('POST', '/api/family-portal/login', { email: 'ann@family.local', password: 'brandnew99' })).status === 200, rp.json)
  check('…not to anything under 8 characters', (await asAdmin('PUT', `/api/family-portal/admin/members/${created.json.id}/reset-password`, { password: 'short' })).status === 400)
  const clientTok = await bearer(maryTok)('GET', '/api/family-portal/portal/client')
  check('a client-portal token does not open the family portal', clientTok.status === 403, clientTok)
}

// ── the client portal's message threads, answered from the office ───────────────
{
  const t = await bearer(maryTok)('POST', '/api/portal/messages', { subject: 'Question', body: 'Is Tuesday on?' })
  const threads = await asAdmin('GET', '/api/family-portal/admin/portal-threads')
  const th = threads.json?.find((x: any) => x.id === t.json.thread?.id)
  check('a client\'s portal message reaches the office, unread', !!th && th.hasUnread === true && th.clientFirstName === 'Mary', threads.json)
  const rep = await asAdmin('POST', `/api/family-portal/admin/portal-threads/${th.id}/reply`, { body: 'Yes, 9am.' })
  check('the office replies in the thread', rep.status === 201)
  const view = await bearer(maryTok)('GET', `/api/portal/messages/${th.id}`)
  check('the client sees the reply', view.json?.messages?.some((m: any) => m.senderType === 'staff' && m.body === 'Yes, 9am.'), view.json)
  check('a caregiver cannot read client threads', (await asCg('GET', '/api/family-portal/admin/portal-threads')).status === 403)
}

// ══ staff notifications ════════════════════════════════════════════════════════════
{
  const sent = await asAdmin('POST', '/api/notifications/send', { recipientId: caregiver.id, subject: 'Shift', message: 'Tomorrow 9am' })
  check('an admin sends a notification', sent.status === 201 && sent.json.status === 'new' && sent.json.type === 'general', sent.json)
  check('a caregiver cannot send one', (await asCg('POST', '/api/notifications/send', { recipientId: admin.id, subject: 'x', message: 'y' })).status === 403)
  check('sending to nobody is a 404, not a crash', (await asAdmin('POST', '/api/notifications/send', { recipientId: 'ghost', subject: 'x', message: 'y' })).status === 404)
  const bulk = await asAdmin('POST', '/api/notifications/send-bulk', { recipientIds: [caregiver.id, caregiver.id], subject: 'All hands', message: 'Meeting' })
  check('bulk send writes one per recipient', bulk.status === 201 && bulk.json.sent === 2, bulk.json)

  const bell = async () => (await asCg('GET', '/api/push/unread-count')).json.count
  check('the bell counts the three new ones', await bell() === 3)
  const mine = (await asCg('GET', '/api/notifications?status=new')).json
  check('the New tab shows the same three', mine.length === 3, mine)
  const h = await asCg('PATCH', `/api/notifications/${mine[0].id}/status`, { status: 'handled' })
  check('handling one sets handled, read, when and by whom', h.status === 200 && h.json.status === 'handled' && h.json.isRead === true && !!h.json.handledAt && h.json.handledById === caregiver.id, h.json)
  check('…and the bell drops to 2, matching the page', await bell() === 2 && (await asCg('GET', '/api/notifications?status=new')).json.length === 2)
  const re = await asCg('PATCH', `/api/notifications/${mine[0].id}/status`, { status: 'new' })
  check('reopening clears handled and makes it unread again', re.json.status === 'new' && re.json.isRead === false && re.json.handledAt === null, re.json)
  check('a bad status is refused', (await asCg('PATCH', `/api/notifications/${mine[0].id}/status`, { status: 'deleted' })).status === 400)
  check('somebody else cannot handle my notification', (await asAdmin('PATCH', `/api/notifications/${mine[0].id}/status`, { status: 'archived' })).status === 404)
  const b = await asCg('POST', '/api/notifications/bulk-status', { ids: [mine[1].id, mine[2].id], status: 'archived' })
  check('bulk archive', b.json.updated === 2 && (await asCg('GET', '/api/notifications?status=archived')).json.length === 2, b.json)
  const other = await asAdmin('POST', '/api/notifications/bulk-status', { ids: [mine[0].id], status: 'archived' })
  check('bulk status only touches my own', other.json.updated === 0, other.json)
  await asCg('POST', '/api/push/mark-read', { ids: 'all' })
  check('the bell\'s mark-all-read moves everything new to handled', await bell() === 0 && (await asCg('GET', '/api/notifications?status=handled')).json.length === 1)
  check('mark-read with nothing to mark is a 400', (await asCg('POST', '/api/push/mark-read', {})).status === 400)
  {
    // The drift the bell fix was about: a writer that sets is_read but not status. The
    // page lists it under New, so the bell must count it too.
    const [drift] = await db.insert(notifications).values({ userId: caregiver.id, title: 'drift', isRead: true }).returning()
    const newTab = (await asCg('GET', '/api/notifications?status=new')).json.length
    check('the bell counts exactly what the New tab lists, whatever is_read says', await bell() === 1 && newTab === 1, { bell: await bell(), newTab })
    await db.delete(notifications).where(eq(notifications.id, drift.id))
  }
  check('another person cannot delete it', (await asAdmin('DELETE', `/api/notifications/${mine[0].id}`)).status === 404)
  check('I can', (await asCg('DELETE', `/api/notifications/${mine[0].id}`)).status === 200)
  const sum = await asAdmin('GET', '/api/notifications/summary')
  check('the office summary counts every notification', sum.status === 200 && sum.json.totalNotifications === 2 && sum.json.uniqueRecipients === 1, sum.json)
  check('the summary is office-only', (await asCg('GET', '/api/notifications/summary')).status === 403)
}

// ── delivery preferences + the send-side gate ───────────────────────────────────
{
  const d = await asCg('GET', '/api/notification-settings')
  check('never saved → every channel and alert on, no quiet hours', d.json.smsEnabled === true && d.json.lowAuthAlerts === true && d.json.quietHoursStart === null, d.json)
  const bad = await asCg('PUT', '/api/notification-settings', { quietHoursStart: '9pm', quietHoursEnd: '07:00' })
  check('a quiet-hours time that is not HH:MM is refused', bad.status === 400, bad.json)
  const half = await asCg('PUT', '/api/notification-settings', { quietHoursStart: '21:00', quietHoursEnd: null })
  check('half a quiet-hours window is refused', half.status === 400, half.json)
  const ok = await asCg('PUT', '/api/notification-settings', { smsEnabled: false, shiftReminderAlerts: false, quietHoursStart: '21:00', quietHoursEnd: '07:00', quietHoursSkipEmergency: true })
  check('a caregiver saves their own preferences', ok.status === 200 && ok.json.smsEnabled === false && String(ok.json.quietHoursStart).startsWith('21:00'), ok.json)
  const legacy = await asCg('PUT', '/api/notifications/preferences', { emailEnabled: true })
  check('the older preferences door does not wipe quiet hours it never mentions', String(legacy.json.quietHoursStart).startsWith('21:00'), legacy.json)

  const { shouldNotify, inQuietHours, invalidate } = await import('./src/services/notificationPrefs.ts')
  invalidate()
  const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00Z`)
  const o = (hhmm: string, extra: any = {}) => ({ now: at(hhmm), timeZone: 'UTC', ...extra })
  check('SMS switched off → no SMS', (await shouldNotify(caregiver.id, 'sms', 'schedule', o('12:00'))) === false)
  check('push still on → push at noon', (await shouldNotify(caregiver.id, 'push', 'schedule', o('12:00'))) === true)
  check('shift reminders switched off → none by email either', (await shouldNotify(caregiver.id, 'email', 'shift_reminder', o('12:00'))) === false)
  check('21:00–07:00 quiet hours: 23:30 is quiet', (await shouldNotify(caregiver.id, 'push', 'schedule', o('23:30'))) === false)
  check('…03:00 is quiet (the window wraps midnight)', (await shouldNotify(caregiver.id, 'push', 'schedule', o('03:00'))) === false)
  check('…07:00 is not (the end is exclusive)', (await shouldNotify(caregiver.id, 'push', 'schedule', o('07:00'))) === true)
  check('…20:59 is not', (await shouldNotify(caregiver.id, 'push', 'schedule', o('20:59'))) === true)
  check('…an urgent alert still goes at 03:00', (await shouldNotify(caregiver.id, 'push', 'absence', o('03:00', { urgent: true }))) === true)
  await asCg('PUT', '/api/notification-settings', { quietHoursSkipEmergency: false, quietHoursStart: '21:00', quietHoursEnd: '07:00' })
  check('…unless the person said not even urgent ones (and the save applies at once)', (await shouldNotify(caregiver.id, 'push', 'absence', o('03:00', { urgent: true }))) === false)
  check('nobody who never saved preferences is ever blocked', (await shouldNotify(admin.id, 'sms', 'shift_reminder', o('03:00'))) === true)
  check('an unknown channel is never allowed', (await shouldNotify(admin.id, 'fax' as any, null, o('12:00'))) === false)
  check('a same-day window 09:00–17:00: 12:00 quiet, 17:00 not', inQuietHours({ quietHoursStart: '09:00:00', quietHoursEnd: '17:00:00' }, at('12:00'), 'UTC') === true
    && inQuietHours({ quietHoursStart: '09:00', quietHoursEnd: '17:00' }, at('17:00'), 'UTC') === false)
  check('quiet hours follow the agency\'s zone: 02:00Z is 21:00 in Chicago (CDT)', inQuietHours({ quietHoursStart: '21:00', quietHoursEnd: '07:00' }, at('02:00'), 'America/Chicago') === true
    && inQuietHours({ quietHoursStart: '21:00', quietHoursEnd: '07:00' }, at('01:59'), 'America/Chicago') === false)
}

// ── the doors anyone can knock on refuse an empty body without crashing ───────────
for (const p of ['/api/portal/login', '/api/portal/set-password', '/api/portal/forgot-password', '/api/portal/exchange', '/api/family-portal/login']) {
  const r = await anon('POST', p, {})
  check(`POST ${p} with nothing answers 400`, r.status === 400, r)
}
check('the office portal list is not readable signed out', (await anon('GET', '/api/portal/admin/clients')).status === 401)
check('client notifications table still holds the office note', (await db.select().from(clientNotifications)).length >= 1)
check('the notifications table defaults status to new', (await db.insert(notifications).values({ userId: owner.id, title: 't' }).returning())[0].status === 'new')
void familyMembers

console.log(`\nhomecare-portal: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
