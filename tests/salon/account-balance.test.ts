// Client account balances — money a client holds WITH the salon.
//
// Every established salon platform has this and we did not. The hole was found by the 29 Sep retest,
// in the shape of one client: they paid $37.98 against a bill a reward later took down to $32.55, and
// the $5.43 existed nowhere but as a disagreement between two columns on one invoice. Nobody at the
// desk could see it, give it back, or spend it.
//
// The rules under test:
//   · the balance is the SUM of a ledger, never a stored number
//   · the desk can SPEND what is there; only an admin can CREATE it
//   · you cannot spend what is not there, and a refused spend writes nothing
//   · a refund can be sent to the account instead of the card
//   · a balance may go negative by deliberate adjustment (a client owing the shop), never by spending
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, invoice, clientAccountEntry } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Balance Salon', slug: 'acctbal', email: 'bal@test.local', settings: { defaultTaxRate: 0 },
  enabledFeatures: ['contacts', 'invoices', 'client_profiles'],
} as any).returning()

const mkUser = async (role: string, email: string) => (await db.insert(user).values({
  email, passwordHash: 'x', firstName: role, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner-bal@test.local')
const manager = await mkUser('manager', 'mgr-bal@test.local')

const [ada] = await db.insert(contact).values({ name: 'Ada Balance', type: 'client', companyId: co.id } as any).returning()
const [walkIn] = await db.insert(contact).values({ name: 'No Account', type: 'client', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const api = as(owner)
const asManager = as(manager)

const ledger = async (contactId: string) =>
  await db.select().from(clientAccountEntry)
    .where(and(eq(clientAccountEntry.contactId, contactId), eq(clientAccountEntry.companyId, co.id)))
const balanceOf = async (contactId: string) => {
  const r = await api('GET', `/api/clients/${contactId}/account-balance`)
  return r.json?.balance
}

let n = 0
/** A bill for `total`, already issued, with no tax so the arithmetic in the test is the arithmetic. */
const mkBill = async (contactId: string, total: string) => (await db.insert(invoice).values({
  companyId: co.id, contactId, number: `INV-${String(++n).padStart(5, '0')}`,
  status: 'open', subtotal: total, taxRate: '0', taxAmount: '0', discount: '0', total,
} as any).returning())[0]

// ═══════════════════════════════ nothing, said in words ═════════════════════════════════════════
{
  const r = await api('GET', `/api/clients/${ada.id}/account-balance`)
  check('a client with no history has a $0 balance', r.status === 200 && r.json?.balance === 0, r.json)
  check('…said in words, so a screen does not have to decide what 0 means', r.json?.describe === 'Nothing on account', r.json?.describe)
  check('…and an empty ledger, not a missing one', Array.isArray(r.json?.entries) && r.json.entries.length === 0, r.json?.entries)

  const missing = await api('GET', `/api/clients/does-not-exist/account-balance`)
  check('an unknown client is a 404, not a $0 balance', missing.status === 404, missing.status)
}

// ══════════════════════════ only an admin can CREATE money ══════════════════════════════════════
{
  const byManager = await asManager('POST', `/api/clients/${ada.id}/account-balance`, { amount: 50, reason: 'Prepaid' })
  check('a manager cannot put money on a client account', byManager.status === 403, byManager.status)
  check('…and nothing was written', (await ledger(ada.id)).length === 0)

  const noReason = await api('POST', `/api/clients/${ada.id}/account-balance`, { amount: 50 })
  check('an adjustment with no reason is refused', noReason.status === 400, noReason.json)
  check('…because the note IS the record of someone else\'s money',
    /why/i.test(String(noReason.json?.error)), noReason.json?.error)

  const nothing = await api('POST', `/api/clients/${ada.id}/account-balance`, { amount: 0, reason: 'x' })
  check('a $0 adjustment is refused', nothing.status === 400, nothing.json)

  const silly = await api('POST', `/api/clients/${ada.id}/account-balance`, { amount: 250000, reason: 'oops' })
  check('a quarter of a million dollars on a salon account is refused as a typo', silly.status === 400, silly.json)

  check('…and after all those refusals the ledger is still empty', (await ledger(ada.id)).length === 0)
}

// ═══════════════════════════════ money on, and it is a ledger ═══════════════════════════════════
{
  const put = await api('POST', `/api/clients/${ada.id}/account-balance`, { amount: 50, reason: 'Paid ahead for a colour package' })
  check('an admin can put money on account', put.status === 200, put.json)
  check('…and the balance is $50.00', put.json?.balance === 50, put.json)
  check('…described as money on account', put.json?.describe === '$50.00 on account', put.json?.describe)

  const rows = await ledger(ada.id)
  check('…written as ONE ledger row, signed positive', rows.length === 1 && Number(rows[0].amount) === 50, rows)
  check('…carrying the reason a person typed', rows[0]?.reason === 'Paid ahead for a colour package', rows[0]?.reason)
  check('…and who did it', rows[0]?.createdBy === owner.id, rows[0]?.createdBy)

  const more = await api('POST', `/api/clients/${ada.id}/account-balance`, { amount: 25, reason: 'Gift from her sister' })
  check('a second movement adds to it rather than replacing it', more.json?.balance === 75, more.json)
  check('…and both rows survive — the balance is their sum, never a stored number', (await ledger(ada.id)).length === 2)
}

// ═══════════════════════ the front desk SPENDS it, at the ordinary till ═════════════════════════
{
  const bill = await mkBill(ada.id, '30.00')
  // A manager holds invoices:update, which is the right the till asks for. Spending a client's own
  // money is a checkout, not a decision — that is the line: create is admin, spend is the desk.
  const paid = await asManager('POST', `/api/invoices/${bill.id}/payments`, { amount: 30, method: 'account_balance' })
  check('the front desk can settle a bill from the client\'s account', paid.status === 201, paid.json)

  const after = await db.select().from(invoice).where(eq(invoice.id, bill.id))
  check('…the invoice is paid', after[0]?.status === 'paid', after[0]?.status)
  check('…and records $30.00 collected', Math.round(Number(after[0]?.amountPaid) * 100) === 3000, after[0]?.amountPaid)
  check('…the balance falls to $45.00', (await balanceOf(ada.id)) === 45)

  const spend = (await ledger(ada.id)).find((r: any) => r.source === 'spend')
  check('…the spend is its own negative ledger row', Number(spend?.amount) === -30, spend)
  check('…naming the bill it went against', String(spend?.reason).includes(bill.number), spend?.reason)
  check('…and linked to it, so the money can be traced both ways', spend?.invoiceId === bill.id, spend?.invoiceId)
}

// ═══════════════════════════ you cannot spend what is not there ═════════════════════════════════
{
  const bill = await mkBill(ada.id, '100.00')
  const before = await ledger(ada.id)
  const tooMuch = await asManager('POST', `/api/invoices/${bill.id}/payments`, { amount: 100, method: 'account_balance' })
  check('a bill larger than the balance is refused', tooMuch.status === 400, { status: tooMuch.status, body: tooMuch.json })
  check('…saying what they actually have, so the desk knows what to do next',
    /\$45\.00/.test(String(tooMuch.json?.error)), tooMuch.json?.error)

  check('…and NOTHING was written — no payment, no ledger row', (await ledger(ada.id)).length === before.length)
  const untouched = await db.select().from(invoice).where(eq(invoice.id, bill.id))
  check('…the invoice is untouched', Math.round(Number(untouched[0]?.amountPaid) * 100) === 0 && untouched[0]?.status === 'open', untouched[0])
  check('…and the balance did not move', (await balanceOf(ada.id)) === 45)
}

{
  const bill = await mkBill(walkIn.id, '10.00')
  const none = await asManager('POST', `/api/invoices/${bill.id}/payments`, { amount: 10, method: 'account_balance' })
  check('a client with nothing on account is told exactly that', none.status === 400 && /nothing on account/i.test(String(none.json?.error)), none.json)
}

// ════════════════════════════ a refund can be LEFT on the account ═══════════════════════════════
//
// This is the retest's $5.43, end to end: a bill is paid in full, the bill then comes down, and the
// difference is given back — to the account rather than to a card, because that is what the client
// chose. Nothing here happens on its own; a person asked for it.
{
  const bill = await mkBill(ada.id, '37.98')
  const paid = await api('POST', `/api/invoices/${bill.id}/payments`, { amount: 37.98, method: 'card' })
  check('the client pays $37.98 by card', paid.status === 201, paid.json)

  // The reward lands and the bill comes down to $32.55 — the shape the loyalty retest found.
  await db.update(invoice).set({ subtotal: '32.55', total: '32.55' } as any).where(eq(invoice.id, bill.id))

  const balanceBefore = await balanceOf(ada.id)
  const refund = await api('POST', `/api/invoices/${bill.id}/refund`, { amount: 5.43, method: 'account_balance', notes: 'Overpayment, kept on account at the client\'s request' })
  check('the $5.43 can be refunded ONTO the account', refund.status === 200, refund.json)
  check('…and it lands there', (await balanceOf(ada.id)) === Math.round((balanceBefore + 5.43) * 100) / 100, { before: balanceBefore, after: await balanceOf(ada.id) })

  const row = (await ledger(ada.id)).find((r: any) => r.source === 'refund_to_account')
  check('…as its own kind of movement, not an untyped adjustment', Number(row?.amount) === 5.43, row)

  const after = await db.select().from(invoice).where(eq(invoice.id, bill.id))
  check('…the invoice records the refund', Math.round(Number(after[0]?.amountRefunded) * 100) === 543, after[0]?.amountRefunded)
  check('…and the sale stays paid — a refund never reopens a balance the client must settle again',
    after[0]?.status === 'paid', after[0]?.status)
}

// ═════════════════════════════ a client can owe the shop ════════════════════════════════════════
{
  const [ivan] = await db.insert(contact).values({ name: 'Ivan Owes', type: 'client', companyId: co.id } as any).returning()
  const iou = await api('POST', `/api/clients/${ivan.id}/account-balance`, { amount: -20, reason: 'Left without paying for a toner; agreed to settle next visit' })
  check('a deliberate adjustment can take a balance below zero', iou.json?.balance === -20, iou.json)
  check('…and reads as money the client owes, not as a credit',
    iou.json?.describe === '$20.00 owed by this client', iou.json?.describe)

  // …but a SPEND still cannot. The IOU is a decision someone made; overspending is not.
  const bill = await mkBill(ivan.id, '5.00')
  const spend = await asManager('POST', `/api/invoices/${bill.id}/payments`, { amount: 5, method: 'account_balance' })
  check('…while spending against a negative balance is still refused', spend.status === 400, spend.json)
}

// ══════════════════════════════ the desk can SEE it ═════════════════════════════════════════════
{
  const chart = await api('GET', `/api/clients/${ada.id}`)
  const bal = await balanceOf(ada.id)
  check('the balance is on the client chart, where the desk looks before ringing up',
    chart.json?.stats?.accountBalance === bal, { chart: chart.json?.stats?.accountBalance, expected: bal })
  check('…in words as well as a number', /on account/.test(String(chart.json?.stats?.accountBalanceLabel)), chart.json?.stats?.accountBalanceLabel)

  const bill = await mkBill(ada.id, '9.00')
  const inv = await api('GET', `/api/invoices/${bill.id}`)
  check('…and on the invoice, so the till can offer it only when there is money behind it',
    inv.json?.accountBalance === bal, { got: inv.json?.accountBalance, expected: bal })
}

// ══════════════ a vertical that keeps NO balances cannot settle a sale against one ══════════════
//
// The salon wires the ledger, so nothing reached through these routes can prove what the other
// twelve CRMs do. This calls the shared writer directly, the way their templates do — with no
// spendFromAccount — because that absence is the only thing standing between a vertical with no
// client balances and a sale settled against money that does not exist.
{
  const { recordInvoicePayment } = await import('./src/shared/index.ts')
  const { invoice: invT, payment: payT } = await import('./db/schema.ts')
  const bill = await mkBill(ada.id, '12.00')

  const noLedger = await recordInvoicePayment(db, { invoice: invT, payment: payT }, true, {
    invoiceId: bill.id, companyId: co.id, amount: 12, method: 'account_balance',
  })
  check('a template that wired no ledger cannot take an account-balance payment',
    noLedger.ok === false && (noLedger as any).status === 400, noLedger)
  check('…and says so in a sentence, rather than failing on a null',
    /does not keep client account balances/i.test(String((noLedger as any).error)), (noLedger as any).error)

  const after = await db.select().from(invoice).where(eq(invoice.id, bill.id))
  check('…with nothing written to the invoice', Math.round(Number(after[0]?.amountPaid) * 100) === 0, after[0]?.amountPaid)

  const { recordInvoiceRefund } = await import('./src/shared/index.ts')
  const paid = await api('POST', `/api/invoices/${bill.id}/payments`, { amount: 12, method: 'cash' })
  check('…(the same bill takes an ordinary payment)', paid.status === 201, paid.json)
  const noLedgerRefund = await recordInvoiceRefund(db, { invoice: invT, payment: payT }, {
    invoiceId: bill.id, companyId: co.id, amount: 12, method: 'account_balance',
  })
  check('…and a refund cannot be left on an account it does not keep either',
    noLedgerRefund.ok === false && /does not keep client account balances/i.test(String((noLedgerRefund as any).error)), noLedgerRefund)

  const stillPaid = await db.select().from(invoice).where(eq(invoice.id, bill.id))
  check('…and that refusal returned no money', Math.round(Number(stillPaid[0]?.amountRefunded) * 100) === 0, stillPaid[0]?.amountRefunded)
}

// ════════════════════════ the ledger adds up to what was claimed ════════════════════════════════
{
  const rows = await ledger(ada.id)
  const sum = Math.round(rows.reduce((s: number, r: any) => s + Number(r.amount), 0) * 100) / 100
  check('the reported balance IS the sum of the ledger, with nothing stored alongside it',
    sum === (await balanceOf(ada.id)), { sum, reported: await balanceOf(ada.id) })

  const [{ c }]: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM client_account_entry WHERE company_id = ${co.id}`).then((r: any) => r.rows || r)
  check('…and every movement on this tenant is still on file', c === rows.length + 1, { total: c, ada: rows.length })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
