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
import { composeInstant } from '../apps/api/src/services/instantComposer.ts'

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

// 4. A bar signup's instant site is the bar's site. Reading the slug right was half of it: the
//    instant composer only wrote hero + "What we do" + contact, the recipe filter then kept home and
//    contact, the facts gate dropped the live menu (an empty list), and the nav had no label for
//    taps/events/parties — so Run 1's site had no Tonight board, /menu, /taps or /visit.
{
  const site = composeInstant({ businessName: 'Test Bar', businessType: 'bar_and_grill', city: 'Eau Claire', state: 'WI', email: 'bar@example.com', services: ['Food & Drinks', 'Beer on Tap'] } as any)
  const types = (slug: string) => (site.pages[slug] || []).map((s: any) => s.type + '/' + s.variant)
  check(types('home')[0] === 'tonight/board', `bar home opens with the Tonight board (got ${types('home').join(', ')})`)
  for (const [slug, want] of [['menu', 'menu/sections'], ['taps', 'taps/wall'], ['events', 'events/list'], ['parties', 'parties/inquiry-form'], ['visit', 'visit/details'], ['visit', 'hours/table']])
    check(types(slug).includes(want), `bar /${slug} has ${want} (got ${types(slug).join(', ') || 'no page'})`)
  check(site.heldPages.length === 0, `no bar page is held (held: ${site.heldPages.join(', ')})`)
  const all = Object.values(site.pages).flat().map((s: any) => s.type)
  check(!all.includes('hero') && !all.includes('services'), 'a bar site has no hero and no "What we do" services block')
  const tonightData = site.pages.home[0]?.data || {}
  check(Object.keys(tonightData).every(k => ['title', 'eyebrow', 'intro', 'asHeading', 'tapsHref', 'menuHref', 'showTaps', 'showRoom'].includes(k)), 'the Tonight board carries framing only')

  const intake = readFileSync(ROOT + 'apps/api/src/routes/factory/intake.ts', 'utf8')
  const labels = intake.match(/const PREMIUM_PAGE_NAV_LABEL[^{]*\{([\s\S]*?)\n\}/)?.[1] || ''
  const order = intake.match(/const order = \[([^\]]*)\]/)?.[1] || ''
  for (const slug of Object.keys(site.pages).filter(s => s !== 'home' && s !== 'contact')) {
    check(new RegExp(`(^|\\s|')${slug}'?:`, 'm').test(labels), `nav label for the bar's /${slug} page`)
    check(order.includes(`'${slug}'`), `/${slug} is in buildPremiumNav's order`)
  }
}

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`trade detect slugs: ${passed} checks passed`)
