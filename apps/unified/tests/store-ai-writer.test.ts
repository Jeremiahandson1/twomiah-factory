// Gap 5 against Shopify Magic (2026-10-30): the product writer — a draft description, search title and description, and
// alt text for the photos, in a tone the owner picks.
//   · it DRAFTS: no route here saves a product or a photo; the words are the owner's once they press Save;
//   · the tone and the owner's notes reach the model; SKUs, prices and costs never do;
//   · no AI key on the server: the owner's sentence (503 ai_not_configured), never the setting's name, and no call out;
//   · a sentence naming a feature that is not ready is taken out of the draft;
//   · search text is held to the lengths a search page shows; alt text to 125 characters without "photo of";
//   · the model is shown the photo itself (our own upload from the file store, or a public address); a photo it cannot
//     read, or that is not this product's, is left for the owner, named in `skipped`;
//   · behind store_ai_writer (registered not ready) AND products:update: a viewer seat and a shop with it off are refused.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP, notReadyWords } from '@twomiah/tenant-backend'
import { productPhotoPrefix } from '../server/crm/store/catalog/products.ts'
import { clip } from '../server/crm/listingWriter.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let productId = ''
let viewer = ''
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_ai_writer']
const WRITER = '/api/admin/product-writer'
const features = async (list: string[]) => {
  await (k.t.db as any).update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
/** The model, answered here: every request recorded, the reply chosen by the test. */
const sent: Array<{ url: string; key: string | null; body: any }> = []
let reply: (body: any) => unknown = () => ({})
const realFetch = globalThis.fetch
const objects = new Map<string, { body: Buffer; contentType: string }>()
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const answer = (text: string) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 20 }, model: 'claude-test' })
const asViewer = async (method: string, p: string, body?: unknown) => {
  const res = await k.t.call(p, { method, headers: { Authorization: `Bearer ${viewer}`, host: 'shop.test' }, ...(body === undefined ? {} : { json: body }) })
  return { status: res.status, json: await res.json().catch(() => ({})) as any }
}
const productRow = async () => (await (k.t.db as any).select().from(k.S.storeProduct).where(eq(k.S.storeProduct.id, productId)))[0]
const images = async () => (await (k.t.db as any).select().from(k.S.storeProductImage).where(eq(k.S.storeProductImage.productId, productId)))

beforeAll(async () => {
  k = await bootStore()
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.anthropic.com/')) {
      const h = new Headers(init?.headers || {})
      const body = JSON.parse(String(init.body))
      sent.push({ url, key: h.get('x-api-key'), body })
      return new Response(JSON.stringify(reply(body)), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return inner(input, init)
  }) as any
  const storage = (k.t.services as any).crm.storage
  storage.put = async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) }
  storage.getObject = async (key: string) => objects.get(key) ?? null
  await features(ON)
  await (k.t.db as any).insert(k.S.user).values({ email: 'viewer@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'view', lastName: 'Seat', role: 'viewer', companyId: k.companyId })
  viewer = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@test.example', password: 'Seat-pass-1' } })).json()).accessToken
  const { product } = await k.product({ slug: 'feeder', name: 'Cedar window feeder', sku: 'SECRET-SKU-9', priceCents: 4321, category: 'Feeders' })
  productId = product.id
  await (k.t.db as any).update(k.S.storeProductVariant).set({ costCents: 777 }).where(eq(k.S.storeProductVariant.productId, productId))
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch; k.restore() })

describe('the product writer', () => {
  test('is registered not ready: offered to the store, switched on by no plan', () => {
    const f = FEATURE_MAP.store_ai_writer
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
  })

  test('with no AI key on the server: the owner\'s sentence, never the setting\'s name, and no call goes out', async () => {
    const was = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = ''
    try {
      const before = sent.length
      for (const [p, body] of [[`${WRITER}/${productId}/describe`, { tone: 'friendly' }], [`${WRITER}/${productId}/alt-text`, { tone: 'friendly' }]] as const) {
        const r = await k.O('POST', p, body)
        // (alt-text asks for photos first: none yet → 400; add one so the key is what is checked)
        if (r.status === 400) {
          await (k.t.db as any).insert(k.S.storeProductImage).values({ productId, url: 'https://cdn.example.com/feeder.jpg', alt: 'Cedar window feeder', isPrimary: true })
          const again = await k.O('POST', p, body)
          expect(again.status).toBe(503)
          expect(again.json.code).toBe('ai_not_configured')
          expect(again.json.error).toContain('support@twomiah.com')
          expect(again.text).not.toContain('ANTHROPIC')
          continue
        }
        expect(r.status).toBe(503)
        expect(r.json.code).toBe('ai_not_configured')
        expect(r.json.error).toContain('support@twomiah.com')
        expect(r.text).not.toContain('ANTHROPIC')
      }
      expect(sent.length).toBe(before)
    } finally { process.env.ANTHROPIC_API_KEY = was ?? '' }
  })

  test('a draft: the tone and the notes are sent, the SKU, price and cost are not, and nothing is saved', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stand-in'
    reply = () => answer(JSON.stringify({ description: 'A cedar feeder that hangs on your window.\n\nWatch the birds up close.', seoTitle: 'Cedar window feeder', seoDescription: 'A cedar feeder that suction-cups to the glass so you can watch birds from your chair.' }))
    const r = await k.O('POST', `${WRITER}/${productId}/describe`, { tone: 'playful', notes: 'Hand-built in Eau Claire. Fits one cup of seed.' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ tone: 'playful', description: expect.stringContaining('cedar feeder'), seoTitle: 'Cedar window feeder' })
    const call = sent.at(-1)!
    expect(call.key).toBe('sk-ant-test-stand-in')
    const prompt = JSON.stringify(call.body)
    expect(prompt).toContain('light and fun')
    expect(prompt).toContain('Hand-built in Eau Claire')
    expect(prompt).toContain('Cedar window feeder')
    expect(prompt).not.toContain('SECRET-SKU-9')
    expect(prompt).not.toContain('4321')
    expect(prompt).not.toContain('777')
    // A different tone is a different instruction.
    await k.O('POST', `${WRITER}/${productId}/describe`, { tone: 'luxurious' })
    expect(JSON.stringify(sent.at(-1)!.body)).toContain('refined and unhurried')
    // The product is exactly as it was: the route drafts, the owner saves.
    const row = await productRow()
    expect(row.description).toBeNull()
    expect(row.seoTitle).toBeNull()
    expect(row.seoDescription).toBeNull()
  })

  test('a tone must be one of the five; notes are capped', async () => {
    for (const body of [{}, { tone: 'sarcastic' }, { tone: 'friendly', notes: 'x'.repeat(1501) }]) {
      const r = await k.O('POST', `${WRITER}/${productId}/describe`, body)
      expect(r.status).toBe(400)
    }
    expect((await k.O('POST', `${WRITER}/00000000-0000-0000-0000-000000000000/describe`, { tone: 'friendly' })).status).toBe(404)
  })

  test('search text is held to the length a search page shows, and a not-ready feature is not mentioned', async () => {
    const word = notReadyWords()[0]
    expect(word).toBeTruthy()
    reply = () => answer('```json\n' + JSON.stringify({
      description: `A sturdy feeder. Ask about ${word} at checkout. It holds a cup of seed.`,
      seoTitle: 'Cedar window feeder that brings the birds right to your glass today',
      seoDescription: 'Watch birds from your chair. '.repeat(12),
    }) + '\n```')
    const r = await k.O('POST', `${WRITER}/${productId}/describe`, { tone: 'friendly' })
    expect(r.status).toBe(200)
    expect(r.json.seoTitle.length).toBeLessThanOrEqual(60)
    expect(r.json.seoDescription.length).toBeLessThanOrEqual(155)
    expect(r.json.description.toLowerCase()).not.toContain(word.toLowerCase())
    expect(r.json.description).toContain('sturdy feeder')
    expect(clip('one two three four five', 12)).toBe('one two')
  })

  test('an unreadable answer is a 502 with a plain sentence, not a draft', async () => {
    reply = () => answer('Sorry, I cannot help with that.')
    const r = await k.O('POST', `${WRITER}/${productId}/describe`, { tone: 'friendly' })
    expect(r.status).toBe(502)
    expect(r.json.error).toContain('Try again')
  })

  test('photo descriptions: the photo itself is shown, ours from the file store; what cannot be read is left for the owner', async () => {
    const own = `${productPhotoPrefix(k.companyId, productId)}own.png`
    const avif = `${productPhotoPrefix(k.companyId, productId)}own.avif`
    const foreign = `site-photos/${k.companyId}/someone-elses.png`
    objects.set(own, { body: PNG, contentType: 'image/png' })
    objects.set(avif, { body: PNG, contentType: 'image/avif' })
    objects.set(foreign, { body: PNG, contentType: 'image/png' })
    const ins = async (url: string) => (await (k.t.db as any).insert(k.S.storeProductImage).values({ productId, url, alt: 'Cedar window feeder', isPrimary: false }).returning())[0]
    const a = await ins(`/media/${own}`)
    const b = await ins(`/media/${avif}`)
    const c2 = await ins(`/media/${foreign}`)
    const before = (await images()).map((i: any) => [i.id, i.alt])
    reply = (body) => {
      const ids = [...JSON.stringify(body).matchAll(/Photo id: ([A-Za-z0-9_-]+)/g)].map((m) => m[1])
      return answer(JSON.stringify({ alts: ids.map((id) => ({ id, alt: `Photo of a cedar feeder stuck to a window, ${'seed '.repeat(40)}` })) }))
    }
    const r = await k.O('POST', `${WRITER}/${productId}/alt-text`, { tone: 'straightforward' })
    expect(r.status).toBe(200)
    const sentImages = sent.at(-1)!.body.messages[0].content.filter((x: any) => x.type === 'image')
    expect(sentImages.some((x: any) => x.source.type === 'base64' && x.source.media_type === 'image/png' && x.source.data === PNG.toString('base64'))).toBe(true)
    expect(sentImages.some((x: any) => x.source.type === 'url' && x.source.url === 'https://cdn.example.com/feeder.jpg')).toBe(true)
    expect(sentImages).toHaveLength(2) // the AVIF and the other folder's file were not sent
    const ids = r.json.alts.map((x: any) => x.imageId)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id)
    expect(ids).not.toContain(c2.id)
    expect(r.json.skipped.map((x: any) => x.imageId).sort()).toEqual([b.id, c2.id].sort())
    for (const alt of r.json.alts) {
      expect(alt.alt.length).toBeLessThanOrEqual(125)
      expect(alt.alt.toLowerCase().startsWith('photo of')).toBe(false)
    }
    // Drafts only: no photo's alt text moved.
    expect((await images()).map((i: any) => [i.id, i.alt])).toEqual(before)
    // The owner saves one through the ordinary photo route.
    expect((await k.O('PATCH', `/api/admin/products/images/${a.id}`, { alt: r.json.alts.find((x: any) => x.imageId === a.id).alt })).status).toBe(200)
  })

  test('a product with no photos has nothing to describe', async () => {
    const { product } = await k.product({ slug: 'bare', name: 'Bare', sku: 'BARE-1', priceCents: 100 })
    const r = await k.O('POST', `${WRITER}/${product.id}/alt-text`, { tone: 'friendly' })
    expect(r.status).toBe(400)
  })

  test('a seat without products:update is refused, and so is a shop with the writer off', async () => {
    reply = () => answer(JSON.stringify({ description: 'A feeder.', seoTitle: 'Feeder', seoDescription: 'A feeder.' }))
    const before = sent.length
    const v = await asViewer('POST', `${WRITER}/${productId}/describe`, { tone: 'friendly' })
    expect(v.status).toBe(403)
    expect((await asViewer('POST', `${WRITER}/${productId}/alt-text`, {})).status).toBe(403)
    expect((await k.ST('POST', `${WRITER}/${productId}/describe`, { tone: 'friendly' })).status).toBe(200) // staff edit products
    await features(['dashboard', 'orders', 'products', 'contacts'])
    try {
      const off = await k.O('POST', `${WRITER}/${productId}/describe`, { tone: 'friendly' })
      expect(off.status).toBe(403)
      expect(off.json.code).toBe('FEATURE_NOT_ENABLED')
      expect((await k.O('POST', `${WRITER}/${productId}/alt-text`, {})).status).toBe(403)
    } finally { await features(ON) }
    expect(sent.length).toBe(before + 1) // only the staff seat's allowed call went out
  })

  test('the editor offers the writer only when the switch is on, and drafts nothing into the saved product by itself', () => {
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', 'crm/pages/store/catalog/ProductEditPage.tsx'), 'utf8')
    expect(src).toContain("hasFeature('store_ai_writer')")
    // The panel only asks for a draft and hands it to the form; the form's own Save is the only write of the words.
    const panel = src.slice(src.indexOf('function WriterPanel'))
    expect(panel).not.toMatch(/api\.(patch|put|delete)\(/)
  })
})
