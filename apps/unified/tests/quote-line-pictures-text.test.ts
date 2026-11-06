// Landscaping parity row 7 (Jobber Grow): a picture per quote line on the customer's quote AND its PDF, and "Add text" lines — a
// heading or a note with no quantity or price. Proved on a landscaping business through the real server and database.
//
// Fails without the change: landscaping was not offered quote_line_images, the PDF never printed a line's picture, and a line of
// type 'text' was refused by the line schema (there was no quote_text_lines).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let contactId: string
const tokens: Record<string, string> = {}
const sent: Array<{ template: string; data: any }> = []
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'quotes', 'invoices', 'jobs']
const features = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const PNG = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#3a3' } }).png().toBuffer()
const picForm = () => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(PNG)], 'shrub.png', { type: 'image/png' })); return fd }

/** The text a PDF draws: pdfkit writes each page's content stream deflated, its strings as hex runs inside TJ arrays. */
function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of [...raw.matchAll(/\/Length (\d+)\s[\s\S]{0,300}?>>\s*stream\r?\n/g)].map((x) => [x[0], raw.substr(x.index! + x[0].length, Number(x[1]))])) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) {
      for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1')
      out += '\n'
    }
  }
  return out
}
const images = (buf: ArrayBuffer) => (Buffer.from(buf).toString('latin1').match(/\/Subtype \/Image/g) || []).length

const HEADING = 'Front beds: spring refresh'
const LINES = [
  { description: HEADING, type: 'text', quantity: 5, unitPrice: 999 },
  { description: 'Edge and mulch front beds', quantity: 1, unitPrice: 480 },
  { description: 'Plant 6 boxwoods', quantity: 6, unitPrice: 45 },
]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ email: 'office@test.example' } as any).where(eq(t.schema.company.id, companyId))
  await features([])
  tokens.owner = await signIn(s.owner.email, s.password)
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [pat] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
  contactId = pat.id
}, 120_000)

describe('the features', () => {
  test('line pictures are offered to landscaping; text lines are registered not ready for every quoting trade', () => {
    const pics = FEATURE_REGISTRY.find((f) => f.id === 'quote_line_images')!
    expect(pics.templates).toContain('crm-landscaping')
    const text = FEATURE_REGISTRY.find((f) => f.id === 'quote_text_lines')!
    expect(text.hidden).toBe(true)
    expect(text.templates).toEqual(expect.arrayContaining(['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof']))
  })
})

describe('text lines', () => {
  test('off: a text line is refused in words and nothing is saved', async () => {
    await features([])
    const before = (await t.db.select().from(t.schema.quote)).length
    const r = await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Spring', contactId, lineItems: LINES } })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('Text lines are not switched on for this business.')
    expect((await t.db.select().from(t.schema.quote)).length).toBe(before)
  })

  test('on: words only — whatever price was sent, it is one of nothing at no price and outside the total', async () => {
    await features(['quote_text_lines'])
    const r = await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Spring', contactId, lineItems: LINES } })
    expect(r.status).toBe(201)
    const q = await r.json()
    const head = q.lineItems.find((l: any) => l.description === HEADING)
    expect(head.type).toBe('text')
    expect(Number(head.quantity)).toBe(1)
    expect(Number(head.unitPrice)).toBe(0)
    expect(Number(head.total)).toBe(0)
    expect(Number(q.subtotal)).toBe(750)
    // An edit keeps it words only, too.
    const edited = await (await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: [{ ...LINES[0], unitPrice: 50 }, LINES[1]] } })).json()
    expect(Number(edited.subtotal)).toBe(480)
    expect(Number(edited.lineItems.find((l: any) => l.type === 'text').total)).toBe(0)
  })

  test('the PDF prints the heading as words with no price; the customer’s page gets the line’s kind', async () => {
    await features(['quote_text_lines'])
    const q = await (await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Spring', contactId, lineItems: LINES } })).json()
    const text = pdfText(new Uint8Array(await (await as('owner', `/api/quotes/${q.id}/pdf`)).arrayBuffer()))
    const at = text.indexOf(HEADING)
    expect(at).toBeGreaterThan(-1)
    // The next thing after the heading is the first priced line, not a quantity or a $0.00.
    expect(text.slice(at + HEADING.length).trim().startsWith('Edge and mulch front beds')).toBe(true)
    expect(text).not.toContain('$999')
    expect(text).toContain('Total: $750.00')
    expect((await as('owner', `/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
    const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
    const page = await (await t.call(`/api/portal/d/${link}/quotes/${q.id}`)).json()
    expect(page.lineItems.find((l: any) => l.description === HEADING).type).toBe('text')
    // The email's list of lines is about prices: the heading is not one of them.
    expect(JSON.stringify(sent.at(-1)!.data)).not.toContain(HEADING)
  })

  test('the job and the invoice made from the quote are its priced lines only', async () => {
    await features(['quote_text_lines'])
    const q = await (await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Spring', contactId, lineItems: LINES } })).json()
    expect((await as('owner', `/api/quotes/${q.id}/approve`, { method: 'POST' })).status).toBe(200)
    const inv = await (await as('owner', `/api/quotes/${q.id}/convert-to-invoice`, { method: 'POST' })).json()
    expect(inv.lineItems.map((l: any) => l.description)).toEqual(['Edge and mulch front beds', 'Plant 6 boxwoods'])
    expect(Number(inv.total)).toBe(750)
    const job = await (await as('owner', `/api/quotes/${q.id}/convert-to-job`, { method: 'POST' })).json()
    expect(String(job.description || '')).not.toContain(HEADING)
  })
})

describe('pictures on quote lines', () => {
  test('a landscaping business uploads a picture, it stays on the line, and both PDFs print it', async () => {
    await features(['quote_line_images'])
    const up = await as('owner', '/api/quote-line-images', { method: 'POST', body: picForm() })
    expect(up.status).toBe(201)
    const url = (await up.json()).url as string
    const q = await (await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Shrubs', contactId, lineItems: [{ description: 'Plant 6 boxwoods', quantity: 6, unitPrice: 45, imageUrl: url }, { description: 'Mulch', quantity: 1, unitPrice: 90 }] } })).json()
    expect(q.lineItems[0].imageUrl).toBe(url)
    const office = await as('owner', `/api/quotes/${q.id}/pdf`)
    expect(images(await office.arrayBuffer())).toBe(1)
    expect((await as('owner', `/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
    const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
    expect((await (await t.call(`/api/portal/d/${link}/quotes/${q.id}`)).json()).lineItems[0].imageUrl).toBe(url)
    expect(images(await (await t.call(`/api/portal/d/${link}/quotes/${q.id}/pdf`)).arrayBuffer())).toBe(1)
  })

  test('a picture at an outside address shows on the page but is not fetched into the PDF', async () => {
    await features(['quote_line_images'])
    const q = await (await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Shrubs', contactId, lineItems: [{ description: 'Plant 6 boxwoods', quantity: 6, unitPrice: 45, imageUrl: 'https://cdn.example.com/boxwood.jpg' }] } })).json()
    expect(q.lineItems[0].imageUrl).toBe('https://cdn.example.com/boxwood.jpg')
    const r = await as('owner', `/api/quotes/${q.id}/pdf`)
    expect(r.status).toBe(200)
    expect(images(await r.arrayBuffer())).toBe(0)
  })
})
