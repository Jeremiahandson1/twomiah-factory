// The read-only seat could copy a link that signs change orders in the customer's name. (T42
// contractor, HIGH)
//
//   "Viewer can see and copy a customer's working portal link, which opens the portal as the
//    customer where COs can be signed."
//
// GET /api/portal/contacts/:id/status answered one question — is the portal on — and returned two
// things: the answer, and a live URL with the customer's bearer token in it. It is gated on
// `contacts:read`, which the viewer seat holds, while ENABLING the portal, reissuing the link and
// emailing it all require `contacts:update`. So the one way to obtain the credential asked for
// nothing, and the three ways to create or send it were locked.
//
// THE FIX IS A SECOND DOOR, NOT A ROLE TEST. `requirePermission` is the only thing in that module
// that knows a user's per-user grants — it reads extra_permissions — and it works as middleware, so
// the second permission needs its own route. The status read keeps everything that is a STATE
// (enabled, a link exists, when it expires, when they last signed in) and says `portalUrlWithheld`;
// GET …/link returns the URL and asks `contacts:update`. No template mount changes, because both
// routes sit on a router every vertical already mounts whole.
//
// Also pinned here, from the same round: no contact row leaves the server with its portal credential
// on it. The shared contacts module has stripped it since T22; the shared INVOICE DETAIL had not, and
// hands the customer's record back beside the money. A static guard
// (scripts/check-portal-token-never-ships.ts) walks the fleet for the shape; these assertions are
// what prove the stripping is real at runtime and that nothing else went with it.
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
const { company, user, contact, invoice } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Harbourstone Builders', slug: 'harbour-t42-link', email: 'link-t42@test.local',
  settings: {}, enabledFeatures: ['contacts', 'invoices', 'projects', 'client_portal'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@harbour-t42.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
// The read-only seat. It holds contacts:read and invoices:read and NOT contacts:update — which is
// exactly why it could read the link and not make one.
const viewer = await mkUser('viewer', 'viewer')

const TOKEN = 't42link' + 'f0e1d2c3b4a5f6e7d8c9'
const [homeowner] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Yusuf Adeyemi', email: 'yusuf-t42@test.local',
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 30 * 86400000),
} as any).returning()

// A second contact with no portal at all, so "no link" and "a link you may not see" stay distinct.
const [noPortal] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Dara Whitfield', email: 'dara-t42@test.local',
} as any).returning()

const [inv] = await db.insert(invoice).values({
  companyId: co.id, contactId: homeowner.id, number: 'INV-00042', status: 'sent',
  subtotal: '2400.00', taxRate: '0', taxAmount: '0.00', total: '2400.00', amountPaid: '0.00',
} as any).returning()

const app = new Hono()
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asViewer = as(viewer)

// ══════════ the status read: a state, and no key ═════════════════════════════════════════════════
console.log('\n══════════ GET /portal/contacts/:id/status ══════════')
for (const [label, call] of [['the viewer', asViewer], ['the owner', asOwner]] as const) {
  const r = await call('GET', `/api/portal/contacts/${homeowner.id}/status`)
  check(`${label} reads the portal status`, r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  check(`…and is told the portal is on and a link exists`,
    r.json?.enabled === true && r.json?.hasToken === true, r.json)
  check(`…and when it expires`, !!r.json?.expiresAt, r.json?.expiresAt)
  check(`…with NO portalUrl in the body`, r.json?.portalUrl === undefined, r.json?.portalUrl)
  check(`…and the token nowhere in it, under any name`, !r.text?.includes(TOKEN), r.text?.slice(0, 240))
  // The screen needs to know the difference between "no link" and "a link you may not see", or it
  // renders an empty box next to a Copy button that copies nothing.
  check(`…and told the link was withheld, so the Link row can be left out`,
    r.json?.portalUrlWithheld === true, r.json?.portalUrlWithheld)
}

// ══════════ the link: the credential, and the permission that mints it ═══════════════════════════
console.log('\n══════════ GET /portal/contacts/:id/link ══════════')
{
  const mine = await asOwner('GET', `/api/portal/contacts/${homeowner.id}/link`)
  check('the owner gets the link — this is the seat that hands it to the customer',
    mine.status === 200 && typeof mine.json?.portalUrl === 'string' && mine.json.portalUrl.includes(TOKEN),
    { status: mine.status, url: String(mine.json?.portalUrl || '').slice(0, 40) + '…' })
  check('…with the expiry, which is what the office quotes down the phone',
    !!mine.json?.expiresAt, mine.json?.expiresAt)

  const theirs = await asViewer('GET', `/api/portal/contacts/${homeowner.id}/link`)
  check('the VIEWER is refused the link — the same permission that enables and emails it',
    theirs.status === 403, { status: theirs.status, body: theirs.text?.slice(0, 160) })
  check('…and the refusal carries no token', !theirs.text?.includes(TOKEN), theirs.text?.slice(0, 200))

  // A contact with the portal switched off has no link to give, which is a different answer from
  // "you may not have it" — and the message has to say which.
  const none = await asOwner('GET', `/api/portal/contacts/${noPortal.id}/link`)
  check('a contact with no portal gets 400, not an empty 200',
    none.status === 400 && /not enabled/i.test(String(none.json?.error || '')), { status: none.status, json: none.json })

  const missing = await asOwner('GET', '/api/portal/contacts/does-not-exist/link')
  check('…and an unknown contact is still a 404', missing.status === 404, { status: missing.status })
}

// ══════════ no contact row carries the credential ════════════════════════════════════════════════
console.log('\n══════════ the contact row itself ══════════')
{
  const one = await asViewer('GET', `/api/contacts/${homeowner.id}`)
  check('the contact detail opens', one.status === 200, { status: one.status, body: one.text?.slice(0, 160) })
  check('…with no portalToken and no portalTokenExp',
    !('portalToken' in (one.json || {})) && !('portalTokenExp' in (one.json || {})),
    { t: one.json?.portalToken, e: one.json?.portalTokenExp })
  check('…and no token in the payload', !one.text?.includes(TOKEN), one.text?.slice(0, 200))
  check('…while portalEnabled, which is a state and not a key, is still readable',
    one.json?.portalEnabled === true, one.json?.portalEnabled)

  const list = await asViewer('GET', '/api/contacts')
  check('the contact list carries no token either', !list.text?.includes(TOKEN), list.text?.slice(0, 200))

  // The invoice detail hands back the customer's record beside the money. It had never stripped it.
  const invoiceDetail = await asOwner('GET', `/api/invoices/${inv.id}`)
  check('the invoice detail opens and carries the customer',
    invoiceDetail.status === 200 && invoiceDetail.json?.contact?.name === 'Yusuf Adeyemi',
    { status: invoiceDetail.status, contact: invoiceDetail.json?.contact?.name })
  check('…with the portal credential stripped off that record',
    !('portalToken' in (invoiceDetail.json?.contact || {})) &&
    !('portalTokenExp' in (invoiceDetail.json?.contact || {})), invoiceDetail.json?.contact)
  check('…and no token anywhere in the invoice payload',
    !invoiceDetail.text?.includes(TOKEN), invoiceDetail.text?.slice(0, 240))
  check('…and the invoice itself is intact', Number(invoiceDetail.json?.total) === 2400,
    { total: invoiceDetail.json?.total, number: invoiceDetail.json?.number })
}

// ══════════ a read gate, not a deletion ══════════════════════════════════════════════════════════
console.log('\n══════════ nothing was redacted at rest ══════════')
{
  const r: any = await db.execute(sql`SELECT portal_token FROM contact WHERE id = ${homeowner.id}`)
  check('the token is still on the contact — the customer\'s link has to keep working',
    ((r as any).rows || r)[0]?.portal_token === TOKEN, ((r as any).rows || r)[0])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
