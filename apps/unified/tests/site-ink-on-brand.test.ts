// Text on the owner's colour reads, whatever colour they picked (server/core/brandColour.ts inkOn, 2026-10-22): the bar
// design put dark ink on every brand (it assumed gold), and the CTA band's button put the brand's dark shade on the
// accent — on a blue, dark on dark.
import { test, expect } from 'bun:test'
import { inkOn } from '../server/core/brandColour.ts'
import { siteStylesheet } from '../server/site/routes.ts'

test('dark ink on a light colour, white on a dark one', () => {
  expect(inkOn('#d4a017')).toBe('#1A1410')   // gold: the bar's own look stays
  expect(inkOn('#facc15')).toBe('#1A1410')
  expect(inkOn('#1d4ed8')).toBe('#ffffff')   // the owner's blue
  expect(inkOn('#7f1d1d')).toBe('#ffffff')
  expect(inkOn('#f59e0b', '#0f172a')).toBe('#0f172a')
})

test('the stylesheet carries the readable ink and no placeholder is left behind', () => {
  for (const design of ['bar', 'classic', 'roofing']) {
    const css = siteStylesheet({ design, options: {}, colours: { primary: '#1d4ed8', accent: '#1d4ed8' } } as any)
    expect(css).not.toContain('{{')
    if (design === 'bar') expect(css).toMatch(/--on-brand:\s*#ffffff/)
  }
  const base = siteStylesheet({ design: 'classic', options: {}, colours: { primary: '#1d4ed8', accent: '#1d4ed8' } } as any)
  expect(base).toMatch(/\.cta--banner \.btn--primary \{[^}]*color: #ffffff/)
})
