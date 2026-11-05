// Default markup by kind of line, and pictures on quote lines (contractor parity item 3), through the real server and its real
// database. The screens are markup-images-ui.test.ts (a DOM installed as globals stops the in-memory database booting).
//   · both features are registered not ready, general contractor only; off, their doors are shut (the registry's gate answers 403);
//   · the markup defaults are cost-side: read with margin:read, changed by owner/admin, validated in words, cleaned the way the form reads them;
//   · a picture on a line is kept only where quote_line_images is on, only as an https address or one of our /media photos, survives
//     an edit, and reaches the customer's copy — which still has no cost, markup or code on it;
//   · the upload route stores a real image in the photo library and refuses a non-image and a seat that cannot write quotes.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { PgTable } from 'drizzle-orm/pg-core'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { markupDefaultsOf } from '../server/crm/billing/markupDefaults.ts'

const json = async (r: Response) => (await r.json()) as any
const FEATURES = ['contacts', 'quotes', 'markup_defaults', 'quote_line_images']
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a3' } }).png().toBuffer()
const picForm = (file: File = new File([new Uint8Array(PNG)], 'tile.png', { type: 'image/png' })) => { const fd = new FormData(); fd.append('file', file); return fd }

describe('the features', () => {
  test.each(['markup_defaults', 'quote_line_images'])('%s is registered, not ready, and offered to the general contractor only', (id) => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

describe('the defaults, by themselves', () => {
  test('anything that is not a percent from 0 to 1000 reads as none set; a good one is kept to a tenth', () => {
    expect(markupDefaultsOf({})).toEqual({ labor: null, material: null, part: null, service: null, other: null })
    expect(markupDefaultsOf({ markupDefaults: { labor: 25, material: '18.26', part: -5, service: 'x', other: 5000 } })).toEqual({ labor: 25, material: 18.3, part: null, service: null, other: null })
    expect(markupDefaultsOf('{"markupDefaults":{"labor":10}}').labor).toBe(10)
  })
})

describe('through the server', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let companyId = ''
  let owner: (p: string, i?: any) => Promise<Response>
  let manager: (p: string, i?: any) => Promise<Response>
  let viewer: (p: string, i?: any) => Promise<Response>
  let field: (p: string, i?: any) => Promise<Response>
  let ann = ''
  const sent: any[] = []
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const line = (over: Record<string, unknown> = {}) => ({ description: 'Floor tile', quantity: 10, unitPrice: 12, unitCost: 8, markupPct: 50, type: 'material', ...over })
  const makeQuote = async (lineItems: any[]) => { const r = await owner('/api/quotes', { method: 'POST', json: { name: 'Bath', contactId: ann, lineItems } }); expect(r.status).toBe(201); return json(r) }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    const email: any = t.services.email
    email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
    const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
    const as = (tok: string) => (p: string, i: any = {}) => Promise.resolve(t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } }))
    owner = as(await login('owner@test.example', s.password))
    for (const role of ['manager', 'viewer', 'field']) await ins(t.schema.user, { companyId, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
    manager = as(await login('manager@test.example', 'Correct-horse-1'))
    viewer = as(await login('viewer@test.example', 'Correct-horse-1'))
    field = as(await login('field@test.example', 'Correct-horse-1'))
    ann = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', email: 'ann@example.com' } as any)).id
  }, 120_000)

  describe('markup defaults', () => {
    test('read with margin:read, changed by the owner or an admin, refused to the rest', async () => {
      expect(await json(await owner('/api/markup-defaults'))).toEqual({ labor: null, material: null, part: null, service: null, other: null })
      expect((await manager('/api/markup-defaults')).status).toBe(200)          // a manager holds margin:read
      expect((await viewer('/api/markup-defaults')).status).toBe(403)           // the cost-side figure is not for a read-only seat
      expect((await field('/api/markup-defaults')).status).toBe(403)
      const body = { labor: 30, material: 20, part: null, service: 15.55, other: null }
      expect((await manager('/api/markup-defaults', { method: 'PUT', json: body })).status).toBe(403)
      expect((await viewer('/api/markup-defaults', { method: 'PUT', json: body })).status).toBe(403)
      const saved = await owner('/api/markup-defaults', { method: 'PUT', json: body })
      expect(saved.status).toBe(200)
      expect(await json(saved)).toEqual({ labor: 30, material: 20, part: null, service: 15.6, other: null })
      expect(await json(await manager('/api/markup-defaults'))).toEqual({ labor: 30, material: 20, part: null, service: 15.6, other: null })
    })

    test('a bad number is refused in words and nothing is saved', async () => {
      for (const bad of [{ labor: -1 }, { labor: 1001 }, { labor: 'lots' }]) {
        const r = await owner('/api/markup-defaults', { method: 'PUT', json: { labor: 10, material: null, part: null, service: null, other: null, ...bad } })
        expect(r.status).toBe(400)
      }
      expect((await json(await owner('/api/markup-defaults'))).labor).toBe(30)
    })
  })

  describe('pictures on quote lines', () => {
    test('a picture is kept with its line, read back, and survives an edit that sends it again', async () => {
      const q = await makeQuote([line({ imageUrl: 'https://cdn.example.com/tile.jpg' }), line({ description: 'Grout', imageUrl: '/media/site/abc123.jpg' }), line({ description: 'Labour' })])
      expect(q.lineItems.map((l: any) => l.imageUrl ?? null)).toEqual(['https://cdn.example.com/tile.jpg', '/media/site/abc123.jpg', null])
      const read = await json(await owner(`/api/quotes/${q.id}`))
      expect(read.lineItems.map((l: any) => l.imageUrl ?? null)).toEqual(['https://cdn.example.com/tile.jpg', '/media/site/abc123.jpg', null])
      const edited = await owner(`/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: read.lineItems.map((l: any) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}) })) } })
      expect(edited.status).toBe(200)
      expect((await json(edited)).lineItems.map((l: any) => l.imageUrl ?? null)).toEqual(['https://cdn.example.com/tile.jpg', '/media/site/abc123.jpg', null])
    })

    test('only a web address or one of our own photos: not http, not a script, not a file path', async () => {
      for (const bad of ['http://cdn.example.com/a.jpg', 'javascript:alert(1)', '/etc/passwd', 'data:image/png;base64,AAAA']) {
        const r = await owner('/api/quotes', { method: 'POST', json: { name: 'Bad', contactId: ann, lineItems: [line({ imageUrl: bad })] } })
        expect(r.status).toBe(400)
      }
    })

    test('the customer\'s copy carries the picture and still carries no cost, markup or code', async () => {
      const q = await makeQuote([line({ imageUrl: 'https://cdn.example.com/tile.jpg', costCode: '09-Tile' })])
      expect((await owner(`/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
      const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
      const seen = await json(await t.call(`/api/portal/d/${link}/quotes/${q.id}`))
      expect(seen.lineItems[0].imageUrl).toBe('https://cdn.example.com/tile.jpg')
      expect(JSON.stringify(seen)).not.toMatch(/unitCost|markupPct|costCode|09-Tile/)
    })

    test('with the feature off for the business, a picture sent is not kept', async () => {
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'quote_line_images') } as any).where(eq(t.schema.company.id, companyId))
      await new Promise((r) => setTimeout(r, 16_000)) // the feature gate caches 15 s per company
      try {
        const q = await makeQuote([line({ imageUrl: 'https://cdn.example.com/tile.jpg' })])
        expect(q.lineItems[0].imageUrl ?? null).toBeNull()
        expect((await owner('/api/quote-line-images', { method: 'POST', body: picForm() })).status).toBe(403)
      } finally {
        await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
        await new Promise((r) => setTimeout(r, 16_000))
      }
    }, 90_000)

    test('the upload route stores a real image in the photo library and answers its /media address; a text file is refused', async () => {
      const ok = await owner('/api/quote-line-images', { method: 'POST', body: picForm() })
      expect(ok.status).toBe(201)
      const url = (await json(ok)).url as string
      expect(url).toMatch(/^\/media\//)
      const stored = await t.db.select().from(t.schema.photo).where(eq(t.schema.photo.publicUrl, url))
      expect(stored.length).toBe(1)
      expect(stored[0].tags).toContain('quote-line')
      expect([...t.store.objects.keys()].some((k) => url.endsWith(k))).toBe(true)
      // …and that address is one the quote route accepts on a line
      const q = await makeQuote([line({ imageUrl: url })])
      expect(q.lineItems[0].imageUrl).toBe(url)
      const text = await owner('/api/quote-line-images', { method: 'POST', body: picForm(new File(['hello'], 'a.txt', { type: 'text/plain' })) })
      expect(text.status).toBe(400)
      expect((await owner('/api/quote-line-images', { method: 'POST', body: new FormData() })).status).toBe(400)
    })

    test('a seat that cannot write quotes cannot upload', async () => {
      expect((await viewer('/api/quote-line-images', { method: 'POST', body: picForm() })).status).toBe(403)
      expect((await field('/api/quote-line-images', { method: 'POST', body: picForm() })).status).toBe(403)
    })
  })
})
