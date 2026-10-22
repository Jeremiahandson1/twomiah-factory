// The public site at phone width (live test 2026-10-22: the contractor site ran off the side at 390px). Measured in
// headless Edge with real phone emulation across every vertical and design: two things ran past the screen — the
// footer's contact row (one unbreakable flex row, on every design) and the bar design's name (nowrap, pushing the
// menu button off). A test cannot lay out a page, so this pins the rules that fixed both in every design's stylesheet.
import { describe, test, expect } from 'bun:test'
import { siteStylesheet } from '../server/site/routes.ts'
import { SITE_DESIGNS } from '../server/core/vertical.ts'

const css = (design: string, cover = false) => siteStylesheet({ design, colours: { primary: '#1d4ed8', accent: null, secondary: null }, options: { cover, shop: false } } as any)
/** Every declaration block for a selector, comments out. */
const blocks = (sheet: string, selector: string) => [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2])

describe('nothing runs off a phone screen', () => {
  for (const design of SITE_DESIGNS) {
    test(`${design}: the footer's contact row wraps, each item at most the row's width`, () => {
      const sheet = css(design, design === 'bar')
      expect(blocks(sheet, '.footer-contact').join(';')).toMatch(/flex-wrap:\s*wrap/)
      expect(blocks(sheet, '.footer-contact > *').join(';')).toMatch(/max-width:\s*100%/)
      expect(blocks(sheet, '.footer-contact a').join(';')).toMatch(/overflow-wrap:\s*anywhere/)
      // No design sets the row back to one line.
      expect(blocks(sheet, '.footer-contact').join(';')).not.toMatch(/flex-wrap:\s*nowrap/)
    })
  }

  test('bar: below 640px the name may take two lines, so the menu button stays on screen', () => {
    const sheet = css('bar', true)
    const phone = [...sheet.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    expect(phone).toMatch(/\.brand \{[^}]*white-space: normal[^}]*\}/)
    expect(phone).toMatch(/\.mobile-nav-toggle \{[^}]*flex-shrink: 0/)
  })
})
