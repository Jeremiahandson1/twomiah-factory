/**
 * lib/schema-org/page.ts — decides which JSON-LD blocks a page ships, from
 * the page's sections and the site data. The business block is on every
 * page; the rest are derived from what is actually rendered so markup and
 * data can never drift.
 */
import { buildBusinessSchema, toJsonLd, type BusinessSettings, type HoursSpec } from './business'
import { buildBreadcrumb, buildFaqSchema, buildMenuSchema, buildMenuItemPageSchema, buildRecurringEventSchema, type MenuSectionRow } from './menu'

export interface PageSection { type?: string; variant?: string; data?: Record<string, any> }

export interface PageJsonLdInput {
  slug: string
  title?: string
  sections: PageSection[]
  settings: BusinessSettings & { companyName?: string | null; siteOrigin?: string | null; timezone?: string | null }
  hoursSchema?: HoursSpec
  menu?: MenuSectionRow[]
  /** Upcoming dated events (for events/list pages). */
  events?: Array<{ slug: string; title: string; description?: string | null; startsAt: Date | string; endsAt?: Date | string | null; imageUrl?: string | null }>
  /** For a signature-item page: the item + its section. */
  item?: { section: MenuSectionRow; item: MenuSectionRow['items'][number] } | null
}

function postalAddress(s: PageJsonLdInput['settings']): object | undefined {
  if (!s.streetAddress && !s.addressLocality) return undefined
  return { '@type': 'PostalAddress', streetAddress: s.streetAddress || undefined, addressLocality: s.addressLocality || undefined, addressRegion: s.addressRegion || undefined, postalCode: s.postalCode || undefined, addressCountry: 'US' }
}

function titleCase(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Returns the concatenated <script type="application/ld+json"> payloads (already serialized, one per block). */
export function pageJsonLd(input: PageJsonLdInput): string {
  const origin = (input.settings.siteOrigin || '').replace(/\/+$/, '')
  const name = input.settings.companyName || 'Bar'
  const blocks: unknown[] = [buildBusinessSchema(input.settings, input.hoursSchema)]

  const has = (type: string, variant?: string) => input.sections.some(s => s.type === type && (!variant || s.variant === variant))

  if (has('menu', 'sections') && input.menu?.length) {
    blocks.push(buildMenuSchema(input.menu, origin, name))
  }
  if (input.item) {
    blocks.push(buildMenuItemPageSchema(input.item.item, input.item.section, origin, name))
  }
  for (const s of input.sections) {
    if (s.type === 'events' && s.variant === 'list' && input.events?.length) {
      for (const ev of input.events.slice(0, 20)) {
        const start = ev.startsAt instanceof Date ? ev.startsAt : new Date(ev.startsAt)
        if (isNaN(start.getTime())) continue
        const end = ev.endsAt ? (ev.endsAt instanceof Date ? ev.endsAt : new Date(ev.endsAt)) : null
        blocks.push({
          '@context': 'https://schema.org', '@type': 'Event', name: ev.title,
          ...(ev.description ? { description: ev.description } : {}),
          ...(ev.imageUrl ? { image: ev.imageUrl } : {}),
          startDate: start.toISOString(), ...(end && !isNaN(end.getTime()) ? { endDate: end.toISOString() } : {}),
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
          location: { '@type': 'Place', name, ...(postalAddress(input.settings) ? { address: postalAddress(input.settings) } : {}) },
          organizer: { '@type': 'Organization', name, ...(origin ? { url: origin } : {}) },
          ...(origin ? { url: origin + '/events#event-' + ev.slug } : {}),
        })
      }
    }
    if (s.type === 'faq' && Array.isArray(s.data?.items)) {
      const faq = buildFaqSchema(s.data!.items)
      if (faq) blocks.push(faq)
    }
    if (s.type === 'events' && s.variant === 'recurring' && s.data?.title && s.data?.day && s.data?.startTime) {
      blocks.push(buildRecurringEventSchema({
        name: s.data.title, description: s.data.description, byDay: s.data.day, startTime: s.data.startTime, endTime: s.data.endTime,
        priceCents: s.data.priceCents, priceLabel: s.data.price, image: s.data.image, url: origin ? origin + '/' + input.slug : undefined,
        timezone: input.settings.timezone || undefined,
      }, { name, address: postalAddress(input.settings), origin: origin || undefined }))
    }
  }

  // Breadcrumbs for anything below the root.
  const parts = input.slug.split('/').filter(Boolean)
  if (parts.length >= 1 && input.slug !== 'home') {
    const crumbs = [{ name: 'Home', path: '/' }]
    let acc = ''
    parts.forEach((p, i) => {
      acc += '/' + p
      const isLast = i === parts.length - 1
      crumbs.push({ name: isLast && input.title ? input.title : titleCase(p), path: acc })
    })
    blocks.push(buildBreadcrumb(origin, crumbs))
  }

  return blocks.map(b => toJsonLd(b)).join('</script>\n<script type="application/ld+json">')
}
