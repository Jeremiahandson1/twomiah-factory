// The online store's live test (twomiah-live-test-shop, 2026-10-26): its seats and its own words, through the real
// unified server as the store, signed in as each seat.
//   · credentials, money and controls follow the seat (bda5a934a): a staff seat reaches no discount codes, no shipping
//     rates and no carrier account — the API refuses, and the menu items and routes ask a permission staff lack; the
//     carrier's API key is a credential: the owner sets it (integrations:update), the manager no longer
//   · the wizard's "Open …" steps reach their pages: the first-run gate lets them through
//   · the store's Settings and Help speak a shop's words: no License #, its own seat descriptions, no contractor help
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq as eqId } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { loadVertical } from '../server/core/vertical.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const WEB = path.join(import.meta.dir, '..', 'web', 'src')
const src = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8')
const carrier = { provider: 'easypost', mode: 'test', apiKey: 'EZTK_test_key_12345', fromAddress: { name: 'Shop', line1: '1 Main St', city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'US' } }

beforeAll(async () => { k = await bootStore() }, 120_000)

describe('a staff seat reaches no discount codes, shipping rates or carrier account', () => {
  test('the API refuses staff the discount codes, a new code, the carrier account and the shipping rates', async () => {
    const staff = k.as('staff')
    expect((await staff('GET', '/api/admin/discounts')).status).toBe(403)
    expect((await staff('POST', '/api/admin/discounts', { code: 'STAFF10', type: 'percent', value: 10 })).status).toBe(403)
    expect((await staff('GET', '/api/admin/customer-groups')).status).toBe(403)
    expect((await staff('POST', '/api/admin/shipping/config', carrier)).status).toBe(403)
    expect((await staff('DELETE', '/api/admin/shipping/config')).status).toBe(403)
    expect((await staff('PATCH', '/api/admin/settings', { flatShippingCents: 100 })).status).toBe(403)
  })

  test("staff's permissions hold none of them, so the menu items and typed-in routes stay hidden", async () => {
    const me = (await k.as('staff')('GET', '/api/auth/me')).json
    const perms: string[] = me.permissions || me.data?.permissions || []
    expect(perms).toContain('orders:read')
    for (const p of ['discounts:read', 'shipping:configure', 'integrations:update']) expect({ p, held: perms.includes(p) }).toEqual({ p, held: false })
    // The menu items and routes ask exactly those (crm/pages/store/*/index.tsx).
    const orders = src('crm/pages/store/orders/index.tsx'), catalog = src('crm/pages/store/catalog/index.tsx')
    expect(orders).toMatch(/to: '\/crm\/shipping'[^\n]*permission: 'shipping:configure'/)
    expect(orders).toContain("'/crm/shipping': 'shipping:configure'")
    expect(catalog).toMatch(/to: '\/crm\/discounts'[^\n]*permission: 'discounts:read'/)
    // The carrier form asks the credential permission.
    expect(src('crm/pages/store/orders/ShippingPage.tsx')).toContain("useMayWrite('integrations:update')")
  })

  test('the carrier API key is a credential: the manager is refused it, the owner sets it; the manager keeps the rates', async () => {
    expect((await k.as('manager')('POST', '/api/admin/shipping/config', carrier)).status).toBe(403)
    expect((await k.as('manager')('GET', '/api/admin/discounts')).status).toBe(200)
    expect((await k.as('manager')('PATCH', '/api/admin/settings', { flatShippingCents: 600 })).status).toBe(200)
    expect((await k.as('owner')('POST', '/api/admin/shipping/config', carrier)).status).toBe(200)
    const cfg = (await k.as('manager')('GET', '/api/admin/shipping/config')).json
    expect(JSON.stringify(cfg)).not.toContain('EZTK_test_key')
  })
})

describe("the setup wizard's steps reach their pages", () => {
  test("the first-run gate lets the wizard's own pages through; the store's are Payments, Domain and the product editor", async () => {
    const store = await loadVertical('store')
    const extra = (store.screens as any).onboarding.extra as Array<{ open: { to: string } }>
    expect(extra.map((e) => e.open.to)).toEqual(['/crm/domain', '/crm/payments', '/crm/products/new'])
    // No QuickBooks step: the store is not offered it.
    expect((store.screens as any).onboarding.integrations).not.toContain('quickbooks')
    const screens = src('crm/screens.tsx')
    expect(screens).toContain('!wizardOpens().includes(pathname)')
    const wizard = src('crm/pages/OnboardingWizard.tsx')
    expect(wizard).toContain('aria-label={`${integration.open.label} (opens in a new tab)`}')
  })
})

describe("a shop's own words", () => {
  test('Settings: no License #, its own two seats described as a shop; Billing Defaults only where the business invoices', async () => {
    const store = await loadVertical('store')
    const settings = (store.screens as any).settings
    expect(settings.licenseNumber).toBe(false)
    expect(settings.roles.map((r: any) => r.value)).toEqual(['field', 'manager'])
    expect(JSON.stringify(settings.roles)).not.toMatch(/\bjobs?\b|log time/i)
    const page = fs.readFileSync(path.join(import.meta.dir, '..', '..', '..', 'packages', 'tenant-ui', 'src', 'shell', 'SettingsPage.tsx'), 'utf8')
    expect(page).toContain("(!hasFeature || hasFeature('invoices') || hasFeature('quotes')) && (<>")
  })

  test("Help starts with the store's articles, none of the contractor's", async () => {
    const store = await loadVertical('store')
    const cats = new Set(store.starter!.helpArticles.map((a) => a.category))
    for (const c of ['Quotes & Invoices', 'Scheduling', 'Time & Expenses', 'Documents']) expect({ c, has: cats.has(c) }).toEqual({ c, has: false })
    expect(store.starter!.helpArticles[0].title).toBe('Getting started with your store')
  })

  test('the email inbox says what it is, links to Branded Email, and has one name in one place', async () => {
    const shell = src('shell.ts')
    expect(shell).toContain("{ to: '/crm/email', icon: Mail, label: 'Email Inbox'")
    // Settings no longer lists a second copy; an old link lands on the one page.
    expect(shell.slice(shell.indexOf('export const SETTINGS_SUB_PAGES'))).not.toMatch(/^[^\]]*email-inbox/)
    expect(src('App.tsx')).toContain('<Route path="settings/email-inbox" element={<Navigate to="/crm/email" replace />} />')
    const page = fs.readFileSync(path.join(import.meta.dir, '..', '..', '..', 'packages', 'tenant-ui', 'src', 'settings', 'InboundMessagesPage.tsx'), 'utf8')
    // Headed by its menu item's name — "Email Inbox" above; the templates' menus still say "Email"
    expect(page).toContain('<h1 className="text-2xl font-bold mb-2"><MenuName fallback="Email" /></h1>')
    expect(page).toContain('The messages people sent to your business&rsquo;s email addresses')
    expect(page).toContain('href="/crm/settings/email"')
    // Signed in, the owner reads it (branded_email is the store's).
    expect((await k.as('owner')('GET', '/api/inbound-messages?limit=100')).status).toBe(200)
  })

  test("the Lead Inbox is in the store's menu; Lead Sources (the marketplaces) is not", async () => {
    expect(src('crm/verticals/store.tsx')).toContain("'/crm/customers', '/crm/leads'")
    const store = await loadVertical('store')
    expect((store.screens as any).navHidden).toEqual(['/crm/lead-sources'])
  })
})

describe("a store's orders, as the owner reads them", () => {
  let paidId = ''
  test("an order keeps the product's own photo for its order-received page; the payment page gets only a fetchable one", async () => {
    await k.connectStripe()
    const { product } = await k.product({ slug: 'mug', name: 'Camp Mug', sku: 'MUG-1', priceCents: 1800 })
    await (k.t.db as any).insert(k.S.storeProductImage).values({ productId: product.id, url: '/media/site/mug.jpg', alt: 'A mug', isPrimary: true })
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ada@example.com' })
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('line_items[0][price_data][product_data][images][0]')).toBeNull()
    const o = await k.orderBySession(new URL(r.json.url).pathname.split('/').pop()!)
    paidId = o.id
    const summary = await k.pub('GET', `/api/public/order-summary?session_id=${o.providerSessionId}`)
    expect(JSON.stringify(summary.json)).toContain('/media/site/mug.jpg')
    // Started: the audit log says so, unpaid.
    const started = await (k.t.db as any).select().from(k.S.auditLog).where(eqId(k.S.auditLog.entityId, o.id))
    expect(started.map((a: any) => a.metadata?.description).join(' | ')).toMatch(/started at checkout — \$\d+\.\d\d, not paid yet/)
    k.stripe.sessions.set(o.providerSessionId, paidSession(o.providerSessionId, { amountTotal: o.totalCents }))
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    const rows = await (k.t.db as any).select().from(k.S.auditLog).where(eqId(k.S.auditLog.entityId, o.id))
    expect(rows.filter((a: any) => /paid —/.test(a.metadata?.description || ''))).toHaveLength(1)
  })

  test('Spent is what a customer paid less what was refunded to them, as the Dashboard nets it', async () => {
    const o = await k.order(paidId)
    await (k.t.db as any).update(k.S.storeOrder).set({ status: 'refunded', refundedCents: o.totalCents }).where(eqId(k.S.storeOrder.id, paidId))
    const list = (await k.O('GET', '/api/admin/orders/customers')).json
    const ada = (list.data || []).find((c: any) => c.email === 'ada@example.com')
    expect(ada?.totalSpentCents).toBe(0)
  })

  test('Stripe disconnected is in the audit log', async () => {
    await (k.t.db as any).update(k.S.company).set({ integrations: { stripeAccountId: 'acct_test123' } }).where(eqId(k.S.company.id, k.companyId))
    expect((await k.O('POST', '/api/integrations/stripe/disconnect')).status).toBe(200)
    const rows = await (k.t.db as any).select().from(k.S.auditLog).where(eqId(k.S.auditLog.entityId, 'acct_test123'))
    expect(rows.map((a: any) => a.metadata?.description)).toContain('Stripe disconnected — card payments no longer go to this account')
  })

  test('an unfinished checkout is labelled apart and left out of the recent sales; the list shows the sale price beside its was-price', () => {
    const lib = src('crm/pages/store/orders/lib.ts')
    expect(lib).toContain("o.status !== 'pending' ? codeLabel(o.status) : o.source === 'draft' ? 'Awaiting payment' : 'Checkout not completed'")
    expect(src('crm/pages/store/orders/DashboardPage.tsx')).toContain('.filter((x) => !isUnfinishedCheckout(x))')
    expect(src('crm/pages/store/orders/OrdersPage.tsx')).toContain('{orderStatusLabel(o)}')
    expect(src('crm/pages/store/catalog/ProductsPage.tsx')).toContain('lo.compareAtPriceCents && lo.compareAtPriceCents > lo.priceCents')
    expect(src('crm/pages/store/catalog/StoreSettingsPage.tsx')).toContain('value={form.currency.toUpperCase()}')
  })
})
