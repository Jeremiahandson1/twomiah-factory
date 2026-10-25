// The self-serve kiosk (crm/bar/barOrders.ts, barFoodRoutes.ts /kiosk): a manager's till PIN starts and stops it —
// typed every time, even on a manager's sign-in; the guest's order is priced on the server (sizes, add-ons); paid on
// the reader it becomes a paid check whose food is ONE grill ticket marked KIOSK, only once Stripe confirms; at the
// counter it is an open check the register sees, and its food goes to the grill when the counter takes the money.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const FEATURES = ['contacts', 'bar_menu', 'bar_register', 'card_reader', 'order_kiosk']
const tickets = async () => (await k.B('GET', '/api/grill/state')).json.open as Array<{ label: string; source: string; items: Array<{ name: string; qty: number; note: string | null }> }>

beforeAll(async () => {
  k = await bootFood({ features: FEATURES })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
  // A manager's till PIN.
  expect((await k.M('PUT', '/api/register/pin', { pin: '4321' })).status).toBe(200)
}, 60_000)
afterAll(() => k.restore())

describe('locking the kiosk', () => {
  test('a manager PIN is typed every time — even a manager signed in must type it; a wrong one is refused', async () => {
    expect((await k.B('POST', '/api/food/kiosk/unlock', { pin: '1111' })).status).toBe(403)
    expect((await k.M('POST', '/api/food/kiosk/unlock', {})).status).toBe(403)
    const ok = await k.B('POST', '/api/food/kiosk/unlock', { pin: '4321', mode: 'start' })
    expect(ok.status).toBe(200)
    expect(ok.json.by).toContain("OK'd by Manager Seat")
  })

  test('the kiosk menu: priced sizes and add-ons, no taps, an 86\'d item shown sold out', async () => {
    const s = await k.B('GET', '/api/food/kiosk/state')
    expect(s.status).toBe(200)
    const burger = s.json.menu.flatMap((x: any) => x.items).find((i: any) => i.name === 'Burger')
    expect(burger.modifiers.map((m: any) => [m.name, m.priceCents])).toEqual([['Add bacon', 200], ['No onions', 0]])
    expect(s.json.reader).toBe(false)
    expect(s.json.payAtCounter).toBe(true)
    // Switched off, the kiosk is closed.
    await k.features(['contacts', 'bar_menu', 'bar_register'])
    expect((await k.B('GET', '/api/food/kiosk/state')).status).toBe(403)
    await k.features(FEATURES)
  })
})

describe('an order at the kiosk', () => {
  test('a guest never sets a price; an add-on not on the item, or a sold-out item, is refused', async () => {
    const bad = await k.B('POST', '/api/food/kiosk/order', { name: 'Pat', pay: 'counter', lines: [{ menuItemId: items.burger.id, modifierIds: ['nope'], priceCents: 1 }] })
    expect(bad.status).toBe(409)
    expect((await k.B('POST', '/api/food/kiosk/order', { pay: 'counter', lines: [{ menuItemId: items.soda.id }] })).status).toBe(400)
    await (k.t.db as any).update(k.S.barMenuItem).set({ is86ed: true }).where(eq(k.S.barMenuItem.id, items.soda.id))
    const out = await k.B('POST', '/api/food/kiosk/order', { name: 'Pat', pay: 'counter', lines: [{ menuItemId: items.soda.id }] })
    expect(out.json.error).toBe('Sorry, Soda just sold out.')
    await (k.t.db as any).update(k.S.barMenuItem).set({ is86ed: false }).where(eq(k.S.barMenuItem.id, items.soda.id))
  })

  test('pay at the counter: an open KIOSK check on the register, its food NOT on the grill until it is paid', async () => {
    const r = await k.B('POST', '/api/food/kiosk/order', { name: 'Pat', pay: 'counter', lines: [{ menuItemId: items.burger.id, modifierIds: ['modbacon01', 'modnoonion'], qty: 2 }, { menuItemId: items.soda.id }] })
    expect(r.status).toBe(200)
    expect(r.json.charge).toBeNull()
    // 2 × ($12.00 + $2.00) + $3.00 = $31.00; tax 5.5% = $1.71 (170.5 up); $32.71.
    expect(r.json.order).toMatchObject({ status: 'at_counter', name: 'Pat', subtotalCents: 3100, taxCents: 171, totalCents: 3271 })
    const state = await k.B('GET', '/api/register/state')
    const row = state.json.open.find((o: any) => o.label === 'KIOSK · Pat')
    expect(row.balanceCents).toBe(3271)
    expect(await tickets()).toEqual([])
    // The register can't fire it unpaid…
    expect((await k.B('POST', `/api/register/check/${row.id}/send`, {})).status).toBe(409)
    // …and paying it fires it, as one KIOSK ticket, the add-ons on the line.
    const pay = await k.B('POST', `/api/register/check/${row.id}/pay`, { tender: 'cash', amountCents: 3271 })
    expect(pay.json.check.status).toBe('paid')
    const t = await tickets()
    expect(t.map((x) => [x.label, x.source])).toEqual([['KIOSK · Pat', 'kiosk']])
    expect(t[0].items.map((i) => [i.name, i.qty, i.note])).toEqual([['Burger', 2, 'Add bacon · No onions']])
  })

  test('pay on the reader: nothing on the grill until Stripe confirms; then a paid check and one KIOSK ticket', async () => {
    const reader = (await k.M('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Kiosk reader' })).json.reader
    expect((await k.B('GET', '/api/food/kiosk/state')).json).toMatchObject({ reader: true, readerSimulated: true })
    for (const tk of await tickets()) await k.B('POST', '/api/grill/bump', { id: (tk as any).id })
    const r = await k.B('POST', '/api/food/kiosk/order', { name: 'Sam', pay: 'reader', lines: [{ menuItemId: items.burger.id }] })
    expect(r.status).toBe(200)
    expect(r.json.order.status).toBe('awaiting_payment')
    expect(r.json.charge.status).toBe('pending')
    const pi = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect([pi.params.get('amount'), pi.account]).toEqual(['1266', 'acct_biz'])
    // Not a check yet, not on the grill.
    expect((await k.B('GET', '/api/register/state')).json.open.some((o: any) => o.label.includes('Sam'))).toBe(false)
    expect(await tickets()).toEqual([])
    const paid = await k.B('POST', `/api/food/terminal/charge/${r.json.charge.id}/simulate`, { outcome: 'approve' })
    expect(paid.json.charge.status).toBe('succeeded')
    const o = (await k.B('GET', `/api/food/kiosk/order/${r.json.order.id}`)).json.order
    expect(o.status).toBe('received')
    expect(o.number).toBeGreaterThan(0)
    const check = (await k.B('GET', `/api/register/check/${o.checkId}`)).json.check
    expect([check.status, check.kind, check.label, check.payments[0].tender]).toEqual(['paid', 'kiosk', 'KIOSK · Sam', 'card_terminal'])
    expect((await tickets()).map((x) => x.label)).toEqual(['KIOSK · Sam'])
    expect(reader.simulated).toBe(true)
  })

  test('a declined card, then the guest walks away: the order is cancelled, nothing reaches a check or the grill', async () => {
    for (const tk of await tickets()) await k.B('POST', '/api/grill/bump', { id: (tk as any).id })
    const r = await k.B('POST', '/api/food/kiosk/order', { name: 'Lee', pay: 'reader', lines: [{ menuItemId: items.soda.id }] })
    const d = await k.B('POST', `/api/food/terminal/charge/${r.json.charge.id}/simulate`, { outcome: 'decline' })
    expect(d.json.charge.status).toBe('failed')
    const c = await k.B('POST', `/api/food/kiosk/order/${r.json.order.id}/cancel`, {})
    expect(c.json.order.status).toBe('cancelled')
    expect(await tickets()).toEqual([])
    expect((await k.B('GET', '/api/register/state')).json.open.some((o: any) => o.label.includes('Lee'))).toBe(false)
  })

  test('with a reader and pay-at-counter switched off, the kiosk takes cards only', async () => {
    expect((await k.M('PUT', '/api/food/settings', { kiosk: { payAtCounter: false, askTable: true } })).status).toBe(200)
    const s = (await k.B('GET', '/api/food/kiosk/state')).json
    expect([s.payAtCounter, s.kiosk.askTable]).toEqual([false, true])
    expect((await k.B('POST', '/api/food/kiosk/order', { name: 'Pat', pay: 'counter', lines: [{ menuItemId: items.soda.id }] })).status).toBe(409)
    // A table number alone will do when the kiosk asks for one.
    const r = await k.B('POST', '/api/food/kiosk/order', { table: '4', pay: 'reader', lines: [{ menuItemId: items.soda.id }] })
    expect(r.status).toBe(200)
    await k.B('POST', `/api/food/kiosk/order/${r.json.order.id}/cancel`, {})
  })
})
