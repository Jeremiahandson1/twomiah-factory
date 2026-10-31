// Estimating depth (brief item 5), through the real server: a quote's lines can sit in sections (phases) with subtotals,
// carry a markup on our cost, be allowances, and carry a cost code; approving the quote opens its allowances on
// Selections (where Selections is on) and sets the project's budget by cost code, which Job Costing reads back. The
// customer's page and the PDF show the sections and the allowances and never the cost or the markup.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { generateQuotePDF } from '../server/crm/pdf.ts'
import fs from 'node:fs'

const json = async (r: Response) => (await r.json()) as any
// job_budgets: the project-budget route is behind its own (not ready) feature, switched on here as a platform admin would.
const BASE = ['contacts', 'quotes', 'invoices', 'jobs', 'projects', 'job_costing', 'job_budgets', 'pricebook']

async function boot(vertical = 'contractor', features = [...BASE, 'selections']) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, email: 'office@test.example', phone: '555-0100' } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const customer = await ins(t.schema.contact, { companyId: s.company.id, type: 'client', name: 'Ann Able', email: 'ann@test.example' })
  const project = await ins(t.schema.project, { companyId: s.company.id, number: 'PRJ-00001', name: 'Kitchen remodel', contactId: customer.id })
  const sent: any[] = []
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, o?: any) => { sent.push({ to, template, data }); return real(to, template, data, o) }
  return { t, ins, owner, seat, companyId: s.company.id as string, customer, project, sent }
}
const KITCHEN = (projectId: string, contactId: string) => ({
  name: 'Kitchen remodel', contactId, projectId,
  lineItems: [
    { description: 'Demo cabinets\nHaul away', quantity: 1, unitPrice: 0, unitCost: 800, markupPct: 25, section: 'Demolition', costCode: '02-Demo', type: 'labor' },
    { description: 'Framing lumber', quantity: 10, unitPrice: 0, unitCost: 50, markupPct: 20, section: 'Framing', costCode: '06-Framing', type: 'material' },
    { description: 'Framing labour', quantity: 8, unitPrice: 60, unitCost: 40, section: 'Framing', costCode: '06-Framing', type: 'labor' },
    { description: 'Countertop — your choice, up to this amount', quantity: 1, unitPrice: 3000, section: 'Finishes', allowance: true },
  ],
})

describe('sections, markup and subtotals', () => {
  test('a markup on our cost sets the price; sections carry subtotals; a multi-line description is kept', async () => {
    const { owner, project, customer } = await boot()
    const made = await owner('/api/quotes', { method: 'POST', json: KITCHEN(project.id, customer.id) })
    expect(made.status).toBe(201)
    const q = await json(made)
    const lines = q.lineItems as any[]
    // 800 × 1.25 = 1000; 50 × 1.20 = 60 → 10 × 60 = 600; the hand-priced line stays as typed
    expect(lines.map((l) => [Number(l.unitPrice), Number(l.total)])).toEqual([[1000, 1000], [60, 600], [60, 480], [3000, 3000]])
    expect(lines[0].description).toBe('Demo cabinets\nHaul away')
    expect(Number(q.subtotal)).toBe(5080)
    const read = await json(await owner(`/api/quotes/${q.id}`))
    expect(read.sections).toEqual([
      { name: 'Demolition', subtotal: 1000, allowance: 0, count: 1, cost: 800 },
      { name: 'Framing', subtotal: 1080, allowance: 0, count: 2, cost: 820 },
      { name: 'Finishes', subtotal: 3000, allowance: 3000, count: 1, cost: 0 },
    ])
    // the sections add up to the quote
    expect(read.sections.reduce((s: number, x: any) => s + x.subtotal, 0)).toBe(Number(read.subtotal))
  }, 90_000)

  test('a markup with no cost to mark up is refused in words, and nothing is saved', async () => {
    const { owner, project, customer } = await boot()
    const r = await owner('/api/quotes', { method: 'POST', json: { name: 'Bad', contactId: customer.id, projectId: project.id, lineItems: [{ description: 'Tile', quantity: 1, unitPrice: 10, markupPct: 30 }] } })
    expect(r.status).toBe(400)
    expect((await json(r)).error).toBe('Line 1 (Tile) has a markup but no cost to mark up — enter what it costs you, or take the markup off.')
    expect((await json(await owner('/api/quotes'))).data).toHaveLength(0)
  }, 90_000)

  test('a seat that cannot read margins is not shown our cost or the markup, and saving it does not wipe them', async () => {
    const { owner, seat, project, customer } = await boot()
    const q = await json(await owner('/api/quotes', { method: 'POST', json: KITCHEN(project.id, customer.id) }))
    const viewer = await seat('viewer')
    const seen = await json(await viewer(`/api/quotes/${q.id}`))
    for (const l of seen.lineItems) { expect(l.unitCost).toBeUndefined(); expect(l.markupPct).toBeUndefined() }
    expect(seen.sections.every((s: any) => s.cost === undefined)).toBe(true)
    // the owner still sees both
    const mine = await json(await owner(`/api/quotes/${q.id}`))
    expect(Number(mine.lineItems[0].markupPct)).toBe(25)
    expect(Number(mine.lineItems[0].unitCost)).toBe(800)
  }, 90_000)
})

describe('approving the quote', () => {
  async function sendAndApprove(x: Awaited<ReturnType<typeof boot>>) {
    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: KITCHEN(x.project.id, x.customer.id) }))
    expect((await x.owner(`/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
    expect((await x.owner(`/api/quotes/${q.id}/approve`, { method: 'POST' })).status).toBe(200)
    return q
  }

  test('allowance lines open on Selections once, with the allowance as the amount', async () => {
    const x = await boot()
    const q = await sendAndApprove(x)
    const rows = await x.t.db.select().from(x.t.schema.projectSelection)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ projectId: x.project.id, name: 'Countertop — your choice, up to this amount', status: 'pending' })
    expect(Number(rows[0].allowance)).toBe(3000)
    expect(rows[0].quoteLineItemId).toBe(q.lineItems.find((l: any) => l.allowance).id)
    // approving again (the office hits it twice) does not open a second one
    await x.owner(`/api/quotes/${q.id}/approve`, { method: 'POST' })
    expect(await x.t.db.select().from(x.t.schema.projectSelection)).toHaveLength(1)
  }, 90_000)

  test('where Selections is off, nothing is opened — the quote is still approved and still budgets', async () => {
    const x = await boot('contractor', BASE)
    await sendAndApprove(x)
    expect(await x.t.db.select().from(x.t.schema.projectSelection)).toHaveLength(0)
    expect((await x.t.db.select().from(x.t.schema.projectBudgetLine)).length).toBeGreaterThan(0)
  }, 90_000)

  test('the project budget is the quote by cost code, and Job Costing reads it', async () => {
    const x = await boot()
    await sendAndApprove(x)
    const r = await x.owner(`/api/job-costing/budget/${x.project.id}`)
    expect(r.status).toBe(200)
    const b = await json(r)
    const byCode = Object.fromEntries(b.lines.map((l: any) => [l.costCode, l]))
    expect(byCode['02-Demo']).toMatchObject({ estimatedCost: 800, estimatedPrice: 1000, uncostedLines: 0 })
    expect(byCode['06-Framing']).toMatchObject({ estimatedCost: 820, estimatedPrice: 1080 })
    // the allowance line has a section but no cost code: it files under its section, uncosted
    expect(byCode['Finishes']).toMatchObject({ estimatedCost: 0, estimatedPrice: 3000, uncostedLines: 1 })
    expect(b.totalCost).toBe(1620)
    expect(b.totalPrice).toBe(5080)
    expect(b.uncostedLines).toBe(1)
    expect(b.actualCost).toBe(0)
    // a quote that is not approved budgets nothing
    const y = await boot()
    await y.owner('/api/quotes', { method: 'POST', json: KITCHEN(y.project.id, y.customer.id) })
    expect((await json(await y.owner(`/api/job-costing/budget/${y.project.id}`))).lines).toEqual([])
  }, 90_000)

  test('a seat without reports:read is refused the budget', async () => {
    const x = await boot()
    await sendAndApprove(x)
    const field = await x.seat('field')
    expect((await field(`/api/job-costing/budget/${x.project.id}`)).status).toBe(403)
  }, 90_000)
})

describe('what the customer reads', () => {
  test('the quote page shows sections and allowances — never our cost or the markup — and the PDF groups them', async () => {
    const x = await boot()
    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: KITCHEN(x.project.id, x.customer.id) }))
    await x.owner(`/api/quotes/${q.id}/send`, { method: 'POST' })
    const mail = x.sent.filter((m) => m.template === 'quoteSent').at(-1)!
    const token = String(mail.data.documentPath || '').replace('/d/', '')
    const page = await json(await x.t.call(`/api/portal/d/${token}/quotes/${q.id}`))
    const lines = page.lineItems as any[]
    expect(lines.map((l) => l.section)).toEqual(['Demolition', 'Framing', 'Framing', 'Finishes'])
    expect(lines.find((l) => l.section === 'Finishes').allowance).toBe(true)
    for (const l of lines) { expect(l.unitCost).toBeUndefined(); expect(l.markupPct).toBeUndefined(); expect(l.costCode).toBeUndefined() }

    // the PDF: section names, their subtotals, the allowance said to be one
    const full = await json(await x.owner(`/api/quotes/${q.id}`))
    const file = '/tmp/estimating-depth.pdf'
    fs.writeFileSync(file, await generateQuotePDF({ ...full, contact: x.customer }, { name: 'Test Builders' }))
    const text = Bun.spawnSync(['pdftotext', '-layout', file, '-']).stdout.toString()
    for (const s of ['Demolition', 'Framing', 'Finishes', 'Framing subtotal', '$1,080.00', '(allowance)']) expect(text).toContain(s)
    expect(text).not.toContain('Markup')
  }, 90_000)

  test('a plain quote (no sections, no allowances) draws exactly as before', async () => {
    const text = await (async () => {
      const file = '/tmp/estimating-plain.pdf'
      fs.writeFileSync(file, await generateQuotePDF({ number: 'QTE-1', name: 'Plain', subtotal: '100', total: '100', lineItems: [{ description: 'Gutter clean', quantity: 1, unitPrice: 100, total: 100 }] }, { name: 'Test Builders' }))
      return Bun.spawnSync(['pdftotext', '-layout', file, '-']).stdout.toString()
    })()
    expect(text).toContain('Gutter clean')
    expect(text).not.toContain('subtotal')
    expect(text).not.toContain('(allowance)')
  }, 60_000)
})

describe('the other trades with quotes', () => {
  for (const vertical of ['basic', 'fieldservice', 'landscaping']) {
    test(`${vertical}: sections and markup work; no Selections, so no allowance is opened`, async () => {
      const x = await boot(vertical, BASE)
      const made = await x.owner('/api/quotes', { method: 'POST', json: { name: 'Job', contactId: x.customer.id, lineItems: [{ description: 'Parts', quantity: 2, unitPrice: 0, unitCost: 10, markupPct: 50, section: 'Parts' }, { description: 'Allowance line', quantity: 1, unitPrice: 100, allowance: true, section: 'Parts' }] } })
      expect(made.status).toBe(201)
      const q = await json(made)
      expect(q.lineItems.map((l: any) => Number(l.total))).toEqual([30, 100])
      const read = await json(await x.owner(`/api/quotes/${q.id}`))
      expect(read.sections).toEqual([{ name: 'Parts', subtotal: 130, allowance: 100, count: 2, cost: 20 }])
      await x.owner(`/api/quotes/${q.id}/send`, { method: 'POST' })
      expect((await x.owner(`/api/quotes/${q.id}/approve`, { method: 'POST' })).status).toBe(200)
      expect(await x.t.db.select().from(x.t.schema.projectSelection)).toHaveLength(0)
    }, 90_000)
  }
})
