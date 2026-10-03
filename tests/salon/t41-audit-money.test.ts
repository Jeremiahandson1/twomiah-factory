// The audit log recorded no money. (T41 — found independently on three verticals)
//
//   "The audit log doesn't record money movements or settings changes: no refund, payment, credit,
//    void, invoice-create, company-settings or 2FA entries across 1,889 rows." — salon
//   "The audit log misses invoice payments, refunds, credits, sends and settings changes (CO
//    signing is logged); there's no audit UI." — contractor
//   "Audit Log action filters return nothing for every option (Order Refunded, Cash Drawer
//    Opened/Closed, Login, Settings Changed, Inventory Adjusted)." — dispensary
//
// 1,889 rows of contacts and jobs being edited, and not one line about money. Every write in the
// shared invoicing module wrote NOTHING to the log — not a single call in the whole file. The log
// was answering "who changed a record" and silently not answering "who took, returned or wrote off
// money", which is the only question anybody opens an audit log to ask.
//
// WHY THIS IS A BEHAVIOUR TEST AND NOT A GUARD. A guard can see that `audit.log(` appears in the
// file. It cannot see whether the entry carries the FIGURE — and "payment on INV-00204" is close to
// useless six weeks later, while "$43.75 by card, balance 0.00" is what a disputed charge is
// settled with. So every assertion here reads the row back out of audit_log and checks the amount,
// the method, the balance, the before-total, the reason. It also checks WHO and FROM WHERE, because
// an audit entry with no actor and no IP answers nothing.
//
// Driven through the real routes: a payment is taken by POST, not by calling a helper.
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
const { company, user, contact } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Shears & Co', slug: 'shears-t41-audit', email: 'audit-t41@test.local',
  settings: { timezone: 'UTC' }, enabledFeatures: ['salon', 'invoices'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t41audit@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Audit Client', email: 'auditclient-t41@test.local',
} as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError(errorHandler)

const IP = '198.51.100.7'
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json', 'x-test-user': owner.id,
      // The actor's address and client, which resolveActor reads off the context. An audit row with
      // no IP cannot answer "was that us or somebody with our password".
      'x-forwarded-for': IP, 'user-agent': 'T41-Audit/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** Every audit row for this company, newest first, with metadata parsed. */
const trail = async (): Promise<any[]> => {
  const r: any = await db.execute(sql`
    SELECT action, entity, entity_id, entity_name, metadata, user_id, user_email, ip_address, user_agent
      FROM audit_log WHERE company_id = ${co.id} ORDER BY created_at DESC, action DESC`)
  return ((r as any).rows || r).map((row: any) => ({
    ...row,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  }))
}
/** The most recent entry for an action on the invoice entity. */
const entryFor = async (action: string) => (await trail()).find((e) => e.action === action && e.entity === 'invoice')

// ══════════ before: the log is empty, so nothing below can be a leftover ════════════════════════
console.log('\n══════════ the starting point ══════════')
{
  check('no audit rows yet for this shop', (await trail()).length === 0, (await trail()).length)
}

// ══════════ raising an invoice ══════════════════════════════════════════════════════════════════
console.log('\n══════════ an invoice is raised ══════════')
let invId = ''
{
  const made = await call('POST', '/api/invoices', {
    contactId: client.id, taxRate: 0, discount: 0,
    lineItems: [{ description: 'Colour and cut', quantity: 1, unitPrice: 125.5 }],
  })
  check('the invoice is created', made.status === 201, { status: made.status, body: made.text?.slice(0, 220) })
  invId = made.json?.id

  const e = await entryFor('create')
  check('T41: creating an invoice is now in the audit log', !!e, (await trail()).map((x) => x.action))
  check('T41: …named by its invoice number, so the log reads in the shop\'s language',
    e?.entity_name === made.json?.number && e?.entity_id === invId, { name: e?.entity_name, number: made.json?.number })
  check('T41: …carrying the TOTAL, not just the fact', e?.metadata?.total === '125.50', e?.metadata)
  check('T41: …and the balance it opened with', e?.metadata?.balance === '125.50', e?.metadata)
  check('T41: …and who did it, with their address and client',
    e?.user_id === owner.id && e?.user_email === owner.email && e?.ip_address === IP && /T41-Audit/.test(String(e?.user_agent)),
    { user: e?.user_email, ip: e?.ip_address, ua: e?.user_agent })
}

// ══════════ editing the amount ══════════════════════════════════════════════════════════════════
console.log('\n══════════ the amount is changed ══════════')
{
  const edited = await call('PUT', `/api/invoices/${invId}`, {
    lineItems: [{ description: 'Colour, cut and treatment', quantity: 1, unitPrice: 168 }],
  })
  check('the invoice is edited', edited.status === 200, { status: edited.status, body: edited.text?.slice(0, 200) })
  const e = await entryFor('update')
  check('T41: the edit is logged', !!e, (await trail()).map((x) => x.action))
  // The BEFORE as well as the after: "edited INV-00001" says nothing; "125.50 → 168.00" does.
  check('T41: …with the total BEFORE and after, so the change itself is readable',
    e?.metadata?.totalBefore === '125.50' && e?.metadata?.total === '168.00', e?.metadata)
}

// ══════════ taking the money ════════════════════════════════════════════════════════════════════
console.log('\n══════════ a payment is taken ══════════')
{
  const paid = await call('POST', `/api/invoices/${invId}/payments`, { amount: 100, method: 'card', reference: 'auth-7781' })
  check('the payment is recorded', paid.status === 201, { status: paid.status, body: paid.text?.slice(0, 220) })

  const e = await entryFor('payment')
  check('T41: THE PAYMENT IS IN THE LOG — the finding, closed', !!e, (await trail()).map((x) => x.action))
  check('T41: …with the amount', e?.metadata?.amount === '100.00', e?.metadata)
  check('T41: …how it was taken, and the reference the card terminal gave',
    e?.metadata?.method === 'card' && e?.metadata?.reference === 'auth-7781', e?.metadata)
  // The balance AFTER is what makes a row answer "what did the client still owe at that moment".
  check('T41: …and what was still owed afterwards', e?.metadata?.balance === '68.00', e?.metadata)
  check('T41: …and the status it left the invoice in', e?.metadata?.status === 'partial' || e?.metadata?.status === 'sent',
    e?.metadata?.status)
}

// ══════════ giving some back ════════════════════════════════════════════════════════════════════
console.log('\n══════════ a refund ══════════')
{
  const refunded = await call('POST', `/api/invoices/${invId}/refund`, { amount: 25, method: 'card', reason: 'Toner was wrong' })
  check('the refund goes through', refunded.status === 200, { status: refunded.status, body: refunded.text?.slice(0, 220) })

  const e = await entryFor('refund')
  check('T41: the refund is in the log', !!e, (await trail()).map((x) => x.action))
  check('T41: …with the amount and the method', e?.metadata?.amount === '25.00' && e?.metadata?.method === 'card', e?.metadata)
  // The REASON is the whole point of a refund entry: money went back out, and somebody decided it.
  check('T41: …and WHY, which is what a refund entry exists to record',
    e?.metadata?.reason === 'Toner was wrong', e?.metadata)
  check('T41: …and the running refunded total', e?.metadata?.refundedToDate === '25.00', e?.metadata)
  /**
   * …and the balance the refund LEFT, which is the figure that shows the refund model working.
   *
   * 168.00 billed, 100.00 collected, 25.00 handed back → 93.00 owed. The balance went UP, and that
   * is deliberate: see invoiceBalance in packages/tenant-backend/src/invoicing/money.ts. A refund
   * against a PART-paid invoice reopens what is owed, because a returned deposit still owes for the
   * work; a refund against a fully-paid one never does, because the customer already settled and
   * money handed back is the business's choice. Asserting it here means the audit entry is also a
   * record of which of those two happened.
   */
  check('T41: …and the balance it left — 168.00 billed, 100.00 taken, 25.00 back = 93.00 owed',
    e?.metadata?.balance === '93.00', e?.metadata)
}

// ══════════ writing some off ════════════════════════════════════════════════════════════════════
console.log('\n══════════ a credit ══════════')
{
  const credited = await call('POST', `/api/invoices/${invId}/credit`, { amount: 18, reason: 'Goodwill — kept waiting' })
  check('the credit applies', credited.status === 200, { status: credited.status, body: credited.text?.slice(0, 220) })

  const e = await entryFor('credit')
  check('T41: the credit is in the log', !!e, (await trail()).map((x) => x.action))
  check('T41: …with the amount and the mandatory reason',
    e?.metadata?.amount === '18.00' && e?.metadata?.reason === 'Goodwill — kept waiting', e?.metadata)
  // A credit is money written off, so what it moved is the record. 93.00 owed (see the refund
  // above), 18.00 written off → 75.00.
  check('T41: …and the balance either side of it',
    e?.metadata?.balanceBefore === '93.00' && e?.metadata?.balanceAfter === '75.00', e?.metadata)
}

// ══════════ voiding ════════════════════════════════════════════════════════════════════════════
console.log('\n══════════ a void ══════════')
{
  // A fresh invoice with nothing collected: the route refuses to void one holding money.
  const made = await call('POST', '/api/invoices', {
    contactId: client.id, taxRate: 0, discount: 0,
    lineItems: [{ description: 'Blow dry', quantity: 1, unitPrice: 35 }],
  })
  const voided = await call('POST', `/api/invoices/${made.json?.id}/void`, { reason: 'Raised on the wrong client' })
  check('the void goes through', voided.status === 200, { status: voided.status, body: voided.text?.slice(0, 220) })

  const e = await entryFor('void')
  check('T41: the void is in the log', !!e, (await trail()).map((x) => x.action))
  check('T41: …naming the invoice taken out of the ledger', e?.entity_name === made.json?.number,
    { name: e?.entity_name, number: made.json?.number })
  check('T41: …and the reason given', e?.metadata?.reason === 'Raised on the wrong client', e?.metadata)
}

// ══════════ the shop's settings ════════════════════════════════════════════════════════════════
console.log('\n══════════ settings ══════════')
{
  const saved = await call('PUT', '/api/company', { name: 'Shears & Co.', settings: { defaultTaxRate: 7.5, paymentTermsDays: 14 } })
  check('the settings save', saved.status === 200, { status: saved.status, body: saved.text?.slice(0, 220) })

  const e = (await trail()).find((x) => x.entity === 'company')
  check('T41: a settings change is now logged', !!e, (await trail()).map((x) => `${x.entity}:${x.action}`))
  check('T41: …naming WHICH keys were touched, not dumping the whole blob',
    Array.isArray(e?.metadata?.fields) && e.metadata.fields.includes('name')
    && Array.isArray(e?.metadata?.settings) && e.metadata.settings.includes('defaultTaxRate')
    && e.metadata.settings.includes('paymentTermsDays'), e?.metadata)
  // Values are deliberately NOT recorded: the entry says the tax rate was touched, by whom, from
  // where. Copying settings values into the log would duplicate the record for ever.
  check('T41: …and not the values themselves', !/7\.5|\b14\b/.test(JSON.stringify(e?.metadata || {})), e?.metadata)
  check('T41: …with the actor and their address', e?.user_id === owner.id && e?.ip_address === IP,
    { user: e?.user_email, ip: e?.ip_address })
}

// ══════════ switching a module on ══════════════════════════════════════════════════════════════
console.log('\n══════════ features ══════════')
{
  const before: any = await db.execute(sql`SELECT enabled_features FROM company WHERE id = ${co.id}`)
  const had = (((before as any).rows || before)[0]?.enabled_features) || []
  const next = [...new Set([...(Array.isArray(had) ? had : []), 'loyalty_rewards'])]
  const saved = await call('PUT', '/api/company/features', { features: next })
  check('the feature list saves', saved.status === 200, { status: saved.status, body: saved.text?.slice(0, 200) })

  const e = (await trail()).find((x) => x.entity === 'company' && Array.isArray(x.metadata?.switchedOn))
  check('T41: switching a module on is logged', !!e, (await trail()).filter((x) => x.entity === 'company').map((x) => x.metadata))
  check('T41: …as the DIFFERENCE, which is what anybody asking will want',
    e?.metadata?.switchedOn?.includes('loyalty_rewards') && Array.isArray(e?.metadata?.switchedOff), e?.metadata)
}

// ══════════ and the whole trail reads as money ═════════════════════════════════════════════════
console.log('\n══════════ the trail as a whole ══════════')
{
  const all = await trail()
  // The exact actions the report said were missing.
  for (const action of ['create', 'update', 'payment', 'refund', 'credit', 'void']) {
    check(`T41: the trail contains a '${action}' entry on an invoice`,
      all.some((e) => e.action === action && e.entity === 'invoice'), all.map((e) => `${e.entity}:${e.action}`))
  }
  check('T41: …and a company entry for the settings', all.some((e) => e.entity === 'company'),
    all.map((e) => e.entity))
  // Not one row may be anonymous: a log that cannot say who did it answers nothing.
  check('T41: every entry names its actor', all.every((e) => e.user_id && e.user_email),
    all.filter((e) => !e.user_id).map((e) => e.action))
  check('T41: …and every entry carries the address it came from', all.every((e) => e.ip_address === IP),
    all.map((e) => [e.action, e.ip_address]))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
