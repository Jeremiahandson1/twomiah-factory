// The site's type and feel (server/site/feel.ts): a font pairing, corners, buttons, spacing — each changes every design it
// is meant to, takes only the offered choices, and leaves the bar's own look alone.
import { describe, test, expect, beforeAll } from 'bun:test'
import { siteStylesheet } from '../server/site/routes.ts'
import type { SiteContext } from '../server/site/context.ts'
import { SITE_DESIGNS, SITE_DESIGN_SPECS, type SiteDesign } from '../server/core/vertical.ts'
import { cleanStyle, FONT_PAIRS, fontsUrl } from '../server/site/feel.ts'
import { siteColours } from '../server/site/palette.ts'
import { bootTenant, seedOwner } from './harness.ts'

const WORDS = { contactAddressLabel: 'Address', contactMessageLabel: 'How can we help?', contactMessageRequired: 'Please write a short message.' }
function ctxFor(design: SiteDesign, style: unknown): SiteContext {
  const spec = SITE_DESIGN_SPECS[design]
  const s = cleanStyle(style)
  return {
    companyId: 'co', slug: 'co', settings: {}, design, words: WORDS, style: s,
    options: { textSizeToggle: false, shop: false, cover: spec.frame === 'book', fonts: fontsUrl(s, spec), schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: siteColours({ primaryColor: '#b45309', secondaryColor: '#1e3a5f' }, null, null), features: [],
  } as SiteContext
}
const sheet = (design: SiteDesign, style: unknown) => siteStylesheet(ctxFor(design, style))
const OFF_BAR = SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].tokens !== 'bar')

describe('the values', () => {
  test('cleanStyle keeps only the offered choices', () => {
    expect(cleanStyle({ fonts: 'classic', corners: 'round', buttons: 'outline', spacing: 'airy', evil: 1 })).toEqual({ fonts: 'classic', corners: 'round', buttons: 'outline', spacing: 'airy' })
    expect(cleanStyle({ fonts: 'comic-sans', corners: 'pointy', buttons: 'neon', spacing: 'huge' })).toBeNull()
    expect(cleanStyle(null)).toBeNull()
    expect(cleanStyle([])).toBeNull()
  })
  test('every font pair is complete and its stylesheet is Google Fonts', () => {
    expect(new Set(FONT_PAIRS.map((f) => f.id)).size).toBe(FONT_PAIRS.length)
    for (const f of FONT_PAIRS) {
      expect(f.url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true)
      expect(f.url).toContain(f.display.replace(/ /g, '+'))
      expect(f.url).toContain(f.body.replace(/ /g, '+'))
    }
  })
})

describe('what is chosen reaches every design', () => {
  for (const design of OFF_BAR) {
    for (const f of FONT_PAIRS) {
      test(`${design}: ${f.id} fonts are used, and the page loads them`, () => {
        const s = sheet(design, { fonts: f.id })
        expect(s).toContain(`'${f.display}'`)
        expect(s).toContain(`'${f.body}'`)
        expect(fontsUrl(cleanStyle({ fonts: f.id }), SITE_DESIGN_SPECS[design])).toBe(f.url)
      })
    }
    test(`${design}: corners, buttons and spacing each change the sheet`, () => {
      const none = sheet(design, null)
      const round = sheet(design, { corners: 'round' })
      expect(round).not.toBe(none)
      expect(round).toContain('999px !important')
      expect(sheet(design, { corners: 'square' })).toContain('border-radius: 0 !important')
      expect(sheet(design, { buttons: 'outline' })).toContain('background: transparent !important')
      expect(sheet(design, { spacing: 'compact' })).toContain('--space: clamp(40px')
      expect(sheet(design, { spacing: 'airy' })).toContain('--space: clamp(88px')
    })
    test(`${design}: no choice, no rules`, () => {
      expect(sheet(design, null)).not.toContain("the owner's type and feel")
    })
  }
  test("the base's hardcoded Fraunces and Inter are replaced, not left beside the owner's", () => {
    const s = sheet('classic', { fonts: 'strong' })
    expect(s).not.toContain("'Fraunces'")
    expect(s).not.toContain("'Inter'")
  })
  test("the bar keeps its own type and shapes", () => {
    const none = sheet('bar', null)
    expect(sheet('bar', { fonts: 'classic', corners: 'round', buttons: 'outline', spacing: 'airy' })).toBe(none)
    expect(fontsUrl(cleanStyle({ fonts: 'classic' }), SITE_DESIGN_SPECS.bar)).toBe(SITE_DESIGN_SPECS.bar.fonts)
  })
})

describe('through the real server', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let token = ''
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  beforeAll(async () => {
    t = await bootTenant()
    const seeded = await seedOwner(t)
    token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    await t.db.insert(t.schema.website).values({ companyId: seeded.company.id, tagline: 'Live' })
    await t.db.insert(t.schema.page).values({ companyId: seeded.company.id, slug: 'home', title: 'Home', isPublished: true, sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Hello' } }] })
  })
  test('the font pairs are offered', async () => {
    const r = await (await as('/api/site/palettes')).json()
    expect(r.fonts.map((f: any) => f.id)).toEqual(FONT_PAIRS.map((f) => f.id))
  })
  test('a choice that is not offered is refused', async () => {
    for (const style of [{ fonts: 'comic-sans' }, { corners: 'pointy' }, { spacing: 5 }, { evil: 'x' }, ['round']]) {
      expect((await as('/api/site/settings', { method: 'PATCH', json: { style } })).status).toBe(400)
    }
  })
  test('saved is a draft; published, the stylesheet and the page carry it; cleared, it is gone', async () => {
    const saved = await (await as('/api/site/settings', { method: 'PATCH', json: { style: { fonts: 'elegant', corners: 'soft' } } })).json()
    expect(saved.draft.style).toEqual({ fonts: 'elegant', corners: 'soft' })
    expect((await as('/api/site/settings/publish', { method: 'POST', json: {} })).status).toBe(200)
    expect(await (await t.call('/styles/main.css')).text()).toContain("'Cormorant Garamond'")
    expect(await (await t.call('/')).text()).toContain('Cormorant+Garamond')
    await as('/api/site/settings', { method: 'PATCH', json: { style: null } })
    await as('/api/site/settings/publish', { method: 'POST', json: {} })
    expect(await (await t.call('/styles/main.css')).text()).not.toContain("'Cormorant Garamond'")
  })
})

describe('a hollow button reads on a dark header', () => {
  test("foundry's steel header gets a white hollow button; a design with a light header does not", () => {
    expect(sheet('foundry', { buttons: 'outline' })).toContain('.site-header .header-cta { color: #ffffff !important; }')
    expect(sheet('heritage', { buttons: 'outline' })).not.toContain('.site-header .header-cta { color: #ffffff')
  })
})
