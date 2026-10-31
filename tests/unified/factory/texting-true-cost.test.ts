// "Texting at cost" is true (owner, 2026-10-27): a text is charged what Twilio and the carrier charge for it —
// Twilio $0.0083 a segment + the carrier's fee (AT&T $0.0035, T-Mobile $0.0045, Verizon $0.005; Twilio's US SMS price
// page, checked 2026-10-27) — kept in hundredths of a cent so thousands of texts add up exactly.
// The Factory DB is a stand-in; Stripe and Twilio are never called.
import { test, expect, mock, describe, beforeAll, beforeEach } from 'bun:test'
import { stubAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore'

process.env.CRON_SECRET = 'cron-test'
delete process.env.RESEND_API_KEY
const store: any = sharedFactoryDb
const ledger: any[] = []
/** messaging_wallet_apply (migrations/2026-10-28_messaging_hundredths_of_a_cent.sql), the same arithmetic. */
const walletRpc = async (_fn: string, a: any) => {
  const t = store.tables.tenants.find((r: any) => r.id === a.p_tenant)
  const next = (t.messaging_wallet_hc ?? 0) + (a.p_kind === 'credit' ? a.p_amount : -a.p_amount)
  if (next < 0 && !a.p_allow_negative) return { data: null, error: { message: 'insufficient balance' } }
  t.messaging_wallet_hc = next
  ledger.push({ id: 'l' + ledger.length, tenant_id: a.p_tenant, kind: a.p_kind, amount_hc: a.p_amount, balance_after_hc: next, reason: a.p_reason, created_at: new Date().toISOString() })
  store.tables.messaging_ledger = ledger
  return { data: next, error: null }
}
beforeEach(() => { store.rpc = walletRpc; ledger.length = 0 })
stubAuth({ supabase: store, authenticate: async () => {}, requireRole: () => async (_c: any, next: any) => next() })

const T = '11111111-1111-4111-8111-111111111111'
const tenant = (over: any = {}) => ({ id: T, name: 'Acme', email: 'owner@acme.example', stripe_customer_id: null, messaging_enabled: true, messaging_wallet_hc: 0, factory_sync_key: 'acme-key', a2p_status: 'approved', ...over })
const costsPath = '../../../apps/api/src/config/messagingCosts.ts'
const costs = await import(costsPath)

let app: any
beforeAll(async () => {
  const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
  const { registerMessagingRoutes } = await import('../../../apps/api/src/routes/factory/messaging.ts')
  app = new Hono()
  registerMessagingRoutes(app)
})
const report = (body: any) => app.request(`/internal/messaging/usage/${T}`, { method: 'POST', headers: { 'X-Factory-Key': 'acme-key', 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('the price of one text', () => {
  test("Twilio's $0.0083 plus the carrier's fee — 1.18¢ to 1.33¢, 1.26¢ blended", () => {
    expect(costs.smsSegmentHc('AT&T')).toBe(83 + 35)
    expect(costs.smsSegmentHc('T-Mobile')).toBe(83 + 45)
    expect(costs.smsSegmentHc('Verizon Wireless')).toBe(83 + 50)
    expect(costs.smsSegmentHc('Sprint')).toBe(83 + 45) // Sprint is T-Mobile
    // no carrier named (today, every send) → the blended fee: the average of the three, $0.0043
    expect(costs.smsSegmentHc()).toBe(83 + 43)
    expect(costs.smsSegmentHc('Some Regional Co-op')).toBe(83 + 43)
    expect(costs.smsPriceSummary()).toMatchObject({ segmentHc: 126, minHc: 118, maxHc: 133, twilioHc: 83, carrierFeeHc: 43, checked: '2026-10-27' })
    // the old charge was 1¢ — below cost
    expect(costs.smsSegmentHc()).toBeGreaterThan(100)
  })

  test('every figure is a setting, in dollars', async () => {
    const keys = ['TWILIO_SMS_SEGMENT_USD', 'CARRIER_FEE_ATT_USD', 'CARRIER_FEE_TMOBILE_USD', 'CARRIER_FEE_VERIZON_USD', 'CARRIER_FEE_BLENDED_USD']
    const saved = keys.map((k) => process.env[k])
    process.env.TWILIO_SMS_SEGMENT_USD = '0.0100'
    process.env.CARRIER_FEE_ATT_USD = '0.004'
    process.env.CARRIER_FEE_TMOBILE_USD = '0.005'
    process.env.CARRIER_FEE_VERIZON_USD = '0.006'
    try {
      const c = await import(costsPath + '?env-override')
      expect(c.smsSegmentHc('att')).toBe(100 + 40)
      expect(c.smsSegmentHc('verizon')).toBe(100 + 60)
      expect(c.smsSegmentHc()).toBe(100 + 50) // blended follows the new average
      process.env.CARRIER_FEE_BLENDED_USD = '0.0055'
      const c2 = await import(costsPath + '?env-override-blended')
      expect(c2.smsSegmentHc()).toBe(100 + 55)
      process.env.TWILIO_SMS_SEGMENT_USD = 'banana' // nonsense falls back to Twilio's price
      const c3 = await import(costsPath + '?env-override-bad')
      expect(c3.SMS_PRICING.twilioSegmentHc).toBe(83)
    } finally {
      keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]! })
    }
  })
})

describe('the ledger is exact', () => {
  test('5,000 texts, one segment each: the wallet is down exactly 5,000 × 1.26¢ = $63.00', async () => {
    store.tables.tenants = [tenant({ messaging_wallet_hc: 1_000_000 })] // $100.00
    for (let i = 0; i < 5000; i++) expect((await report({ segments: 1 })).status).toBe(200)
    expect(store.tables.tenants[0].messaging_wallet_hc).toBe(1_000_000 - 5000 * 126)
    expect(store.tables.tenants[0].messaging_wallet_hc / 10_000).toBe(37) // $37.00 left, to the hundredth of a cent
    expect(ledger).toHaveLength(5000)
    expect(ledger.reduce((s, l) => s + l.amount_hc, 0)).toBe(630_000)
  })

  test('a mixed batch charges each its carrier: nothing lost to rounding', async () => {
    store.tables.tenants = [tenant({ messaging_wallet_hc: 500_000 })]
    const mix: Array<[string | undefined, number, number]> = [['AT&T', 1, 118], ['T-Mobile', 2, 128], ['Verizon', 3, 133], [undefined, 1, 126]]
    let spent = 0
    for (let i = 0; i < 400; i++) for (const [carrier, segments, per] of mix) { await report({ segments, carrier }); spent += segments * per }
    expect(store.tables.tenants[0].messaging_wallet_hc).toBe(500_000 - spent)
    const r = await (await report({ segments: 2, carrier: 'verizon', twilioSid: 'SM1' })).json()
    expect(r).toMatchObject({ success: true, chargedHc: 266 })
    // the reply's balance is in cents, with the fraction
    expect(r.balance).toBe((500_000 - spent - 266) / 100)
  })

  test("the usage report still refuses nonsense and the wrong key", async () => {
    store.tables.tenants = [tenant()]
    expect((await report({ segments: 0 })).status).toBe(400)
    expect((await app.request(`/internal/messaging/usage/${T}`, { method: 'POST', headers: { 'X-Factory-Key': 'nope', 'content-type': 'application/json' }, body: '{"segments":1}' })).status).toBe(401)
  })

  test('the ledger reads back in cents with the fraction, and in hc', async () => {
    store.tables.tenants = [tenant({ messaging_wallet_hc: 10_000 })]
    await report({ segments: 1 })
    const { getLedger } = await import('../../../apps/api/src/services/messagingWallet.ts')
    const [row] = await getLedger(T, 5)
    expect(row).toMatchObject({ amount_hc: 126, amount_cents: 1.26, balance_after_hc: 9_874, balance_after_cents: 98.74 })
  })

  test('a whole-cent top-up and a registration fee are exact in hc', async () => {
    store.tables.tenants = [tenant()]
    const { credit, debit, getBalanceHc, getBalance } = await import('../../../apps/api/src/services/messagingWallet.ts')
    expect(await credit(T, 2500, 'topup')).toBe(2500)
    expect(await debit(T, 450, 'a2p_brand')).toBe(2050)
    await report({ segments: 1 })
    expect(await getBalanceHc(T)).toBe(205_000 - 126)
    expect(await getBalance(T)).toBe(2048.74)
  })
})

describe('low balance and reload still work with fractions of a cent', () => {
  test('under $2.00 is low: 1.9999¢ short of it reloads; $2.0001 does not', async () => {
    const low = costs.MESSAGING_LOW_CENTS * 100 // hc
    store.tables.tenants = [
      tenant({ id: '22222222-2222-4222-8222-222222222222', messaging_wallet_hc: low - 1, factory_sync_key: 'k2', email: 'a@x.example' }),
      tenant({ id: '33333333-3333-4333-8333-333333333333', messaging_wallet_hc: low, factory_sync_key: 'k3', email: 'b@x.example' }),
      tenant({ id: '44444444-4444-4444-8444-444444444444', messaging_wallet_hc: -50, factory_sync_key: 'k4', email: 'c@x.example' }),
    ]
    const r = await app.request('/internal/messaging/low-balance-nudge', { method: 'POST', headers: { 'x-cron-secret': 'cron-test' } })
    const j = await r.json()
    expect(j.checked).toBe(2) // the first and the overdrawn one; the wallet exactly at the line is not low
    expect(store.tables.tenants.filter((t: any) => t.messaging_nudged_at).map((t: any) => t.id).sort())
      .toEqual(['22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444'])
  })

  test("a reload covers a negative balance with its fraction, in whole dollars, at least $25", async () => {
    const { reloadWallet } = await import('../../../apps/api/src/services/messagingWallet.ts')
    const calls: any[] = []
    const deps = { createWalletReloadInvoice: async (o: any) => { calls.push(o); return { paid: true } } }
    // owes 43.5¢ more than nothing → still the $25 minimum
    expect(await reloadWallet({ id: 't', stripe_customer_id: 'cus' }, 43.5, deps)).toMatchObject({ paid: true, creditCents: 2500 })
    // owes $30.0126 → $31
    expect((await reloadWallet({ id: 't', stripe_customer_id: 'cus' }, 3001.26, deps)).creditCents).toBe(3100)
  })

  test("the pre-send gate sees a wallet of part of a cent as not empty, and the status reply carries the fraction", async () => {
    store.tables.tenants = [tenant({ messaging_wallet_hc: 50 })] // half a cent
    const r = await (await app.request(`/internal/messaging/balance/${T}`, { headers: { 'X-Factory-Key': 'acme-key' } })).json()
    expect(r).toMatchObject({ walletCents: 0.5, walletHc: 50, enabled: true })
    expect(r.walletCents > 0).toBe(true) // packages/tenant-backend walletSufficient(): balance > 0
  })

  test('the Texting page gets the per-text price', async () => {
    store.tables.tenants = [tenant()]
    const r = await (await app.request(`/internal/messaging/self/${T}`, { headers: { 'X-Factory-Key': 'acme-key' } })).json()
    expect(r.textPrice).toMatchObject({ segmentHc: 126, minHc: 118, maxHc: 133 })
  })
})
