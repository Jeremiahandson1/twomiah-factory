// A stylist could read the client's portal password off the chart. (T42 salon, HIGH)
//
//   "Stylists can read client portal tokens: GET /api/clients/:id returns contact.portalToken for
//    portal-enabled clients (removed from list endpoints in T22, not the detail endpoint)."
//
// `contact.portal_token` is a BEARER CREDENTIAL. Whoever holds it opens /portal/<token> as that
// client. It is a password kept in a column, and on this vertical it is worse than useless: the salon
// bundle has no client-portal screen at all, so the secret was being handed to the lowest seat in the
// shop for a feature nobody can even use.
//
// WHAT THE REPORT GOT RIGHT, AND WHAT IT COULD NOT SEE. T22 did fix the LIST — by hand, in the map
// that flattens contact and profile into one row — and the fix stopped there. The chart one handler
// below returned `contact: ct`, the whole row. Two reads of the same table, one stripping and one
// not, is the shape every round of this campaign has had to undo; both go through one helper now
// (`withoutPortalCredential`, exported from the shared contacts module), and a new CI guard,
// scripts/check-portal-token-never-ships.ts, walks every backend file in the fleet for the next door.
//
// The assertions scan the RESPONSE TEXT for the token itself as well as checking the keys, because
// the field arriving under a different name, or nested one level down inside the profile, is the same
// disclosure. And the chart is checked for what it must still carry: a stylist absolutely needs the
// client's name, email and phone — withholding those would be a different bug.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, clientProfile } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Olive & Oak Salon', slug: 'olive-t42-portal', email: 'portal-t42@test.local',
  settings: { timezone: 'UTC' }, enabledFeatures: ['salon', 'invoices', 'client_portal'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@olive-t42.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
// The seat the report logged in as. qa.staff on the salon tenant reports role 'field'.
const stylist = await mkUser('field', 'stylist')

// A token with a shape nothing else in the payload could produce, so a text scan is conclusive.
const TOKEN = 't42portal' + 'a1b2c3d4e5f6a7b8c9d0'
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Priya Raghunathan',
  email: 'priya-t42@test.local', phone: '614-555-0117',
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 30 * 86400000),
} as any).returning()

await db.insert(clientProfile).values({
  companyId: co.id, contactId: client.id, hairType: 'fine, wavy', allergies: 'PPD',
} as any)

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asStylist = as(stylist)
const rowsOf = (p: any) => (Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [])

// ══════════ the chart — the endpoint the report named ════════════════════════════════════════════
console.log('\n══════════ GET /api/clients/:id — the client chart ══════════')
for (const [label, call] of [['the stylist', asStylist], ['the owner', asOwner]] as const) {
  const r = await call('GET', `/api/clients/${client.id}`)
  check(`${label} opens the chart`, r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  check(`…and it carries no portalToken`, !('portalToken' in (r.json?.contact || {})), r.json?.contact?.portalToken)
  check(`…nor portalTokenExp — the expiry alone says whether a link is still live`,
    !('portalTokenExp' in (r.json?.contact || {})), r.json?.contact?.portalTokenExp)
  check(`…and the token does not appear anywhere in the payload, under any name`,
    !r.text?.includes(TOKEN), r.text?.slice(0, 240))
  // The gate must not have gone further than the credential.
  check(`…while the client's name, email and phone are all still there`,
    r.json?.contact?.name === 'Priya Raghunathan' && r.json?.contact?.email === 'priya-t42@test.local' &&
    r.json?.contact?.phone === '614-555-0117', r.json?.contact)
  check(`…and so is the salon profile the chart exists for`,
    r.json?.profile?.hairType === 'fine, wavy' && r.json?.profile?.allergies === 'PPD', r.json?.profile)
  // portalEnabled is a FLAG, not a secret: the front desk may know the client has portal access.
  check(`…and whether the portal is on is still readable — that is a state, not a key`,
    r.json?.contact?.portalEnabled === true, r.json?.contact?.portalEnabled)
}

// ══════════ the list — fixed in T22, and it has to stay fixed ════════════════════════════════════
console.log('\n══════════ GET /api/clients — the list ══════════')
{
  const r = await asStylist('GET', '/api/clients')
  const rows = rowsOf(r.json)
  check('the stylist reads the client list', r.status === 200 && rows.length === 1,
    { status: r.status, n: rows.length })
  check('…with no portalToken on the row', !('portalToken' in (rows[0] || {})), rows[0]?.portalToken)
  check('…and no token in the payload', !r.text?.includes(TOKEN), r.text?.slice(0, 200))
  check('…and the row still flattens the profile onto the client, which is what the list renders',
    rows[0]?.name === 'Priya Raghunathan' && rows[0]?.hairType === 'fine, wavy', rows[0])
}

// ══════════ it is a read gate, not a deletion ════════════════════════════════════════════════════
console.log('\n══════════ nothing was redacted at rest ══════════')
{
  const r: any = await db.execute(sql`SELECT portal_token, portal_enabled FROM contact WHERE id = ${client.id}`)
  const row = ((r as any).rows || r)[0]
  check('the token is still ON the contact — the portal would stop working otherwise',
    row?.portal_token === TOKEN && (row?.portal_enabled === true || row?.portal_enabled === 't'), row)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
