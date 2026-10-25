// A menu item's photo, and a restaurant's (or a food truck's) live menu on its website.
//   · the menu editor uploads an item's photo into the website's photo library (re-encoded, served at /media), gated on
//     editing the menu (bar:update) — a server-side 403 for staff, not just a hidden button;
//   · the photo shows on the website's menu, the /order page's menu and the kiosk's; an item with none has no <img>;
//   · a restaurant's site has /menu and a "Menu" nav item while its menu has items — sections, items, sizes, prices,
//     descriptions, photos, 86'd items left off — whether or not online ordering is on, and none of the bar's night;
//   · no menu (empty, or bar_menu off) is no page and no nav item.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let staff = ''
const BASE = ['contacts', 'event_bookings', 'bar_menu', 'bar_register']
const call = (tok: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const ok = async (r: Response) => { if (r.status >= 300) throw new Error(r.status + ' ' + await r.text()); return r.json() }
// The Factory's switch (sync-features), so the signed-in gates' cache hears it as it does in production.
process.env.FACTORY_SYNC_KEY = 'factory-key-for-test'
const features = async (list: string[]) => ok(await t.call('/api/internal/sync-features', { method: 'POST', json: { features: list }, headers: { 'X-Factory-Key': 'factory-key-for-test' } }))
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
const photoForm = async (format: 'png' | 'jpeg' = 'png') => {
  const img = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 80, b: 20 } } })[format]().toBuffer()
  const fd = new FormData()
  fd.append('file', new File([img], 'burger.' + format, { type: 'image/' + format }))
  return fd
}
const upload = async (tok: string, itemId: string) => call(tok, `/api/bar/menu/items/${itemId}/photo`, { method: 'POST', body: await photoForm() })
let burger: any, fries: any, soup: any, pop: any

beforeAll(async () => {
  t = await bootTenant({ vertical: 'restaurant' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Mabel\'s Truck', phone: '715-555-0199', enabledFeatures: BASE }).where(eq(t.schema.company.id, companyId))
  await t.db.insert(t.schema.user).values({ email: 'cook@test.example', passwordHash: await Bun.password.hash(s.password, 'bcrypt'), firstName: 'Cal', lastName: 'Cook', role: 'field', companyId })
  owner = await login('owner@test.example', s.password)
  staff = await login('cook@test.example', s.password)
  // A published home page, so the site renders and shows its nav.
  await t.db.insert(t.schema.website).values({ companyId, tagline: 'Street food', nav: [{ label: 'Contact', href: 'contact' }] })
  await t.db.insert(t.schema.page).values({ companyId, slug: 'home', title: 'Home', sections: [{ type: 'about', variant: 'story', data: { title: 'About us', paragraphs: ['Tacos since 2019.'] } }], isPublished: true, navOrder: 0 })
})

describe('no menu, no menu page', () => {
  test('an empty menu: /menu is not a page and the nav has no Menu', async () => {
    expect((await t.call('/menu')).status).toBe(404)
    expect(await (await t.call('/')).text()).not.toContain('href="/menu"')
  })
})

describe("the item's photo, from the menu editor", () => {
  beforeAll(async () => {
    const mains = await ok(await call(owner, '/api/bar/menu/sections', { method: 'POST', json: { name: 'Mains', kind: 'food' } }))
    const drinks = await ok(await call(owner, '/api/bar/menu/sections', { method: 'POST', json: { name: 'Drinks', kind: 'drink' } }))
    burger = await ok(await call(owner, '/api/bar/menu/items', { method: 'POST', json: { sectionId: mains.id, name: 'Smash Burger', price: '12', description: 'Two patties, onions.' } }))
    fries = await ok(await call(owner, '/api/bar/menu/items', { method: 'POST', json: { sectionId: mains.id, name: 'Fries', priceLabel: '$4 / $6' } }))
    soup = await ok(await call(owner, '/api/bar/menu/items', { method: 'POST', json: { sectionId: mains.id, name: 'Soup of the Day', price: '6' } }))
    pop = await ok(await call(owner, '/api/bar/menu/items', { method: 'POST', json: { sectionId: drinks.id, name: 'Root Beer', price: '3' } }))
    await ok(await call(owner, `/api/bar/menu/items/${soup.id}/86`, { method: 'PUT', json: { is86ed: true } }))
  })

  test('staff without menu editing are refused by the server (403), and nothing is written', async () => {
    const r = await upload(staff, burger.id)
    expect(r.status).toBe(403)
    const [row] = await t.db.select().from(t.schema.barMenuItem).where(eq(t.schema.barMenuItem.id, burger.id))
    expect(row.imageUrl).toBeNull()
  })

  test('the owner uploads: re-encoded into the website library, served at /media, written to the item', async () => {
    const r = await upload(owner, burger.id)
    expect(r.status).toBe(201)
    const row = await r.json()
    expect(row.imageUrl).toMatch(/^\/media\/photos\/[0-9a-f-]+\.jpg$/)
    const media = await t.call(row.imageUrl)
    expect(media.status).toBe(200)
    expect(media.headers.get('content-type')).toBe('image/jpeg')
    // In the website's own photo library, as every site photo is.
    const lib = await t.db.select().from(t.schema.photo).where(eq(t.schema.photo.publicUrl, row.imageUrl))
    expect(lib.length).toBe(1)
    expect(lib[0].isPublic).toBe(true)
    burger = row
  })

  test('not an image, another business\'s item, or the menu switched off: refused', async () => {
    const fd = new FormData(); fd.append('file', new File([new TextEncoder().encode('not a picture')], 'x.png', { type: 'image/png' }))
    expect((await call(owner, `/api/bar/menu/items/${fries.id}/photo`, { method: 'POST', body: fd })).status).toBe(400)
    expect((await call(owner, '/api/bar/menu/items/00000000-0000-0000-0000-000000000000/photo', { method: 'POST', body: await photoForm() })).status).toBe(404)
    await features(BASE.filter((f) => f !== 'bar_menu'))
    const off = await upload(owner, fries.id)
    await features(BASE)
    expect(off.status).toBe(403)
    const [row] = await t.db.select().from(t.schema.barMenuItem).where(eq(t.schema.barMenuItem.id, fries.id))
    expect(row.imageUrl).toBeNull()
  })
})

describe("the restaurant's live menu page", () => {
  test('/menu: sections, items, sizes, prices, descriptions, the photo; the 86 left off; none of the bar\'s night', async () => {
    const r = await t.call('/menu')
    expect(r.status).toBe(200)
    const html = await r.text()
    for (const w of ['Mains', 'Drinks', 'Smash Burger', 'Two patties, onions.', '$12', 'Fries', '$4 / $6', 'Root Beer', '$3']) expect(html).toContain(w)
    expect(html).not.toContain('Soup of the Day')
    expect(html).toContain(`<img class="menu-line__img" src="${burger.imageUrl}"`)
    // One photo: the items without one have no image at all (no broken picture).
    expect(html.match(/menu-line__img/g)!.filter(Boolean).length).toBeGreaterThan(0)
    expect(html.match(/<img class="menu-line__img"/g)!.length).toBe(1)
    expect(html).toContain('menu-line--photo')
    expect(html).not.toContain('class="board"')
    expect(html).not.toMatch(/class="taps/)
    expect(html).toContain('href="/menu"')
  })

  test('the nav carries Menu on every page; the sitemap lists /menu', async () => {
    const home = await (await t.call('/')).text()
    expect(home).toContain('href="/menu"')
    expect(await (await t.call('/sitemap.xml')).text()).toContain('/menu</loc>')
  })

  test('with online ordering on, the order page\'s menu and the kiosk\'s carry the photo; /menu still stands', async () => {
    await features([...BASE, 'online_ordering', 'order_kiosk'])
    const a = await ok(await t.call('/api/public/food/ordering'))
    const items = a.menu.flatMap((s: any) => s.items)
    expect(items.find((i: any) => i.id === burger.id).imageUrl).toBe(burger.imageUrl)
    expect(items.find((i: any) => i.id === pop.id).imageUrl).toBeNull()
    const kiosk = await ok(await call(owner, '/api/food/kiosk/state'))
    expect(kiosk.menu.flatMap((s: any) => s.items).find((i: any) => i.id === burger.id)?.imageUrl).toBe(burger.imageUrl)
    expect((await t.call('/menu')).status).toBe(200)
    const order = await (await t.call('/order')).text()
    expect(order).toContain('/scripts/order.js')
    expect(await (await t.call('/scripts/order.js')).text()).toContain('order-item__img')
    await features(BASE)
  })

  test('the photo comes off with the item\'s save, and the line is plain again', async () => {
    await ok(await call(owner, `/api/bar/menu/items/${burger.id}`, { method: 'PUT', json: { imageUrl: null } }))
    const html = await (await t.call('/menu')).text()
    expect(html).toContain('Smash Burger')
    expect(html).not.toContain('<img class="menu-line__img"')
  })

  test('bar_menu off: no menu page and no nav item', async () => {
    await features(BASE.filter((f) => f !== 'bar_menu'))
    expect((await t.call('/menu')).status).toBe(404)
    expect(await (await t.call('/')).text()).not.toContain('href="/menu"')
    await features(BASE)
  })
})
