// The site's colours (server/site/palette.ts): every colour an owner can set changes the site, on every design; the guards
// keep it readable whatever they pick. Born from the owner's report (2026-10-29): "I changed the accent colour, the only
// colour I can change, and I don't see it changed anywhere" — three of the four whole looks never used it.
import { describe, test, expect } from 'bun:test'
import { siteStylesheet } from '../server/site/routes.ts'
import type { SiteContext } from '../server/site/context.ts'
import { SITE_DESIGNS, SITE_DESIGN_SPECS, type SiteDesign } from '../server/core/vertical.ts'
import { cleanHex, cleanPalette, pageTokens, PRESETS, siteColours } from '../server/site/palette.ts'
import { contrastRatio, ensureDark, relLuminance, hexToRgb } from '../server/core/brandColour.ts'

const WORDS = { contactAddressLabel: 'Address', contactMessageLabel: 'How can we help?', contactMessageRequired: 'Please write a short message.' }
const COMPANY = { primaryColor: '#b45309', secondaryColor: '#1e3a5f' }

function ctxFor(design: SiteDesign, accent: string | null, palette: unknown = null): SiteContext {
  const spec = SITE_DESIGN_SPECS[design]
  return {
    companyId: 'co', slug: 'co', settings: {}, design, words: WORDS,
    options: { textSizeToggle: false, shop: false, cover: spec.frame === 'book', fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: siteColours(COMPANY, accent, palette),
    features: [],
  } as SiteContext
}
const sheet = (design: SiteDesign, accent: string | null, palette: unknown = null) => siteStylesheet(ctxFor(design, accent, palette)).toLowerCase()

describe('the values', () => {
  test('cleanHex widens #rgb, lowercases, and refuses what is not a colour', () => {
    expect(cleanHex('#ABC')).toBe('#aabbcc')
    expect(cleanHex('1F6B46')).toBe('#1f6b46')
    for (const bad of ['', 'red', '#12', '#12345', '#gggggg', null, 5, undefined]) expect(cleanHex(bad)).toBeNull()
  })
  test('cleanPalette keeps the known keys, as #rrggbb, and a known preset id', () => {
    expect(cleanPalette({ brand: '#ABC', band: 'nope', page: '#ffffff', preset: 'midnight', evil: 'x' })).toEqual({ brand: '#aabbcc', page: '#ffffff', preset: 'midnight' })
    expect(cleanPalette({ preset: 'not-a-preset' })).toBeNull()
    expect(cleanPalette(null)).toBeNull()
    expect(cleanPalette('#fff')).toBeNull()
  })
  test('the company colour is the brand until the site chooses its own', () => {
    expect(siteColours(COMPANY, null, null).primary).toBe('#b45309')
    expect(siteColours(COMPANY, null, { brand: '#112233' }).primary).toBe('#112233')
    expect(siteColours(COMPANY, '#abcdef', null).accent).toBe('#abcdef')
  })
})

describe('every colour an owner sets changes every design', () => {
  const ACCENT = '#2255cc'
  const OTHER = '#cc2288'
  for (const design of SITE_DESIGNS) {
    test(`${design}: the accent shows, and a different one shows differently`, () => {
      const a = sheet(design, ACCENT)
      expect(a).toContain(ACCENT)
      expect(sheet(design, OTHER)).not.toBe(a)
      // the accent reaches rules of its own, not only a placeholder in the design's own sheet
      expect(a).toContain("the owner's accent")
      expect((a.match(new RegExp(ACCENT, 'g')) || []).length).toBeGreaterThanOrEqual(3)
    })
    test(`${design}: a site that never chose an accent keeps the look it had`, () => {
      expect(sheet(design, null)).not.toContain("the owner's accent")
    })
    test(`${design}: the brand colour changes the sheet`, () => {
      const a = sheet(design, null, { brand: '#aa3311' })
      expect(a).toContain('#aa3311')
      expect(a).not.toBe(sheet(design, null))
    })
    test(`${design}: the dark band follows, and is never light`, () => {
      const a = sheet(design, null, { band: '#334455' })
      expect(a).toContain('#334455')
      // a pale pick comes back dark, so the white text on the band reads
      const pale = sheet(design, null, { band: '#ffffff' })
      expect(pale).not.toContain('--brand-deep: #ffffff')
      expect(pale).not.toMatch(/(--steel|--deep|--panel|--band): #ffffff/)
    })
  }
  for (const design of SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].tokens !== 'bar')) {
    test(`${design}: the page ground changes the page, and its text is worked out`, () => {
      const a = sheet(design, null, { page: '#fdf2f8' })
      expect(a).toContain('#fdf2f8')
      expect(a).toContain('color-scheme: light')
      const d = sheet(design, null, { page: '#101418' })
      expect(d).toContain('#101418')
      expect(d).toContain('color-scheme: dark')
    })
  }
  test('the bar keeps its leather page: a page ground is not applied to it', () => {
    expect(sheet('bar', null, { page: '#fdf2f8' })).not.toContain('#fdf2f8')
  })
})

describe('what the owner picks always reads', () => {
  const pages = ['#ffffff', '#faf4ea', '#fbf5f7', '#f6f3ec', '#f7f2e8', '#131313', '#000000', '#101418', '#fdf2f8', '#c8d6e5', '#808080', '#ffff00', '#0000ff']
  for (const page of [...PRESETS.map((p) => p.page).filter(Boolean) as string[], ...pages]) {
    test(`page ${page}: text 4.5:1 or better, muted text too, on the page and on a leaf of it`, () => {
      const t = pageTokens(page)
      // 7:1 wherever the page allows it (a mid-grey allows about 5.3 at best, and gets it)
      const best = Math.max(contrastRatio('#000000', page), contrastRatio('#ffffff', page))
      expect(contrastRatio(t.tx, t.bg)).toBeGreaterThanOrEqual(Math.min(7, best * 0.99))
      expect(contrastRatio(t.tx, t.sf)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.tx2, t.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.tx3, t.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.tx3, t.sf2)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.tx3, t.sf)).toBeGreaterThanOrEqual(4.5)
    })
  }
  test('a dark band stays dark enough for white text, whatever was picked', () => {
    for (const pick of ['#ffffff', '#ffff00', '#80ffff', '#f59e0b', '#1e3a5f']) expect(contrastRatio(ensureDark(pick), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the presets', () => {
  test('ids are unique and every colour is a #rrggbb', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    for (const p of PRESETS) for (const c of [p.brand, p.accent, p.band, p.page].filter(Boolean) as string[]) expect(cleanHex(c)).toBe(c)
  })
  test('a band is dark already (a preset never relies on the guard) and white on it reads', () => {
    for (const p of PRESETS) {
      expect(relLuminance(hexToRgb(p.band)!)).toBeLessThanOrEqual(0.16)
      expect(contrastRatio(p.band, '#ffffff')).toBeGreaterThanOrEqual(7)
    }
  })
  test('every preset yields a different sheet from none, on every design', () => {
    for (const design of SITE_DESIGNS) {
      const none = sheet(design, null)
      for (const p of PRESETS) expect(sheet(design, p.accent, { brand: p.brand, band: p.band, page: p.page, preset: p.id })).not.toBe(none)
    }
  })
})
