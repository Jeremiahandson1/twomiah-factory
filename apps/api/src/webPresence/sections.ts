// What each trade's Web presence editor offers — the ONE table (owner-approved 2026-10-29, a fixed rule, not a judgement call).
//
//   Everyone        hero, about, what we do, gallery, reviews, hours, service area, contact, social links, announcement ticker,
//                   and the two forms (lead capture, now hiring)
//   Food truck      + today's spot, saved places, schedule/events, menu, order-ahead link
//   Restaurant/café + menu, events, order-ahead or delivery link
//   Bar             + events, menu/specials
//   Salon / spa     + service menu with prices, team
//   Contractors, roofing, landscaping, field trades   + project gallery (before/after), service area check, partners wall
//   Home care       + "how care works" steps (service area is everyone's) — never medical wording
//   Shop            + featured products (pictures and a visit/call link — no checkout)
//
// Rules this file keeps:
//   1. A trade's extra sections exist ONLY for that trade (a roofer is never offered today's spot).
//   2. The table is keyed by the SAME `Vertical` the full product routes on (config/industryRouting.ts verticalFor), as a
//      Record<Vertical, …> — adding a vertical there fails the type check here until it has a row, so the two cannot drift.
//   3. The AI's first site uses only the trade's sections (composeOnePage filters through sectionAllowed).
//   4. Changing the trade changes what can be ADDED; nothing already on the page is removed (keepsExisting).
//
// The lookup is `extrasFor(vertical)`; everything else (offered list, allowed test, composer filter) is derived from it, so a
// mutation of the lookup is caught by the tests (tests/unified/factory/web-presence-sections.test.ts).
import { verticalFor, type Vertical } from '../config/industryRouting.ts'

/** One thing an owner can put on the page. `type`/`variant` are the unified renderer's section library — never a second template. */
export type Capability = {
  id: string
  label: string
  /** The renderer's section type and its default variant (the owner can change the layout within the compatibility table). */
  type: string
  variant: string
  /** The in-page anchor: the page's menu links to #anchor — there are no other pages. */
  anchor: string
  /** At most one on the page (true for everything but the gallery-like sections an owner may repeat — none, today). */
  single: true
  /** The word in the page's menu for this section; none = not in the menu. The menu holds the first six, in page order. */
  nav?: string
}

const cap = (id: string, label: string, type: string, variant: string, anchor = id, nav?: string): Capability =>
  ({ id, label, type, variant, anchor, single: true, ...(nav ? { nav } : {}) })

// ─── Everyone ──────────────────────────────────────────────────────────────
// `hero/split-form` is left out on purpose: it carries its own lead form, and the lead form here is the contact section's,
// switched on and off by the owner.
export const EVERYONE: readonly Capability[] = [
  cap('hero', 'Top of the page', 'hero', 'split', 'top'),
  cap('about', 'About us', 'about', 'story', 'about', 'About'),
  cap('services', 'What we do', 'services', 'cards-grid', 'services', 'Services'),
  cap('gallery', 'Photos', 'gallery', 'grid', 'gallery', 'Photos'),
  cap('reviews', 'Reviews', 'testimonials', 'quotes', 'reviews', 'Reviews'),
  cap('hours', 'Hours', 'hours', 'simple', 'hours', 'Hours'),
  cap('serviceArea', 'Where we work', 'map', 'area', 'area', 'Where'),
  cap('contact', 'Contact', 'contact', 'form-info', 'contact', 'Contact'),
  cap('social', 'Social links', 'social', 'links'),
  cap('ticker', 'Announcement bar', 'banner', 'announcement', 'announcement'),
  cap('hiring', 'Now hiring', 'hiring', 'form', 'hiring', 'Jobs'),
]

// ─── The trades' extras ────────────────────────────────────────────────────
const MENU = cap('menu', 'Menu', 'menu', 'cards', 'menu', 'Menu')
const EVENTS = cap('events', 'Events', 'events', 'dated', 'events', 'Events')
const ORDER = cap('orderLink', 'Order ahead', 'cta', 'banner', 'order')

const TRADE_EXTRAS = {
  foodTruck: [cap('todaysSpot', "Today's spot", 'spot', 'today', 'today', 'Today'), cap('savedPlaces', 'Where to find us', 'spot', 'places', 'places'), EVENTS, MENU, ORDER],
  restaurant: [MENU, EVENTS, ORDER],
  bar: [EVENTS, MENU, cap('specials', 'Specials', 'deals', 'strip', 'specials')],
  salon: [cap('serviceMenu', 'Services and prices', 'pricing', 'flat-rate-menu', 'prices', 'Prices'), cap('team', 'Our team', 'team', 'grid', 'team', 'Team')],
  trades: [
    cap('projectGallery', 'Our work, before and after', 'before_after', 'slider', 'work', 'Our work'),
    cap('serviceAreaCheck', 'Do we cover you?', 'service_area', 'zip-check', 'coverage'),
    cap('partners', 'Partners and suppliers', 'partners', 'wall'),
  ],
  homeCare: [cap('howCareWorks', 'How care works', 'steps', 'list', 'how', 'How it works')],
  shop: [cap('featuredProducts', 'Featured products', 'products', 'featured', 'products', 'Products')],
  none: [],
} as const satisfies Record<string, readonly Capability[]>

/**
 * The table: the trade setting the full product uses (Vertical) → the extras that trade's editor adds to EVERYONE's.
 * Exhaustive by type: a new Vertical without a row does not compile.
 *   - events runs as a restaurant in the full product (UNIFIED_VERTICAL_OF), so it gets the restaurant row.
 *   - dispensary, rv, veterinary, showcase, basic: everyone's sections only (no extras were approved for them).
 */
export const EXTRAS_BY_VERTICAL: Readonly<Record<Vertical, readonly Capability[]>> = {
  foodtruck: TRADE_EXTRAS.foodTruck,
  events: TRADE_EXTRAS.restaurant,
  bar: TRADE_EXTRAS.bar,
  salon: TRADE_EXTRAS.salon,
  contractor: TRADE_EXTRAS.trades,
  roofing: TRADE_EXTRAS.trades,
  landscaping: TRADE_EXTRAS.trades,
  fieldservice: TRADE_EXTRAS.trades,
  homecare: TRADE_EXTRAS.homeCare,
  store: TRADE_EXTRAS.shop,
  basic: TRADE_EXTRAS.none,
  showcase: TRADE_EXTRAS.none,
  dispensary: TRADE_EXTRAS.none,
  rv: TRADE_EXTRAS.none,
  veterinary: TRADE_EXTRAS.none,
}

/** The key the table is read by: the Vertical the full product routes the industry to (a restaurant, café or bakery is 'events'). */
export const tradeKey = (industry: string | null | undefined): Vertical => verticalFor(industry)

/** THE lookup. Everything below derives from it. */
export function extrasFor(vertical: Vertical): readonly Capability[] {
  return EXTRAS_BY_VERTICAL[vertical] ?? []
}

/** Exactly what this trade's editor offers: everyone's, then the trade's own. */
export function offeredFor(vertical: Vertical): Capability[] {
  return [...EVERYONE, ...extrasFor(vertical)]
}

/** Whether a section (type/variant's type) is one this trade may be offered. */
export function sectionAllowed(vertical: Vertical, type: string): boolean {
  return offeredFor(vertical).some((c) => c.type === type)
}

/** The capability a section type belongs to, for this trade. */
export function capabilityOf(vertical: Vertical, type: string): Capability | null {
  return offeredFor(vertical).find((c) => c.type === type) ?? null
}

/** Every section type any trade's extras add — a type outside EVERYONE that only some trades are offered. */
export function tradeOnlyTypes(): Set<string> {
  const everyone = new Set(EVERYONE.map((c) => c.type))
  const out = new Set<string>()
  for (const rows of Object.values(EXTRAS_BY_VERTICAL)) for (const c of rows) if (!everyone.has(c.type)) out.add(c.type)
  return out
}

/** The composer's filter (rule 3): keep only sections this trade is offered; the order is kept. */
export function onlyAllowed<T extends { type: string }>(vertical: Vertical, sections: readonly T[]): T[] {
  return sections.filter((s) => sectionAllowed(vertical, s.type))
}

/**
 * Rule 4. A trade change updates what can be ADDED; nothing already on the page goes. Returns the sections unchanged, and
 * names the ones the NEW trade would not offer (the editor shows them as "kept — can't be added again", never deletes them).
 */
export function afterTradeChange<T extends { type: string }>(newVertical: Vertical, sections: readonly T[]): { sections: T[]; keptOutsideTrade: string[] } {
  return {
    sections: [...sections],
    keptOutsideTrade: [...new Set(sections.filter((s) => !sectionAllowed(newVertical, s.type)).map((s) => s.type))],
  }
}

/** The two forms the plan has. Each is the owner's switch; off means absent from the page and refused at the endpoint. */
export const FORMS = ['lead', 'hiring'] as const
export type FormId = (typeof FORMS)[number]
