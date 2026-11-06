// Landscaping parity rows 5 and 6 (Jobber), proved on a landscaping business (the quote code is shared by every quoting trade).
//
// Row 5: the quote's PDF — the office's and the customer's — prints the optional lines nobody ticked, apart, each labelled
// "Not included", and they stay out of the total. Fails without the change: both PDFs printed only the included lines.
// Row 6: "Preview as client" — the office opens the customer's own page for a quote, read only, without sending it. Fails without
// the change: there was no /api/quote-preview and no /v/ door.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
const tokens: Record<string, string> = {}
const sent: Array<{ template: string; data: any }> = []
let contactId: string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'quotes', 'invoices', 'jobs']
const features = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

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

const LINES = [
  { description: 'Weekly mowing, season', quantity: 1, unitPrice: 1200 },
  { description: 'Core aeration', quantity: 1, unitPrice: 150, optional: true },
  { description: 'Fertiliser, 4 rounds', quantity: 1, unitPrice: 320, optional: true, selected: true },
  { description: 'Mulch top-up', quantity: 3, unitPrice: 45, optional: true },
]

async function newQuote(lineItems = LINES) {
  const r = await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Lawn care 2027', contactId, lineItems } })
  expect(r.status).toBe(201)
  return r.json() as Promise<any>
}
/** Send it, and the customer's own link's token. */
async function send(id: string) {
  expect((await as('owner', `/api/quotes/${id}/send`, { method: 'POST' })).status).toBe(200)
  return String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
}
const statusOf = async (id: string) => (await t.db.select({ s: t.schema.quote.status }).from(t.schema.quote).where(eq(t.schema.quote.id, id)))[0].s

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ email: 'office@test.example' } as any).where(eq(t.schema.company.id, companyId))
  await features([])
  tokens.owner = await signIn(s.owner.email, s.password)
  await t.db.insert(t.schema.user).values({ email: 'viewer@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId })
  tokens.viewer = await signIn('viewer@test.example', 'Seat-pass-1')
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [pat] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
  contactId = pat.id
}, 120_000)

describe('row 5: unticked optional lines print as "Not included"', () => {
  test('the office PDF lists them apart, labelled, with their prices; the ticked one is in the quote; the total leaves them out', async () => {
    const q = await newQuote()
    expect(Number(q.total)).toBe(1520)
    const r = await as('owner', `/api/quotes/${q.id}/pdf`)
    expect(r.status).toBe(200)
    const text = pdfText(new Uint8Array(await r.arrayBuffer()))
    const notIn = text.indexOf('Optional')
    expect(notIn).toBeGreaterThan(-1)
    expect(text).toContain('not included')
    // Aeration and mulch are below the heading, each marked; fertiliser (ticked) is above it, as a bought line.
    const after = text.slice(notIn)
    expect(after).toContain('Core aeration')
    expect(after).toContain('Mulch top-up')
    expect(after.split('Not included').length - 1).toBe(2)
    expect(text.slice(0, notIn)).toContain('Fertiliser, 4 rounds')
    expect(after).not.toContain('Fertiliser')
    expect(after).toContain('$135.00 for this line')
    expect(text).toContain('Total: $1,520.00')
  })

  test('the customer’s PDF from their own link says the same, and ticking a line moves it into the quote', async () => {
    const q = await newQuote()
    const link = await send(q.id)
    const pdf = async () => pdfText(new Uint8Array(await (await t.call(`/api/portal/d/${link}/quotes/${q.id}/pdf`)).arrayBuffer()))
    let text = await pdf()
    expect(text.slice(text.indexOf('Optional'))).toContain('Core aeration')
    const aeration = q.lineItems.find((l: any) => l.description === 'Core aeration')
    expect((await t.call(`/api/portal/d/${link}/quotes/${q.id}/options`, { method: 'POST', json: { lineItemId: aeration.id, selected: true } })).status).toBe(200)
    text = await pdf()
    expect(text.slice(text.indexOf('Optional'))).not.toContain('Core aeration')
    expect(text.split('Not included').length - 1).toBe(1)
    expect(text).toContain('Total: $1,670.00')
  })

  test('a quote with no unticked lines prints no such section', async () => {
    const q = await newQuote([{ description: 'Spring clean-up', quantity: 1, unitPrice: 400 }])
    const text = pdfText(new Uint8Array(await (await as('owner', `/api/quotes/${q.id}/pdf`)).arrayBuffer()))
    expect(text).not.toContain('Not included')
    expect(text).toContain('Spring clean-up')
  })
})

describe('row 6: preview the quote as the client', () => {
  test('is hidden and off unless switched on', async () => {
    expect(FEATURE_REGISTRY.find((f) => f.id === 'quote_preview')?.hidden).toBe(true)
    expect(FEATURE_REGISTRY.find((f) => f.id === 'quote_preview')?.templates).toContain('crm-landscaping')
    await features([])
    const q = await newQuote()
    expect((await as('owner', `/api/quote-preview/${q.id}`, { method: 'POST' })).status).toBe(403)
  })

  test('a draft opens as the customer will see it, read only; nothing is sent and it stays a draft', async () => {
    await features(['quote_preview'])
    const q = await newQuote()
    const before = sent.length
    const r = await as('viewer', `/api/quote-preview/${q.id}`, { method: 'POST' })
    expect(r.status).toBe(201)
    const { path, minutes } = await r.json()
    expect(path).toMatch(/^\/v\/[\w-]+\.[\w-]+$/)
    expect(minutes).toBe(30)
    const token = path.slice(3)
    const head = await (await t.call(`/api/portal/v/${token}`)).json()
    expect(head).toMatchObject({ preview: true, document: { kind: 'quote', id: q.id }, contact: { name: 'Pat Client' } })
    const page = await t.call(`/api/portal/v/${token}/quotes/${q.id}`)
    expect(page.status).toBe(200)
    const body = await page.json()
    expect(body.preview).toBe(true)
    expect(body.lineItems.map((l: any) => l.description)).toEqual(LINES.map((l) => l.description))
    expect(body.status).not.toBe('draft')
    // The PDF the customer would download, too.
    const pdf = await t.call(`/api/portal/v/${token}/quotes/${q.id}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdfText(new Uint8Array(await pdf.arrayBuffer()))).toContain('Core aeration')
    expect(await statusOf(q.id)).toBe('draft')
    expect(sent.length).toBe(before)
    const [row] = await t.db.select({ token: t.schema.quote.publicToken }).from(t.schema.quote).where(eq(t.schema.quote.id, q.id))
    expect(row.token).toBeNull()
  })

  test('nothing can be signed, ticked, chosen or declined through a preview; a sent quote is not marked viewed', async () => {
    await features(['quote_preview'])
    const q = await newQuote()
    await send(q.id)
    const { path } = await (await as('owner', `/api/quote-preview/${q.id}`, { method: 'POST' })).json()
    const token = path.slice(3)
    expect((await t.call(`/api/portal/v/${token}/quotes/${q.id}`)).status).toBe(200)
    expect(await statusOf(q.id)).toBe('sent')
    const aeration = q.lineItems.find((l: any) => l.description === 'Core aeration')
    for (const [p, json] of [
      ['approve', { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Office', consent: true }],
      ['reject', { reason: 'x' }], ['options', { lineItemId: aeration.id, selected: true }], ['choose-option', { optionId: 'x' }], ['choose-upgrade', { lineItemId: aeration.id, selected: true }],
    ] as const) {
      expect((await t.call(`/api/portal/v/${token}/quotes/${q.id}/${p}`, { method: 'POST', json })).status).toBe(404)
    }
    expect(await statusOf(q.id)).toBe('sent')
    expect(Number((await (await as('owner', `/api/quotes/${q.id}`)).json()).total)).toBe(1520)
  })

  test('the link opens that quote only, cannot be forged, and closes when the feature is switched off', async () => {
    await features(['quote_preview'])
    const a = await newQuote(), b = await newQuote()
    const { path } = await (await as('owner', `/api/quote-preview/${a.id}`, { method: 'POST' })).json()
    const token = path.slice(3)
    expect((await t.call(`/api/portal/v/${token}/quotes/${b.id}`)).status).toBe(404)
    const forged = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
    expect((await t.call(`/api/portal/v/${forged}`)).status).toBe(404)
    // A customer's own link is not a preview link, and a preview token does not open the customer's door.
    expect((await t.call(`/api/portal/d/${token}`)).status).toBe(404)
    expect((await as('owner', '/api/quote-preview/not-a-quote', { method: 'POST' })).status).toBe(404)
    await features([])
    expect((await t.call(`/api/portal/v/${token}`)).status).toBe(404)
  })

  test('a preview link lasts 30 minutes', async () => {
    const { quotePreviewToken, readQuotePreviewToken } = await import('../../../packages/tenant-backend/src/portal/documentLinks.ts')
    const at = Date.parse('2026-11-06T12:00:00Z')
    const tk = quotePreviewToken('co', 'q1', at)
    expect(readQuotePreviewToken(tk, at + 29 * 60_000)).toEqual({ companyId: 'co', quoteId: 'q1' })
    expect(readQuotePreviewToken(tk, at + 31 * 60_000)).toBeNull()
  })
})
