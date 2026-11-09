// The bar re-check (Chrome, 2026-11-09): a kiosk order paid at the counter stayed on Orders as "Pay at counter / Take
// payment" after the money was taken; a bartender's menu said "Tips" over a page headed "My tips"; the email settings
// still spoke SendGrid, SPF, DKIM and Cloudflare.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const FEATURES = ['contacts', 'bar_menu', 'bar_register', 'order_kiosk']

beforeAll(async () => {
  k = await bootFood({ features: FEATURES })
  items = await k.menu()
  expect((await k.M('PUT', '/api/food/settings', { kiosk: { payAtCounter: true } })).status).toBe(200)
}, 60_000)
afterAll(() => k.restore())

const counterOrder = async (name: string) => {
  const r = await k.B('POST', '/api/food/kiosk/order', { name, pay: 'counter', lines: [{ menuItemId: items.soda.id }] })
  expect(r.status).toBe(200)
  return r.json.order as { id: string; checkId: string; totalCents: number }
}
const ordersNow = async () => (await k.B('GET', '/api/food/orders')).json.orders as Array<{ id: string; status: string }>

describe('a kiosk order paid at the counter', () => {
  test('paying its check moves it from "Pay at counter" to waiting to be picked up, and Picked up then works', async () => {
    const o = await counterOrder('Pat')
    expect((await ordersNow()).find((x) => x.id === o.id)?.status).toBe('at_counter')
    expect((await k.B('POST', `/api/register/check/${o.checkId}/pay`, { tender: 'cash', amountCents: o.totalCents })).json.check.status).toBe('paid')
    expect((await ordersNow()).find((x) => x.id === o.id)?.status).toBe('received')
    expect((await k.B('POST', `/api/food/orders/${o.id}/collected`, {})).status).toBe(200)
    expect((await ordersNow()).find((x) => x.id === o.id)?.status).toBe('collected')
  })

  test('a part payment leaves it at the counter', async () => {
    const o = await counterOrder('Sam')
    await k.B('POST', `/api/register/check/${o.checkId}/pay`, { tender: 'cash', amountCents: 100 })
    expect((await ordersNow()).find((x) => x.id === o.id)?.status).toBe('at_counter')
  })

  test('voiding its check takes it off Orders', async () => {
    const o = await counterOrder('Lee')
    expect((await k.M('POST', `/api/register/check/${o.checkId}/void`, { reason: 'Walked out' })).status).toBe(200)
    expect((await ordersNow()).find((x) => x.id === o.id)).toBeUndefined()
  })

  test('an order left at the counter after its check was paid (before this fix) is put right when Orders opens', async () => {
    const o = await counterOrder('Kim')
    await k.B('POST', `/api/register/check/${o.checkId}/pay`, { tender: 'cash', amountCents: o.totalCents })
    await (k.t.db as any).update(k.S.barOrder).set({ status: 'at_counter' }).where(eq(k.S.barOrder.id, o.id))
    expect((await ordersNow()).find((x) => x.id === o.id)?.status).toBe('received')
  })
})

describe('the words', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

  test('the Tips menu item reads "My tips" to anyone without bar:manage, as the page they get is headed', () => {
    // Read as text: the menu file pulls in the map library, which needs a browser.
    const line = src('../web/src/crm/verticals/bar.tsx').split('\n').find((l) => l.includes("to: '/crm/tips'"))!
    expect(line).toContain("labelWithout: ['bar:manage', 'My tips']")
    expect(src('../web/src/crm/pages/bar/TipsPage.tsx')).toContain("useMayWrite('bar:manage')")
    expect(src('../../../packages/tenant-ui/src/shell/AppShell.tsx')).toContain('i.labelWithout && !can(i.labelWithout[0])')
  })

  test('a paid kiosk order is badged "Paid" on Orders, not "On the grill" (it has no Ready step); a website pickup keeps its steps', () => {
    const orders = src('../web/src/crm/pages/bar/OrdersPage.tsx')
    expect(orders).toContain("o.channel === 'kiosk' && o.status === 'received' ? { label: 'Paid'")
    expect(orders).toContain("received: { label: 'On the grill'")
  })

  test('Email Domain and Branded Email name no SendGrid, SPF, DKIM or Cloudflare', () => {
    const domain = src('../../../packages/tenant-ui/src/settings/EmailDomainPage.tsx')
    const page = domain.slice(domain.indexOf('return ('))
    for (const w of ['SendGrid', 'SPF', 'DKIM']) expect(page).not.toContain(w)
    const aliases = src('../../../packages/tenant-ui/src/settings/EmailAliasesPage.tsx')
    expect(aliases.slice(aliases.indexOf('return ('))).not.toMatch(/>[^<{]*Cloudflare/)
  })
})
