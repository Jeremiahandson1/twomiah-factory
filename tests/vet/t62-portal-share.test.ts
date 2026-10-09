// T62 decision (owner, 2026-10-09): vet staff keep add/edit on a client, but a client's PORTAL LINK —
// the credential — is owners', admins' and managers' only.
//
//   "The stylist holds contacts:create and contacts:update. That lets them fetch any client's working
//    portal link, which is the credential behind the original T42 high."
//
// Every portal route that issues, reads, mails or withdraws the link now asks portal:share. The status
// read (is it on, when does it expire) stays contacts:read. Asserted through the real portal router.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Share Vet', slug: 'share-vet-t62', email: 'share-vet-t62@test.local', state: 'OH', settings: {}, enabledFeatures: ['contacts', 'client_portal'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@share-vet-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), manager = await mk('manager', 'manager'), staff = await mk('staff', 'staff')

const TOKEN = 't62share' + 'a1b2c3d4e5f60718293a'
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Morgan Ellis', email: 't62-share@share-vet-t62.local',
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 30 * 86400000),
} as any).returning()
const [fresh] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'New Client', email: 't62-fresh@share-vet-t62.local' } as any).returning()

const app = new Hono()
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const P = `/api/portal/contacts/${client.id}`

// ── vet staff: the status, never the key ──
const st = await as(staff)('GET', `${P}/status`)
check('vet staff still read whether the portal is on', st.status === 200 && st.json?.enabled === true, st.json)
check('…and the status read carries no link', !st.text.includes(TOKEN), st.text.slice(0, 200))
for (const [m, path] of [['GET', '/link'], ['POST', '/regenerate'], ['POST', '/send-link'], ['POST', '/disable']] as const) {
  const r = await as(staff)(m, P + path)
  check(`vet staff: ${m} …${path} is refused (403)`, r.status === 403, { status: r.status, body: r.text.slice(0, 160) })
  check(`…and no token in that answer`, !r.text.includes(TOKEN))
}
const en = await as(staff)('POST', `/api/portal/contacts/${fresh.id}/enable`)
check('vet staff cannot switch a client\'s portal on (that response IS a link)', en.status === 403, { status: en.status })
const [after] = await db.select().from(contact).where((await import('drizzle-orm')).eq(contact.id, client.id))
check('the refused regenerate/disable left the client\'s link exactly as it was', after.portalToken === TOKEN && after.portalEnabled === true, { enabled: after.portalEnabled })

// ── they keep add/edit on the client ──
const ed = await as(staff)('PUT', `/api/contacts/${fresh.id}`, { name: 'New Client', phone: '555-0162' })
check('vet staff keep editing a client\'s card (contacts:update untouched)', ed.status === 200, { status: ed.status, body: ed.text.slice(0, 160) })

// ── the desk: owner, admin, manager ──
for (const [who, label] of [[owner, 'the owner'], [admin, 'an admin'], [manager, 'a manager']] as const) {
  const l = await as(who)('GET', `${P}/link`)
  check(`${label} is handed the link`, l.status === 200 && typeof l.json?.portalUrl === 'string' && l.json.portalUrl.includes(TOKEN), { status: l.status })
}
const men = await as(manager)('POST', `/api/portal/contacts/${fresh.id}/enable`)
check('a manager switches a client\'s portal on', men.status === 200 && typeof men.json?.portalUrl === 'string', { status: men.status, body: men.text.slice(0, 160) })

console.log(`\nt62 portal share: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
