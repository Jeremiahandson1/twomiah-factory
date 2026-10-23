// The contractor RE-test of 2026-10-22 — what was still broken live after the first round — through the real server.
// The screens' half of each is clicked in a real browser (see the commit); this file holds the server's half.
//   1. Equipment: "Add Service Record" had no form; the route it posts to 500'd on a record with no type.
//   2. Takeoff "Add to quote" priced every line $0.00 (the standard assemblies carry no selling price and nothing could set
//      one) and left the screws at 6.72 lb: a material's prices are set on its assembly now, the sheet is worked out again
//      at them, and goods sold by weight are ordered in whole pounds.
//   4. Daily logs (and punch-list items, the sibling) keep photos: added, served, removed, inside the log's edit window.
//   6. Money's sign goes before the dollar sign (the shared formatter).
//   7. Email campaigns: {{firstName}} and {firstName} are filled; a field we can't fill is refused, never sent raw.
//   9. GET /api/jobs sends every status a job can hold — the list the screen's filter offers — 'pending' included.
//   5. Every trade that can switch warranties on has its own words for the warranty and claim forms.
import { describe, test, expect, beforeAll } from 'bun:test'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { money, moneyCents, signedMoney, moneyCompact } from '../../../packages/tenant-ui/src/money.ts'
import { DEFAULT_JOB_STATUSES } from '../../../packages/tenant-ui/src/jobs/types.ts'
import { JOB_STATUSES, personalize, unknownMergeFields, getFeaturesForTemplate } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'
const as = (who: string, method: string, path: string, json?: unknown, init: any = {}) =>
  t.call(path, { method, json, ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
let ip = 0
const signIn = async (email: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `203.0.113.${++ip}` } })).json()).accessToken as string
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a3' } }).png().toBuffer()
const photoForm = () => { const fd = new FormData(); fd.append('photo', new File([new Uint8Array(PNG)], 'site.png', { type: 'image/png' })); return fd }

const FEATURES = ['contacts', 'projects', 'jobs', 'quotes', 'invoices', 'equipment_tracking', 'takeoff_tools', 'daily_logs', 'punch_lists', 'rfis', 'documents', 'email_marketing']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const S = t.schema
  // The file store: R2 in production, the harness's in-memory one here, on the object every photo route holds.
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: (key: string) => { void t.store.remove(key); return true },
  })
  const hash = await Bun.password.hash(PASSWORD, 'bcrypt')
  for (const [key, slug] of [['A', 'build-a'], ['B', 'build-b']] as const) {
    const [co] = await t.db.insert(S.company).values({ name: `Builder ${key}`, slug, enabledFeatures: FEATURES } as any).returning()
    ids[`co${key}`] = co.id
    const [u] = await t.db.insert(S.user).values({ email: `owner${key.toLowerCase()}@test.example`, passwordHash: hash, firstName: 'O', lastName: key, role: 'owner', companyId: co.id }).returning()
    ids[`owner${key}`] = u.id
    tokens[`owner${key}`] = await signIn(`owner${key.toLowerCase()}@test.example`)
  }
  const [client] = await t.db.insert(S.contact).values({ companyId: ids.coA, name: 'Pat Client', type: 'client', email: 'pat@test.example' }).returning()
  ids.client = client.id
  const [p] = await t.db.insert(S.project).values({ companyId: ids.coA, number: 'PRJ-1', name: 'Kitchen', contactId: client.id }).returning()
  ids.project = p.id
}, 180_000)

describe('1. equipment: a service record is added from the history', () => {
  test('a record with what was done is saved and read back; one without is a 400, not a 500', async () => {
    const eq1 = await body(await as('ownerA', 'POST', '/api/equipment', { name: 'Job-site generator' }))
    ids.equipment = eq1.id
    expect((await as('ownerA', 'POST', `/api/equipment/${eq1.id}/history`, { description: 'no type' })).status).toBe(400)
    expect((await as('ownerA', 'POST', `/api/equipment/${eq1.id}/history`, { type: 'Oil change', cost: -5 })).status).toBe(400)
    const r = await as('ownerA', 'POST', `/api/equipment/${eq1.id}/history`, { type: 'Oil change', description: 'Synthetic', cost: 89.5, nextDueDate: '2027-04-01' })
    expect(r.status).toBe(201)
    const history = await body(await as('ownerA', 'GET', `/api/equipment/${eq1.id}/history`))
    expect(history).toHaveLength(1)
    // The fields the screen now reads: type, performedAt, cost, nextDueDate.
    expect(history[0]).toMatchObject({ type: 'Oil change', description: 'Synthetic' })
    expect(Number(history[0].cost)).toBe(89.5)
    expect(typeof history[0].performedAt).toBe('string')
    expect(String(history[0].nextDueDate).slice(0, 10)).toBe('2027-04-01')
    // Another company's equipment takes no record.
    expect((await as('ownerB', 'POST', `/api/equipment/${eq1.id}/history`, { type: 'Sneaky' })).status).toBe(404)
  })
})

describe('2. takeoffs: the standard assemblies are priced, and the quote lines carry the price', () => {
  test('a sheet of standard drywall: $0 until a selling price is set, then the price, and whole pounds of screws', async () => {
    expect((await as('ownerA', 'POST', '/api/takeoffs/assemblies/seed', {})).status).toBe(200)
    const asm = (await body(await as('ownerA', 'GET', '/api/takeoffs/assemblies'))).data.find((a: any) => a.name === 'Drywall (1/2")')
    const sheet = await body(await as('ownerA', 'POST', `/api/takeoffs/project/${ids.project}`, { name: 'Kitchen walls' }))
    ids.sheet = sheet.id
    await as('ownerA', 'POST', `/api/takeoffs/sheets/${sheet.id}/items`, { assemblyId: asm.id, length: 12, width: 10, quantity: 1 })
    // 120 sq ft × 1.12 waste: 0.05 lb/sq ft of screws = 6.72 lb → 7 lb to order; 0.03125 sheets/sq ft = 4.2 → 5 sheets.
    const before = (await body(await as('ownerA', 'GET', `/api/takeoffs/sheets/${sheet.id}/quote-lines`))).lines
    const screws = before.find((l: any) => l.description.startsWith('Drywall Screws'))
    expect(screws.quantity).toBe(7)
    // …while the sheet's totals (and its purchase-order export) keep the measured weight: 6.72 lb, not 7 (crm harness
    // t32-takeoff-export, "nails keep their decimals"). The rounding is the sale's, not the measure's.
    const totals = await body(await as('ownerA', 'GET', `/api/takeoffs/sheets/${sheet.id}/totals`))
    expect(totals.materials.find((m: any) => m.name.startsWith('Drywall Screws')).totalQuantity).toBe(6.72)
    expect(before.find((l: any) => l.description.startsWith('1/2" Drywall')).quantity).toBe(5)
    // What the live test got: no selling price anywhere.
    expect(before.every((l: any) => l.unitPrice === 0)).toBe(true)

    // The owner sets the selling prices on the assembly's materials…
    const prices: Record<string, number> = { 'Drywall Screws': 11, '1/2" Drywall 4x8': 18.5, 'Joint Compound': 22, 'Drywall Tape': 6 }
    const materials = asm.materials.map((m: any) => ({ id: m.id, unitPrice: prices[m.name] }))
    expect((await as('ownerA', 'PUT', `/api/takeoffs/assemblies/${asm.id}`, { materials: [{ id: materials[0].id, unitPrice: -1 }] })).status).toBe(400)
    expect((await as('ownerA', 'PUT', `/api/takeoffs/assemblies/${asm.id}`, { materials: [{ id: materials[0].id, unitPrice: 'lots' }] })).status).toBe(400)
    expect((await as('ownerB', 'PUT', `/api/takeoffs/assemblies/${asm.id}`, { materials })).status).toBe(404)
    const put = await as('ownerA', 'PUT', `/api/takeoffs/assemblies/${asm.id}`, { materials })
    expect(put.status).toBe(200)
    expect(Number((await body(put)).materials.find((m: any) => m.name === 'Drywall Screws').unitPrice)).toBe(11)

    // …and the sheet already measured is worked out again at them: the quote lines carry the selling price.
    const after = (await body(await as('ownerA', 'GET', `/api/takeoffs/sheets/${sheet.id}/quote-lines`))).lines
    const sAfter = after.find((l: any) => l.description.startsWith('Drywall Screws'))
    expect(sAfter.quantity).toBe(7)
    // 6.72 lb × $11 = $73.92 for what was measured; per ordered pound that is $10.56 — the price per unit of the order.
    expect(sAfter.unitPrice).toBeGreaterThan(0)
    expect(after.every((l: any) => l.unitPrice > 0)).toBe(true)
    const q = await as('ownerA', 'POST', '/api/quotes', { name: 'Takeoff: Kitchen walls', projectId: ids.project, contactId: ids.client, lineItems: after })
    expect(q.status).toBe(201)
    const quote = await body(q)
    expect(Number(quote.subtotal)).toBeGreaterThan(0)
    expect((quote.lineItems || []).every((li: any) => Number(li.unitPrice) > 0 && Number.isInteger(Number(li.quantity)))).toBe(true)
  })
})

describe('4. photos on a daily log and on a punch-list item', () => {
  test('a daily log: a photo is added, listed with its address, served, and removed', async () => {
    const log = await body(await as('ownerA', 'POST', '/api/daily-logs', { projectId: ids.project, workPerformed: 'Hung drywall' }))
    const up = await as('ownerA', 'POST', `/api/daily-logs/${log.id}/photos`, undefined, { body: photoForm() })
    expect(up.status).toBe(201)
    const withPhoto = await body(up)
    expect(withPhoto.photos).toHaveLength(1)
    const photo = withPhoto.photos[0]
    expect(photo.url).toBe(`/api/daily-logs/${log.id}/photos/${photo.id}/file`)
    // The list the page reads carries it too.
    const listed = (await body(await as('ownerA', 'GET', `/api/daily-logs?projectId=${ids.project}`))).data
    expect(listed[0].dailyLog.photos[0].url).toBe(photo.url)
    const file = await as('ownerA', 'GET', photo.url)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/jpeg')
    expect(file.headers.get('cache-control')).toContain('no-store')
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).format).toBe('jpeg')
    // Not another company's to read or add to; not a file that is no photo.
    expect((await as('ownerB', 'GET', photo.url)).status).toBe(404)
    expect((await as('ownerB', 'POST', `/api/daily-logs/${log.id}/photos`, undefined, { body: photoForm() })).status).toBe(404)
    const notPhoto = new FormData(); notPhoto.append('photo', new File(['hello'], 'a.txt', { type: 'text/plain' }))
    expect((await as('ownerA', 'POST', `/api/daily-logs/${log.id}/photos`, undefined, { body: notPhoto })).status).toBe(400)
    const del = await as('ownerA', 'DELETE', `/api/daily-logs/${log.id}/photos/${photo.id}`)
    expect(del.status).toBe(200)
    expect((await body(del)).photos).toEqual([])
    expect((await as('ownerA', 'GET', photo.url)).status).toBe(404)
  })

  test('a log past its edit window takes no new photo (the log itself can no longer change)', async () => {
    const [old] = await t.db.insert(t.schema.dailyLog).values({ companyId: ids.coA, projectId: ids.project, userId: ids.ownerA, date: new Date('2026-01-05T00:00:00Z') } as any).returning()
    const r = await as('ownerA', 'POST', `/api/daily-logs/${old.id}/photos`, undefined, { body: photoForm() })
    expect(r.status).toBe(400)
    expect(JSON.stringify(await body(r))).toContain('daily_log_closed')
  })

  test('a punch-list item: a photo is added, listed and removed', async () => {
    const item = await body(await as('ownerA', 'POST', '/api/punch-lists', { projectId: ids.project, description: 'Nail pop by the door' }))
    const up = await as('ownerA', 'POST', `/api/punch-lists/${item.id}/photos`, undefined, { body: photoForm() })
    expect(up.status).toBe(201)
    const photo = (await body(up)).photos[0]
    const listed = (await body(await as('ownerA', 'GET', `/api/punch-lists?projectId=${ids.project}`))).data
    expect(listed[0].punchListItem.photos[0].url).toBe(`/api/punch-lists/${item.id}/photos/${photo.id}/file`)
    expect((await as('ownerA', 'GET', `/api/punch-lists/${item.id}/photos/${photo.id}/file`)).status).toBe(200)
    expect((await as('ownerA', 'DELETE', `/api/punch-lists/${item.id}/photos/${photo.id}`)).status).toBe(200)
  })
})

describe('3 and 4. the screens\' other calls: an RFI closed and reopened, a document renamed', () => {
  test('an answered RFI closes; an unanswered one closes only when meant; a closed one reopens', async () => {
    const rfi = await body(await as('ownerA', 'POST', '/api/rfis', { projectId: ids.project, subject: 'Header size', question: 'Which header over the door?' }))
    expect((await as('ownerA', 'POST', `/api/rfis/${rfi.id}/close`, {})).status).toBe(400)
    const closed = await as('ownerA', 'POST', `/api/rfis/${rfi.id}/close`, { closeUnanswered: true })
    expect(closed.status).toBe(200)
    expect((await body(closed)).status).toBe('closed')
    expect((await body(await as('ownerA', 'POST', `/api/rfis/${rfi.id}/reopen`, {}))).status).toBe('open')
  })
})

describe('6. money: the sign before the dollar sign', () => {
  test('negative amounts read -$, everywhere the shared formatter is used', () => {
    expect(money(-200)).toBe('-$200.00')
    expect(money('-200')).toBe('-$200.00')
    expect(money(1234.5)).toBe('$1,234.50')
    expect(money(-1234.5, 0)).toBe('-$1,235')
    expect(money(-0.001)).toBe('$0.00')
    expect(money(null)).toBe('$0.00')
    expect(moneyCents(-1999)).toBe('-$19.99')
    expect(signedMoney(5)).toBe('+$5.00')
    expect(signedMoney(-5)).toBe('-$5.00')
    expect(moneyCompact(-150000)).toBe('-$150k')
    expect(moneyCompact(12345)).toBe('$12.3k')
  })
})

describe('7. email campaigns: merge fields', () => {
  test('both spellings of a field we have are filled; unknown ones are found', () => {
    const person = { name: 'Pat Client', email: 'pat@test.example', company: 'Client Co' }
    expect(personalize('Hi {firstName}, {{ lastName }} of {{Company}} — {{firstName}}', person)).toBe('Hi Pat, Client of Client Co — Pat')
    expect(personalize('<style>p { color: red }</style>', person)).toBe('<style>p { color: red }</style>')
    expect(unknownMergeFields('Hi {first_name} and {{nickname}}', 'ok {{firstName}}')).toEqual(['{first_name}', '{{nickname}}'])
  })

  test('the editor\'s list; a field we cannot fill is refused on save and on send; a good one is sent', async () => {
    const fields = (await body(await as('ownerA', 'GET', '/api/marketing/merge-fields'))).data
    expect(fields.map((f: any) => f.token)).toEqual(['{{firstName}}', '{{lastName}}', '{{name}}', '{{company}}', '{{email}}'])
    const bad = await as('ownerA', 'POST', '/api/marketing/campaigns', { name: 'Bad', subject: 'Hi {first_name}', body: '<p>x</p>', audienceType: 'all' })
    expect(bad.status).toBe(400)
    expect((await body(bad)).error).toContain('{first_name}')
    // The live test's campaign, as the owner wrote it: single braces. It is filled now, so it saves and sends.
    const made = await as('ownerA', 'POST', '/api/marketing/campaigns', { name: 'Spring', subject: 'Hi {firstName}', body: '<p>Hello {firstName}</p>', audienceType: 'all' })
    expect(made.status).toBe(201)
    const c = await body(made)
    expect((await as('ownerA', 'PUT', `/api/marketing/campaigns/${c.id}`, { body: '<p>{{nickname}}</p>' })).status).toBe(400)
    // A draft saved with a bad field before this check is not sent.
    await t.db.update(t.schema.campaign).set({ content: '<p>{{nickname}}</p>' } as any).where(eq(t.schema.campaign.id, c.id))
    expect((await as('ownerA', 'POST', `/api/marketing/campaigns/${c.id}/send`)).status).toBe(400)
    await t.db.update(t.schema.campaign).set({ content: '<p>Hello {firstName}</p>' } as any).where(eq(t.schema.campaign.id, c.id))
    const sent = await body(await as('ownerA', 'POST', `/api/marketing/campaigns/${c.id}/send`))
    expect([sent.sent, sent.status]).toEqual([1, 'sent'])
    // Templates and sequence steps are held to the same rule.
    expect((await as('ownerA', 'POST', '/api/marketing/templates', { name: 'T', subject: 'x', body: '{{nope}}' })).status).toBe(400)
    expect((await as('ownerA', 'POST', '/api/marketing/sequences', { name: 'S', steps: [{ subject: 'Hi {{nope}}', body: '' }] })).status).toBe(400)
  })
})

describe('9. jobs: every status a job can hold, in one list', () => {
  test('GET /api/jobs sends the server\'s list, the screen\'s fallback is the same list, and a quote\'s job is in it', async () => {
    const r = await body(await as('ownerA', 'GET', '/api/jobs'))
    expect(r.statuses).toEqual([...JOB_STATUSES])
    expect([...DEFAULT_JOB_STATUSES].sort()).toEqual([...JOB_STATUSES].sort())
    expect(r.statuses).toContain('pending')
    // A job converted from an approved quote holds 'pending' — and the filter by it finds the job.
    const quote = await body(await as('ownerA', 'POST', '/api/quotes', { name: 'Deck', contactId: ids.client, lineItems: [{ description: 'Deck', quantity: 1, unitPrice: 100 }] }))
    await as('ownerA', 'POST', `/api/quotes/${quote.id}/approve`)
    const conv = await as('ownerA', 'POST', `/api/quotes/${quote.id}/convert-to-job`)
    expect([200, 201]).toContain(conv.status)
    const pending = await body(await as('ownerA', 'GET', '/api/jobs?status=pending'))
    expect(pending.data.some((j: any) => j.status === 'pending')).toBe(true)
  })
})

describe('5. the warranty forms speak each trade\'s words', () => {
  test('every vertical that can switch warranties on sets its own examples', async () => {
    const { loadVertical } = await import('../server/core/vertical.ts')
    for (const id of ['bar', 'basic', 'contractor', 'fieldservice', 'homecare', 'landscaping', 'restaurant', 'roofing', 'rv', 'salon', 'store', 'vet']) {
      const v: any = await loadVertical(id)
      const offered = getFeaturesForTemplate(v.featureSet).some((f: any) => f.id === 'warranties')
      if (!offered) continue
      const w = v.screens?.warranties
      expect({ id, set: !!(w?.namePlaceholder && w?.categoryPlaceholder && w?.claimTitlePlaceholder && w?.claimLocationPlaceholder) }).toEqual({ id, set: true })
    }
    const contractor: any = await loadVertical('contractor')
    expect(contractor.screens.warranties.namePlaceholder).not.toMatch(/plant/i)
  })
})
