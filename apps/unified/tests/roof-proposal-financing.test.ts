// Roofing parity row 30 — customer financing beside the proposal (Roofr, Leap: a monthly figure on each package;
// server/crm/financing/; proposal_financing, not ready, on top of consumer_financing). Fails without the change.
//   · each pick-one option shows the lender's estimate on its own whole price; an add-on shows none; one out of range none;
//   · the customer's link: the estimates per option, and Apply waits for the choice (an application is for one price);
//     once chosen, Apply is on the quote at the chosen option's price;
//   · the office sees the same estimates, and cannot open an application before the choice;
//   · off (either switch, or the lender not connected): nothing per option, and the quote's own financing is as it was.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { optionOffersFor } from '../server/crm/financing/service.ts'
import { monthlyPayment } from '../server/crm/financing/lender.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let annId = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const BASE = ['contacts', 'jobs', 'quotes', 'invoices', 'quote_proposals', 'consumer_financing']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const OPTIONS = [
  { name: 'Good', tier: 'good', lines: [{ description: '3-tab shingles', quantity: 1, unitPrice: 9000 }] },
  { name: 'Better', tier: 'better', lines: [{ description: 'Architectural shingles', quantity: 1, unitPrice: 12000 }] },
  { name: 'Best', tier: 'best', lines: [{ description: 'Metal', quantity: 1, unitPrice: 70000 }] },
]
async function proposalQuote() {
  const q = (await json(await auth('/api/quotes', { method: 'POST', json: { name: 'Roof', contactId: annId, taxRate: 0, lineItems: [{ description: 'Permit', quantity: 1, unitPrice: 0 }] } }))).body
  const put = await json(await auth(`/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: OPTIONS } }))
  expect([put.status, put.body]).toEqual([200, expect.anything()])
  await auth(`/api/quotes/${q.id}/send`, { method: 'POST', json: {} })
  const row = (await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, q.id)))[0]
  const opts = await t.db.select().from(t.schema.quoteProposalOption).where(eq(t.schema.quoteProposalOption.quoteId, q.id))
  return { id: q.id as string, link: row.publicToken as string, opt: (name: string) => opts.find((o: any) => o.name === name)!.id as string }
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures([...BASE, 'proposal_financing'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services.crm.emailService as any).sendRaw = async () => ({ success: true })
  annId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', phone: '6085550100', type: 'client' } as any).returning()) as any[])[0].id
  const conn = await auth('/api/financing/connection', { method: 'PUT', json: { merchantId: 'm-123', prequalUrl: 'https://wisetack.us/#/abc123/prequalify' } })
  expect(conn.status).toBe(200)
}, 120_000)

describe('row 30: the rule', () => {
  test('an estimate on each pick-one option’s whole price; none on an add-on or out of range', () => {
    const r = optionOffersFor([{ id: 'a', setKind: 'one', price: '12000.00' }, { id: 'b', setKind: 'any', price: '12500.00' }, { id: 'c', setKind: 'one', price: '70000.00' }, { id: 'd', setKind: 'one', price: '400' }])
    expect(Object.keys(r)).toEqual(['a'])
    expect(r.a).toEqual({ asLowAs: monthlyPayment(12000, 9.9, 24), apr: 9.9, termMonths: 24, amount: 12000 })
  })
})

describe('row 30: the customer and the office', () => {
  test('the link shows each option’s estimate; Apply waits for the choice, then is for the chosen price', async () => {
    const q = await proposalQuote()
    const per = await json(await t.call(`/api/financing-public/d/${q.link}/options`))
    expect(per.status).toBe(200)
    expect(per.body.needsChoice).toBe(true)
    expect(per.body.options[q.opt('Good')].asLowAs).toBe(monthlyPayment(9000, 9.9, 24))
    expect(per.body.options[q.opt('Better')].asLowAs).toBe(monthlyPayment(12000, 9.9, 24))
    expect(per.body.options[q.opt('Best')]).toBeUndefined()
    expect(per.body.disclosure).toMatch(/subject to credit approval/)
    expect((await t.call(`/api/financing-public/d/${q.link}`)).status).toBe(404)
    const early = await json(await t.call(`/api/financing-public/d/${q.link}/apply`, { method: 'POST' }))
    expect([early.status, early.body.code]).toEqual([409, 'option_required'])
    const picked = await t.call(`/api/portal/d/${q.link}/quotes/${q.id}/choose-option`, { method: 'POST', json: { optionId: q.opt('Better') } })
    expect(picked.status).toBe(200)
    const offer = await json(await t.call(`/api/financing-public/d/${q.link}`))
    expect(offer.status).toBe(200)
    expect(offer.body.amount).toBe(12000)
    const apply = await json(await t.call(`/api/financing-public/d/${q.link}/apply`, { method: 'POST' }))
    expect(apply.status).toBe(200)
    expect(apply.body.url).toMatch(/^https:\/\/wisetack\.us\//)
  })

  test('the office sees the same estimates and opens no application before the choice', async () => {
    const q = await proposalQuote()
    const per = await json(await auth(`/api/financing/quotes/${q.id}/options`))
    expect(per.body.options[q.opt('Good')].asLowAs).toBe(monthlyPayment(9000, 9.9, 24))
    const panel = await json(await auth(`/api/financing/quotes/${q.id}`))
    expect(panel.body.offer).toBeNull()
    expect(panel.body.reason).toMatch(/Choose an option first/)
    const open = await json(await auth(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' }))
    expect(open.status).toBe(409)
  })

  test('off: nothing per option, and the quote’s own financing is as it was; the switch is hidden and roofing’s', async () => {
    const q = await proposalQuote()
    await setFeatures(BASE)
    try {
      expect((await t.call(`/api/financing-public/d/${q.link}/options`)).status).toBe(404)
      expect((await auth(`/api/financing/quotes/${q.id}/options`)).status).toBe(404)
      expect((await json(await auth(`/api/financing/quotes/${q.id}`))).body.reason ?? null).not.toMatch(/Choose an option first/)
    } finally { await setFeatures([...BASE, 'proposal_financing']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'proposal_financing') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
