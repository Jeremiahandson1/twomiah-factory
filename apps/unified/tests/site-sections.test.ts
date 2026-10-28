// The new site sections (why-choose, testimonials carousel, map, blog preview, gallery filter, values, call button): each renders
// from the owner's facts in every whole look, renders NOTHING when it has none of them, is offered by the website editor, and
// lays itself out by its own width (a container query) in the base and in every look.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SITE_DESIGNS, SITE_DESIGN_SPECS } from '../server/core/vertical.ts'
import { renderSections } from '../server/site/render.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { offersSection } from '../server/site/admin.ts'
import { findTradeSection } from '../web/src/site/sectionFields.ts'
import { findSectionDef } from '../web/src/site/sectionSchema.ts'

const DESIGNS_DIR = path.resolve(import.meta.dir, '..', 'site', 'designs')
const LOOKS = SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].build === 'whole' && !SITE_DESIGN_SPECS[d].frame)

const ctx = (design: string, over: Record<string, any> = {}): any => {
  const spec = (SITE_DESIGN_SPECS as any)[design]
  return {
    companyId: 'c', slug: 's', design, features: [], words: { contactAddressLabel: 'Office', contactMessageLabel: 'Message', contactMessageRequired: 'x' },
    settings: { companyName: 'Westridge', phone: '608-555-0142', email: 'a@b.example', nav: [], contactCtaLabel: 'Go', accentColor: '#0e7490', ...over },
    options: { textSizeToggle: false, shop: false, cover: false, fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: { primary: '#b45309', accent: '#0e7490', secondary: '#1e3a5f' },
  }
}
const render = (design: string, sections: any[], over: Record<string, any> = {}) =>
  renderSections(ctx(design, over), sections, { title: 'Home' }, { currentPath: '/', origin: 'https://x.example', facts: null })
const HERO = { type: 'hero', variant: 'centered-stats', data: { title: 'T' } }

describe('every look styles every new block, and each block asks its own width', () => {
  // [section class, the container name its base rule declares]
  const BLOCKS: Array<[string, string]> = [['.why-choose', 'why-choose']]
  for (const [cls, name] of BLOCKS) {
    test(cls, () => {
      const base = fs.readFileSync(path.resolve(DESIGNS_DIR, '..', 'public', 'styles', 'main.css'), 'utf8')
      expect(base).toContain(`container: ${name} / inline-size`)
      expect(base).toContain(`@container ${name} (`)
      // no layout of the block by the screen's width
      expect(base.split('\n').filter((l) => l.includes(cls) && /@media \(max-width/.test(l))).toEqual([])
      for (const look of LOOKS) expect([look, fs.readFileSync(path.join(DESIGNS_DIR, look + '.css'), 'utf8').includes(cls)]).toEqual([look, true])
    })
  }
})

describe('why choose us', () => {
  const sec = (items: any[]) => ({ type: 'why_choose', variant: 'grid', data: { heading: 'Why Westridge', items } })
  test('the owner\'s reasons render, in every look, numbered, with their sentence only when given', async () => {
    for (const look of LOOKS) {
      const html = await render(look, [HERO, sec([{ title: 'Licensed and insured', description: 'License on file.' }, { title: 'Free estimates' }])])
      expect(html).toContain('Why Westridge')
      expect(html).toContain('Licensed and insured')
      expect(html).toContain('License on file.')
      expect(html).toContain('Free estimates')
      expect((html.match(/why-choose__desc/g) || []).length).toBe(1)
      expect(html).toContain('>01<')
      expect(html).toContain('>02<')
    }
  })
  test('with no reasons the section renders nothing — never a heading over an empty list', async () => {
    for (const items of [[], [{ title: '' }, { description: 'orphan' }]]) {
      const html = await render('foundry', [HERO, sec(items)])
      expect(html).not.toContain('why-choose')
      expect(html).not.toContain('Why Westridge')
    }
    expect(await render('foundry', [HERO, { type: 'why_choose', variant: 'grid', data: {} }])).not.toContain('Why choose us')
  })
  test('the website editor offers it, with a field for everything the view reads', async () => {
    expect(findTradeSection('why_choose', 'grid')).toBeDefined()
    expect(findSectionDef('why_choose', 'grid')?.defaultData).toMatchObject({ items: [] })
    for (const id of ['contractor', 'roofing', 'homecare', 'store']) expect([id, offersSection('why_choose/grid', await loadVertical(id))]).toEqual([id, true])
    const css = siteStylesheet(ctx('foundry'))
    expect(css).toContain('.why-choose__item')
  })
})
