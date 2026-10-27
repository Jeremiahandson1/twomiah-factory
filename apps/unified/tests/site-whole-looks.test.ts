// A design is a row of SITE_DESIGN_SPECS (server/core/vertical.ts): how it is built ('whole' = a complete look over the
// base as a CSS layer) and whether the page wears a frame (the bar's leather book). The two used to be one idea
// ("cover"), so a new whole look would have inherited the book. This holds them apart, and holds each whole look to the
// rules the new contractor looks (foundry, heritage, studio) were built on.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SITE_DESIGNS, SITE_DESIGN_SPECS } from '../server/core/vertical.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { renderSections } from '../server/site/render.ts'

const DESIGNS_DIR = path.resolve(import.meta.dir, '..', 'site', 'designs')
const SERVER_DIR = path.resolve(import.meta.dir, '..', 'server')
const WHOLE = SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].build === 'whole')
const NO_FRAME = WHOLE.filter((d) => !SITE_DESIGN_SPECS[d].frame)
const ctx = (design: string, brand = '#b45309'): any => {
  const spec = (SITE_DESIGN_SPECS as any)[design]
  return {
    companyId: 'c', slug: 's', design, features: [], words: { contactAddressLabel: 'Office', contactMessageLabel: 'Message', contactMessageRequired: 'x' },
    settings: { companyName: 'Westridge', phone: '608-555-0142', email: 'a@b.example', nav: [{ label: 'Contact', href: 'contact' }], contactCtaLabel: 'Go', accentColor: '#0e7490' },
    options: { textSizeToggle: false, shop: false, cover: spec.frame === 'book', fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: { primary: brand, accent: '#0e7490', secondary: '#1e3a5f' },
  }
}

describe('a whole look and the book frame are two separate settings', () => {
  test('only the bar has the book frame; every whole look has a stylesheet of its own', () => {
    expect(SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].frame === 'book')).toEqual(['bar'])
    for (const d of WHOLE) expect([d, fs.existsSync(path.join(DESIGNS_DIR, d + '.css'))]).toEqual([d, true])
    for (const d of SITE_DESIGNS) expect(SITE_DESIGN_SPECS[d].label.length).toBeGreaterThan(2)
  })

  test('nothing in the server chooses by a design\'s name: the rows decide', () => {
    const names = SITE_DESIGNS.filter((d) => d !== 'classic')
    for (const f of fs.readdirSync(SERVER_DIR, { recursive: true }) as string[]) {
      if (!f.endsWith('.ts') || f.endsWith('vertical.ts')) continue
      const src = fs.readFileSync(path.join(SERVER_DIR, f), 'utf8')
      for (const n of names) expect([f, n, new RegExp(`design\\s*(===|!==|==)\\s*'${n}'`).test(src)]).toEqual([f, n, false])
    }
  })

  test('a whole look without the frame is laid over the base as a layer, and its page has no leather book', async () => {
    for (const d of NO_FRAME) {
      const css = siteStylesheet(ctx(d))
      expect(css.startsWith('@layer base {')).toBe(true)
      const html = await renderSections(ctx(d), [{ type: 'hero', variant: 'centered-stats', data: { title: 'T', stats: [{ value: '1', label: 'a' }] } }], { title: 'Home' }, { currentPath: '/', origin: 'https://x.example', facts: null })
      expect(html).not.toContain('class="cover"')
      expect(html).not.toContain('data-theme=')
      expect(html).not.toContain('/styles/fonts.css')
      // its own type, in place of the base's Inter and Fraunces
      expect(html).toContain(encodeURI(SITE_DESIGN_SPECS[d].fonts!).replace(/&/g, '&amp;').slice(0, 40))
      expect(html).not.toContain('family=Fraunces')
      expect(html).toContain('<meta name="color-scheme" content="light dark">')
    }
  })

  test('the bar still wears its frame', async () => {
    const html = await renderSections(ctx('bar'), [{ type: 'hero', variant: 'centered-stats', data: { title: 'T' } }], { title: 'Home' }, { currentPath: '/', origin: 'https://x.example', facts: null })
    expect(html).toContain('class="cover"')
  })
})

describe('each whole look is built for any brand colour, light and dark', () => {
  for (const d of NO_FRAME) {
    test(`${d}: every colour token is filled, and it restyles for dark`, () => {
      for (const brand of ['#b45309', '#facc15', '#0b3d2e', '#ffffff']) {
        expect([d, brand, /\{\{[A-Z_]+\}\}/.test(siteStylesheet(ctx(d, brand)))]).toEqual([d, brand, false])
      }
      const raw = fs.readFileSync(path.join(DESIGNS_DIR, d + '.css'), 'utf8')
      expect(raw).toMatch(/@media \(prefers-color-scheme: dark\)/)
      // the owner's colour as TEXT only through its readable forms, never the raw fill
      expect(raw).not.toMatch(/(^|[^-])color:\s*\{\{(PRIMARY|ACCENT)_COLOR\}\}/m)
      // every fill of the owner's colour carries the ink that reads on it
      for (const rule of raw.replace(/\{\{[A-Z_]+\}\}/g, (t) => t.replace(/[{}]/g, '#')).matchAll(/\{([^{}]*)\}/g)) {
        const body = rule[1]
        if (/(^|[;\s])background:\s*##PRIMARY_COLOR##/.test(body) && /(^|[;\s])color:/.test(body)) expect(body).toMatch(/(^|[;\s])color:\s*(##INK_ON_PRIMARY##|#ffffff|transparent|var\(--on-brand\))/)
      }
    })
  }
})

describe('what the looks survey found (2026-10-27) stays fixed', () => {
  const blocks = (sheet: string, selector: string) => [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]).join(';')

  test('the menu, week strip, deals strip and catering form have their own padding, in every design', () => {
    for (const d of SITE_DESIGNS) {
      const sheet = siteStylesheet(ctx(d))
      expect([d, /padding:\s*var\(--space\)\s+0/.test(blocks(sheet, '.menu--cards, .schedule--strip, .deals--strip, .catering--inquiry'))]).toEqual([d, true])
    }
  })

  test('the text-size buttons are fixed at the bottom, never over the header\'s buttons at the top', () => {
    for (const d of SITE_DESIGNS) {
      const rule = blocks(siteStylesheet(ctx(d)), '.text-size-toggle')
      expect([d, /bottom:\s*16px/.test(rule), /\btop:/.test(rule)]).toEqual([d, true, false])
    }
  })

  test('the ZIP box and the financing slider cannot push their neighbours off a phone, or vanish in dark', () => {
    for (const d of SITE_DESIGNS) {
      const sheet = siteStylesheet(ctx(d))
      expect([d, /\.sa-input\s*\{\s*min-width:\s*0;?\s*\}/.test(sheet)]).toEqual([d, true])
    }
    const shared = siteStylesheet(ctx('heritage'))
    expect(shared).toMatch(/\.financing input\[type="range"\]::-webkit-slider-thumb\s*\{\s*background:\s*#ffffff/)
  })

  test('the care finder\'s five steps fit a phone: only the current step keeps its label', () => {
    for (const d of SITE_DESIGNS) {
      const flat = siteStylesheet(ctx(d)).replace(/\s+/g, ' ')
      expect([d, /\.cf-progress__step:not\(\.is-current\)\s*\{[^}]*font-size:\s*0/.test(flat)]).toEqual([d, true])
    }
  })

  test('the shared sheet reaches the frameless whole looks and no other design', () => {
    for (const d of SITE_DESIGNS) {
      const has = siteStylesheet(ctx(d)).includes('--brand-text:')
      expect([d, has]).toEqual([d, NO_FRAME.includes(d)])
    }
  })

  test('brand colour as text and white-on-dark-bar are given the forms that read, for any brand colour', () => {
    for (const brand of ['#facc15', '#0b3d2e', '#ffffff', '#b45309']) {
      const sheet = siteStylesheet(ctx('heritage', brand))
      expect(sheet).not.toMatch(/\{\{[A-Z_]+\}\}/)
      // price / date / chip text never uses the raw fill
      const flat = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
      expect(flat).toMatch(/\.menu-item__price[^{}]*\.schedule-strip__date[^{}]*\{\s*color:\s*var\(--brand-text\);\s*\}/)
      expect(blocks(sheet, '.storm-alert__heading, .storm-alert__close:hover, .emergency-bar__heading')).toContain('#ffffff')
    }
  })
})
