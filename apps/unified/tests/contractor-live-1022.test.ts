// The contractor live test of 2026-10-22, and the shared invoice rule it found:
//   · Selections: a selection had nowhere to add options ("No options found"). The library's POST /options now takes a
//     checked price and picture, files the option under the company's own category only, and a selection is made only
//     with the company's own option (the template read the option unscoped).
//   · Takeoffs reached a purchase order only. GET /sheets/:id/quote-lines gives the materials as quote lines at the
//     selling price, which the shared quotes routes take as they take any line.
//   · The Gantt chart was read-only. It now reads, adds, moves and removes a project's tasks and moves the project's
//     own bar, each write projects:update and the company's own record.
//   · A vendor is never who an invoice bills: the server refuses one (any vertical; the Client picker leaves them out).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'
const as = (who: string, method: string, path: string, json?: unknown) =>
  t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
let ip = 0
const signIn = async (email: string) => (await (await t.call("/api/auth/login", { method: "POST", json: { email, password: PASSWORD }, headers: { "X-Forwarded-For": `203.0.113.${++ip}` } })).json()).accessToken as string
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

const FEATURES = ['contacts', 'projects', 'quotes', 'invoices', 'selections', 'takeoff_tools', 'gantt_charts', 'purchase_orders']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const S = t.schema
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  for (const [key, slug] of [['A', 'build-a'], ['B', 'build-b']] as const) {
    const [co] = await t.db.insert(S.company).values({ name: `Builder ${key}`, slug, enabledFeatures: FEATURES } as any).returning()
    ids[`co${key}`] = co.id
    await t.db.insert(S.user).values({ email: `owner${key.toLowerCase()}@test.example`, passwordHash: hash, firstName: 'O', lastName: key, role: 'owner', companyId: co.id })
    tokens[`owner${key}`] = await signIn(`owner${key.toLowerCase()}@test.example`)
  }
  await t.db.insert(S.user).values({ email: 'crew@test.example', passwordHash: hash, firstName: 'C', lastName: 'Crew', role: 'field', companyId: ids.coA })
  tokens.crew = await signIn('crew@test.example')
  const [client] = await t.db.insert(S.contact).values({ companyId: ids.coA, name: 'Pat Client', type: 'client' }).returning()
  const [vendor] = await t.db.insert(S.contact).values({ companyId: ids.coA, name: 'Lumber Yard', type: 'vendor' }).returning()
  ids.client = client.id; ids.vendor = vendor.id
  const [p] = await t.db.insert(S.project).values({ companyId: ids.coA, number: 'PRJ-1', name: 'Kitchen', contactId: client.id, startDate: new Date('2026-11-02T00:00:00Z'), endDate: new Date('2026-11-30T00:00:00Z') }).returning()
  const [pB] = await t.db.insert(S.project).values({ companyId: ids.coB, number: 'PRJ-1', name: 'B house' }).returning()
  ids.project = p.id; ids.projectB = pB.id
}, 180_000)

describe('selections: options can be added and chosen', () => {
  test('an option is added to the selection\'s category, and a selection is made with it', async () => {
    const cats = await body(await as('ownerA', 'GET', '/api/selections/categories'))
    ids.cat = cats.data.find((c: any) => c.name === 'Countertops').id
    const sel = await body(await as('ownerA', 'POST', `/api/selections/project/${ids.project}`, { name: 'Kitchen counters', categoryId: ids.cat, allowance: 2000, quantity: 1 }))
    ids.sel = sel.id
    expect((await body(await as('ownerA', 'GET', `/api/selections/options?categoryId=${ids.cat}`))).data).toEqual([])
    const r = await as('ownerA', 'POST', '/api/selections/options', { categoryId: ids.cat, name: 'Quartz', price: '2450.505', imageUrl: 'https://example.com/q.jpg' })
    expect(r.status).toBe(201)
    const opt = await body(r)
    expect(Number(opt.price)).toBe(2450.51)
    expect(opt.imageUrl).toBe('https://example.com/q.jpg')
    const listed = (await body(await as('ownerA', 'GET', `/api/selections/options?categoryId=${ids.cat}`))).data
    expect(listed.map((o: any) => o.name)).toEqual(['Quartz'])
    const chosen = await as('ownerA', 'POST', `/api/selections/${ids.sel}/select`, { optionId: opt.id })
    expect(chosen.status).toBe(200)
    const rows = (await body(await as('ownerA', 'GET', `/api/selections/project/${ids.project}`))).data
    expect(Math.round(rows[0].priceDifference * 100) / 100).toBe(450.51)
    ids.optA = opt.id
  })

  test('a price that is not a number, or negative, is refused (it was a 500)', async () => {
    expect((await as('ownerA', 'POST', '/api/selections/options', { categoryId: ids.cat, name: 'X', price: 'lots' })).status).toBe(400)
    expect((await as('ownerA', 'POST', '/api/selections/options', { categoryId: ids.cat, name: 'X', price: -5 })).status).toBe(400)
    expect((await as('ownerA', 'POST', '/api/selections/options', { categoryId: ids.cat, name: 'X', price: 5, imageUrl: 'javascript:alert(1)' })).status).toBe(400)
  })

  test('another company\'s category takes no option, and another company\'s option makes no selection', async () => {
    expect((await as('ownerB', 'POST', '/api/selections/options', { categoryId: ids.cat, name: 'Sneaky', price: 1 })).status).toBe(404)
    const catsB = await body(await as('ownerB', 'GET', '/api/selections/categories'))
    const catB = catsB.data[0].id
    const optB = await body(await as('ownerB', 'POST', '/api/selections/options', { categoryId: catB, name: 'B only', price: 1 }))
    expect((await as('ownerA', 'POST', `/api/selections/${ids.sel}/select`, { optionId: optB.id })).status).toBe(404)
  })
})

describe('takeoffs: the materials go onto a quote', () => {
  test('the sheet\'s quote lines are the selling price per order unit, and the shared quotes route takes them', async () => {
    const asm = await body(await as('ownerA', 'POST', '/api/takeoffs/assemblies', {
      name: 'Wall', category: 'framing', measurementType: 'linear', wasteFactor: 10,
      materials: [{ name: 'Stud', quantityPer: 0.75, unit: 'each', unitCost: 4.5, unitPrice: 6 }],
    }))
    const sheet = await body(await as('ownerA', 'POST', `/api/takeoffs/project/${ids.project}`, { name: 'Ground floor' }))
    await as('ownerA', 'POST', `/api/takeoffs/sheets/${sheet.id}/items`, { assemblyId: asm.id, length: 14.5, quantity: 1 })
    const r = await as('ownerA', 'GET', `/api/takeoffs/sheets/${sheet.id}/quote-lines`)
    expect(r.status).toBe(200)
    const built = await body(r)
    expect(built.projectId).toBe(ids.project)
    // 14.5 ft × 0.75 × 1.10 = 11.9625 studs → 12 to order; $6.00 each to the customer, $4.50 cost.
    expect(built.lines).toEqual([{ description: 'Stud (each)', quantity: 12, unitPrice: 6, unitCost: 4.5, type: 'material' }])
    const q = await as('ownerA', 'POST', '/api/quotes', { name: 'Takeoff: Ground floor', projectId: ids.project, contactId: ids.client, lineItems: built.lines })
    expect(q.status).toBe(201)
    expect(Number((await body(q)).subtotal)).toBe(72)
    // …and onto an existing draft, after its own lines.
    const draft = await body(await as('ownerA', 'POST', '/api/quotes', { name: 'Draft', lineItems: [{ description: 'Labour', quantity: 2, unitPrice: 50 }] }))
    const put = await as('ownerA', 'PUT', `/api/quotes/${draft.id}`, { lineItems: [{ description: 'Labour', quantity: 2, unitPrice: 50 }, ...built.lines] })
    expect(put.status).toBe(200)
    expect(Number((await body(put)).subtotal)).toBe(172)
    // The PO export reads the same lines (cost, not price).
    const po = await body(await as('ownerA', 'POST', `/api/takeoffs/sheets/${sheet.id}/export-po`, { vendorId: ids.vendor }))
    expect(po.lines).toEqual([expect.objectContaining({ description: 'Stud (each)', quantity: '12', unitCost: '4.50', total: '54.00' })])
  })

  test('another company\'s sheet has no quote lines to give', async () => {
    const sheets = (await body(await as('ownerA', 'GET', `/api/takeoffs/project/${ids.project}`)))
    const sheetId = (sheets.data ?? sheets)[0].id
    expect((await as('ownerB', 'GET', `/api/takeoffs/sheets/${sheetId}/quote-lines`)).status).toBe(404)
  })
})

describe('the Gantt chart plans: tasks added, bars moved', () => {
  test('a task is added to a project and read back with it', async () => {
    const r = await as('ownerA', 'POST', `/api/gantt-charts/${ids.project}/tasks`, { name: 'Framing', startDate: '2026-11-03', endDate: '2026-11-07' })
    expect(r.status).toBe(201)
    ids.task = (await body(r)).id
    const chart = (await body(await as('ownerA', 'GET', '/api/gantt-charts'))).data
    const kitchen = chart.find((p: any) => p.id === ids.project)
    expect(kitchen.tasks.map((x: any) => x.name)).toEqual(['Framing'])
    expect(new Date(kitchen.tasks[0].startDate).toISOString().slice(0, 10)).toBe('2026-11-03')
  })

  test('dragging a task moves its dates; an end before its start is refused', async () => {
    const r = await as('ownerA', 'PATCH', `/api/gantt-charts/tasks/${ids.task}`, { startDate: '2026-11-10', endDate: '2026-11-14' })
    expect(r.status).toBe(200)
    expect(new Date((await body(r)).endDate).toISOString().slice(0, 10)).toBe('2026-11-14')
    expect((await as('ownerA', 'PATCH', `/api/gantt-charts/tasks/${ids.task}`, { endDate: '2026-11-01' })).status).toBe(400)
    expect((await as('ownerA', 'POST', `/api/gantt-charts/${ids.project}/tasks`, { name: 'Bad', startDate: '2026-11-05', endDate: '2026-11-01' })).status).toBe(400)
  })

  test('dragging the project\'s bar moves the project', async () => {
    const r = await as('ownerA', 'PATCH', `/api/gantt-charts/${ids.project}/dates`, { startDate: '2026-11-09', endDate: '2026-12-07' })
    expect(r.status).toBe(200)
    const [row] = await t.db.select().from(t.schema.project).where(eq(t.schema.project.id, ids.project))
    expect(row.startDate!.toISOString().slice(0, 10)).toBe('2026-11-09')
    expect(row.endDate!.toISOString().slice(0, 10)).toBe('2026-12-07')
  })

  test('another company cannot read, move or add to them; a crew seat (no projects:update) cannot plan', async () => {
    const chartB = (await body(await as('ownerB', 'GET', '/api/gantt-charts'))).data
    expect(chartB.flatMap((p: any) => p.tasks).length).toBe(0)
    expect((await as('ownerB', 'PATCH', `/api/gantt-charts/tasks/${ids.task}`, { startDate: '2026-11-01', endDate: '2026-11-02' })).status).toBe(404)
    expect((await as('ownerB', 'POST', `/api/gantt-charts/${ids.project}/tasks`, { name: 'X', startDate: '2026-11-01', endDate: '2026-11-02' })).status).toBe(404)
    expect((await as('ownerB', 'PATCH', `/api/gantt-charts/${ids.project}/dates`, { startDate: '2026-11-01', endDate: '2026-11-02' })).status).toBe(404)
    expect((await as('crew', 'POST', `/api/gantt-charts/${ids.project}/tasks`, { name: 'X', startDate: '2026-11-01', endDate: '2026-11-02' })).status).toBe(403)
  })

  test('a task is removed', async () => {
    expect((await as('ownerB', 'DELETE', `/api/gantt-charts/tasks/${ids.task}`)).status).toBe(404)
    expect((await as('ownerA', 'DELETE', `/api/gantt-charts/tasks/${ids.task}`)).status).toBeLessThan(300)
    const chart = (await body(await as('ownerA', 'GET', '/api/gantt-charts'))).data
    expect(chart.find((p: any) => p.id === ids.project).tasks).toEqual([])
  })
})

describe('a vendor is never an invoice\'s client', () => {
  const line = [{ description: 'Work', quantity: 1, unitPrice: 100 }]
  test('an invoice to a vendor is refused; to a client it is raised', async () => {
    const bad = await as('ownerA', 'POST', '/api/invoices', { contactId: ids.vendor, lineItems: line })
    expect(bad.status).toBe(400)
    expect((await body(bad)).code).toBe('vendor_not_client')
    const ok = await as('ownerA', 'POST', '/api/invoices', { contactId: ids.client, lineItems: line })
    expect(ok.status).toBe(201)
    ids.invoice = (await body(ok)).id
  })

  test('an invoice cannot be moved onto a vendor; saving it unchanged still works', async () => {
    const moved = await as('ownerA', 'PUT', `/api/invoices/${ids.invoice}`, { contactId: ids.vendor })
    expect(moved.status).toBe(400)
    expect((await as('ownerA', 'PUT', `/api/invoices/${ids.invoice}`, { contactId: ids.client, notes: 'ok' })).status).toBe(200)
  })
})
