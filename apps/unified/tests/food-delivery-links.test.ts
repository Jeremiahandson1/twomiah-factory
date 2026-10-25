// DoorDash and Uber Eats links (crm/bar/foodSettings.ts deliveryUrl, site /order): the owner pastes each store's link
// in Register Settings; only an https link on that company's own domain is taken (DoorDash's own-site storefronts are
// order.online). Set, the website's Order page shows "Order on DoorDash" / "Order on Uber Eats" beside its own
// ordering — and the page is there for links alone, with online ordering off. No API integration.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { deliveryUrl } from '../server/crm/bar/foodSettings.ts'

let k: Awaited<ReturnType<typeof bootFood>>

beforeAll(async () => { k = await bootFood({ features: ['contacts', 'bar_menu', 'bar_register', 'bar_tonight'] }) }, 60_000)
afterAll(() => k.restore())

describe('the links', () => {
  test('only https links on the companies\' own domains', () => {
    expect(deliveryUrl('doordash', 'https://www.doordash.com/store/amber-inn-eau-claire-123/')).toBe('https://www.doordash.com/store/amber-inn-eau-claire-123/')
    expect(deliveryUrl('doordash', 'https://order.online/business/amber-inn-456')).toBe('https://order.online/business/amber-inn-456')
    expect(deliveryUrl('ubereats', 'https://www.ubereats.com/store/amber-inn/abc')).toBe('https://www.ubereats.com/store/amber-inn/abc')
    for (const bad of ['http://www.doordash.com/store/x', 'https://doordash.com.evil.example/store', 'https://evil-doordash.com/x', 'https://www.ubereats.com/x', 'javascript:alert(1)', 'https://user:pw@www.doordash.com/x', 'doordash.com/store/x']) {
      expect(deliveryUrl('doordash', bad)).toBeNull()
    }
    expect(deliveryUrl('ubereats', 'https://www.doordash.com/store/x')).toBeNull()
  })

  test('a manager saves them (a bartender may not); a wrong one is refused in words; blank clears', async () => {
    expect((await k.B('PUT', '/api/food/settings', { delivery: { doordashUrl: 'https://www.doordash.com/store/amber-1/' } })).status).toBe(403)
    const bad = await k.M('PUT', '/api/food/settings', { delivery: { ubereatsUrl: 'https://www.grubhub.com/restaurant/amber' } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe("That is not an Uber Eats link. Paste your store's address from ubereats.com (it starts with https://).")
    const ok = await k.M('PUT', '/api/food/settings', { delivery: { doordashUrl: 'https://www.doordash.com/store/amber-1/', ubereatsUrl: 'https://www.ubereats.com/store/amber/xyz' } })
    expect(ok.status).toBe(200)
    expect(ok.json.settings.delivery).toEqual({ doordashUrl: 'https://www.doordash.com/store/amber-1/', ubereatsUrl: 'https://www.ubereats.com/store/amber/xyz' })
  })
})

describe('on the website', () => {
  test('with online ordering off, the Order page and its nav item are there for the links alone', async () => {
    const a = await k.pub('GET', '/api/public/food/ordering')
    expect(a.status).toBe(200)
    expect(a.json.offered).toBe(false)
    expect(a.json.menu).toEqual([])
    expect(a.json.delivery).toEqual([
      { company: 'doordash', name: 'DoorDash', url: 'https://www.doordash.com/store/amber-1/' },
      { company: 'ubereats', name: 'Uber Eats', url: 'https://www.ubereats.com/store/amber/xyz' },
    ])
    const page = await k.pub('GET', '/order')
    expect(page.status).toBe(200)
    expect(page.text).toContain('id="order-delivery"')
    const home = page
    expect(home.text).toContain('href="/order"')
    // The script draws "Order on DoorDash" / "Order on Uber Eats" from those links, opening the company's own page.
    const js = (await k.pub('GET', '/scripts/order.js')).text
    expect(js).toContain('Order on ')
    expect(js).toContain('target="_blank" rel="noopener"')
  })

  test('cleared, and with ordering off, there is no Order page', async () => {
    expect((await k.M('PUT', '/api/food/settings', { delivery: { doordashUrl: '', ubereatsUrl: null } })).status).toBe(200)
    expect((await k.pub('GET', '/api/public/food/ordering')).status).toBe(404)
    expect((await k.pub('GET', '/order')).status).toBe(404)
  })
})
