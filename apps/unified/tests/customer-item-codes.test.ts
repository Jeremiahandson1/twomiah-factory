// A pricebook item's code never reaches the customer (live test 2026-10-22, roofing P3.3: the quote email listed
// "Standard (SVC-0001)"). The editors no longer write the code into a line (tenant-ui invoicing/ui.tsx pricebookLine);
// lines written before that are shown and copied without it (tenant-backend invoicing/itemCodes.ts): the quote email,
// the private link's quote and invoice pages, the PDFs, quote → invoice, quote → job and job → invoice.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { withoutItemCodes } from '@twomiah/tenant-backend/src/invoicing/itemCodes'
// The editor's own function, loaded by path at run time (the server's tsconfig compiles no JSX).
const UI = '@twomiah/tenant-ui/src/invoicing/ui'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const ids: Record<string, string> = {}
let code = ''
const sent: Array<{ template: string; data: any }> = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'pricebook'], email: 'office@test.example' } as any).where(eq(t.schema.company.id, seeded.company.id))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [casey] = await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name: 'Casey Customer', email: 'casey@example.com' } as any).returning()
  ids.contact = casey.id
  const item = await json(await call('/api/pricebook/items', { method: 'POST', json: { name: 'Standard', price: 8500 } }))
  expect(item.status).toBe(201)
  ids.item = item.body.id
  code = item.body.code
  expect(code).toMatch(/^SVC-\d{4}$/)
}, 120_000)

describe('the rule', () => {
  test('only this business\'s codes come out, where the picker put them; a customer\'s own brackets stay', () => {
    const codes = new Set(['SVC-0001'])
    expect(withoutItemCodes('Standard (SVC-0001)', codes)).toBe('Standard')
    expect(withoutItemCodes('Roof system (SVC-0001) — Better', codes)).toBe('Roof system — Better')
    expect(withoutItemCodes('Gutters (2 coats)', codes)).toBe('Gutters (2 coats)')
    expect(withoutItemCodes('Standard (SVC-0002)', codes)).toBe('Standard (SVC-0002)')
    expect(withoutItemCodes('Standard (SVC-0001) extra', codes)).toBe('Standard (SVC-0001) extra')
  })

  test('a line picked from the pricebook is the item\'s name, linked by its id', async () => {
    const { pricebookLine } = await import(UI) as { pricebookLine: (pb: any, option?: any) => any }
    const line = pricebookLine({ id: 'pb1', name: 'Standard', code: 'SVC-0001', price: 8500, type: 'service' } as any)
    expect(line).toMatchObject({ description: 'Standard', pricebookItemId: 'pb1', unitPrice: 8500 })
    const option = pricebookLine({ id: 'pb1', name: 'Standard', code: 'SVC-0001', price: 8500 } as any, { name: 'Better', price: 9500 })
    expect(option.description).toBe('Standard — Better')
  })
})

describe('a quote written before the change (its line still says the code)', () => {
  test('the email, the private link and the PDF route read it without the code; the staff copy is as stored', async () => {
    const q = await json(await call('/api/quotes', { method: 'POST', json: { name: 'Roof', contactId: ids.contact, lineItems: [
      { description: `Standard (${code})`, quantity: 1, unitPrice: 8500, pricebookItemId: ids.item },
      { description: 'Ridge vent (2 sides)', quantity: 1, unitPrice: 625.75 },
    ] } }))
    expect(q.status).toBe(201)
    ids.quote = q.body.id
    expect((await call(`/api/quotes/${ids.quote}/send`, { method: 'POST' })).status).toBe(200)
    const mail = sent.filter((m) => m.template === 'quoteSent').at(-1)!
    expect(mail.data.lineItems.map((l: any) => l.description)).toEqual(['Standard', 'Ridge vent (2 sides)'])
    // Marked approved by the office before the customer opens the link (a viewed quote is the customer's to decide).
    expect((await call(`/api/quotes/${ids.quote}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    const link = String(mail.data.documentPath).replace('/d/', '')
    const page = await json(await t.call(`/api/portal/d/${link}/quotes/${ids.quote}`))
    expect(page.body.lineItems.map((l: any) => l.description)).toEqual(['Standard', 'Ridge vent (2 sides)'])
    expect(JSON.stringify(page.body)).not.toContain(code)
    expect((await call(`/api/quotes/${ids.quote}/pdf`)).status).toBe(200)
    const staff = await json(await call(`/api/quotes/${ids.quote}`))
    expect(staff.body.lineItems[0].description).toBe(`Standard (${code})`)
  })

  test('approved and converted: the invoice and the job are written without it', async () => {
    const inv = await json(await call(`/api/quotes/${ids.quote}/convert-to-invoice`, { method: 'POST', json: {} }))
    expect(inv.status).toBe(201)
    expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Standard', 'Ridge vent (2 sides)'])
    const job = await json(await call(`/api/quotes/${ids.quote}/convert-to-job`, { method: 'POST', json: {} }))
    expect(job.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, job.body.id))
    expect(String(row.description)).not.toContain(code)
  })

  test('an invoice line that carries a code is shown on its private link without it', async () => {
    const inv = await json(await call('/api/invoices', { method: 'POST', json: { contactId: ids.contact, lineItems: [{ description: `Standard (${code})`, quantity: 1, unitPrice: 8500 }] } }))
    expect(inv.status).toBe(201)
    expect((await call(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })).status).toBe(200)
    const mail = sent.filter((m) => m.template === 'invoiceSent').at(-1)!
    const link = String(mail.data.documentPath).replace('/d/', '')
    const page = await json(await t.call(`/api/portal/d/${link}/invoices/${inv.body.id}`))
    expect(page.status).toBe(200)
    expect(page.body.lineItems.map((l: any) => l.description)).toEqual(['Standard'])
    expect((await call(`/api/invoices/${inv.body.id}/pdf`)).status).toBe(200)
  })
})

describe('field service: a job billed from its quote', () => {
  test('the invoice the job makes carries the quote\'s lines without the code', async () => {
    const f = await bootTenant({ vertical: 'fieldservice' })
    const seeded = await seedOwner(f)
    await f.db.update(f.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'pricebook'] } as any).where(eq(f.schema.company.id, seeded.company.id))
    const tok = (await (await f.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    const as = (p: string, init: any = {}) => f.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
    const [who] = await f.db.insert(f.schema.contact).values({ companyId: seeded.company.id, name: 'Pat Doe' } as any).returning()
    const item = await json(await as('/api/pricebook/items', { method: 'POST', json: { name: 'Tune-up', price: 189 } }))
    const q = await json(await as('/api/quotes', { method: 'POST', json: { name: 'Tune-up', contactId: who.id, lineItems: [{ description: `Tune-up (${item.body.code})`, quantity: 1, unitPrice: 189, pricebookItemId: item.body.id }] } }))
    expect((await as(`/api/quotes/${q.body.id}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    const job = await json(await as(`/api/quotes/${q.body.id}/convert-to-job`, { method: 'POST', json: {} }))
    expect(job.status).toBe(201)
    const billed = await json(await as(`/api/jobs/${job.body.id}/invoice`, { method: 'POST', json: {} }))
    expect(billed.status).toBe(201)
    const inv = await json(await as(`/api/invoices/${billed.body.id ?? billed.body.invoice?.id}`))
    expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Tune-up'])
  })
})
