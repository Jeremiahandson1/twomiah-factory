// T58d — "35 old quotes with no expiry."
//
// Measured on fstest before touching anything: exactly 35, every one raised on or before
// 2026-09-21, and nothing raised since is missing one — because POST /api/quotes has had the
// `quoteExpiryFromTerms` fallback since Field Service T26 L2. So the create path was already right
// and those 35 are rows from before it.
//
// They are NOT back-dated, and that is the decision rather than an omission: a quote is a document
// the customer may be holding, and stamping a validity onto one after the fact changes what was
// offered. All 35 on fstest are approved, viewed, rejected or declined — not one is a live open
// offer — so there is nothing outstanding to protect.
//
// What WAS still open: ctrtest and lndtest hold unsent DRAFTS with no expiry, and sending one put
// it in front of the customer with the validity line blank, because the email template is handed
// `expiryDate: found.expiryDate ? … : ''`. A draft has been shown to nobody, so there is nothing to
// change — and sending it IS the moment the offer is made, which is when a validity should attach.
//
// Every quote here is INSERTED DIRECTLY with expiryDate null, because that is the only way to get
// the shape the old rows actually have: the create route will not produce one. A fixture that only
// writes the current shape cannot catch this, and writing such a fixture is how the gap survived.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, quote } from './db/schema.ts'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const app = new Hono()
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

/** A shop, with its own validity period if one is given. */
const makeShop = async (tag: string, settings: Record<string, unknown>) => {
  const [co] = await db.insert(company).values({
    name: `Shop ${tag}`, slug: `shop-${tag}`, email: `${tag}@test.local`, settings,
    enabledFeatures: ['quotes', 'contacts', 'jobs'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${tag}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id,
  } as any).returning()
  const [client] = await db.insert(contact).values({
    name: `Client ${tag}`, email: `client-${tag}@test.local`, companyId: co.id,
  } as any).returning()
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const txt = await res.text(); let j: any = txt; try { j = JSON.parse(txt) } catch {}
    return { status: res.status, json: j, text: txt }
  }
  return { co, owner, client, call }
}

/** The shape an old row has: a draft with no expiry at all. */
const undatedQuote = async (companyId: string, contactId: string, number: string, status = 'draft') =>
  (await db.insert(quote).values({
    number, name: 'Condenser swap', status, companyId, contactId,
    expiryDate: null, subtotal: '400.00', taxRate: '0', taxAmount: '0', discount: '0', total: '400.00',
  } as any).returning())[0]

const storedExpiry = async (id: string) =>
  (await db.select().from(quote).where(eq(quote.id, id)).limit(1))[0]?.expiryDate ?? null
const dayOf = (d: unknown) => d ? new Date(d as any).toISOString().slice(0, 10) : null
const daysFromToday = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

// ══════════ 1. an undated draft gets its expiry WHEN IT IS SENT ═════════════════════════════════
{
  const shop = await makeShop('default', {})
  const q = await undatedQuote(shop.co.id, shop.client.id, 'QTE-90001')
  check('the draft starts with no expiry, like the live rows', (await storedExpiry(q.id)) === null)

  const sent = await shop.call('POST', `/api/quotes/${q.id}/send`)
  check('sending it is accepted', sent.status === 200, { status: sent.status, body: sent.text?.slice(0, 300) })
  const after = await storedExpiry(q.id)
  check('…and it now HAS an expiry', !!after, { after })
  // 30 is quoteValidityDaysFrom's default when the setting is absent.
  check('…30 days out, the default validity', dayOf(after) === daysFromToday(30), { got: dayOf(after), expected: daysFromToday(30) })
  check('…and it is marked sent', (await db.select().from(quote).where(eq(quote.id, q.id)).limit(1))[0]?.status === 'sent')
}

// ══════════ 2. the shop's OWN validity period is honoured ══════════════════════════════════════
{
  const shop = await makeShop('sevenday', { quoteValidityDays: 7 })
  const q = await undatedQuote(shop.co.id, shop.client.id, 'QTE-90002')
  const sent = await shop.call('POST', `/api/quotes/${q.id}/send`)
  check('a shop that quotes for 7 days can send', sent.status === 200, { status: sent.status, body: sent.text?.slice(0, 240) })
  check('…and the expiry is 7 days out, not 30', dayOf(await storedExpiry(q.id)) === daysFromToday(7),
    { got: dayOf(await storedExpiry(q.id)), expected: daysFromToday(7) })
}

// ══════════ 3. RE-SENDING MUST NOT QUIETLY EXTEND AN OFFER ═════════════════════════════════════
//
// The status gate admits 'sent', so a second send is reachable. If it re-stamped the expiry, every
// re-send would silently give the customer another thirty days at the old price.
{
  const shop = await makeShop('resend', {})
  const q = await undatedQuote(shop.co.id, shop.client.id, 'QTE-90003')
  await shop.call('POST', `/api/quotes/${q.id}/send`)
  const first = dayOf(await storedExpiry(q.id))
  check('the first send dates it', !!first, { first })

  // Pull it back to a date in the near future, as though it had been sent a while ago.
  const fixed = new Date(Date.now() + 3 * 864e5)
  await db.update(quote).set({ expiryDate: fixed } as any).where(eq(quote.id, q.id))
  const again = await shop.call('POST', `/api/quotes/${q.id}/send`)
  check('it can be sent again', again.status === 200, { status: again.status })
  check('…and the expiry is UNCHANGED — no silent extension',
    dayOf(await storedExpiry(q.id)) === fixed.toISOString().slice(0, 10),
    { got: dayOf(await storedExpiry(q.id)), expected: fixed.toISOString().slice(0, 10) })
}

// ══════════ 4. a quote raised through the API still gets one on CREATE ═════════════════════════
//
// The half that was already fixed, pinned so it cannot regress: the form sends
// `expiryDate: form.expiryDate || null` when the field is blank, and that must not mean "never".
{
  const shop = await makeShop('create', {})
  const made = await shop.call('POST', '/api/quotes', {
    name: 'New work', contactId: shop.client.id, expiryDate: null, taxRate: 0, discount: 0,
    lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 200 }],
  })
  check('a quote with a BLANK expiry is accepted', made.status === 200 || made.status === 201,
    { status: made.status, body: made.text?.slice(0, 300) })
  const id = made.json?.id || made.json?.data?.id
  check('…and it was given one anyway, not left open-ended', !!(await storedExpiry(id)),
    { expiry: dayOf(await storedExpiry(id)) })
  check('…30 days out', dayOf(await storedExpiry(id)) === daysFromToday(30),
    { got: dayOf(await storedExpiry(id)), expected: daysFromToday(30) })
}

// ══════════ 5. an APPROVED undated quote is left alone ═════════════════════════════════════════
//
// This is the decision above, made executable: the 35 on fstest are approved and must not gain a
// validity they never had. Sending is refused for an approved quote, so nothing can stamp one.
{
  const shop = await makeShop('approved', {})
  const q = await undatedQuote(shop.co.id, shop.client.id, 'QTE-90005', 'approved')
  const sent = await shop.call('POST', `/api/quotes/${q.id}/send`)
  check('an approved quote cannot be re-sent', sent.status === 400, { status: sent.status, body: sent.text?.slice(0, 200) })
  check('…so its missing expiry stays missing — the document is not rewritten',
    (await storedExpiry(q.id)) === null, { expiry: dayOf(await storedExpiry(q.id)) })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
