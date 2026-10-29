// Section layouts (server/site/layouts.ts, site/views/sections/*): the compatibility table, every layout rendering for the
// content that offers it, "Change layout" keeping the section's data through draft, publish and undo, and structured data
// untouched by a layout.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SITE_DESIGNS, SITE_DESIGN_SPECS } from '../server/core/vertical.ts'
import { renderSections } from '../server/site/render.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { LAYOUTS, offeredLayouts, layoutFit, KEY_WORDS } from '../server/site/layouts.ts'
import { bootTenant, seedOwner } from './harness.ts'

const SECTIONS_DIR = path.resolve(import.meta.dir, '..', 'site', 'views', 'sections')
const OFF_BAR = SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].tokens !== 'bar')
const IMG = (n: number) => `/hero-library/generic/generic-0${n}.jpg`

// Real-shaped content for each type (what the composers and the editor write), and the bare minimum.
const FULL: Record<string, Record<string, any>> = {
  hero: { eyebrow: 'Roofing · Eau Claire', title: 'Summit Roofing', subtitle: 'Roofs done right.', image: IMG(1), images: [IMG(2), IMG(3), IMG(4)], primaryCta: { label: 'Get a quote', href: '/contact' }, secondaryCta: { label: 'Our work', href: '/projects' }, stats: [{ value: '20', label: 'years' }, { value: '900', label: 'roofs' }] },
  services: { heading: 'What we do', intro: 'Three things.', items: [1, 2, 3, 4].map((n) => ({ title: 'Service ' + n, description: 'About service ' + n, image: IMG(n), href: '/services/s' + n })) },
  testimonials: { heading: 'Kind words', items: [1, 2, 3, 4].map((n) => ({ quote: 'Great work ' + n, author: 'Client ' + n, role: 'Eau Claire', photo: '' })) },
  about: { eyebrow: 'About', title: 'Our story', portrait: IMG(2), paragraphs: ['We started in 2009.', 'We still do.'], signature: 'Sam', stats: [{ value: '15', label: 'crew' }], milestones: [{ year: '2009', text: 'Started' }, { year: '2018', text: 'Second crew' }], items: [{ title: 'Honest', text: 'Always' }] },
  gallery: { heading: 'Recent work', intro: 'Some jobs.', photos: [1, 2, 3, 4].map((n) => ({ url: IMG(n), after: IMG(5 - n), alt: 'Job ' + n, title: 'Job ' + n, location: 'Town ' + n, category: n % 2 ? 'Roofs' : 'Repairs' })) },
  cta: { heading: 'Talk to us', subtitle: 'Free quotes.', primaryCta: { label: 'Call', href: '/contact' }, bullets: ['Free quote', 'Licensed'], image: IMG(1), phone: '608-555-0142', id: 'talk' },
}
const MIN: Record<string, Record<string, any>> = {
  hero: { title: 'Summit Roofing' },
  services: { items: [{ title: 'Roofing' }, { title: 'Repairs' }, { title: 'Gutters' }] },
  testimonials: { items: [{ quote: 'Great.' }] },
  about: { title: 'About', paragraphs: ['A short story.'] },
  gallery: { photos: [{ url: IMG(1) }] },
  cta: { heading: 'Talk to us', primaryCta: { label: 'Call', href: '/contact' } },
}

const ctx = (design: string): any => {
  const spec = (SITE_DESIGN_SPECS as any)[design]
  return {
    companyId: 'c', slug: 's', design, features: [], words: { contactAddressLabel: 'Office', contactMessageLabel: 'How can we help?', contactMessageRequired: 'x' },
    settings: { companyName: 'Westridge', phone: '608-555-0142', email: 'a@b.example', nav: [], contactCtaLabel: 'Go', accentColor: '#0e7490' },
    options: { textSizeToggle: false, shop: false, cover: false, fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: { primary: '#b45309', accent: '#0e7490', secondary: '#1e3a5f' },
  }
}
const render = (design: string, sections: any[]) => renderSections(ctx(design), sections, { title: 'Home' }, { currentPath: '/', origin: 'https://x.example', facts: null })
const HERO = { type: 'hero', variant: 'centered-stats', data: { title: 'T' } }

describe('the table and the views agree', () => {
  for (const [type, defs] of Object.entries(LAYOUTS)) {
    test(`${type}: every layout has a view, and every view is in the table`, () => {
      for (const d of defs) expect(fs.existsSync(path.join(SECTIONS_DIR, type, d.id + '.ejs'))).toBe(true)
      const onDisk = fs.readdirSync(path.join(SECTIONS_DIR, type)).filter((f) => f.endsWith('.ejs')).map((f) => f.replace(/\.ejs$/, ''))
      for (const v of onDisk) expect(defs.map((d) => d.id)).toContain(v)
    })
  }
  test('the layout counts the owner asked for', () => {
    expect(LAYOUTS.hero.length).toBe(6)
    expect(LAYOUTS.gallery.length).toBe(4)
    expect(LAYOUTS.services.length).toBeGreaterThanOrEqual(4)
    expect(LAYOUTS.testimonials.length).toBe(4)
    expect(LAYOUTS.about.length).toBeGreaterThanOrEqual(4)
  })
})

describe('a layout is offered only where its content is', () => {
  test('with nothing in the section, only layouts that need no content are offered (a headline and a button need none)', () => {
    for (const [type, defs] of Object.entries(LAYOUTS)) {
      const offered = offeredLayouts(type, defs[0].id, {}, { takesEnquiries: true }).filter((l) => !l.current)
      for (const l of offered) expect(layoutFit(type, l.id, {})).toBeNull()
      if (!['hero', 'cta'].includes(type)) expect(offered).toEqual([])
    }
  })
  test('before and after: only with a pair on every project', () => {
    const photos = [{ url: IMG(1), after: IMG(2) }, { url: IMG(3) }, { url: IMG(4), after: IMG(5) }]
    expect(offeredLayouts('gallery', 'grid', { photos }).map((l) => l.id)).not.toContain('pairs')
    expect(offeredLayouts('gallery', 'grid', { photos: photos.map((p) => ({ ...p, after: IMG(1) })) }).map((l) => l.id)).toContain('pairs')
  })
  test('project cards: only when every photo is titled', () => {
    expect(offeredLayouts('gallery', 'grid', { photos: [{ url: IMG(1), title: 'A' }, { url: IMG(2) }, { url: IMG(3), title: 'C' }] }).map((l) => l.id)).not.toContain('projects')
    expect(offeredLayouts('gallery', 'grid', { photos: [{ url: IMG(1), title: 'A' }, { url: IMG(2), caption: 'B' }] }).map((l) => l.id)).toContain('projects')
  })
  test('the collage needs the hero photo and two more; the form hero only where the site takes enquiries', () => {
    expect(offeredLayouts('hero', 'full-bleed', { title: 'T', image: IMG(1), images: [IMG(2)] }).map((l) => l.id)).not.toContain('collage')
    expect(offeredLayouts('hero', 'full-bleed', FULL.hero).map((l) => l.id)).toContain('collage')
    expect(offeredLayouts('hero', 'full-bleed', FULL.hero, { takesEnquiries: false }).map((l) => l.id)).not.toContain('split-form')
  })
  test('the timeline only with milestones; a full-width portrait only with a portrait', () => {
    expect(offeredLayouts('about', 'story', MIN.about).map((l) => l.id)).toEqual(['story'])
    expect(offeredLayouts('about', 'story', FULL.about).map((l) => l.id)).toEqual(expect.arrayContaining(['feature', 'timeline']))
  })
  test('a layout for some trades is offered to those trades only', () => {
    LAYOUTS.services.push({ id: 'only-here', label: 'x', blurb: 'x', shows: ['items'], trades: ['roof'] })
    try {
      expect(offeredLayouts('services', 'cards-grid', FULL.services, { trade: 'roof' }).map((l) => l.id)).toContain('only-here')
      expect(offeredLayouts('services', 'cards-grid', FULL.services, { trade: 'vet' }).map((l) => l.id)).not.toContain('only-here')
    } finally { LAYOUTS.services.pop() }
  })
  test("the bar's own design keeps its layouts: nothing else is offered on it", () => {
    expect(offeredLayouts('hero', 'full-bleed', FULL.hero, { spec: SITE_DESIGN_SPECS.bar }).map((l) => l.id)).toEqual(['full-bleed'])
  })
  test('layoutFit agrees with what is offered', () => {
    expect(layoutFit('gallery', 'pairs', FULL.gallery)).toBeNull()
    expect(layoutFit('gallery', 'pairs', MIN.gallery)).toContain('before')
  })
})

describe('nothing is dropped without saying so', () => {
  test('a layout that does not draw something the section has says so, and every such key has words', () => {
    for (const [type, defs] of Object.entries(LAYOUTS)) {
      for (const from of defs) {
        const offered = offeredLayouts(type, from.id, FULL[type], { takesEnquiries: true })
        for (const l of offered.filter((x) => !x.current)) {
          const def = defs.find((d) => d.id === l.id)!
          const known = new Set([...def.shows, 'heading', 'title', 'id', 'intro', 'imageAlt', 'flip', 'primaryCta'])
          for (const k of Object.keys(FULL[type])) if (!known.has(k)) expect(KEY_WORDS[k]).toBeTruthy()
          // the photo is the commonest loss: said, not silent
          if (type === 'hero' && !def.shows.includes('image')) expect(l.hides).toContain('the photo')
        }
      }
    }
  })
  test('switching away and back leaves the data exactly as it was', () => {
    for (const [type, defs] of Object.entries(LAYOUTS)) {
      const before = JSON.stringify(FULL[type])
      const data = JSON.parse(before)
      for (const d of defs) { offeredLayouts(type, d.id, data); render('classic', [HERO, { type, variant: d.id, data }]) }
      expect(JSON.stringify(data)).toBe(before)
    }
  })
})

describe('every offered layout renders, in every look, with full and with missing content', () => {
  for (const design of OFF_BAR) {
    test(design, async () => {
      for (const [type, defs] of Object.entries(LAYOUTS)) {
        for (const content of [FULL[type], MIN[type]]) {
          const offered = offeredLayouts(type, defs[0].id, content, { takesEnquiries: true }).map((l) => l.id)
          for (const id of new Set([defs[0].id, ...offered])) {
            const html = await render(design, [HERO, { type, variant: id, data: content }])
            expect(html).not.toContain('[object Object]')
            expect(html).not.toContain('undefined')
            expect(html.length).toBeGreaterThan(500)
            // it drew something of its own: more than the hero alone
            expect(html.length).toBeGreaterThan((await render(design, [HERO])).length + 150)
          }
        }
      }
    })
  }
  test('the layouts have styles in every look but the bar, and none in the bar', () => {
    for (const design of SITE_DESIGNS) {
      const css = siteStylesheet({ ...ctx(design), colours: { primary: '#b45309', accent: null, secondary: null, page: null, band: null } })
      if (SITE_DESIGN_SPECS[design].tokens === 'bar') expect(css).not.toContain('.hero-collage')
      else for (const c of ['.hero-collage', '.gallery-masonry', '.svc-tile', '.quote-wall', '.timeline-list']) expect(css).toContain(c)
    }
  })
  test('they use the shared tokens, not colours of their own', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dir, '..', 'site', 'layouts.css'), 'utf8')
    const stripped = css.replace(/rgba\(0, ?0, ?0, ?\.72\)|#fff\b/g, '') // the Before/After label sits on a photo: white on black
    expect(stripped).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(css).toContain('@container')
  })
})

describe('Change layout through the real server: draft, publish, undo', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let token = ''
  const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  const services = { heading: 'What we do', items: FULL.services.items }
  beforeAll(async () => {
    t = await bootTenant()
    const seeded = await seedOwner(t)
    token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    await t.db.insert(t.schema.website).values({ companyId: seeded.company.id, tagline: 'Live' })
    await t.db.insert(t.schema.page).values({ companyId: seeded.company.id, slug: 'home', title: 'Home', isPublished: true, sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Hello' } }, { type: 'services', variant: 'cards-grid', data: services }] })
  })
  const sectionsNow = async () => { const j = await (await as('/api/site/pages/home')).json(); return (j.draft ?? j).sections }
  test('the editor is told which layouts suit the section, and what each leaves out', async () => {
    const r = await (await as('/api/site/layouts', { method: 'POST', json: { type: 'services', variant: 'cards-grid', data: services } })).json()
    expect(r.layouts.map((l: any) => l.id)).toEqual(expect.arrayContaining(['cards-grid', 'alternating', 'list', 'tiles', 'featured']))
    expect(r.layouts.find((l: any) => l.id === 'list').hides).toContain('the service photos')
    expect(r.layouts.find((l: any) => l.id === 'cards-grid').current).toBe(true)
    expect((await as('/api/site/layouts', { method: 'POST', json: { nope: 1 } })).status).toBe(400)
  })
  test('a thumbnail is the section drawn in that layout, by the site itself', async () => {
    const posted = await (await as('/api/site/preview/layout/home', { method: 'POST', json: { section: { type: 'services', data: services }, variant: 'tiles' } })).json()
    const html = await (await as(posted.url)).text()
    expect(html).toContain('svc-tiles')
    expect(html).toContain('Service 1')
    expect(html).toContain('data-layout-thumb')
  })
  test('switching saves a draft with the data untouched; the live page changes only on Publish; undo is the same switch back', async () => {
    const live = await (await t.call('/')).text()
    expect(live).toContain('services--cards')
    const before = await sectionsNow()
    const switched = before.map((s: any) => s.type === 'services' ? { ...s, variant: 'tiles' } : s)
    expect((await as('/api/site/pages/home', { method: 'PATCH', json: { sections: switched } })).status).toBe(200)
    // a draft: visitors still see the old layout
    expect(await (await t.call('/')).text()).toContain('services--cards')
    // and the data is exactly what it was
    const draft = await sectionsNow()
    expect(draft.find((s: any) => s.type === 'services').variant).toBe('tiles')
    expect(draft.find((s: any) => s.type === 'services').data).toEqual(before.find((s: any) => s.type === 'services').data)
    expect((await as('/api/site/pages/home/publish', { method: 'POST', json: {} })).status).toBe(200)
    const nowLive = await (await t.call('/')).text()
    expect(nowLive).toContain('services--tiles')
    expect(nowLive).toContain('Service 4')
    // undo: back to the previous layout, nothing lost
    const back = (await sectionsNow()).map((s: any) => s.type === 'services' ? { ...s, variant: 'cards-grid' } : s)
    await as('/api/site/pages/home', { method: 'PATCH', json: { sections: back } })
    await as('/api/site/pages/home/publish', { method: 'POST', json: {} })
    expect(await (await t.call('/')).text()).toContain('services--cards')
    expect((await sectionsNow()).find((s: any) => s.type === 'services').data).toEqual(before.find((s: any) => s.type === 'services').data)
  })
  test('structured data does not change with the layout', async () => {
    const ld = (h: string) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('|')
    const base = ld(await (await t.call('/')).text())
    for (const variant of ['alternating', 'list', 'tiles', 'featured']) {
      const s = (await sectionsNow()).map((x: any) => x.type === 'services' ? { ...x, variant } : x)
      await as('/api/site/pages/home', { method: 'PATCH', json: { sections: s } })
      await as('/api/site/pages/home/publish', { method: 'POST', json: {} })
      expect(ld(await (await t.call('/')).text())).toBe(base)
    }
  })
})
