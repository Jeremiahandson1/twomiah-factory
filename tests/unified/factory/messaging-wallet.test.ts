// The texting wallet's money rules (owner, 2026-10-21: "they need to be fixed"; "it should be 25 to start texting"):
//   · a top-up charges the card fee on top, so the wallet gets every cent (Twomiah absorbed 2.9% + 30¢ on each);
//   · one Stripe payment credits the wallet once, however many times Stripe delivers the event;
//   · a wallet that can't cover its monthly charge is reloaded from the card on file first, as Twilio bills its own
//     customers — it used to go negative, a debt for what Twomiah had already paid Twilio;
//   · registering for texting needs $25 in the wallet: the one-time carrier registration and something to text with.
// The Factory DB is a stand-in; Stripe and Twilio are never called.
import { test, expect, mock, describe, beforeAll, beforeEach } from 'bun:test'
import { stubAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore'

process.env.A2P_ENC_KEY = 'test-key'
const store: any = sharedFactoryDb
const ledger: any[] = []
const walletRpc = async (_fn: string, a: any) => {
  const t = store.tables.tenants.find((r: any) => r.id === a.p_tenant)
  const next = (t.messaging_wallet_hc ?? 0) + (a.p_kind === 'credit' ? a.p_amount : -a.p_amount)
  if (next < 0 && !a.p_allow_negative) return { data: null, error: { message: 'insufficient balance' } }
  t.messaging_wallet_hc = next
  const row = { id: 'l' + ledger.length, tenant_id: a.p_tenant, kind: a.p_kind, amount_hc: a.p_amount, balance_after_hc: next, reason: a.p_reason, stripe_ref: a.p_stripe_ref, created_at: new Date().toISOString() }
  ledger.push(row); store.tables.messaging_ledger = ledger
  return { data: next, error: null }
}
beforeEach(() => { store.rpc = walletRpc })
stubAuth({ supabase: store, authenticate: async () => {}, requireRole: () => async (_c: any, next: any) => next() })
const reloads: any[] = []
let cardWorks = true
/** Stripe's reload invoice, stood in by injection (services/messagingWallet.ts reloadWallet's deps) — never a module mock. */
const stripeStandIn = { createWalletReloadInvoice: async (o: any) => { reloads.push(o); return cardWorks ? { invoiceId: 'in_' + reloads.length, paid: true } : { invoiceId: 'in_x', paid: false, hostedUrl: 'https://invoice.stripe.com/i/x', error: 'card declined' } } }

const { withStripeFee } = await import('../../../apps/api/src/config/domainPricing.ts')
const { creditOnce, reloadWallet } = await import('../../../apps/api/src/services/messagingWallet.ts')
const { encryptJSON } = await import('../../../apps/api/src/lib/crypto.ts')

const tenant = (over: any = {}) => ({ id: 't-1', name: 'Acme', email: 'owner@acme.example', stripe_customer_id: 'cus_1', messaging_enabled: true, messaging_wallet_hc: 0, a2p_status: 'approved', a2p_phone_number: 'PN1', a2p_number_monthly_cents: 115, factory_sync_key: 'acme-key', ...over })

test('a $25 top-up charges $26.06 — the card fee on top — and the wallet is credited $25', () => {
  expect(withStripeFee(2500)).toBe(2606)
  expect(2606 - Math.round(2606 * 0.029) - 30).toBeGreaterThanOrEqual(2500)
})

describe('one Stripe payment, one credit', () => {
  test('the same payment delivered twice credits once', async () => {
    store.tables.tenants = [tenant({ messaging_wallet_hc: 0 })]
    ledger.length = 0
    expect(await creditOnce('t-1', 2500, 'topup', 'pi_1')).toBe(2500)
    expect(await creditOnce('t-1', 2500, 'topup', 'pi_1')).toBeNull()
    expect(store.tables.tenants[0].messaging_wallet_hc).toBe(250000)
    expect(await creditOnce('t-1', 2500, 'topup', 'pi_2')).toBe(5000)
  })
})

describe('auto-reload from the card on file', () => {
  test('at least $25, enough to cover what is owed, plus the card fee; once a day', async () => {
    reloads.length = 0
    const r = await reloadWallet(tenant(), 1115, stripeStandIn)
    expect(r).toMatchObject({ paid: true, creditCents: 2500 })
    expect(reloads[0]).toMatchObject({ customerId: 'cus_1', creditCents: 2500, chargeCents: 2606, tenantId: 't-1' })
    expect(reloads[0].key).toBe('wallet-reload-t-1-' + new Date().toISOString().slice(0, 10))
    // a bigger debt is covered in whole dollars
    expect((await reloadWallet(tenant(), 4350, stripeStandIn)).creditCents).toBe(4400)
    // no card on file: nothing charged
    expect(await reloadWallet(tenant({ stripe_customer_id: null }), 100, stripeStandIn)).toMatchObject({ paid: false, error: 'no card on file' })
  })

})

describe('the $10 a month covers the line', () => {
  // Owner, 2026-10-26: "i dont want to charge twice, so the 10 should cover it". The number's rental and the carriers'
  // monthly campaign fee are paid out of the $10 subscription — nothing takes them from the wallet as well.
  test('nothing debits a monthly line fee from the wallet', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const root = path.resolve(import.meta.dir, '../../../apps/api/src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.ts$/.test(f) && /debit\([^)]*'monthly_campaign'/.test(readFileSync(p, 'utf8'))) hits.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(hits).toEqual([])
    const costs = await import('../../../apps/api/src/config/messagingCosts.ts')
    expect(Object.keys(costs.TWILIO_COSTS).sort()).toEqual(['brandRegistrationCents', 'campaignVettingCents'])
  })
})

describe('$25 starts texting', () => {
  let app: any
  beforeAll(async () => {
    const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
    const { registerA2pRoutes } = await import('../../../apps/api/src/routes/factory/a2p.ts')
    app = new Hono()
    registerA2pRoutes(app)
  })
  const details = encryptJSON({ kind: 'sole_proprietor', brandName: 'Acme', mobilePhone: '+17155550111', street: '1 Main', city: 'Eau Claire', region: 'WI', postalCode: '54701', repFirstName: 'Pat', repLastName: 'Jones', repEmail: 'p@a.example', repPhone: '+17155550100' })
  const submit = () => app.request('/internal/messaging/self/11111111-1111-4111-8111-111111111111/registration', { method: 'POST', headers: { 'X-Factory-Key': 'acme-key', 'content-type': 'application/json' }, body: '{}' })

  test('$19.50 in the wallet is not enough to start; the answer says why and how much to add', async () => {
    store.tables.tenants = [tenant({ id: '11111111-1111-4111-8111-111111111111', a2p_status: 'collected', a2p_data: details, messaging_wallet_hc: 195000 })]
    const r = await submit()
    expect(r.status).toBe(402)
    const j = await r.json()
    expect(j.requiredCents).toBe(2500)
    expect(j.error).toContain('Add $5.50')
    expect(j.error).toContain('$25.00 starts texting')
    expect(store.tables.tenants[0].a2p_status).toBe('collected') // nothing was submitted
  })

  test('$25 is: the registration goes ahead (to Twilio — which this test never reaches)', async () => {
    store.tables.tenants = [tenant({ id: '11111111-1111-4111-8111-111111111111', a2p_status: 'collected', a2p_data: details, messaging_wallet_hc: 250000 })]
    const realFetch = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = (async (u: any) => { asked.push(String(u)); return new Response('{"message":"no network in tests"}', { status: 503 }) }) as any
    try {
      const r = await submit()
      expect(r.status).not.toBe(402)
      // it went past the wallet into the registration, which stopped at the first Twilio call
      expect(store.tables.tenants[0].a2p_status).toBe('error')
      expect(asked.every((u) => u.startsWith('https://trusthub.twilio.com/') || u.startsWith('https://api.twilio.com/'))).toBe(true)
    } finally { globalThis.fetch = realFetch }
  })
})
