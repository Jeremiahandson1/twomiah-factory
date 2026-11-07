// Contractor parity row 12 (part a) — roofing's payment tools for the general contractor (docs/parity/contractor-payments.md): the
// card surcharge setting, the payouts view, and texting an invoice with receipts answer on a contractor's tenant behind their own
// switches; roofing still mounts its own copy, once; the four switches are offered to the contractor CRM and stay not ready.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })

async function boot(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, state: 'TX' } as any).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  return { t, owner: (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } }) }
}

describe('payment tools for the contractor', () => {
  test('the four switches are offered to the contractor CRM as well as roofing, and none is ready', () => {
    for (const id of ['card_surcharge', 'payments_overview', 'invoice_text_requests', 'portal_pay_options']) {
      const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
      expect([id, f?.hidden, f?.templates]).toEqual([id, true, ['crm-roof', 'crm']])
    }
  })

  test('on a contractor tenant: the surcharge setting and the texted-invoice list answer behind their switches', async () => {
    const on = await boot('contractor', ['contacts', 'invoices', 'online_payments', 'card_surcharge', 'invoice_text_requests'])
    const s = await json(await on.owner('/api/card-payments/surcharge'))
    expect(s.status).toBe(200)
    expect(s.body).toHaveProperty('setting')
    const inv = (await on.t.db.insert(on.t.schema.invoice).values({ companyId: (await on.t.db.select().from(on.t.schema.company))[0].id, number: 'INV-00001', status: 'sent', total: '100', subtotal: '100' } as any).returning())[0]
    expect((await on.owner(`/api/invoice-requests/${inv.id}`)).status).toBe(200)
    const off = await boot('contractor', ['contacts', 'invoices'])
    expect((await off.owner('/api/card-payments/surcharge')).status).toBe(404)
  }, 90_000)

  test('roofing keeps its own copy, mounted once', async () => {
    const r = await boot('roofing', ['jobs', 'contacts', 'invoices', 'online_payments', 'card_surcharge'])
    expect((await r.owner('/api/card-payments/surcharge')).status).toBe(200)
  }, 90_000)
})
