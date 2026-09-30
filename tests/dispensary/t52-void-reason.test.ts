// crm-dispensary — T52 M5: voiding a sale has to say why, and the account has to survive.
//
// Cancelling an order took money and stock back out of the day and recorded no reason anywhere. The
// status route parsed { status } alone, so a reason sent with the request — the tester sent one, and
// the approvals path has always had one in hand — was dropped before anything could store it, and
// the audit row read "pending → cancelled" and nothing else.
//
// A refund has carried refund_reason, refunded_at and refunded_by since the first migration. A void
// is the same kind of event against the same money and the same stock, and it carried none of the
// three. It now carries all three, on the order as well as in the audit log: the audit log is the
// trail of who did what, the order is what a manager, an export and a regulator read.
//
// There were TWO doors onto this event and only one of them was reported. The approvals path — the
// one a shop uses when Settings → Approvals requires a manager to sign a void off — had the reason
// in its hand and wrote it nowhere either. Its neighbouring refund case in the same switch writes
// refund_reason. That is the sibling this project keeps missing, so it is tested here too.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Void Leaf', slug: 'leaf-m5', email: 'm5@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-m5@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Void Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 100,
  strainName: 'Blue Dream', strainType: 'hybrid', weightGrams: '3.5', taxCategory: 'cannabis',
  trackInventory: true, active: true, visible: true, inStock: true, thcPercent: '20',
} as any).returning()
const [ada] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Void', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const newOrder = async () => {
  const made = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, items: [{ productId: flower.id, quantity: 1 }],
  })
  return (made.json?.data || made.json)?.id as string
}

// ══════════ the finding ═════════════════════════════════════════════════════════════════════════
{
  const id = await newOrder()
  const voided = await api('PUT', `/api/orders/${id}/status`, { status: 'cancelled', reason: 'Customer did not collect' })
  check('an order can be voided with a reason', voided.status === 200, { status: voided.status, body: voided.json })

  const [row] = await rows(sql`SELECT status, cancellation_reason, cancelled_at, cancelled_by FROM orders WHERE id = ${id}`)
  check('…and the reason is kept ON THE SALE — it used to be dropped before anything could store it',
    row?.cancellation_reason === 'Customer did not collect', row)
  check('…with when', !!row?.cancelled_at, row?.cancelled_at)
  check('…and who', row?.cancelled_by === owner.id, { got: row?.cancelled_by, expected: owner.id })
  check('…and the order really is cancelled', row?.status === 'cancelled', row?.status)

  const audits = await rows(sql`
    SELECT action, metadata FROM audit_log
    WHERE company_id = ${co.id} AND entity_id = ${id} ORDER BY created_at DESC LIMIT 5
  `)
  const withReason = audits.find((a: any) => {
    const m = typeof a.metadata === 'string' ? (() => { try { return JSON.parse(a.metadata) } catch { return {} } })() : (a.metadata || {})
    return m?.reason === 'Customer did not collect'
  })
  check('…and the AUDIT row carries it too, where the refund audit puts its own — that was the finding',
    !!withReason, audits.map((a: any) => a.metadata))
}

// ══════════ …and it is not optional ═════════════════════════════════════════════════════════════
{
  const id = await newOrder()
  const bare = await api('PUT', `/api/orders/${id}/status`, { status: 'cancelled' })
  check('voiding with NO reason is refused', bare.status === 400 && String(bare.json?.code) === 'cancel_reason_required',
    { status: bare.status, body: bare.json })
  const blank = await api('PUT', `/api/orders/${id}/status`, { status: 'cancelled', reason: '   ' })
  check('…and whitespace is not a reason', blank.status === 400, { status: blank.status, body: blank.json })

  const [row] = await rows(sql`SELECT status FROM orders WHERE id = ${id}`)
  check('…and the refused void left the order alone', row?.status !== 'cancelled', row?.status)
}

// ══════════ every OTHER status change is untouched ══════════════════════════════════════════════
//
// A new refusal on a shape that was being accepted breaks every caller still sending the old one, so
// it is deliberately narrow: the cancel transition, and only when the reason is genuinely absent.
{
  const id = await newOrder()
  const processing = await api('PUT', `/api/orders/${id}/status`, { status: 'processing' })
  check('marking an order as processing still needs no reason', processing.status === 200,
    { status: processing.status, body: processing.json })

  const ready = await api('PUT', `/api/orders/${id}/status`, { status: 'ready' })
  check('…and so does marking it ready', ready.status === 200, { status: ready.status, body: ready.json })
}

// ══════════ a settled sale is still refunded, not voided ════════════════════════════════════════
{
  const id = await newOrder()
  const settled = await api('POST', `/api/orders/${id}/complete`, { paymentMethod: 'cash', idVerified: true })
  check('a sale can be settled', settled.status === 200 || settled.status === 201, { status: settled.status, body: settled.json })

  const tryVoid = await api('PUT', `/api/orders/${id}/status`, { status: 'cancelled', reason: 'changed my mind' })
  check('voiding a PAID sale is still refused — refund it instead, and the new reason rule did not weaken that',
    tryVoid.status === 409 && String(tryVoid.json?.code) === 'cancel_requires_refund', { status: tryVoid.status, body: tryVoid.json })
}

// ══════════ the sibling door: an approved void ══════════════════════════════════════════════════
//
// routes/approvals.ts applies a manager-approved void. Its neighbouring refund case writes
// refund_reason; the void case wrote nothing at all, on a path whose whole reason to exist is that
// somebody had to sign this off. Checked at the SQL the route runs, because raising and approving a
// real request needs a second signed-in manager this suite has no fixture for.
{
  const src = await Bun.file(new URL('./src/routes/approvals.ts', import.meta.url)).text()
  const voidCase = src.slice(src.indexOf("case 'void'"), src.indexOf("case 'discount'"))
  check('the approved-void path records the reason on the order', /cancellation_reason\s*=/.test(voidCase), voidCase.slice(0, 400))
  check('…and when', /cancelled_at\s*=/.test(voidCase), voidCase.slice(0, 400))
  check('…and who approved it', /cancelled_by\s*=/.test(voidCase), voidCase.slice(0, 400))

  // …and it actually works against the real column, rather than naming one that does not exist.
  const id = await newOrder()
  await rows(sql`
    UPDATE orders SET status = 'cancelled', cancellation_reason = 'Approved void: duplicate order',
                      cancelled_at = NOW(), cancelled_by = ${owner.id}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${co.id}
  `)
  const [row] = await rows(sql`SELECT cancellation_reason, cancelled_by FROM orders WHERE id = ${id}`)
  check('…against columns that exist', row?.cancellation_reason === 'Approved void: duplicate order' && row?.cancelled_by === owner.id, row)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
