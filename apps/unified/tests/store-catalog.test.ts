// The store's catalog group (server/crm/store/catalog/; docs/UNIFIED_STORE_PLAN.md step 3) through the real server as
// the store vertical, with the template suite (tests/store/*.test.ts) as the spec — roles, admin-concurrency (the
// catalogue and loyalty parts), loyalty and loyalty-races-and-roles (the admin parts), qa-t1 (codes, the punch-card
// reward's name), audit-and-shipping-rates (settings, codes, stock and the team rows), team-invites, store-domain:
//   · products: staff add and edit, the manager deletes; slugs unique in a company's catalogue; SKUs unique; paging;
//     the guarded stock count; one primary photo; a pasted photo only a public https address; an upload served by the
//     website's /media; another company's product, variant and photo are 404s;
//   · discount codes: upper case, letters and digits only, unique, at most 100% — on a create and an edit; staff read
//     and may not write; the audit rows in words;
//   · reviews: staff publish, the manager deletes; the queue and its counts;
//   · loyalty: the settings in company.settings.loyalty, merged under a lock; rewards money off only, with a minimum
//     spend, written by the manager and not staff; members shown with their contact, and their ledger;
//   · settings: the round trip, the shipping fields the manager's and the rest the owner's, the company's own fields
//     refused here with where they live;
//   · the shared modules' fixes the store carried, now the engine's for everyone: a revoked login's attempt is
//     recorded; an expired invite says to ask again; a login added, re-roled or revoked is on the record in words;
//     the store's seats are the roles a login may hold; the domain route (status, check, buy, attach), the owner's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { storeDateString } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let otherCo = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const req = (who: string, method: string, p: string, body?: unknown) =>
  t.call(p, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body === undefined ? {} : { json: body }) })
const call = async (who: string, method: string, p: string, body?: unknown) => {
  const r = await req(who, method, p, body)
  const text = await r.text()
  let json: any = text
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, body: json }
}
const O = (m: string, p: string, b?: unknown) => call('owner', m, p, b)
const M = (m: string, p: string, b?: unknown) => call('mgr', m, p, b)
const S = (m: string, p: string, b?: unknown) => call('staff', m, p, b)
const auditRows = async () => (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, companyId)))
  .sort((a: any, b: any) => +a.createdAt - +b.createdAt)
const since = async (n: number) => (await auditRows()).slice(n)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, cid = companyId) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId: cid } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('mgr', 'manager')
  await seat('mgr2', 'manager')
  // The template's floor seat, stored as the template stored it; the store's roleMapping reads it as the field rung.
  await seat('staff', 'staff')
  await seat('staff2', 'field')
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Shop', slug: 'rival-shop' } as any).returning()
  otherCo = other.id
}, 120_000)

describe('products: who may do what', () => {
  test('staff add a product, edit it, add a variant and change its stock — and cannot delete either', async () => {
    const created = await S('POST', '/api/admin/products', { name: 'Teapot' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ name: 'Teapot', slug: 'teapot', status: 'draft', companyId })
    ids.teapot = created.body.id
    expect((await S('PATCH', `/api/admin/products/${ids.teapot}`, { tagline: 'Pours well' })).body.tagline).toBe('Pours well')
    const v = await S('POST', `/api/admin/products/${ids.teapot}/variants`, { sku: 'POT-1', name: 'Default', priceCents: 3000 })
    expect(v.status).toBe(201)
    ids.potVariant = v.body.id
    expect((await S('PATCH', `/api/admin/products/variants/${ids.potVariant}`, { inventoryQty: 4 })).body.inventoryQty).toBe(4)
    expect((await S('DELETE', `/api/admin/products/variants/${ids.potVariant}`)).status).toBe(403)
    expect((await S('DELETE', `/api/admin/products/${ids.teapot}`)).status).toBe(403)
    expect((await t.db.select().from(t.schema.storeProduct).where(eq(t.schema.storeProduct.id, ids.teapot))).length).toBe(1)
  })

  test('the manager deletes the variant and the product; a delete of nothing is a 404', async () => {
    expect((await M('DELETE', `/api/admin/products/variants/${ids.potVariant}`)).body).toEqual({ success: true })
    expect((await M('DELETE', `/api/admin/products/${ids.teapot}`)).body).toEqual({ success: true })
    expect((await M('DELETE', `/api/admin/products/${ids.teapot}`)).status).toBe(404)
  })

  test('the list is { data, pagination }, each product with its photos and variants; ?limit and ?page are honoured', async () => {
    for (const name of ['Mug', 'Jar', 'Bowl']) expect((await O('POST', '/api/admin/products', { name, status: 'active' })).status).toBe(201)
    const all = await S('GET', '/api/admin/products')
    expect(all.status).toBe(200)
    expect(all.body.data.length).toBe(3)
    expect(all.body.pagination).toMatchObject({ page: 1, total: 3 })
    expect(Array.isArray(all.body.data[0].images) && Array.isArray(all.body.data[0].variants)).toBe(true)
    const paged = await S('GET', '/api/admin/products?limit=2&page=2')
    expect(paged.body.data.length).toBe(1)
    expect(paged.body.pagination).toEqual({ page: 2, limit: 2, total: 3, pages: 2 })
    ids.mug = all.body.data.find((p: any) => p.name === 'Mug').id
  })

  test('a slug is unique in the company\'s catalogue — another company\'s slug does not count', async () => {
    await t.db.insert(t.schema.storeProduct).values({ companyId: otherCo, slug: 'kettle', name: 'Their Kettle' } as any)
    const first = await O('POST', '/api/admin/products', { name: 'Kettle' })
    const second = await O('POST', '/api/admin/products', { name: 'Kettle' })
    expect([first.body.slug, second.body.slug]).toEqual(['kettle', 'kettle-2'])
    // Renamed onto a slug the catalogue already has: refused, not a 500.
    expect((await O('PATCH', `/api/admin/products/${second.body.id}`, { slug: 'Kettle' })).status).toBe(409)
  })

  test('a SKU is unique; a price past the column and a negative stock are refused by name', async () => {
    expect((await S('POST', `/api/admin/products/${ids.mug}/variants`, { sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 })).status).toBe(201)
    const dup = await S('POST', `/api/admin/products/${ids.mug}/variants`, { sku: 'MUG-1', name: 'Other', priceCents: 1500 })
    expect(dup.status).toBe(409)
    const huge = await S('POST', `/api/admin/products/${ids.mug}/variants`, { sku: 'MUG-2', name: 'Big', priceCents: 2147483648 })
    expect(huge.status).toBe(400)
    expect(huge.body.fields.priceCents).toBe('Price is too large')
    const neg = await S('POST', `/api/admin/products/${ids.mug}/variants`, { sku: 'MUG-3', name: 'Neg', priceCents: 100, inventoryQty: -99 })
    expect(neg.body.fields.inventoryQty).toBe('Inventory cannot be negative')
  })

  test('the stock count: a count typed over a figure that has since moved is refused whole, and logged only when saved', async () => {
    const [v] = await t.db.select().from(t.schema.storeProductVariant).where(eq(t.schema.storeProductVariant.sku, 'MUG-1'))
    ids.mugVariant = v.id
    await t.db.update(t.schema.storeProductVariant).set({ inventoryQty: 7 }).where(eq(t.schema.storeProductVariant.id, v.id))
    const n = (await auditRows()).length
    const stale = await S('PATCH', `/api/admin/products/variants/${v.id}`, { priceCents: 1800, inventoryQty: 15, inventoryFrom: 10 })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('inventory_changed')
    expect(stale.body.error).toMatch(/stock changed to 7/)
    const [after] = await t.db.select().from(t.schema.storeProductVariant).where(eq(t.schema.storeProductVariant.id, v.id))
    expect([after.inventoryQty, after.priceCents]).toEqual([7, 1500])
    expect((await auditRows()).length).toBe(n)
    const both = await Promise.all([
      S('PATCH', `/api/admin/products/variants/${v.id}`, { inventoryQty: 9, inventoryFrom: 7 }),
      call('staff2', 'PATCH', `/api/admin/products/variants/${v.id}`, { inventoryQty: 8, inventoryFrom: 7 }),
    ])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    const [row] = (await since(n)).filter((r: any) => r.entity === 'product_variant')
    expect(row).toMatchObject({ action: 'update', entityName: 'MUG-1' })
    expect((row.changes as any).inventoryQty.old).toBe(7)
  })

  test('photos: a pasted one must be public https; one primary photo, always', async () => {
    expect((await S('POST', `/api/admin/products/${ids.mug}/images`, { url: 'javascript:alert(1)' })).status).toBe(400)
    expect((await S('POST', `/api/admin/products/${ids.mug}/images`, { url: 'https://169.254.169.254/latest' })).status).toBe(400)
    const imgs = [] as string[]
    for (let i = 0; i < 3; i++) imgs.push((await S('POST', `/api/admin/products/${ids.mug}/images`, { url: `https://img.test/${i}.jpg`, isPrimary: i === 0 })).body.id)
    for (let round = 0; round < 3; round++) {
      await Promise.all([
        S('PATCH', `/api/admin/products/images/${imgs[1]}`, { isPrimary: true }),
        call('staff2', 'PATCH', `/api/admin/products/images/${imgs[2]}`, { isPrimary: true }),
      ])
      const prim = (await t.db.select().from(t.schema.storeProductImage).where(eq(t.schema.storeProductImage.productId, ids.mug))).filter((r: any) => r.isPrimary)
      expect(prim.length).toBe(1)
    }
    const added = await S('POST', `/api/admin/products/${ids.mug}/images`, { url: 'https://img.test/new.jpg', isPrimary: true })
    expect(added.status).toBe(201)
    expect(added.body.isPrimary).toBe(true)
    const prim = (await t.db.select().from(t.schema.storeProductImage).where(eq(t.schema.storeProductImage.productId, ids.mug))).filter((r: any) => r.isPrimary)
    expect(prim.map((p: any) => p.url)).toEqual(['https://img.test/new.jpg'])
    ids.mugImage = imgs[0]
  })

  test('an upload goes to the file store under the website\'s photo prefix and the website\'s /media serves it', async () => {
    const storage: any = t.services.crm.storage
    const saved = { put: storage.put, configured: storage.storageConfigured, del: storage.deleteFile }
    const deleted: string[] = []
    try {
      storage.storageConfigured = () => false
      const form0 = new FormData(); form0.append('file', new File([new Uint8Array([1, 2, 3])], 'a.avif', { type: 'image/avif' }))
      const off = await t.call(`/api/admin/products/${ids.mug}/images/upload`, { method: 'POST', body: form0, headers: { Authorization: `Bearer ${tokens.staff}` } })
      expect(off.status).toBe(503)
      // The website's /media reads the app's photo store; in production both are the one R2 bucket.
      storage.storageConfigured = () => true
      storage.put = async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) }
      storage.deleteFile = (key: string) => { deleted.push(key); return true }
      const [jar] = await t.db.select().from(t.schema.storeProduct).where(and(eq(t.schema.storeProduct.companyId, companyId), eq(t.schema.storeProduct.name, 'Jar')))
      const form = new FormData(); form.append('file', new File([new Uint8Array([0, 0, 0, 1])], 'jar.avif', { type: 'image/avif' }))
      const up = await t.call(`/api/admin/products/${jar.id}/images/upload`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${tokens.staff}` } })
      expect(up.status).toBe(201)
      const img = await up.json() as any
      expect(img.url).toMatch(new RegExp(`^/media/photos/products/${companyId}/${jar.id}/[0-9a-f-]+\\.avif$`))
      expect(img).toMatchObject({ isPrimary: true, alt: 'Jar' })
      const served = await t.app.request(img.url)
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('image/avif')
      const svg = new FormData(); svg.append('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))
      expect((await t.call(`/api/admin/products/${jar.id}/images/upload`, { method: 'POST', body: svg, headers: { Authorization: `Bearer ${tokens.staff}` } })).status).toBe(415)
      // Removing it removes the file; removing a pasted photo touches no file.
      expect((await S('DELETE', `/api/admin/products/images/${img.id}`)).status).toBe(200)
      expect((await S('DELETE', `/api/admin/products/images/${ids.mugImage}`)).status).toBe(200)
      expect(deleted).toEqual([img.url.replace(/^\/media\//, '')])
    } finally {
      storage.put = saved.put; storage.storageConfigured = saved.configured; storage.deleteFile = saved.del
    }
  })

  test('another company\'s product, variant and photo are 404s, read or written', async () => {
    const [theirs] = await t.db.select().from(t.schema.storeProduct).where(eq(t.schema.storeProduct.companyId, otherCo))
    const [tv] = await t.db.insert(t.schema.storeProductVariant).values({ productId: theirs.id, sku: 'THEIR-1', name: 'Default', priceCents: 100, inventoryQty: 3 } as any).returning()
    const [ti] = await t.db.insert(t.schema.storeProductImage).values({ productId: theirs.id, url: 'https://img.test/theirs.jpg' } as any).returning()
    expect((await O('GET', `/api/admin/products/${theirs.id}`)).status).toBe(404)
    expect((await O('PATCH', `/api/admin/products/${theirs.id}`, { name: 'Mine now' })).status).toBe(404)
    expect((await O('DELETE', `/api/admin/products/${theirs.id}`)).status).toBe(404)
    expect((await O('POST', `/api/admin/products/${theirs.id}/variants`, { sku: 'X-1', name: 'X', priceCents: 1 })).status).toBe(404)
    expect((await O('PATCH', `/api/admin/products/variants/${tv.id}`, { inventoryQty: 0, inventoryFrom: 3 })).status).toBe(404)
    expect((await O('DELETE', `/api/admin/products/variants/${tv.id}`)).status).toBe(404)
    expect((await O('PATCH', `/api/admin/products/images/${ti.id}`, { isPrimary: true })).status).toBe(404)
    expect((await O('DELETE', `/api/admin/products/images/${ti.id}`)).status).toBe(404)
    expect((await O('GET', '/api/admin/products')).body.data.some((p: any) => p.id === theirs.id)).toBe(false)
    const [still] = await t.db.select().from(t.schema.storeProductVariant).where(eq(t.schema.storeProductVariant.id, tv.id))
    expect(still.inventoryQty).toBe(3)
    expect((await t.db.select().from(t.schema.storeProduct).where(eq(t.schema.storeProduct.id, theirs.id)))[0].name).toBe('Their Kettle')
  })

  test('every catalogue write is on the record under its own name', async () => {
    const n = (await auditRows()).length
    const p = await S('POST', '/api/admin/products', { name: 'Cup', slug: 'cup' })
    const v = await S('POST', `/api/admin/products/${p.body.id}/variants`, { sku: 'CUP-1', name: 'Default', priceCents: 2500 })
    await M('DELETE', `/api/admin/products/variants/${v.body.id}`)
    await M('DELETE', `/api/admin/products/${p.body.id}`)
    const say = (await since(n)).map((r: any) => `${r.action} ${r.entity} ${r.entityName}`)
    expect(say).toEqual(['create product Cup', 'create product_variant CUP-1', 'delete product_variant CUP-1', 'delete product Cup'])
    expect(((await since(n))[1].metadata as any).description).toBe('Variant CUP-1 added — $25.00, stock not tracked')
  })
})

describe('discount codes', () => {
  test('staff read the codes and may not write one; the manager does', async () => {
    const [code] = await t.db.insert(t.schema.discountCode).values({ companyId, code: 'SAVE10', type: 'percent', value: 10 } as any).returning()
    ids.save10 = code.id
    const listed = await S('GET', '/api/admin/discounts')
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((c: any) => c.code)).toEqual(['SAVE10'])
    expect((await S('POST', '/api/admin/discounts', { code: 'FREE', type: 'percent', value: 100 })).status).toBe(403)
    expect((await S('PATCH', `/api/admin/discounts/${code.id}`, { value: 90 })).status).toBe(403)
    expect((await S('DELETE', `/api/admin/discounts/${code.id}`)).status).toBe(403)
    expect((await t.db.select().from(t.schema.discountCode).where(eq(t.schema.discountCode.id, code.id)))[0].value).toBe(10)
    const made = await M('POST', '/api/admin/discounts', { code: '  spring-10 ', type: 'percent', value: 10 })
    expect(made.status).toBe(201)
    expect(made.body.code).toBe('SPRING-10')
    ids.spring = made.body.id
  })

  test('a code a shopper can type, unique, at most 100% — on the create and on an edit', async () => {
    const spaced = await M('POST', '/api/admin/discounts', { code: 'T1 SP ACE', type: 'percent', value: 10 })
    expect(spaced.status).toBe(400)
    expect(spaced.body.error).toMatch(/no spaces/)
    expect(spaced.body.fields.code).toBeTruthy()
    expect((await M('POST', '/api/admin/discounts', { code: 'SAVE$10', type: 'fixed', value: 1000 })).status).toBe(400)
    expect((await M('POST', '/api/admin/discounts', { code: 'save10', type: 'fixed', value: 500 })).status).toBe(409)
    expect((await M('POST', '/api/admin/discounts', { code: 'HUGE', type: 'percent', value: 500 })).status).toBe(400)
    const fiver = await M('POST', '/api/admin/discounts', { code: 'FALL_5', type: 'fixed', value: 500 })
    expect((await M('PATCH', `/api/admin/discounts/${ids.spring}`, { code: 'BAD CODE' })).status).toBe(400)
    expect((await M('PATCH', `/api/admin/discounts/${ids.spring}`, { code: 'fall_5' })).status).toBe(409)
    expect((await M('PATCH', `/api/admin/discounts/${ids.spring}`, { value: 500 })).status).toBe(400)
    expect((await M('PATCH', `/api/admin/discounts/${fiver.body.id}`, { type: 'percent' })).status).toBe(400)
    const fine = await M('PATCH', `/api/admin/discounts/${ids.spring}`, { active: false })
    expect(fine.status).toBe(200)
    expect(fine.body.active).toBe(false)
    // Another company may hold the same code; this one cannot see or edit theirs.
    const [theirs] = await t.db.insert(t.schema.discountCode).values({ companyId: otherCo, code: 'SPRING-10', type: 'percent', value: 50 } as any).returning()
    expect((await M('PATCH', `/api/admin/discounts/${theirs.id}`, { value: 1 })).status).toBe(404)
    expect((await M('DELETE', `/api/admin/discounts/${theirs.id}`)).status).toBe(404)
    expect((await M('GET', '/api/admin/discounts')).body.data.some((c: any) => c.id === theirs.id)).toBe(false)
  })

  test('giving money away is on the record: who, which code, how much', async () => {
    const n = (await auditRows()).length
    const c1 = await M('POST', '/api/admin/discounts', { code: 'SPRING15', type: 'percent', value: 15 })
    const c2 = await M('POST', '/api/admin/discounts', { code: 'FIVER', type: 'fixed', value: 500 })
    await M('PATCH', `/api/admin/discounts/${c1.body.id}`, { value: 100 })
    expect((await M('DELETE', `/api/admin/discounts/${c2.body.id}`)).body).toEqual({ success: true })
    const added = await since(n)
    expect(added.every((r: any) => r.entity === 'discount_code' && r.userId === ids.mgr)).toBe(true)
    const say = added.map((r: any) => (r.metadata as any)?.description ?? null)
    expect(say[0]).toBe('Code SPRING15 created — 15% off')
    expect(say[1]).toBe('Code FIVER created — $5.00 off')
    expect((added[2].changes as any).value).toEqual({ old: 15, new: 100 })
    expect(say[3]).toBe('Code FIVER deleted — it was $5.00 off, used 0 times')
  })
})

describe('reviews', () => {
  test('staff publish a review and may not delete one; the manager deletes; the queue and its counts', async () => {
    const [mug] = await t.db.select().from(t.schema.storeProduct).where(eq(t.schema.storeProduct.id, ids.mug))
    const [r1] = await t.db.insert(t.schema.productReview).values({ companyId, productId: mug.id, authorName: 'Ada', rating: 5, title: 'Lovely' } as any).returning()
    const [r2] = await t.db.insert(t.schema.productReview).values({ companyId, productId: mug.id, authorName: 'Bob', rating: 2 } as any).returning()
    const [theirP] = await t.db.select().from(t.schema.storeProduct).where(eq(t.schema.storeProduct.companyId, otherCo))
    const [theirs] = await t.db.insert(t.schema.productReview).values({ companyId: otherCo, productId: theirP.id, authorName: 'Eve', rating: 1 } as any).returning()
    const queue = await S('GET', '/api/admin/reviews')
    expect(queue.body.data.map((r: any) => r.authorName).sort()).toEqual(['Ada', 'Bob'])
    expect(queue.body.data[0].productName).toBe('Mug')
    expect(queue.body.pagination.total).toBe(2)
    const ok = await S('PATCH', `/api/admin/reviews/${r1.id}`, { status: 'approved' })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('approved')
    expect((await S('PATCH', `/api/admin/reviews/${r1.id}`, { status: 'shown' })).status).toBe(400)
    expect((await S('GET', '/api/admin/reviews/counts')).body).toEqual({ pending: 1, approved: 1, rejected: 0 })
    expect((await S('GET', '/api/admin/reviews?status=all')).body.data.length).toBe(2)
    expect((await S('DELETE', `/api/admin/reviews/${r2.id}`)).status).toBe(403)
    expect((await M('DELETE', `/api/admin/reviews/${r2.id}`)).status).toBe(200)
    expect((await M('PATCH', `/api/admin/reviews/${theirs.id}`, { status: 'approved' })).status).toBe(404)
    expect((await M('DELETE', `/api/admin/reviews/${theirs.id}`)).status).toBe(404)
  })
})

describe('loyalty', () => {
  test('the settings live in company.settings.loyalty, with the store\'s reward name; the manager sets them, staff read them', async () => {
    const first = await S('GET', '/api/admin/loyalty/config')
    expect(first.status).toBe(200)
    expect(first.body.loyaltyPunchCard.rewardName).toBe('Free item')
    expect((await S('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 99 })).status).toBe(403)
    const set = await M('PUT', '/api/admin/loyalty/config', { loyaltyEnabled: true, loyaltyPointsPerDollar: 1 })
    expect(set.status).toBe(200)
    // Three settings saved at once by two managers: every one kept.
    const rs = await Promise.all([
      M('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 3 }),
      call('mgr2', 'PUT', '/api/admin/loyalty/config', { loyaltyWelcomePoints: 50 }),
      M('PUT', '/api/admin/loyalty/config', { loyaltyPunchCard: { visitsRequired: 6, rewardName: 'Free mug' } }),
    ])
    expect(rs.every((r) => r.status === 200)).toBe(true)
    const [co] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
    expect((co.settings as any).loyalty).toMatchObject({ enabled: true, pointsPerDollar: 3, welcomePoints: 50, punchCard: { visitsRequired: 6, rewardName: 'Free mug' } })
    const back = await S('GET', '/api/admin/loyalty/config')
    expect(back.body).toMatchObject({ loyaltyEnabled: true, loyaltyPointsPerDollar: 3, loyaltyWelcomePoints: 50, loyaltyPunchCard: { visitsRequired: 6, rewardName: 'Free mug' } })
    // The audit row is flat and readable.
    const n = (await auditRows()).length
    await M('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 4, loyaltyPunchCard: { visitsRequired: 7, rewardName: 'Free jar' } })
    const [l] = await since(n)
    expect(l.entity).toBe('loyalty_config')
    expect(l.changes).toEqual({ pointsPerDollar: { old: 3, new: 4 }, punchCardOrders: { old: 6, new: 7 }, punchCardReward: { old: 'Free mug', new: 'Free jar' } })
  })

  test('rewards: money off only, at most 100%, never worth nothing, with a minimum spend — the manager\'s, not staff\'s', async () => {
    const r = await M('POST', '/api/admin/loyalty/rewards', { name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 5000 })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ companyId, name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 5000, active: true })
    ids.reward = r.body.id
    expect((await M('POST', '/api/admin/loyalty/rewards', { name: 'Free mug', type: 'free_item', valueCents: 0 })).status).toBe(400)
    const pct = await M('POST', '/api/admin/loyalty/rewards', { name: 'Too much', type: 'percent', valueCents: 150 })
    expect(pct.body.fields.valueCents).toBe('A percentage reward cannot exceed 100%')
    expect((await M('POST', '/api/admin/loyalty/rewards', { name: 'Nothing', type: 'fixed', valueCents: 0 })).body.fields.valueCents).toBe('A reward worth nothing takes nothing off')
    const nearlyFree = { name: 'Nearly free', pointsCost: 1, type: 'fixed', valueCents: 5000, active: true }
    expect((await S('POST', '/api/admin/loyalty/rewards', nearlyFree)).status).toBe(403)
    expect((await S('PUT', `/api/admin/loyalty/rewards/${ids.reward}`, nearlyFree)).status).toBe(403)
    expect((await S('DELETE', `/api/admin/loyalty/rewards/${ids.reward}`)).status).toBe(403)
    const listed = await S('GET', '/api/admin/loyalty/rewards')
    expect(listed.body.data.map((x: any) => [x.name, x.pointsCost])).toEqual([['$10 off', 60]])
    const edited = await M('PUT', `/api/admin/loyalty/rewards/${ids.reward}`, { name: '$10 off', pointsCost: 80, type: 'fixed', valueCents: 1000, minSubtotalCents: 6000 })
    expect(edited.body).toMatchObject({ pointsCost: 80, minSubtotalCents: 6000 })
    // The minimum spend is what checkout prices against (core.availableRewards).
    const [theirs] = await t.db.insert(t.schema.loyaltyReward).values({ companyId: otherCo, name: 'Theirs', type: 'fixed', valueCents: 100 } as any).returning()
    expect((await M('PUT', `/api/admin/loyalty/rewards/${theirs.id}`, nearlyFree)).status).toBe(404)
    expect((await M('DELETE', `/api/admin/loyalty/rewards/${theirs.id}`)).status).toBe(404)
  })

  test('members are contacts: shown with their name and email, found by either, with their ledger', async () => {
    const [ada] = await t.db.insert(t.schema.contact).values({ companyId, type: 'customer', name: 'Ada Lovelace', email: 'ada@example.com', phone: '608-555-0100' } as any).returning()
    const [m] = await t.db.insert(t.schema.loyaltyMember).values({ companyId, contactId: ada.id, pointsBalance: 120, lifetimePoints: 150, qualifyingVisits: 2 } as any).returning()
    await t.db.insert(t.schema.loyaltyTransaction).values({ companyId, memberId: m.id, type: 'earn', points: 150, balanceAfter: 150, description: 'Order ORD-1', orderId: 'o1' } as any)
    const [eve] = await t.db.insert(t.schema.contact).values({ companyId: otherCo, type: 'customer', name: 'Eve', email: 'eve@example.com' } as any).returning()
    const [em] = await t.db.insert(t.schema.loyaltyMember).values({ companyId: otherCo, contactId: eve.id } as any).returning()
    const all = await S('GET', '/api/admin/loyalty/members')
    expect(all.status).toBe(200)
    expect(all.body.data.length).toBe(1)
    expect(all.body.data[0]).toMatchObject({ id: m.id, contactId: ada.id, name: 'Ada Lovelace', email: 'ada@example.com', phone: '608-555-0100', pointsBalance: 120, qualifyingVisits: 2 })
    expect(all.body.data[0].punchCard).toMatchObject({ enabled: true })
    expect((await S('GET', '/api/admin/loyalty/members?search=ADA@EXAMPLE')).body.data.length).toBe(1)
    expect((await S('GET', '/api/admin/loyalty/members?search=lovelace')).body.data.length).toBe(1)
    expect((await S('GET', '/api/admin/loyalty/members?search=nobody')).body.data.length).toBe(0)
    const one = await S('GET', `/api/admin/loyalty/members/${m.id}`)
    expect(one.body).toMatchObject({ name: 'Ada Lovelace', pointsBalance: 120 })
    expect(one.body.transactions.map((x: any) => x.description)).toEqual(['Order ORD-1'])
    expect((await S('GET', `/api/admin/loyalty/members/${em.id}`)).status).toBe(404)
  })
})

describe('settings', () => {
  test('every seat reads the commerce settings; the owner saves them and they come back', async () => {
    const first = await S('GET', '/api/admin/settings')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ companyId, currency: 'usd', flatShippingCents: 0, abandonedCartEnabled: true, reviewsEnabled: true })
    const saved = await O('PATCH', '/api/admin/settings', {
      flatShippingCents: 500, taxRateBps: 500, taxRates: [{ country: 'US', state: 'WI', rateBps: 550 }],
      abandonedCartEnabled: false, reviewRequestDays: 10,
    })
    expect(saved.status).toBe(200)
    const back = await S('GET', '/api/admin/settings')
    expect(back.body).toMatchObject({ flatShippingCents: 500, taxRateBps: 500, taxRates: [{ country: 'US', state: 'WI', rateBps: 550 }], abandonedCartEnabled: false, reviewRequestDays: 10 })
  })

  test('the manager saves the shipping rates and not the tax; staff save nothing; refused saves change nothing and leave no row', async () => {
    const n = (await auditRows()).length
    const zones = [{ name: 'Domestic', countries: ['US'], states: [], rateCents: 700, freeThresholdCents: 5000 }]
    const r = await M('PATCH', '/api/admin/settings', { flatShippingCents: 600, freeShippingThresholdCents: 7500, shippingZones: zones })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ flatShippingCents: 600, freeShippingThresholdCents: 7500, shippingZones: zones })
    const tax = await M('PATCH', '/api/admin/settings', { taxRateBps: 900 })
    expect(tax.status).toBe(403)
    expect(tax.body.code).toBe('settings_field_refused')
    expect(Object.keys(tax.body.fields)).toEqual(['taxRateBps'])
    const mixed = await M('PATCH', '/api/admin/settings', { flatShippingCents: 650, taxRateBps: 1 })
    expect(mixed.status).toBe(403)
    // Who may set a field is asked before whether the value is valid.
    const badTax = await M('PATCH', '/api/admin/settings', { taxRateBps: 'lots', currency: 'dollars' })
    expect(badTax.status).toBe(403)
    expect(Object.keys(badTax.body.fields)).toEqual(['taxRateBps', 'currency'])
    expect((await M('PATCH', '/api/admin/settings', { flatShippingCents: -5 })).status).toBe(400)
    expect((await S('PATCH', '/api/admin/settings', { flatShippingCents: 1 })).status).toBe(403)
    const now = (await S('GET', '/api/admin/settings')).body
    expect([now.flatShippingCents, now.taxRateBps]).toEqual([600, 500])
    const rows = (await since(n)).filter((x: any) => x.entity === 'store_settings')
    expect(rows.length).toBe(1)
    expect(rows[0].userId).toBe(ids.mgr)
    const said = (rows[0].metadata as any).description
    expect(said).toMatch(/Flat shipping \$5\.00 → \$6\.00/)
    expect(said).toMatch(/Free shipping over never → \$75\.00/)
    expect(said).toMatch(/Shipping zones edited \(0 zones → 1 zone\)/)
  })

  test('a field a seat may read but not save LOOKS read-only: the disabled fieldset is the store form, and a disabled field has its own ground and ink in both themes (Store QA T3 L2)', () => {
    // `.input` paints every field white; without the disabled rule a manager saw the owner's settings as editable fields.
    const page = readFileSync(new URL('../web/src/crm/pages/store/catalog/StoreSettingsPage.tsx', import.meta.url), 'utf8')
    expect(page).toMatch(/<fieldset disabled=\{!maySaveSettings\}/)
    const css = readFileSync(new URL('../web/src/index.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(css).toMatch(/input:disabled,\s*select:disabled,\s*textarea:disabled \{\s*@apply cursor-not-allowed bg-gray-100 text-gray-600 dark:bg-slate-900 dark:text-slate-400;/)
  })

  test('the business\'s own fields are the company\'s: the manager is refused them, the owner is told where they live', async () => {
    expect((await M('PATCH', '/api/admin/settings', { companyName: 'Mine Now' })).status).toBe(403)
    const owner = await O('PATCH', '/api/admin/settings', { companyName: 'Fern & Field', flatShippingCents: 1 })
    expect(owner.status).toBe(400)
    expect(owner.body.code).toBe('company_field')
    expect(owner.body.error).toMatch(/\/api\/company/)
    expect((await S('GET', '/api/admin/settings')).body.flatShippingCents).toBe(600)
    // …and the company module is where they are written.
    expect((await O('PUT', '/api/company', { name: 'Fern & Field' })).status).toBe(200)
    expect((await O('GET', '/api/company')).body.name).toBe('Fern & Field')
  })

  test('the settings page: every control in a locked section carries its section\'s rule as its own disabled', () => {
    // A disabled fieldset leaves each control's `.disabled` false — the store's T3 retest read that as "still editable"
    // (tests/store/audit-and-shipping-rates). The template gave each control its section's flag; the move had lost it.
    const page = readFileSync(new URL('../web/src/crm/pages/store/catalog/StoreSettingsPage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const sections = [...page.matchAll(/<fieldset disabled=\{(![a-zA-Z]+)\}[^>]*>([\s\S]*?)<\/fieldset>/g)]
    expect(sections.length).toBeGreaterThan(0)
    const loose = sections.flatMap(([, cond, body]) => [
      ...[...body.matchAll(/<input(?![^>]*disabled=\{[^}]*\})[^>]*>/g)].map((m) => m[0].slice(0, 60)),
      ...[...body.matchAll(/<input disabled=\{([^}]*)\}/g)].filter((m) => m[1] !== cond).map((m) => `wrong flag: ${m[1]}`),
    ])
    expect(loose).toEqual([])
  })
})

describe('the shared modules\' fixes, now the engine\'s', () => {
  test('a login the store may hand out is manager or staff — not admin; one given no role is staff', async () => {
    const admin = await O('POST', '/api/company/users', { email: 'adm@test.example', password: 'Password123', firstName: 'Ad', lastName: 'Min', role: 'admin' })
    expect(admin.status).toBe(400)
    const plain = await O('POST', '/api/company/users', { email: 'plain@test.example', password: 'Password123', firstName: 'Pat', lastName: 'Plain' })
    expect(plain.status).toBe(201)
    expect(plain.body.role).toBe('field')
    ids.plain = plain.body.id
    const mgr = await O('POST', '/api/company/users', { email: 'mo@test.example', password: 'Password123', firstName: 'Mo', lastName: 'Mgr', role: 'manager' })
    expect(mgr.body.role).toBe('manager')
    expect((await O('PUT', `/api/company/users/${ids.plain}`, { role: 'admin' })).status).toBe(400)
    expect((await M('POST', '/api/company/users', { email: 'x@test.example', password: 'Password123', firstName: 'X', lastName: 'Y' })).status).toBe(403)
  })

  test('a login added, promoted, revoked and re-invited is on the record in words, role changes as role_change', async () => {
    const n = (await auditRows()).length
    const add = await O('POST', '/api/company/users', { email: 'newhire@test.example', password: 'Temp-Pass-99', firstName: 'New', lastName: 'Hire' })
    const promote = await O('PUT', `/api/company/users/${add.body.id}`, { role: 'manager' })
    const revoke = await O('PUT', `/api/company/users/${add.body.id}`, { isActive: false })
    expect([add.status, promote.status, revoke.status]).toEqual([201, 200, 200])
    const [a, p, r] = (await since(n)).filter((x: any) => x.entity === 'user')
    expect(a).toMatchObject({ action: 'create', entityId: add.body.id, entityName: 'New Hire', userId: ids.owner ?? a.userId })
    expect((a.metadata as any).description).toBe('Login added — newhire@test.example, as staff')
    expect(p.action).toBe('role_change')
    expect(p.changes).toEqual({ role: { old: 'field', new: 'manager' } })
    expect(r.action).toBe('update')
    expect((r.metadata as any).description).toBe('Access revoked — newhire@test.example')
  })

  test('the audit log: a bare end date covers the whole of that day, on the company\'s clock', async () => {
    // The screen's date pickers send YYYY-MM-DD. Read as an instant, "to today" stopped at today's UTC midnight and left
    // out everything done today (tests/store/audit-and-shipping-rates; the template covered the whole day).
    const tz = 'America/Chicago'
    await t.db.update(t.schema.company).set({ timezone: tz } as any).where(eq(t.schema.company.id, companyId))
    try {
      expect((await O('PATCH', '/api/admin/settings', { reviewRequestDays: 8 })).status).toBe(200) // a row written now
      const total = (await auditRows()).length
      const today = storeDateString(new Date(), tz)
      const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1)
      const yesterday = d.toISOString().slice(0, 10)
      const toToday = await O('GET', `/api/audit?startDate=2000-01-01&endDate=${today}`)
      expect(toToday.status).toBe(200)
      expect(toToday.body.pagination.total).toBe(total)
      const onlyToday = await O('GET', `/api/audit?startDate=${today}&endDate=${today}`)
      expect(onlyToday.body.data.some((r: any) => r.entity === 'store_settings')).toBe(true)
      const toYesterday = await O('GET', `/api/audit?startDate=2000-01-01&endDate=${yesterday}`)
      expect(toYesterday.body.data.some((r: any) => +new Date(r.createdAt) > Date.now() - 60_000)).toBe(false)
    } finally {
      await t.db.update(t.schema.company).set({ timezone: null } as any).where(eq(t.schema.company.id, companyId))
    }
  })

  test('a revoked login trying to sign in is on the record; the reply is unchanged', async () => {
    const n = (await auditRows()).length
    const r = await t.call('/api/auth/login', { method: 'POST', json: { email: 'newhire@test.example', password: 'Temp-Pass-99' } })
    expect(r.status).toBe(401)
    expect(((await r.json()) as any).error).toBe('Account is disabled')
    const [row] = (await since(n)).filter((x: any) => x.action === 'login_failed')
    expect(row).toMatchObject({ entity: 'user', entityName: 'newhire@test.example', userEmail: 'newhire@test.example' })
    expect((row.metadata as any).description).toBe('Sign-in refused — this login has been revoked')
  })

  test('an invitation that ran out says to ask for it again; a lapsed reset link says what it always said', async () => {
    const inv = await O('POST', '/api/company/users', { email: 'sam@test.example', firstName: 'Sam', lastName: 'Staff' })
    expect(inv.status).toBe(201)
    expect(inv.body.invited).toBe(true)
    const [sam] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, inv.body.id))
    await t.db.update(t.schema.user).set({ resetTokenExp: new Date(Date.now() - 1000) } as any).where(eq(t.schema.user.id, sam.id))
    const late = await t.call('/api/auth/reset-password', { method: 'POST', json: { token: sam.resetToken, password: 'Sams-own-pass-1' } })
    expect(late.status).toBe(400)
    expect(await late.json()).toMatchObject({ code: 'invite_expired', error: expect.stringMatching(/Ask whoever invited you to send it again/) })
    // Someone who has signed in and let a Forgot-password link lapse is not told about an invitation.
    await t.db.update(t.schema.user).set({ resetToken: 'reset-token-lapsed', resetTokenExp: new Date(Date.now() - 1000) } as any).where(eq(t.schema.user.id, ids.mgr))
    const lapsed = await t.call('/api/auth/reset-password', { method: 'POST', json: { token: 'reset-token-lapsed', password: 'New-pass-123' } })
    expect(await lapsed.json()).toEqual({ error: 'Invalid or expired reset token' })
    const unknown = await t.call('/api/auth/reset-password', { method: 'POST', json: { token: 'never-issued', password: 'New-pass-123' } })
    expect(await unknown.json()).toEqual({ error: 'Invalid or expired reset token' })
  })

  test('the domain: status, check, buy and attach through the Factory, the owner\'s alone; unlinked says so', async () => {
    const env = { FACTORY_URL: process.env.FACTORY_URL, TENANT_ID: process.env.TENANT_ID, FACTORY_SYNC_KEY: process.env.FACTORY_SYNC_KEY }
    process.env.FACTORY_URL = 'https://factory.test'; process.env.TENANT_ID = 'tenant-1'; process.env.FACTORY_SYNC_KEY = 'store-sync-key'
    const calls: Array<{ method: string; path: string; key: string | null; body: any }> = []
    let answer: { status: number; body: any } | null = null
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input)
      if (!url.startsWith('https://factory.test/')) return realFetch(input, init)
      const path = url.slice('https://factory.test'.length)
      calls.push({ method: (init?.method || 'GET').toUpperCase(), path, key: new Headers(init?.headers).get('x-factory-key'), body: init?.body ? JSON.parse(init.body) : null })
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
      if (answer) { const a = answer; answer = null; return json(a.body, a.status) }
      if (path.startsWith('/api/v1/factory/internal/domain/status/')) return json({ status: 'unconfigured', domain: null, nameservers: [] })
      if (path === '/api/v1/factory/public/domain/check') return json({ domain: 'testshopco.com', available: true, quote: { firstYearCents: 1214, renewalCents: 1955 } })
      if (path.startsWith('/api/v1/factory/internal/domain/buy/')) return json({ url: 'https://checkout.stripe.test/s', priceCents: 1214, renewalCents: 1955 })
      if (path.startsWith('/api/v1/factory/internal/domain/attach/')) return json({ domain: 'mine.com', status: 'pending_nameservers', nameservers: ['a.ns', 'b.ns'] })
      return json({ error: 'not answered here' }, 404)
    }) as any
    try {
      const st = await O('GET', '/api/admin/domain/status')
      expect(st.body.status).toBe('unconfigured')
      expect(calls[0]).toMatchObject({ path: '/api/v1/factory/internal/domain/status/tenant-1', key: 'store-sync-key' })
      const ck = await O('POST', '/api/admin/domain/check', { domain: ' TestShopCo.com ' })
      expect(ck.body.quote.renewalCents).toBe(1955)
      expect(calls.at(-1)!.body.domain).toBe('testshopco.com')
      const buy = await O('POST', '/api/admin/domain/buy-checkout', { domain: 'testshopco.com' })
      expect(buy.body).toEqual({ url: 'https://checkout.stripe.test/s', priceCents: 1214, renewalCents: 1955 })
      expect(calls.at(-1)!.body).toMatchObject({ domain: 'testshopco.com', years: 1, returnTo: 'admin', returnPath: '/crm/domain' })
      const at = await O('POST', '/api/admin/domain/attach', { domain: 'mine.com' })
      expect(at.body.nameservers.length).toBe(2)
      expect(calls.at(-1)!.body).toMatchObject({ mode: 'byod' })
      const c0 = calls.length
      expect((await O('POST', '/api/admin/domain/buy-checkout', { domain: 'not a domain' })).status).toBe(400)
      expect(calls.length).toBe(c0)
      answer = { status: 422, body: { error: 'To register a domain we need your business street address.', code: 'registrant_incomplete', missing: ['street address'] } }
      const gap = await O('POST', '/api/admin/domain/buy-checkout', { domain: 'testshopco.com' })
      expect(gap).toEqual({ status: 422, body: { error: 'To register a domain we need your business street address.', code: 'registrant_incomplete' } })
      answer = { status: 401, body: { error: 'Unauthorized' } }
      expect((await O('GET', '/api/admin/domain/status')).status).toBe(502)
      answer = { status: 503, body: { error: 'down' } }
      expect((await O('POST', '/api/admin/domain/check', { domain: 'a.com' })).status).toBe(502)
      const c1 = calls.length
      const seats = await Promise.all([M('GET', '/api/admin/domain/status'), S('GET', '/api/admin/domain/status'), M('POST', '/api/admin/domain/buy-checkout', { domain: 'a.com' }), S('POST', '/api/admin/domain/attach', { domain: 'a.com' })])
      expect(seats.map((r) => r.status)).toEqual([403, 403, 403, 403])
      expect(calls.length).toBe(c1)
      delete process.env.FACTORY_SYNC_KEY
      const un = await O('GET', '/api/admin/domain/status')
      const unBuy = await O('POST', '/api/admin/domain/buy-checkout', { domain: 'a.com' })
      expect(un.body.status).toBe('unconfigured')
      expect([unBuy.status, unBuy.body.code]).toEqual([503, 'factory_not_linked'])
      expect(calls.length).toBe(c1)
    } finally {
      globalThis.fetch = realFetch
      for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  })
})
