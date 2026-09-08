/**
 * lib/schema-org/menu.ts — typed JSON-LD builders for the menu, single items,
 * breadcrumbs, FAQ pages and recurring events. All read the same rows the
 * HTML renders from, so the structured data can never disagree with the page.
 */

export interface MenuItemRow {
  slug: string
  name: string
  description?: string | null
  priceCents?: number | null
  priceLabel?: string | null
  dietary?: unknown
  imageUrl?: string | null
  heroImageUrl?: string | null
  isSignature?: boolean | null
  is86ed?: boolean | null
  isActive?: boolean | null
}

export interface MenuSectionRow {
  slug: string
  name: string
  description?: string | null
  kind?: string | null
  items: MenuItemRow[]
}

const DIET_MAP: Record<string, string> = {
  V: 'https://schema.org/VegetarianDiet',
  VG: 'https://schema.org/VeganDiet',
  GF: 'https://schema.org/GlutenFreeDiet',
  DF: 'https://schema.org/LowLactoseDiet',
  K: 'https://schema.org/KosherDiet',
  H: 'https://schema.org/HalalDiet',
}

export function priceText(item: { priceCents?: number | null; priceLabel?: string | null }): string {
  if (item.priceLabel) return item.priceLabel
  if (item.priceCents === null || item.priceCents === undefined) return '—'
  return item.priceCents % 100 === 0 ? `$${item.priceCents / 100}` : `$${(item.priceCents / 100).toFixed(2)}`
}

function offer(item: MenuItemRow): object | undefined {
  if (item.priceCents === null || item.priceCents === undefined) return undefined
  return {
    '@type': 'Offer',
    price: (item.priceCents / 100).toFixed(2),
    priceCurrency: 'USD',
    availability: item.is86ed ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
  }
}

function diets(item: MenuItemRow): string[] | undefined {
  const tags = Array.isArray(item.dietary) ? item.dietary.map(String) : []
  const out = tags.map(t => DIET_MAP[t.toUpperCase()]).filter(Boolean)
  return out.length ? out : undefined
}

export function itemUrl(origin: string, section: MenuSectionRow, item: MenuItemRow): string | undefined {
  if (!item.isSignature) return undefined
  const base = origin ? origin.replace(/\/+$/, '') : ''
  return `${base}/${section.slug}/${item.slug}`
}

export function buildMenuItemSchema(item: MenuItemRow, section: MenuSectionRow, origin = ''): Record<string, unknown> {
  const url = itemUrl(origin, section, item)
  return prune({
    '@type': 'MenuItem',
    name: item.name,
    description: item.description || undefined,
    image: item.heroImageUrl || item.imageUrl || undefined,
    offers: offer(item),
    suitableForDiet: diets(item),
    url,
    '@id': url ? url + '#item' : undefined,
  })
}

/** The whole menu — Menu → MenuSection → MenuItem with offers. This is the ballgame. */
export function buildMenuSchema(sections: MenuSectionRow[], origin = '', businessName = ''): Record<string, unknown> {
  const base = origin ? origin.replace(/\/+$/, '') : ''
  return prune({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': base ? base + '/menu#menu' : undefined,
    url: base ? base + '/menu' : undefined,
    name: businessName ? businessName + ' menu' : 'Menu',
    inLanguage: 'en-US',
    hasMenuSection: sections.filter(s => s.items.some(i => i.isActive !== false)).map(s => ({
      '@type': 'MenuSection',
      name: s.name,
      description: s.description || undefined,
      hasMenuItem: s.items.filter(i => i.isActive !== false).map(i => buildMenuItemSchema(i, s, origin)),
    })),
  })
}

/** A standalone MenuItem page (e.g. /burgers/peanut-butter-bacon). */
export function buildMenuItemPageSchema(item: MenuItemRow, section: MenuSectionRow, origin = '', businessName = ''): Record<string, unknown> {
  const base = origin ? origin.replace(/\/+$/, '') : ''
  return {
    '@context': 'https://schema.org',
    ...buildMenuItemSchema(item, section, origin),
    menuAddOn: undefined,
    ...(base ? { isPartOf: { '@type': 'Menu', '@id': base + '/menu#menu', name: businessName ? businessName + ' menu' : 'Menu' } } : {}),
  }
}

export function buildBreadcrumb(origin: string, crumbs: Array<{ name: string; path: string }>): Record<string, unknown> {
  const base = origin ? origin.replace(/\/+$/, '') : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: base ? base + c.path : c.path,
    })),
  }
}

export function buildFaqSchema(items: Array<{ question?: string; q?: string; answer?: string; a?: string }>): Record<string, unknown> | null {
  const list = items.map(i => ({ q: (i.question || i.q || '').trim(), a: (i.answer || i.a || '').trim() })).filter(i => i.q && i.a)
  if (!list.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map(i => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  }
}

export interface RecurringEventInput {
  name: string
  description?: string | null
  /** 'Friday' | 'Fri' | ['Friday','Saturday'] */
  byDay: string | string[]
  /** 'HH:MM' local */
  startTime: string
  endTime?: string | null
  priceCents?: number | null
  priceLabel?: string | null
  image?: string | null
  url?: string | null
  timezone?: string
}

const DAY_URL: Record<string, string> = {
  sunday: 'https://schema.org/Sunday', monday: 'https://schema.org/Monday', tuesday: 'https://schema.org/Tuesday',
  wednesday: 'https://schema.org/Wednesday', thursday: 'https://schema.org/Thursday', friday: 'https://schema.org/Friday', saturday: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday', mon: 'https://schema.org/Monday', tue: 'https://schema.org/Tuesday', wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday', fri: 'https://schema.org/Friday', sat: 'https://schema.org/Saturday',
}

/** A weekly recurring event (Friday fish fry, Tuesday trivia) with an eventSchedule. */
export function buildRecurringEventSchema(ev: RecurringEventInput, business: { name: string; address?: unknown; origin?: string }): Record<string, unknown> {
  const days = (Array.isArray(ev.byDay) ? ev.byDay : [ev.byDay]).map(d => DAY_URL[String(d).toLowerCase()]).filter(Boolean)
  return prune({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.name,
    description: ev.description || undefined,
    image: ev.image || undefined,
    url: ev.url || undefined,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'Place', name: business.name, address: business.address || undefined },
    organizer: { '@type': 'Organization', name: business.name, url: business.origin || undefined },
    eventSchedule: {
      '@type': 'Schedule',
      repeatFrequency: 'P1W',
      byDay: days.length === 1 ? days[0] : days,
      startTime: ev.startTime,
      endTime: ev.endTime || undefined,
      scheduleTimezone: ev.timezone || 'America/Chicago',
    },
    offers: ev.priceCents !== null && ev.priceCents !== undefined
      ? { '@type': 'Offer', price: (ev.priceCents / 100).toFixed(2), priceCurrency: 'USD', availability: 'https://schema.org/InStock' }
      : undefined,
  })
}

function prune<T>(v: T): T {
  if (Array.isArray(v)) return v.map(prune).filter(x => x !== undefined) as unknown as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined || val === null || val === '') continue
      o[k] = prune(val)
    }
    return o as T
  }
  return v
}
