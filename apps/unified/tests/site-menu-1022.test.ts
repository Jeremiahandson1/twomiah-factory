// The public website as the live tests of 2026-10-22 found it (contractor and roofing; every vertical's starting site
// is built the same way): the menu was the build's list frozen ("Services" alone, or nothing), a published blog never
// reached it, "What we do" was one card repeating the trade ("Roofing"), and every tab read only the business's name.
// The site is built here exactly as a new business gets it — the Factory's own provision body (apps/api provisionSite)
// written by the app's own writer (modules/provision.ts writeStartingSite) — and also as a site built before the fix.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { writeStartingSite } from '../server/modules/provision.ts'
// The Factory's own code (apps/api), loaded at run time: the app's type check covers the app, and the Factory's files
// are typed under their own project (scripts/check-unified-types.ts), so this import is not followed by the app's tsc.
const FACTORY = '../../api/src/unified/factory.ts'
const { provisionSite } = await import(FACTORY) as { provisionSite: (tenant: any) => Record<string, any> }
import { isTradeCard, pageTitle, siteMenu, withBusinessServices } from '../server/site/menu.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
const tenant = (industry: string, extra: Record<string, unknown> = {}) => ({ name: 'Test Co', industry, city: 'Eau Claire', state: 'WI', phone: '715-555-0100', email: 'owner@testco.example', products: ['crm', 'website'], ...extra })

/** A tenant whose site is the Factory's starting site for this industry; signed in as its owner. */
async function started(industry: string, extra: Record<string, unknown> = {}, vertical = 'contractor') {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ name: 'Test Co', city: 'Eau Claire', state: 'WI' }).where(eq(t.schema.company.id, s.company.id))
  await writeStartingSite(t.db, s.company.id, provisionSite(tenant(industry, extra)) as any)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken as string
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  return { t, companyId: s.company.id as string, as }
}

const page = async (t: T, path: string) => { const r = await t.call(path); return { status: r.status, body: await r.text() } }
/** The header's menu, desktop and phone, as [label, href]. */
function menus(html: string) {
  const grab = (cls: string) => {
    const at = html.indexOf(`<nav class="${cls}"`)
    const block = html.slice(at, html.indexOf('</nav>', at))
    return [...block.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2].trim(), m[1]]).filter(([, h]) => !/mobile-nav__cta/.test(h))
  }
  const phone = grab('mobile-nav').filter(([l]) => l !== 'Get in touch')
  return { desktop: grab('primary-nav'), phone }
}
const title = (html: string) => (html.match(/<title>([^<]*)<\/title>/) || [])[1]
const whatWeDo = (html: string) => {
  const at = html.indexOf('class="services services--cards"')
  if (at < 0) return null
  return [...html.slice(at, html.indexOf('</section>', at)).matchAll(/service-card__title">([^<]*)</g)].map((m) => m[1])
}

describe('a general contractor\'s starting site (the contractor retest)', () => {
  let s: Awaited<ReturnType<typeof started>>
  beforeAll(async () => { s = await started('general_contractor') }, 60_000)

  test('"What we do" never shows the trade as a service; with nothing given it is not shown, and Services leaves the menu', async () => {
    const home = await page(s.t, '/')
    expect(home.status).toBe(200)
    expect(whatWeDo(home.body)).toBeNull()
    expect(home.body).not.toContain('service-card__title">General Contracting<')
    expect(menus(home.body).desktop).toEqual([])
  })

  test('the tab reads "Page — Business, City"; the home page "Business, City"', async () => {
    expect(title((await page(s.t, '/')).body)).toBe('Test Co, Eau Claire, WI')
    expect(title((await page(s.t, '/services')).body)).toBe('Services — Test Co, Eau Claire, WI')
    expect(title((await page(s.t, '/privacy')).body)).toBe('Privacy Policy — Test Co, Eau Claire, WI')
  })

  test('the price book\'s services shown to customers become "What we do", and Services joins the menu', async () => {
    const add = (v: Record<string, unknown>) => s.t.db.insert(s.t.schema.pricebookItem).values({ companyId: s.companyId, price: '100', ...v } as any)
    await add({ name: 'Kitchen remodel', customerDescription: 'Cabinets to countertops.' })
    await add({ name: 'Deck build' })
    await add({ name: 'Internal labour rate', showToCustomer: false })
    await add({ name: 'Old service', active: false })
    await add({ name: 'Drywall screws', type: 'material' })
    const home = await page(s.t, '/')
    expect(whatWeDo(home.body)).toEqual(['Deck build', 'Kitchen remodel'])
    expect(home.body).toContain('Cabinets to countertops.')
    expect(whatWeDo((await page(s.t, '/services')).body)).toEqual(['Deck build', 'Kitchen remodel'])
    expect(menus(home.body)).toEqual({ desktop: [['Services', '/services']], phone: [['Services', '/services']] })
  })

  test('a published blog post puts Blog in the menu on every page; a draft does not', async () => {
    await s.t.db.insert(s.t.schema.post).values({ companyId: s.companyId, slug: 'draft', title: 'Draft', status: 'draft' })
    expect(menus((await page(s.t, '/')).body).desktop.map(([l]) => l)).not.toContain('Blog')
    await s.t.db.insert(s.t.schema.post).values({ companyId: s.companyId, slug: 'spring', title: 'Spring checklist', status: 'published', publishedAt: new Date() })
    for (const path of ['/', '/services', '/blog', '/blog/spring']) {
      const m = menus((await page(s.t, path)).body)
      expect(m.desktop).toContainEqual(['Blog', '/blog'])
      expect(m.phone).toContainEqual(['Blog', '/blog'])
    }
    expect(title((await page(s.t, '/blog/spring')).body)).toBe('Spring checklist — Test Co, Eau Claire, WI')
  })

  test('About starts hidden (the signup gave no story); given a story and published, it is shown and joins the menu', async () => {
    expect((await page(s.t, '/about')).status).toBe(404)
    expect(menus((await page(s.t, '/')).body).desktop.map(([l]) => l)).not.toContain('About')
    const story = { type: 'about', variant: 'story', data: { title: 'About Test Co', paragraphs: ['Three generations of builders.'] } }
    const r = await s.as('/api/site/pages/about', { method: 'PATCH', json: { sections: [story], isPublished: true } })
    expect(r.status).toBe(200)
    expect((await page(s.t, '/about')).status).toBe(200)
    expect(title((await page(s.t, '/about')).body)).toBe('About — Test Co, Eau Claire, WI')
    expect(menus((await page(s.t, '/')).body).desktop).toContainEqual(['About', '/about'])
    // Hidden again: the link goes with it, though the owner's list keeps it.
    await s.as('/api/site/pages/about', { method: 'PATCH', json: { isPublished: false } })
    expect(menus((await page(s.t, '/')).body).desktop.map(([l]) => l)).not.toContain('About')
    const nav = (await (await s.as('/api/site/settings')).json()).nav
    expect(nav.map((n: any) => n.href)).toContain('about')
  })

  test('a published page the owner takes out of the menu stays out; a page made empty is not listed until it has something', async () => {
    await s.as('/api/site/pages/about', { method: 'PATCH', json: { isPublished: true } })
    const settings = (await (await s.as('/api/site/settings')).json())
    await s.as('/api/site/settings', { method: 'PATCH', json: { nav: settings.nav.filter((n: any) => n.href !== 'about') } })
    expect(menus((await page(s.t, '/')).body).desktop.map(([l]) => l)).not.toContain('About')
    expect((await page(s.t, '/about')).status).toBe(200)
    expect((await s.as('/api/site/pages', { method: 'POST', json: { slug: 'offers', title: 'Offers' } })).status).toBe(201)
    expect(menus((await page(s.t, '/')).body).desktop.map(([l]) => l)).not.toContain('Offers')
    await s.as('/api/site/pages/offers', { method: 'PATCH', json: { sections: [{ type: 'faq', variant: 'accordion', data: { items: [{ question: 'Free estimates?', answer: 'Yes.' }] } }] } })
    expect(menus((await page(s.t, '/')).body).desktop).toContainEqual(['Offers', '/offers'])
  })

  test('the owner\'s own titles win: a page\'s SEO title, and a home title that says more than the name', async () => {
    await s.as('/api/site/pages/services', { method: 'PATCH', json: { metaTitle: 'Remodeling in Eau Claire | Test Co' } })
    expect(title((await page(s.t, '/services')).body)).toBe('Remodeling in Eau Claire | Test Co')
    await s.as('/api/site/settings', { method: 'PATCH', json: { seoTitle: 'Test Co — Eau Claire remodeling since 1990' } })
    expect(title((await page(s.t, '/')).body)).toBe('Test Co — Eau Claire remodeling since 1990')
  })
})

describe('a roofer\'s starting site (the roofing retest)', () => {
  let s: Awaited<ReturnType<typeof started>>
  beforeAll(async () => { s = await started('roofing', {}, 'roofing') }, 60_000)

  test('no "Roofing" card under What we do, no menu items to pages that are not there, and the tab names the page and town', async () => {
    const home = await page(s.t, '/')
    expect(home.status).toBe(200)
    expect(whatWeDo(home.body)).toBeNull()
    expect(menus(home.body).desktop).toEqual([])
    expect(title(home.body)).toBe('Test Co, Eau Claire, WI')
    expect(title((await page(s.t, '/contact')).body)).toBe('Contact — Test Co, Eau Claire, WI')
  })

  test('services the roofer adds to the price book are shown under What we do', async () => {
    await s.t.db.insert(s.t.schema.pricebookItem).values({ companyId: s.companyId, name: 'Roof replacement', price: '9000' } as any)
    expect(whatWeDo((await page(s.t, '/')).body)).toEqual(['Roof replacement'])
  })
})

describe("a salon's What we do is its service menu", () => {
  test('the stand-in card gives way to the active services on the menu', async () => {
    const s = await started('salon', {}, 'salon')
    expect(whatWeDo((await page(s.t, '/')).body)).toBeNull()
    await s.t.db.insert(s.t.schema.serviceMenu).values([
      { companyId: s.companyId, name: 'Balayage', description: 'Hand-painted colour.' },
      { companyId: s.companyId, name: 'Retired cut', active: false },
    ] as any)
    expect(whatWeDo((await page(s.t, '/')).body)).toEqual(['Balayage'])
    expect(menus((await page(s.t, '/')).body).desktop).toEqual([['Services', '/services']])
  }, 60_000)
})

describe('services the owner gave at signup are theirs', () => {
  test('typed services stay, even beside the price book', async () => {
    const s = await started('general_contractor', { preview_premium_pages: null, intake_data: { intake: { services: ['Kitchens', 'Decks'] } } })
    await s.t.db.insert(s.t.schema.pricebookItem).values({ companyId: s.companyId, name: 'Hourly labour', price: '80' } as any)
    expect(whatWeDo((await page(s.t, '/')).body)).toEqual(['Kitchens', 'Decks'])
    expect(menus((await page(s.t, '/')).body).desktop).toEqual([['Services', '/services']])
  }, 60_000)
})

describe('a site built before the fix (no stand-in mark, the name as its site-wide title)', () => {
  test('the trade card is recognised by the hero\'s words, the RV dealer\'s too; the name-only title gives way', async () => {
    const t = await bootTenant()
    const [co] = await t.db.insert(t.schema.company).values({ name: 'Northwoods RV', slug: 'nw', city: 'Altoona', state: 'WI' }).returning()
    await t.db.insert(t.schema.website).values({ companyId: co.id, seoTitle: 'Northwoods RV', nav: [{ label: 'Services', href: 'services' }, { label: 'Gone', href: 'gone' }, { label: 'Our Facebook', href: 'https://facebook.com/nw' }] })
    const hero = { type: 'hero', variant: 'full-bleed', data: { eyebrow: 'RV & Powersports Dealership · Altoona, WI', title: 'Northwoods RV' } }
    const card = { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [{ title: 'RV & Powersports Sales' }] } }
    await t.db.insert(t.schema.page).values([
      { companyId: co.id, slug: 'home', title: 'Home', sections: [hero, card] },
      { companyId: co.id, slug: 'services', title: 'Services', sections: [{ type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Services' } }, card] },
    ])
    const home = await page(t, '/')
    expect(whatWeDo(home.body)).toBeNull()
    expect(title(home.body)).toBe('Northwoods RV, Altoona, WI')
    // Services has nothing of its own left; "Gone" is no page at all; an outside link is the owner's.
    expect(menus(home.body).desktop).toEqual([['Our Facebook', 'https://facebook.com/nw']])
  }, 60_000)
})

describe('the rules themselves', () => {
  test('every industry\'s stand-in card is marked by the Factory, and an owner\'s card never is', () => {
    for (const industry of ['roofing', 'general_contractor', 'hvac', 'plumbing', 'landscaping', 'home_care', 'salon', 'restaurant', 'veterinary', 'rv', 'locksmith', 'painter', 'Other']) {
      const site: any = provisionSite(tenant(industry))
      expect(site.seoTitle).toBeUndefined()
      for (const p of site.pages) for (const sec of p.sections) {
        if (sec.type === 'services') expect(sec.data.items.every((i: any) => i.standIn === true)).toBe(true)
      }
    }
    const typed: any = provisionSite(tenant('roofing', { intake_data: { intake: { services: ['Roof repair'] } } }))
    const items = typed.pages.find((p: any) => p.slug === 'home').sections.find((x: any) => x.type === 'services').data.items
    expect(items).toEqual([{ title: 'Roof repair' }])
  })

  test('isTradeCard: one bare card naming the trade (with or without its noun), or a marked one; nothing else', () => {
    expect(isTradeCard([{ title: 'Roofing' }], 'roofing')).toBe(true)
    expect(isTradeCard([{ title: 'Locksmith Services' }], 'locksmith')).toBe(true)
    expect(isTradeCard([{ title: 'Roof repair' }], 'roofing')).toBe(false)
    expect(isTradeCard([{ title: 'Roofing', description: 'Tear-offs and re-roofs.' }], 'roofing')).toBe(false)
    expect(isTradeCard([{ title: 'Roofing' }, { title: 'Gutters' }], 'roofing')).toBe(false)
    expect(isTradeCard([{ title: 'Anything', standIn: true }], '')).toBe(true)
    expect(withBusinessServices([{ type: 'services', data: { items: [] } }], [], '')).toEqual([])
  })

  test('the menu keeps the owner\'s order and adds collections after it', () => {
    const pages = new Map([['about', { live: true }], ['team', { live: false }]])
    expect(siteMenu([{ label: 'Team', href: '/team' }, { label: 'About us', href: 'about' }, { label: 'Book', href: '/book' }], { pages, posts: true, portfolio: true, areas: false }))
      .toEqual([{ label: 'About us', href: 'about' }, { label: 'Book', href: '/book' }, { label: 'Projects', href: '/projects' }, { label: 'Blog', href: '/blog' }])
    expect(pageTitle({ companyName: 'Acme' }, { title: 'About' })).toBe('About — Acme')
    expect(pageTitle({ companyName: 'Acme', addressLocality: 'Verona', addressRegion: 'WI', seoTitle: 'acme' }, { home: true })).toBe('Acme, Verona, WI')
  })
})
