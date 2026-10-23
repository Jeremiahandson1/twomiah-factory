// The small label over the hero photo ("ROOFING · EAU CLAIRE, WI") reads, whatever the brand colour and whatever the
// photo (live test 2026-10-22, roofing and contractor). Measured in headless Edge on the live roofing site: the brand
// colour straight onto the photograph, 1.33:1 median at phone width (1.00 at worst). The label now has its own dark
// ground with white text and the brand as its edge — measured on the built site at 14:1 or better at the 5th
// percentile, every brand colour tried, phone and desktop (fix-g report). This holds the rule in every design.
import { test, expect } from 'bun:test'
import { siteStylesheet } from '../server/site/routes.ts'
import { SITE_DESIGNS } from '../server/core/vertical.ts'

/** The declarations the last `.hero--full-bleed .hero__eyebrow` rule in the stylesheet gives. */
const lastRule = (css: string) => {
  const all = [...css.matchAll(/\.hero--full-bleed \.hero__eyebrow\s*\{([^}]*)\}/g)]
  return all.at(-1)?.[1] ?? ''
}

test('in every design the label over the photo has its own dark ground and white text, for any brand colour', () => {
  for (const design of SITE_DESIGNS) {
    for (const cover of [false, true]) {
      for (const brand of ['#FF3D00', '#facc15', '#1d4ed8', '#ffffff']) {
        const css = siteStylesheet({ design, options: { cover }, colours: { primary: brand, accent: brand } } as any)
        const rule = lastRule(css)
        expect([design, cover, brand, /color:\s*#ffffff/.test(rule)]).toEqual([design, cover, brand, true])
        expect([design, cover, brand, /background:\s*rgba\(\s*1[45],\s*(13|23),\s*(8|42),\s*0\.8\d?\)/.test(rule)]).toEqual([design, cover, brand, true])
      }
    }
  }
})
