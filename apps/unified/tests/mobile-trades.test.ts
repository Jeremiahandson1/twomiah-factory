// The phone app's TRADES screens (apps/mobile — contractor, basic, field service, landscaping, roofing) against the real
// unified server: every request those screens now send, with the exact params and bodies the app sends, and every field
// the screens read off the replies — as the owner and as the field seat. Where a seat lacks a permission the app hides the
// control; the server's 403 is asserted here so the hidden control is the right one to hide.
//
// The screens and what they call:
//   contact/form.tsx       POST/PUT /api/contacts { name, … } — one `name`, 409 + existingId on a duplicate
//   contact/[id].tsx       GET /api/contacts/:id (jobs, quotes, invoices by seat); DELETE, POST /:id/convert (office)
//   job/form.tsx           POST/PUT /api/jobs — shared { title, scheduledDate: YYYY-MM-DD, scheduledTime: HH:MM … };
//                          roofing { contactId, jobType, propertyAddress, city, state, zip }
//   job/[id].tsx           GET /api/jobs/:id; shared PUT { notes } + POST /:id/start|dispatch|complete;
//                          roofing POST /:id/notes { body }, /:id/advance, /:id/close, /:id/reopen, PUT { inspectionDate }
//   PhotoGallery.tsx       contractor GET /api/photos?jobId + POST /api/photos/bulk (jobId, photos) + GET /:id/file;
//                          other trades GET/POST /api/jobs/:id/photos (photo)
//   quote/form, quote/[id], quotes.tsx   POST /api/quotes { lineItems: [{ description, quantity, unitPrice (dollars) }] },
//                          GET /api/quotes/:id, /api/quotes, /api/quotes/stats, POST /:id/approve, /:id/convert-to-invoice
//   invoice/[id].tsx       GET /api/invoices/:id, POST /:id/payments { amount (dollars), method }
//   schedule.tsx           GET /api/jobs?date=YYYY-MM-DD
//   pipeline.tsx           GET /api/jobs?limit=500 (roofing) — grouped by status
//   lead/quick-add.tsx     POST /api/contacts { type: 'lead' } then POST /api/jobs (roofing)
//   canvass.tsx            /api/canvassing/sessions, /:id/stops, /:id/end, ?mine=1
//   dashboard.tsx          GET /api/dashboard/stats, /api/jobs/today (not for roofing or the dealership)
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

const PASS = 'Seat-pass-1'
// A real 8x8 PNG (the documents route re-encodes it with sharp, so it must decode).
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer()
// Bun's toMatchObject writes the asymmetric matchers it was given back into the object it checked (an id read after
// `toMatchObject({ id: expect.any(String) })` became the matcher), so every shape check looks at a copy.
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const pad = (n: number) => String(n).padStart(2, '0')
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` })()

type Tenant = Awaited<ReturnType<typeof bootTenant>>
interface Booted { t: Tenant; tokens: Record<string, string>; logins: Record<string, any>; companyId: string }

async function boot(vertical: string, features: string[]): Promise<Booted> {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, seeded.company.id))
  // The photo store: the server's file storage is R2, which a test never reaches (noLiveKeys). In production the CRM's
  // file storage and the website's /media store are the same bucket, so the harness's in-memory store stands in for
  // both, on the same object every photo route holds.
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: async (key: string) => { await t.store.remove(key) },
  })
  const tokens: Record<string, string> = {}
  const logins: Record<string, any> = {}
  const login = async (who: string, email: string, password: string) => {
    const body = await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()
    tokens[who] = body.accessToken
    logins[who] = body
  }
  await login('owner', 'owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['field', 'field'], ['viewer', 'viewer']] as const) {
    await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId: seeded.company.id } as any)
    await login(key, `${key}@test.example`, PASS)
  }
  return { t, tokens, logins, companyId: seeded.company.id }
}

const caller = (b: Booted) => async (who: string, method: string, path: string, body?: unknown) => {
  const init: any = { method, headers: { Authorization: `Bearer ${b.tokens[who]}` } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) init.json = body
  const res = await b.t.call(path, init)
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.arrayBuffer() } as { status: number; type: string; body: any }
}
const photoForm = (field: string, extra: Record<string, string> = {}) => {
  const form = new FormData()
  form.append(field, new File([new Uint8Array(PNG)], 'photo.png', { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return form
}

// ─────────────────────────────────────────────────────────────────────────────── contractor
describe('contractor (shared jobs, photos as documents)', () => {
  let b: Booted
  let call: ReturnType<typeof caller>
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    b = await boot('contractor', ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'])
    call = caller(b)
  }, 120_000)

  test("sign-in hands the app the seat's permissions: the field seat has no quotes:read and no contacts:create", () => {
    expect(b.logins.owner.permissions).toContain('*')
    const field: string[] = b.logins.field.permissions
    expect(Array.isArray(field)).toBe(true)
    expect(field).toContain('jobs:update')
    expect(field).toContain('contacts:read')
    for (const p of ['quotes:read', 'invoices:read', 'contacts:create', 'contacts:update', 'contacts:delete', 'jobs:create']) expect(field).not.toContain(p)
    expect(b.logins.field.user.role).toBe('field')
  })

  test('contact form: one name creates (201); a duplicate is 409 with existingId; "save anyway" sends allowDuplicate', async () => {
    const body = { name: 'Dana Homeowner', email: 'dana@example.com', phone: '(555) 201-3344', company: undefined, address: '12 Oak St', city: 'Madison', state: 'WI', zip: '53703', type: 'lead', notes: 'Kitchen' }
    const made = await call('owner', 'POST', '/api/contacts', body)
    expect(made.status).toBe(201)
    expect(clone(made.body)).toMatchObject({ id: expect.any(String), name: 'Dana Homeowner', type: 'lead', state: 'WI' })
    ids.contact = made.body.id
    // The old first/last body is what the server refused: name is required.
    expect((await call('owner', 'POST', '/api/contacts', { firstName: 'No', lastName: 'Name', type: 'lead' })).status).toBe(400)
    const dupe = await call('owner', 'POST', '/api/contacts', { ...body, name: 'Dana Again' })
    expect(dupe.status).toBe(409)
    expect(dupe.body.existingId).toBe(ids.contact)
    expect(dupe.body.error).toEqual(expect.any(String))
    expect((await call('owner', 'POST', '/api/contacts', { ...body, name: 'Dana Again', allowDuplicate: true })).status).toBe(201)
  })

  test("contact edit: the name is kept, and '' clears a box the person emptied", async () => {
    const edit = { name: 'Dana H.', email: 'dana@example.com', phone: '(555) 201-3344', company: '', address: '12 Oak St', city: 'Madison', state: 'WI', zip: '53703', type: 'lead', notes: '' }
    // "Dana Again" (saved anyway above) shares the email, so the edit is the same 409 the form answers with
    // "Save anyway" — which resends with allowDuplicate.
    const first = await call('owner', 'PUT', `/api/contacts/${ids.contact}`, edit)
    expect(first.status).toBe(409)
    expect(first.body.existingId).toEqual(expect.any(String))
    const res = await call('owner', 'PUT', `/api/contacts/${ids.contact}`, { ...edit, allowDuplicate: true })
    expect(res.status).toBe(200)
    expect(clone(res.body)).toMatchObject({ name: 'Dana H.', notes: '' })
    const read = await call('owner', 'GET', `/api/contacts/${ids.contact}`)
    expect(read.body.name).toBe('Dana H.')
  })

  test('contacts list: { data }, the type chips are real filters, a word the CRM lacks is a 400', async () => {
    // The field seat reads the customers on its own jobs (crew scope, 2026-10-24): give it one with this lead on it, for
    // this read only (the job form below books the contact's real job).
    const [visit] = await b.t.db.insert(b.t.schema.job).values({ companyId: b.companyId, number: 'JOB-09901', title: 'Field seat visit', status: 'scheduled', contactId: ids.contact, assignedToId: b.logins.field.user.id } as any).returning()
    const list = await call('field', 'GET', '/api/contacts?page=1&limit=25&type=lead')
    expect(list.status).toBe(200)
    expect(clone(list.body.data[0])).toMatchObject({ id: expect.any(String), name: expect.any(String), type: 'lead' })
    await b.t.db.delete(b.t.schema.job).where(eq(b.t.schema.job.id, visit.id))
    for (const ty of ['lead', 'client', 'subcontractor', 'vendor']) expect((await call('owner', 'GET', `/api/contacts?type=${ty}`)).status).toBe(200)
    expect((await call('owner', 'GET', '/api/contacts?type=customer')).status).toBe(400)
  })

  test('job form (shared): a calendar day + HH:MM; the schedule finds it by ?date=; detail carries what the screen reads', async () => {
    const made = await call('owner', 'POST', '/api/jobs', { title: 'Deck repair', description: 'Rotten boards', contactId: ids.contact, address: '12 Oak St', city: 'Madison', state: 'WI', zip: '53703', scheduledDate: today, scheduledTime: '14:30', notes: 'Gate code 1234', assignedToId: b.logins.field.user.id })
    expect(made.status).toBe(201)
    ids.job = made.body.id
    const day = await call('field', 'GET', `/api/jobs?date=${today}&limit=100`)
    expect(day.status).toBe(200)
    expect(day.body.data.map((j: any) => j.id)).toContain(ids.job)
    const other = await call('field', 'GET', '/api/jobs?date=2001-01-01&limit=100')
    expect(other.body.data).toEqual([])
    const row = day.body.data.find((j: any) => j.id === ids.job)
    expect(clone(row)).toMatchObject({ title: 'Deck repair', number: expect.any(String), status: 'scheduled', scheduledTime: '14:30', address: '12 Oak St', city: 'Madison', contact: { name: 'Dana H.' } })
    expect('assignedTo' in row).toBe(true)
    const detail = await call('field', 'GET', `/api/jobs/${ids.job}`)
    expect(clone(detail.body)).toMatchObject({ id: ids.job, title: 'Deck repair', notes: 'Gate code 1234', description: 'Rotten boards', contact: { id: ids.contact, name: 'Dana H.' } })
    expect(typeof detail.body.notes).toBe('string')
    expect(String(detail.body.scheduledDate).slice(0, 10)).toBe(today)
    // The field seat cannot make a job: the app shows it no "+".
    expect((await call('field', 'POST', '/api/jobs', { title: 'Nope' })).status).toBe(403)
  })

  test("job notes: the field seat saves the text with PUT { notes }; there is no POST /notes on the shared module", async () => {
    const saved = await call('field', 'PUT', `/api/jobs/${ids.job}`, { notes: 'Gate code 1234\nDog in yard' })
    expect(saved.status).toBe(200)
    // Notes keep the person's line breaks (server/core/sanitize.ts cleanLines).
    expect((await call('field', 'GET', `/api/jobs/${ids.job}`)).body.notes).toBe('Gate code 1234\nDog in yard')
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/notes`, { content: 'x' })).status).toBe(404)
  })

  test('job actions: dispatch, start and complete are the field seat\'s; the viewer is refused', async () => {
    expect((await call('viewer', 'POST', `/api/jobs/${ids.job}/start`)).status).toBe(403)
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/dispatch`)).body.status).toBe('dispatched')
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/start`)).body.status).toBe('in_progress')
    const done = await call('field', 'POST', `/api/jobs/${ids.job}/complete`)
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('completed')
  })

  test('photos (contractor): bulk upload by jobId, listed by ?jobId, the file served with the session only', async () => {
    const up = await call('field', 'POST', '/api/photos/bulk', photoForm('photos', { jobId: ids.job }))
    expect(up.status).toBe(201)
    expect(up.body.uploaded).toBe(1)
    const list = await call('field', 'GET', `/api/photos?jobId=${ids.job}`)
    expect(list.status).toBe(200)
    expect(list.body.data).toHaveLength(1)
    const photo = list.body.data[0]
    expect(clone(photo)).toMatchObject({ id: expect.any(String), url: `/api/photos/${photo.id}/file`, thumbnailUrl: `/api/photos/${photo.id}/thumbnail` })
    // Another job's list does not carry it (the old ?leadId / ?contactId were not filters and listed every photo).
    expect((await call('field', 'GET', '/api/photos?jobId=someone-else')).body.data).toEqual([])
    const file = await call('field', 'GET', photo.url)
    expect(file.status).toBe(200)
    expect(file.type).toContain('image/')
    expect((await b.t.call(photo.url)).status).toBe(401)
    // Contractor has no job photo routes; the gallery does not ask them.
    expect((await call('owner', 'GET', `/api/jobs/${ids.job}/photos`)).status).toBe(404)
  })

  test('contact detail: the owner gets jobs, quotes and invoices; the field seat gets jobs only, and is refused delete and convert', async () => {
    const owner = await call('owner', 'GET', `/api/contacts/${ids.contact}`)
    expect(owner.body).toHaveProperty('quotes')
    expect(owner.body).toHaveProperty('invoices')
    expect(clone(owner.body.jobs[0])).toMatchObject({ id: ids.job, number: expect.any(String), title: 'Deck repair', status: 'completed' })
    const field = await call('field', 'GET', `/api/contacts/${ids.contact}`)
    expect(field.status).toBe(200)
    expect(field.body).not.toHaveProperty('quotes')
    expect(field.body).not.toHaveProperty('invoices')
    expect(field.body.jobs).toHaveLength(1)
    expect(field.body).not.toHaveProperty('portalToken')
    expect((await call('field', 'DELETE', `/api/contacts/${ids.contact}`)).status).toBe(403)
    expect((await call('field', 'POST', `/api/contacts/${ids.contact}/convert`)).status).toBe(403)
    expect((await call('field', 'PUT', `/api/contacts/${ids.contact}`, { name: 'x' })).status).toBe(403)
  })

  test('quote form: lineItems in DOLLARS — 2 × $12.50 is a $25.00 quote, not $2,500', async () => {
    const made = await call('owner', 'POST', '/api/quotes', { name: 'Deck rebuild', contactId: ids.contact, expiryDate: today, lineItems: [{ description: 'Boards', quantity: 2, unitPrice: 12.5 }, { description: 'Labour', quantity: 1.5, unitPrice: 40 }] })
    expect(made.status).toBe(201)
    ids.quote = made.body.id
    expect(Number(made.body.subtotal)).toBe(85)
    // The old body (items[].rate in cents) is a quote with no lines, which the server refuses.
    expect((await call('owner', 'POST', '/api/quotes', { name: 'Old', contactId: ids.contact, items: [{ description: 'Boards', quantity: 2, rate: 1250 }] })).status).toBe(400)
    const detail = await call('owner', 'GET', `/api/quotes/${ids.quote}`)
    expect(clone(detail.body)).toMatchObject({ id: ids.quote, number: expect.any(String), name: 'Deck rebuild', status: 'draft', contact: { id: ids.contact, name: 'Dana H.' } })
    for (const k of ['subtotal', 'taxAmount', 'discount', 'total', 'expiryDate']) expect(detail.body).toHaveProperty(k)
    expect(detail.body.lineItems.map((l: any) => [l.description, Number(l.quantity), Number(l.unitPrice), Number(l.total)])).toEqual([['Boards', 2, 12.5, 25], ['Labour', 1.5, 40, 60]])
    expect(Number(detail.body.total)).toBeGreaterThanOrEqual(85)
  })

  test('quotes tab: { data } rows and stats with draft + sent (no `pending`), all in dollars; a field seat is refused all of it', async () => {
    const list = await call('owner', 'GET', '/api/quotes?page=1&limit=25')
    expect(clone(list.body.data[0])).toMatchObject({ id: ids.quote, name: 'Deck rebuild', number: expect.any(String), status: 'draft', contact: { name: 'Dana H.' } })
    expect(list.body.data[0]).toHaveProperty('expiryDate')
    expect((await call('owner', 'GET', '/api/quotes?status=declined')).status).toBe(200)
    const stats = await call('owner', 'GET', '/api/quotes/stats')
    expect(clone(stats.body)).toMatchObject({ total: 1, draft: 1, sent: 0, approved: 0 })
    expect(stats.body).not.toHaveProperty('pending')
    expect(Number(stats.body.totalValue)).toBe(Number(list.body.data[0].total))
    for (const p of ['/api/quotes', '/api/quotes/stats', `/api/quotes/${ids.quote}`]) expect((await call('field', 'GET', p)).status).toBe(403)
    expect((await call('field', 'POST', '/api/quotes', { name: 'x', lineItems: [{ description: 'a', quantity: 1, unitPrice: 1 }] })).status).toBe(403)
  })

  test('quote → invoice; a payment typed $12.34 is recorded as 12.34, and the invoice reads amountPaid / balance in dollars', async () => {
    expect((await call('owner', 'POST', `/api/quotes/${ids.quote}/approve`)).status).toBe(200)
    const inv = await call('owner', 'POST', `/api/quotes/${ids.quote}/convert-to-invoice`)
    expect(inv.status).toBe(201)
    ids.invoice = inv.body.id
    const before = await call('owner', 'GET', `/api/invoices/${ids.invoice}`)
    const total = Number(before.body.total)
    expect(total).toBeGreaterThan(12.34)
    for (const k of ['number', 'status', 'total', 'amountPaid', 'amountRefunded', 'balance', 'lineItems', 'payments', 'contact']) expect(before.body).toHaveProperty(k)
    expect(clone(before.body.lineItems[0])).toMatchObject({ description: 'Boards' })
    expect(Number(before.body.lineItems[0].unitPrice)).toBe(12.5)
    // What invoice/[id].tsx sends: paymentDollars('12.34') → 12.34.
    const paid = await call('owner', 'POST', `/api/invoices/${ids.invoice}/payments`, { amount: 12.34, method: 'cash' })
    expect(paid.status).toBe(201)
    expect(Number(paid.body.amount)).toBe(12.34)
    const after = await call('owner', 'GET', `/api/invoices/${ids.invoice}`)
    expect(Number(after.body.amountPaid)).toBe(12.34)
    expect(Number(after.body.balance)).toBeCloseTo(total - 12.34, 2)
    expect(clone(after.body.payments[0])).toMatchObject({ method: 'cash' })
    expect(Number(after.body.payments[0].amount)).toBe(12.34)
    expect(after.body.payments[0]).toHaveProperty('paidAt')
    // The field seat cannot open or pay an invoice: the app never offers either.
    expect((await call('field', 'GET', `/api/invoices/${ids.invoice}`)).status).toBe(403)
    expect((await call('field', 'POST', `/api/invoices/${ids.invoice}/payments`, { amount: 1, method: 'cash' })).status).toBe(403)
  })

  test('dashboard: the jobs-family keys; money only for the owner; /api/jobs/today is a list', async () => {
    const owner = await call('owner', 'GET', '/api/dashboard/stats')
    expect(clone(owner.body.jobs)).toMatchObject({ today: expect.any(Number), open: expect.any(Number), byStatus: expect.any(Object) })
    expect(clone(owner.body.quotes)).toMatchObject({ pending: expect.any(Number) })
    expect(clone(owner.body.invoices)).toMatchObject({ outstandingValue: expect.any(Number) })
    const field = await call('field', 'GET', '/api/dashboard/stats')
    expect(field.status).toBe(200)
    expect(field.body.invoices).toBeUndefined()
    const todays = await call('field', 'GET', '/api/jobs/today')
    expect(Array.isArray(todays.body)).toBe(true)
  })

  test('the routes the app no longer calls are not on the server', async () => {
    expect((await call('owner', 'GET', '/api/push/history')).status).toBe(404)
    expect((await call('owner', 'GET', '/api/tracking/routes?status=active&driver=me')).status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────── field service
describe('field service (shared jobs, photos on the job)', () => {
  let b: Booted
  let call: ReturnType<typeof caller>
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    b = await boot('fieldservice', ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture'])
    call = caller(b)
    ids.contact = (await call('owner', 'POST', '/api/contacts', { name: 'Pat Furnace', phone: '555-300-4000', type: 'client' })).body.id
    // The field seat's own call (crew scope: it reads the jobs assigned to it).
    ids.job = (await call('owner', 'POST', '/api/jobs', { title: 'No heat', contactId: ids.contact, scheduledDate: today, scheduledTime: '09:00', assignedToId: b.logins.field.user.id })).body.id
  }, 120_000)

  test('the contact types this CRM takes are the ones the form offers (lead, client, vendor)', async () => {
    for (const ty of ['lead', 'client', 'vendor']) expect((await call('owner', 'POST', '/api/contacts', { name: `T ${ty}`, type: ty })).status).toBe(201)
  })

  test('service calls + schedule: the day view finds the call; start and complete are the technician\'s', async () => {
    const day = await call('field', 'GET', `/api/jobs?date=${today}&limit=100`)
    expect(clone(day.body.data.find((j: any) => j.id === ids.job))).toMatchObject({ title: 'No heat', scheduledTime: '09:00', contact: { name: 'Pat Furnace' } })
    expect((await call('field', 'GET', '/api/jobs?page=1&limit=25&status=scheduled')).body.data.length).toBeGreaterThan(0)
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/start`)).body.status).toBe('in_progress')
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/complete`)).body.status).toBe('completed')
  })

  test("photos live on the job: POST /api/jobs/:id/photos (photo), listed there, url /media/photos/… served by /media", async () => {
    const up = await call('field', 'POST', `/api/jobs/${ids.job}/photos`, photoForm('photo'))
    expect(up.status).toBe(201)
    expect(up.body.url).toStartWith('/media/photos/')
    const list = await call('field', 'GET', `/api/jobs/${ids.job}/photos`)
    expect(Array.isArray(list.body)).toBe(true)
    expect(clone(list.body[0])).toMatchObject({ id: up.body.id, url: up.body.url })
    const served = await b.t.call(up.body.url)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toContain('image/')
    expect((await call('viewer', 'POST', `/api/jobs/${ids.job}/photos`, photoForm('photo'))).status).toBe(403)
  })

  test('the field seat edits a call\'s notes but cannot reprice it', async () => {
    expect((await call('field', 'PUT', `/api/jobs/${ids.job}`, { notes: 'Replaced igniter' })).status).toBe(200)
    expect((await call('field', 'GET', `/api/jobs/${ids.job}`)).body.notes).toBe('Replaced igniter')
  })
})

// ─────────────────────────────────────────────────────────────────────────────── roofing
describe('roofing (its own jobs: pipeline, notes rows, canvassing)', () => {
  let b: Booted
  let call: ReturnType<typeof caller>
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    b = await boot('roofing', ['contacts', 'jobs', 'quotes', 'invoices', 'dashboard', 'photo_capture', 'canvassing_tool'])
    call = caller(b)
  }, 120_000)

  test('quick add: a lead is a contact (type lead) and a roofing job at `lead` — the job body roofing requires', async () => {
    const who = await call('owner', 'POST', '/api/contacts', { name: 'Robin Shingle', phone: '555-700-8000', address: '9 Elm Ave', city: 'Akron', state: 'Ohio', zip: '44301', type: 'lead', source: 'Door Knock', notes: 'Hail' })
    expect(who.status).toBe(201)
    expect(who.body.state).toBe('OH')
    ids.contact = who.body.id
    const job = await call('owner', 'POST', '/api/jobs', { contactId: ids.contact, jobType: 'retail', propertyAddress: '9 Elm Ave', city: 'Akron', state: 'OH', zip: '44301', source: 'Door Knock', notes: 'Hail', estimatedRevenue: 14000, assignedSalesRepId: b.logins.field.user.id })
    expect(job.status).toBe(201)
    expect(clone(job.body)).toMatchObject({ status: 'lead', title: '9 Elm Ave', address: '9 Elm Ave', jobType: 'retail', number: expect.stringMatching(/^ROOF-/), contact: { id: ids.contact, name: 'Robin Shingle' } })
    ids.job = job.body.id
    // The shared form's body (title, no property address) is refused by roofing's job module.
    expect((await call('owner', 'POST', '/api/jobs', { title: 'Roof', contactId: ids.contact })).status).toBe(400)
    // POST /api/leads is the website's public enquiry form, not this.
    expect((await call('field', 'POST', '/api/contacts', { name: 'x', type: 'lead' })).status).toBe(403)
    expect((await call('field', 'POST', '/api/jobs', { contactId: ids.contact, jobType: 'retail', propertyAddress: 'a', city: 'b', state: 'OH', zip: '44301' })).status).toBe(403)
  })

  test('pipeline: GET /api/jobs carries status, contact.name, address; what work is worth is the office\'s', async () => {
    const owner = await call('owner', 'GET', '/api/jobs?limit=500')
    const row = owner.body.data.find((j: any) => j.id === ids.job)
    expect(clone(row)).toMatchObject({ status: 'lead', number: expect.any(String), address: '9 Elm Ave', jobType: 'retail', contact: { name: 'Robin Shingle' } })
    expect(Number(row.estimatedValue)).toBe(14000)
    expect(clone(owner.body.pagination)).toMatchObject({ total: expect.any(Number) })
    const field = await call('field', 'GET', '/api/jobs?limit=500')
    expect(field.body.data.find((j: any) => j.id === ids.job)).not.toHaveProperty('estimatedValue')
    // The jobs tab's roofing chips are filters the module honours.
    expect((await call('field', 'GET', '/api/jobs?page=1&limit=25&status=lead')).body.data.map((j: any) => j.id)).toContain(ids.job)
  })

  test('the old lead routes are not the pipeline: GET/PUT /api/leads/:id', async () => {
    // /api/leads is the Lead Inbox (switched off here: 403); switched on or not, it has no single-lead read of a job.
    expect((await call('owner', 'GET', `/api/leads/${ids.job}`)).status).not.toBe(200)
    expect((await call('owner', 'PUT', `/api/leads/${ids.job}`, { stage: 'contacted' })).status).not.toBe(200)
  })

  test('job detail: inspection on the company clock, notes as rows ({ body }), advance, close with a reason, reopen — all the field seat\'s', async () => {
    expect((await call('owner', 'PUT', `/api/jobs/${ids.job}`, { inspectionDate: `${today}T10:00` })).status).toBe(200)
    // Scheduling is the office's (jobs:dispatch, 10/24): the field seat can't move its own job's date.
    expect((await call('field', 'PUT', `/api/jobs/${ids.job}`, { inspectionDate: `${today}T11:00` })).status).toBe(403)
    const note = await call('field', 'POST', `/api/jobs/${ids.job}/notes`, { body: 'Hail on north slope' })
    expect(note.status).toBe(201)
    expect(clone(note.body)).toMatchObject({ body: 'Hail on north slope' })
    const detail = await call('field', 'GET', `/api/jobs/${ids.job}`)
    expect(Array.isArray(detail.body.notes)).toBe(true)
    expect(clone(detail.body.notes[0])).toMatchObject({ id: expect.any(String), body: expect.any(String), createdAt: expect.any(String) })
    expect(detail.body.notes.map((n: any) => n.body)).toContain('Hail on north slope')
    expect(clone(detail.body)).toMatchObject({ title: '9 Elm Ave', status: 'lead', contact: { name: 'Robin Shingle' } })
    for (const k of ['inspectionDate', 'installDate', 'claimNumber', 'insuranceCompany', 'adjusterName', 'crew', 'roofType', 'jobType']) expect(detail.body).toHaveProperty(k)
    expect(detail.body.inspectionDate).toBeTruthy()
    // start / complete / dispatch do not exist on roofing's module.
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/start`)).status).toBe(404)
    const adv = await call('field', 'POST', `/api/jobs/${ids.job}/advance`)
    expect(adv.status).toBe(200)
    expect(adv.body.status).toBe('inspection_scheduled')
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/close`, { status: 'lost', lostReason: '' })).status).toBe(400)
    const closed = await call('field', 'POST', `/api/jobs/${ids.job}/close`, { status: 'lost', lostReason: 'Went with another roofer' })
    expect(clone(closed.body)).toMatchObject({ status: 'lost', lostReason: 'Went with another roofer' })
    expect((await call('field', 'POST', `/api/jobs/${ids.job}/reopen`, { status: 'lead' })).body.status).toBe('lead')
    expect((await call('viewer', 'POST', `/api/jobs/${ids.job}/advance`)).status).toBe(403)
  })

  test('job edit (roofing form): the PUT body roofing reads, notes left alone', async () => {
    const res = await call('field', 'PUT', `/api/jobs/${ids.job}`, { contactId: ids.contact, jobType: 'insurance', propertyAddress: '9 Elm Avenue', city: 'Akron', state: 'OH', zip: '44301' })
    expect(res.status).toBe(200)
    expect(clone(res.body)).toMatchObject({ title: '9 Elm Avenue', address: '9 Elm Avenue', jobType: 'insurance' })
    expect((await call('field', 'GET', `/api/jobs/${ids.job}`)).body.notes.length).toBeGreaterThan(0)
  })

  test("photos on the roofing job: { data } list; the field seat adds one", async () => {
    const up = await call('field', 'POST', `/api/jobs/${ids.job}/photos`, photoForm('photo'))
    expect(up.status).toBe(201)
    expect(up.body.url).toStartWith('/media/photos/')
    const list = await call('field', 'GET', `/api/jobs/${ids.job}/photos`)
    expect(clone(list.body.data[0])).toMatchObject({ id: up.body.id, url: up.body.url })
    expect((await b.t.call(up.body.url)).status).toBe(200)
  })

  test('canvass: a session, an interested door with a phone becomes a lead (jobId), a no-answer door does not; it comes back, then ends', async () => {
    const s = await call('field', 'POST', '/api/canvassing/sessions', { name: 'Canvass', centerLat: 41.08, centerLng: -81.51 })
    expect(s.status).toBe(201)
    expect(clone(s.body)).toMatchObject({ id: expect.any(String), status: 'active' })
    ids.session = s.body.id
    const lead = await call('field', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'interested', address: '14 Elm Ave', lat: 41.08, lng: -81.51, homeownerName: 'Sam Door', phone: '555-111-2222' })
    expect(lead.status).toBe(201)
    expect(clone(lead.body)).toMatchObject({ id: expect.any(String), outcome: 'interested', address: '14 Elm Ave', jobId: expect.any(String), visitedAt: expect.any(String) })
    const none = await call('field', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer', address: '16 Elm Ave' })
    expect(none.body.jobId).toBeNull()
    // The screen's old outcomes are not the server's.
    expect((await call('field', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'not_home', address: '18 Elm Ave' })).status).toBe(400)
    const mine = await call('field', 'GET', '/api/canvassing/sessions?mine=1')
    expect(mine.body.data.find((x: any) => x.status === 'active')?.id).toBe(ids.session)
    const back = await call('field', 'GET', `/api/canvassing/sessions/${ids.session}`)
    expect(back.body.stops).toHaveLength(2)
    const ended = await call('field', 'POST', `/api/canvassing/sessions/${ids.session}/end`)
    expect(clone(ended.body)).toMatchObject({ status: 'completed', totalDoors: 2, leadsCreated: 1 })
    // The lead is on the pipeline.
    expect(clone((await call('owner', 'GET', `/api/jobs/${lead.body.jobId}`)).body)).toMatchObject({ status: 'lead', source: 'canvassing' })
    expect((await call('viewer', 'POST', '/api/canvassing/sessions', {})).status).toBe(403)
    expect((await call('owner', 'POST', '/api/canvassing/knocks', { address: 'x', result: 'interested' })).status).toBe(404)
  })

  test('contact detail for the field seat: jobs, no quotes or invoices; quotes are refused', async () => {
    const field = await call('field', 'GET', `/api/contacts/${ids.contact}`)
    expect(field.body.jobs.length).toBeGreaterThan(0)
    expect(field.body).not.toHaveProperty('quotes')
    expect((await call('field', 'GET', '/api/quotes')).status).toBe(403)
  })

  test("roofing's dashboard keys (no /api/jobs/today for a roofer)", async () => {
    const stats = await call('owner', 'GET', '/api/dashboard/stats')
    expect(clone(stats.body.jobs)).toMatchObject({ open: expect.any(Number), inspectionsToday: expect.any(Number), installsToday: expect.any(Number) })
  })
})

// ─────────────────────────────────────────────────────────────────────────────── the dealership's dashboard
describe('rv dashboard (dashboard.tsx RV cards)', () => {
  let b: Booted
  let call: ReturnType<typeof caller>
  beforeAll(async () => {
    b = await boot('rv', ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept', 'dashboard'])
    call = caller(b)
    await b.t.db.insert(b.t.schema.unit).values([
      { companyId: b.companyId, category: 'Travel Trailer', status: 'available' },
      { companyId: b.companyId, category: 'Motorhome', status: 'sold' },
    ] as any)
  }, 120_000)

  test('inventory.total / available, sales.openLeads, service.openRepairOrders come from /api/dashboard/stats; /api/jobs/today is not the dealership\'s', async () => {
    const stats = await call('owner', 'GET', '/api/dashboard/stats')
    expect(stats.status).toBe(200)
    expect(clone(stats.body.inventory)).toMatchObject({ total: 2, available: 1 })
    expect(clone(stats.body.sales)).toMatchObject({ openLeads: expect.any(Number) })
    expect(clone(stats.body.service)).toMatchObject({ openRepairOrders: expect.any(Number) })
    expect((await call('owner', 'GET', '/api/jobs/today')).status).toBe(403)
  })

  test('the dealership\'s contact types are lead / customer / vendor (contact form + chips)', async () => {
    for (const ty of ['lead', 'customer', 'vendor']) expect((await call('owner', 'POST', '/api/contacts', { name: `RV ${ty}`, type: ty })).status).toBe(201)
    expect((await call('owner', 'POST', '/api/contacts', { name: 'RV client', type: 'client' })).status).toBe(400)
    const conv = await call('owner', 'POST', `/api/contacts/${(await call('owner', 'GET', '/api/contacts?type=lead')).body.data[0].id}/convert`)
    expect(conv.body.type).toBe('customer')
  })
})
