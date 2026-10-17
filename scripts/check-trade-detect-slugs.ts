// CI guard: a stored industry slug reads as the same trade as its words.
//
// Test Bar Run 1 (2026-10-17) was stored as industry 'bar_and_grill', and deploy hands tenant.industry
// to the composer as businessType. tradeFlagsFor's lone words (bar, pub, vet, rv, spa...) sit inside
// \b...\b, and \b treats '_' as a word character — so 'bar_and_grill' matched no trade, the composer
// wrote the generic service-business pages (hero, "Services", "What we do"), and the bar's Tonight
// board, /menu, /taps and /visit never existed. vet_clinic, rv_dealer, sports_bar, carpet_cleaning
// and ~40 more slugs had the same hole. check-composer-facts tried only spelled-out names
// ("bar & grill"), which is why nothing caught it.
//
//   bun scripts/check-trade-detect-slugs.ts
import { readFileSync } from 'node:fs'
import { tradeFlagsFor } from '../apps/api/src/config/tradeDetect.ts'
import { pageRecipesFor } from '../apps/api/src/services/sectionComposer.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
let passed = 0
const check = (ok: boolean, m: string) => { if (ok) passed++; else { failed++; console.error('FAIL: ' + m) } }
const on = (bt: string) => Object.entries(tradeFlagsFor(bt)).filter(([, v]) => v).map(([k]) => k).join('+') || '(none)'
const pages = (bt: string) => Object.keys(pageRecipesFor(bt)).sort().join(',')

// 1. Every slug industryRouting knows reads the same as its spelled-out words.
const routing = readFileSync(ROOT + 'apps/api/src/config/industryRouting.ts', 'utf8')
const slugs = [...new Set([...routing.matchAll(/'([a-z0-9]+(?:_[a-z0-9]+)+)'/g)].map(m => m[1]))]
check(slugs.length > 50, `found the industry slugs in industryRouting.ts (${slugs.length})`)
for (const s of slugs) {
  const spaced = s.replace(/_/g, ' ')
  check(on(s) === on(spaced), `'${s}' reads as ${on(s)} but '${spaced}' reads as ${on(spaced)}`)
}

// 2. The slugs that were broken get their trade's pages.
const BAR_PAGES = pages('tavern')
check(BAR_PAGES.includes('taps') && BAR_PAGES.includes('visit') && BAR_PAGES.includes('menu'), 'bar recipes have menu, taps and visit pages')
for (const s of ['bar_and_grill', 'bar_grill', 'sports_bar', 'wine_bar', 'dive_bar', 'cocktail_bar']) check(pages(s) === BAR_PAGES, `${s}: composed with the bar pages (got ${pages(s)})`)
for (const s of ['vet_clinic', 'veterinary_hospital']) check(pages(s) === pages('veterinary clinic') && pages(s).includes('team'), `${s}: composed with the vet pages`)
for (const s of ['rv_dealer', 'boat_dealership']) check(pages(s).includes('inventory'), `${s}: composed with the dealer pages`)

// 3. Reading '_' as a space must not pull a trade into the wrong one.
check(tradeFlagsFor('pool_spa').salon === false && tradeFlagsFor('pool_spa').contractor, 'pool_spa is a build trade, not a salon')
check(tradeFlagsFor('spa_installation').salon === false && tradeFlagsFor('spa_installation').contractor, 'spa_installation is a build trade, not a salon')
check(tradeFlagsFor('day_spa').salon && tradeFlagsFor('med_spa').salon && tradeFlagsFor('spa').salon, 'day/med spas stay salons')
check(pages('blow_dry_bar') === pages('salon'), 'blow_dry_bar gets the salon pages, not the bar pages')
check(pages('nail_bar') === pages('salon') && pages('lash_bar') === pages('salon'), 'nail/lash bars keep the salon pages')
check(!tradeFlagsFor('mobile_kitchen').contractor && !tradeFlagsFor('pop_up_kitchen').contractor, 'a mobile / pop-up kitchen gets no kitchen-remodeler guidance')
check(tradeFlagsFor('kitchen_remodeling').contractor && tradeFlagsFor('kitchen').contractor, 'kitchen remodelers stay contractors')
check(!tradeFlagsFor('juice_bar').bar && !tradeFlagsFor('smoothie_bar').bar, 'juice/smoothie bars are not bars')

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`trade detect slugs: ${passed} checks passed`)
