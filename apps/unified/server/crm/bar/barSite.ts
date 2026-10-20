// The bar's night, for its website (SiteSettings.facts 'bar'; server/site/facts.ts). Two readers share one set of
// public answers here:
//   · /api/public/bar (barPublicRoutes.ts): the same answers as JSON, for the board's poller and the speakeasy door;
//   · the website's own pages: the `site` bundle every bar section reads (menu, taps, hours, events, the story, the
//     owner's cover art) and the `live` state, read straight from the database for each page.
//
// Moved from templates/website-premium-bar lib/bar.ts, which fetched the five answers from the bar CRM's
// /api/public/bar over HTTP (cached ~20 s) and shaped them into the bundle. The shaping is the same, so a section
// renders what it rendered; what changed is only the road: a read in the same database, fresh each page. A feature the
// owner switched off, or a paused account, gives the same empty answer the CRM's 404/402 gave the site — every section
// then shows its own fallback line, never a 500.
import { and, asc, eq, gte, or } from 'drizzle-orm'
import { accountLockOf } from '@twomiah/tenant-backend'
import { company, barEvent, barMenuSection, barMenuItem, barTap, page, photo } from '../../db/schema/index.ts'
import { formatPrice, PUBLIC_TAP_STATUSES, type BarLive, type LiveState } from './barLive.ts'
import { tapSizes } from './barTapSizes.ts'
import { openingHoursSpecification, specialOpeningHours, EMPTY_HOURS, type DateOverride, type HoursConfig, type WeeklyHours } from './barHours.ts'
import { pageJsonLd } from './schemaOrg/page.ts'
import type { HoursSpec } from './schemaOrg/business.ts'
import type { BarDb } from './db.ts'
import type { SiteFacts, PageFacts, FactsPage } from '../../site/facts.ts'

// ── The public answers (what /api/public/bar serves) ─────────────────────────────────────────────────────────

const featureOn = (co: { enabledFeatures: unknown }, id: string) => {
  let list = co.enabledFeatures as unknown
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = null } }
  return Array.isArray(list) && list.includes(id)
}

const publicItem = (i: typeof barMenuItem.$inferSelect) => ({
  slug: i.slug, name: i.name, description: i.description, priceCents: i.priceCents, priceLabel: i.priceLabel,
  price: i.priceLabel || formatPrice(i.priceCents), dietary: Array.isArray(i.dietary) ? i.dietary : [],
  imageUrl: i.imageUrl, heroImageUrl: i.heroImageUrl, story: i.story, isSignature: i.isSignature, is86ed: i.is86ed,
  variations: (Array.isArray(i.variations) ? i.variations : []).map((v: any) => ({ name: String(v?.name || ''), priceCents: Number(v?.priceCents) || 0 })),
})

/** Why a public answer is refused: no bar yet (404), a paused account (402), the feature off (404). */
export type PublicRefusal = { status: 402 | 404; error: string; code?: string }

export function createBarPublic(db: BarDb, live: BarLive) {
  async function theBar(): Promise<{ id: string; enabledFeatures: unknown; settings: unknown } | null> {
    const [co] = await db.select({ id: company.id, enabledFeatures: company.enabledFeatures, settings: company.settings })
      .from(company).orderBy(asc(company.createdAt)).limit(1)
    return co || null
  }

  /** The company, or why the public may not see this feature's facts. */
  function gate(co: { id: string; enabledFeatures: unknown; settings: unknown } | null, feature: string): { id: string } | PublicRefusal {
    if (!co) return { status: 404, error: 'Not set up yet' }
    if (accountLockOf(co.settings)) return { status: 402, error: 'This bar\'s page is paused', code: 'ACCOUNT_LOCKED' }
    if (!featureOn(co, feature)) return { status: 404, error: 'Not available' }
    return co
  }

  async function menu(companyId: string) {
    const sections: Array<typeof barMenuSection.$inferSelect> = await db.select().from(barMenuSection)
      .where(and(eq(barMenuSection.companyId, companyId), eq(barMenuSection.isActive, true))).orderBy(asc(barMenuSection.sortOrder), asc(barMenuSection.name))
    const items: Array<typeof barMenuItem.$inferSelect> = await db.select().from(barMenuItem)
      .where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.isActive, true))).orderBy(asc(barMenuItem.sortOrder), asc(barMenuItem.name))
    const stamps = [...sections.map((s) => s.updatedAt), ...items.map((i) => i.updatedAt)].filter(Boolean) as Date[]
    return {
      updatedAt: stamps.length ? new Date(Math.max(...stamps.map((dt) => dt.getTime()))).toISOString() : null,
      sections: sections.map((s) => ({
        slug: s.slug, name: s.name, description: s.description, kind: s.kind === 'drink' ? 'drink' : 'food',
        items: items.filter((i) => i.sectionId === s.id).map(publicItem),
      })),
    }
  }

  async function menuItem(companyId: string, slug: string) {
    const [item] = await db.select().from(barMenuItem)
      .where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.slug, slug), eq(barMenuItem.isActive, true))).limit(1)
    if (!item) return null
    const [section] = item.sectionId ? await db.select().from(barMenuSection).where(and(eq(barMenuSection.id, item.sectionId), eq(barMenuSection.companyId, companyId))).limit(1) : []
    if (section && !section.isActive) return null
    return { ...publicItem(item), section: section ? { slug: section.slug, name: section.name } : null }
  }

  async function taps(companyId: string) {
    const rows: Array<typeof barTap.$inferSelect> = await db.select().from(barTap)
      .where(and(eq(barTap.companyId, companyId), eq(barTap.isActive, true))).orderBy(asc(barTap.sortOrder), asc(barTap.lineNumber))
    const shown = rows.filter((t) => (PUBLIC_TAP_STATUSES as readonly string[]).includes(t.status))
    const stamp = rows.reduce<Date | null>((m, t) => (!m || t.updatedAt > m ? t.updatedAt : m), null)
    return {
      updatedAt: stamp ? stamp.toISOString() : null,
      taps: shown.map((t) => ({
        lineNumber: t.lineNumber, beerName: t.beerName, brewery: t.brewery, style: t.style, abv: t.abv,
        originCountry: t.originCountry, description: t.description, badge: t.badge, price: formatPrice(t.priceCents), status: t.status,
        // Every pour size, for a tap list that shows "Pint $5.50 · Pitcher $18" (price above stays the usual pour).
        sizes: tapSizes(t).map((s) => ({ name: s.name, oz: s.oz, price: formatPrice(s.priceCents) })),
      })),
    }
  }

  async function hours(companyId: string) {
    const h = await live.hoursFor(companyId)
    return { timezone: h.timezone, bar: h.bar || {}, kitchen: h.kitchen || {}, overrides: h.holidays || [] }
  }

  async function events(companyId: string) {
    // Upcoming one-offs, ones still running, and every published recurring night.
    const since = new Date(Date.now() - 6 * 3600000)
    const rows: Array<typeof barEvent.$inferSelect> = await db.select().from(barEvent)
      .where(and(eq(barEvent.companyId, companyId), eq(barEvent.isPublished, true), or(gte(barEvent.startsAt, since), gte(barEvent.endsAt, since), eq(barEvent.isRecurring, true))))
      .orderBy(asc(barEvent.startsAt)).limit(100)
    return {
      events: rows.map((e) => ({
        slug: e.slug, title: e.title, description: e.description, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt ? e.endsAt.toISOString() : null,
        imageUrl: e.imageUrl, isRecurring: e.isRecurring, recurrenceDays: e.recurrenceDays,
      })),
    }
  }

  return { theBar, gate, menu, menuItem, taps, hours, events, liveState: (companyId: string) => live.buildLiveState(companyId) }
}
export type BarPublic = ReturnType<typeof createBarPublic>

// ── The website's bundle (lib/bar.ts SiteData) ───────────────────────────────────────────────────────────────

/** Shown beside the (never pre-ticked) box, and stored as the consent evidence when it is ticked (crm/bar/enquiry.ts). */
export const EMAIL_CONSENT_TEXT = 'Yes, email me now and then — the birthday note and the occasional night worth knowing about. Unsubscribe any time.'

const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function menuFrom(raw: any) {
  const sections = Array.isArray(raw?.sections) ? raw.sections : []
  return sections.map((s: any) => ({
    slug: String(s?.slug || '').replace(/[^a-z0-9_-]/gi, ''), name: String(s?.name || ''), description: str(s?.description),
    kind: s?.kind === 'drink' ? 'drink' : 'food',
    items: (Array.isArray(s?.items) ? s.items : []).map((i: any) => ({
      slug: String(i?.slug || '').replace(/[^a-z0-9_-]/gi, ''), name: String(i?.name || ''), description: str(i?.description),
      priceCents: num(i?.priceCents), priceLabel: str(i?.priceLabel), price: str(i?.price),
      dietary: Array.isArray(i?.dietary) ? i.dietary.map(String) : [], imageUrl: str(i?.imageUrl), heroImageUrl: str(i?.heroImageUrl),
      story: str(i?.story), isSignature: i?.isSignature === true, is86ed: i?.is86ed === true,
      variations: Array.isArray(i?.variations) ? i.variations.filter((v: any) => v && typeof v.priceCents === 'number').map((v: any) => ({ name: String(v.name || ''), priceCents: v.priceCents })) : [],
      isActive: true as const,
    })).filter((i: any) => i.slug && i.name),
  })).filter((s: any) => s.slug && s.name) as Array<{ slug: string; name: string; description: string | null; kind: 'food' | 'drink'; items: any[] }>
}

function tapsFrom(raw: any) {
  const ok = new Set(['pouring', 'just_tapped', 'last_keg'])
  return (Array.isArray(raw?.taps) ? raw.taps : []).filter((t: any) => t && t.beerName && ok.has(t.status)).map((t: any) => ({
    lineNumber: num(t.lineNumber) ?? 0, beerName: String(t.beerName), brewery: str(t.brewery), style: str(t.style), abv: t.abv == null ? null : String(t.abv),
    originCountry: str(t.originCountry), description: str(t.description), badge: str(t.badge), price: str(t.price), status: t.status,
    sizes: (Array.isArray(t.sizes) ? t.sizes : []).filter((z: any) => z && str(z.name)).map((z: any) => ({ name: String(z.name), oz: num(z.oz), price: str(z.price) })),
  }))
}

function hoursFrom(raw: any): HoursConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const any = (w: any) => w && typeof w === 'object' && Object.values(w).some((r) => Array.isArray(r) && r.length)
  if (!any(raw.bar) && !any(raw.kitchen)) return null
  return {
    timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : EMPTY_HOURS.timezone,
    bar: (raw.bar && typeof raw.bar === 'object' ? raw.bar : {}) as WeeklyHours,
    kitchen: (raw.kitchen && typeof raw.kitchen === 'object' ? raw.kitchen : {}) as WeeklyHours,
    holidays: (Array.isArray(raw.overrides) ? raw.overrides : []) as DateOverride[],
  }
}

function eventsFrom(raw: any) {
  return (Array.isArray(raw?.events) ? raw.events : []).filter((e: any) => e && e.slug && e.title && e.startsAt).map((e: any) => ({
    slug: String(e.slug).replace(/[^a-z0-9_-]/gi, ''), title: String(e.title), description: str(e.description), startsAt: String(e.startsAt),
    endsAt: str(e.endsAt), imageUrl: str(e.imageUrl), isRecurring: e.isRecurring === true, recurrenceRule: str(e.recurrenceRule),
  }))
}

/**
 * "840 E Madison St, Eau Claire, WI 54703" → the parts schema.org's PostalAddress wants (the visit section and the
 * JSON-LD). Only what the owner typed is used, and a line that doesn't split cleanly gives none.
 */
export function addressParts(address: unknown): Record<string, string> {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 3) return {}
  const m = parts[parts.length - 1].match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/)
  if (!m) return {}
  return { streetAddress: parts.slice(0, -2).join(', '), addressLocality: parts[parts.length - 2], addressRegion: m[1].toUpperCase(), ...(m[2] ? { postalCode: m[2] } : {}) }
}

const ART_TAGS: Record<string, 'leather' | 'corner' | 'rivet'> = { 'brand-leather': 'leather', 'brand-corner': 'corner', 'brand-rivet': 'rivet' }

export function createBarSite(deps: { db: BarDb; live: BarLive }): SiteFacts {
  const { db } = deps
  const pub = createBarPublic(db, deps.live)
  const isRefusal = (x: unknown): x is PublicRefusal => !!x && typeof x === 'object' && 'status' in x

  // The story's eras live in the `story` page's timeline section (data.entries), so the era pages (/story/<slug>) and
  // the book read the same list the owner edits.
  async function timelineEntries(companyId: string): Promise<any[] | null> {
    const [p] = await db.select({ sections: page.sections }).from(page).where(and(eq(page.companyId, companyId), eq(page.slug, 'story'))).limit(1)
    const secs = p && Array.isArray(p.sections) ? (p.sections as any[]) : []
    const t = secs.find((s) => s && s.type === 'timeline' && Array.isArray(s.data?.entries))
    return t ? t.data.entries : null
  }

  // The owner's cover art and header lettering: website photos tagged brand-* / header-logo in the admin.
  async function ownersArt(companyId: string) {
    const rows = await db.select({ tags: photo.tags, publicUrl: photo.publicUrl }).from(photo)
      .where(and(eq(photo.companyId, companyId), eq(photo.isPublic, true))).orderBy(asc(photo.createdAt))
    const brandArt: { leather?: string; corner?: string; rivet?: string } = {}
    let headerLogoUrl: string | null = null
    for (const r of rows) {
      if (!r.publicUrl) continue
      for (const tag of Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : []) {
        const k = ART_TAGS[tag]
        if (k) brandArt[k] = r.publicUrl
        if (tag === 'header-logo') headerLogoUrl = r.publicUrl
      }
    }
    return { brandArt, headerLogoUrl }
  }

  async function load(companyId: string, settings: Record<string, any>): Promise<PageFacts> {
    const co = await pub.theBar()
    // Each answer as the CRM gave it to the site: null where it refused (feature off, account paused).
    const when = async <T>(feature: string, read: (id: string) => Promise<T>): Promise<T | null> => {
      const g = pub.gate(co && co.id === companyId ? co : null, feature)
      return isRefusal(g) ? null : read(g.id)
    }
    const [liveRaw, menuRaw, tapsRaw, hoursRaw, eventsRaw, timeline, art] = await Promise.all([
      when('bar_tonight', pub.liveState), when('bar_menu', pub.menu), when('bar_menu', pub.taps), when('bar_tonight', pub.hours),
      when('bar_tonight', pub.events), timelineEntries(companyId), ownersArt(companyId),
    ])
    const hours = hoursFrom(hoursRaw)
    const h = hours || EMPTY_HOURS
    const menu = menuFrom(menuRaw)
    const liveState = (liveRaw && typeof liveRaw === 'object' && liveRaw.kitchen && liveRaw.bar ? liveRaw : null) as LiveState | null
    const site = {
      live: liveState,
      hours,
      hoursSchema: {
        bar: [...openingHoursSpecification(h.bar), ...specialOpeningHours(h.holidays || [], 'bar')],
        kitchen: [...openingHoursSpecification(h.kitchen), ...specialOpeningHours(h.holidays || [], 'kitchen')],
      } as HoursSpec,
      menu,
      signatureItems: menu.flatMap((s) => s.items.filter((i: any) => i.isSignature)),
      taps: tapsFrom(tapsRaw),
      timeline,
      events: eventsFrom(eventsRaw),
      regulars: { loyalty: null, emailConsentText: EMAIL_CONSENT_TEXT },
      brandArt: art.brandArt,
      headerLogoUrl: art.headerLogoUrl,
      loadedAt: Date.now(),
    }
    // The address as its parts (the visit section, the footer), and the owner's cover art (base.ejs).
    return { site, live: liveState, settings: { ...addressParts(settings.address), brandArt: art.brandArt, ...(art.headerLogoUrl ? { headerLogoUrl: art.headerLogoUrl } : {}) } }
  }

  function jsonLd(facts: PageFacts, p: { slug: string; title: string; sections: any[]; settings: Record<string, any>; about?: unknown }): string {
    try {
      return pageJsonLd({
        slug: p.slug, title: p.title, sections: p.sections,
        settings: p.settings as any, hoursSchema: facts.site.hoursSchema,
        menu: facts.site.menu, events: facts.site.events, item: (p.about as any) || null,
      })
    } catch (e: any) {
      console.warn('[JSON-LD] skipped:', e?.message)
      return ''
    }
  }

  // /<section>/<item> is a signature item's own page; /story/<era> an era of the story.
  function nestedPage(facts: PageFacts, a: string, b: string, companyName: string): FactsPage | null {
    if (a === 'story') {
      const entry = (facts.site.timeline || []).find((e: any) => e && String(e.slug || '') === b && e.isPublished !== false)
      if (entry) {
        const title = String(entry.title || b)
        return { path: '/story/' + b, sections: [{ type: 'timeline', variant: 'era', data: { slug: b } }], meta: { title, metaTitle: title + (companyName ? ' — ' + companyName : ''), metaDescription: '' } }
      }
    }
    const section = (facts.site.menu as any[]).find((s) => s.slug === a)
    const item = section?.items.find((i: any) => i.slug === b && i.isSignature)
    if (!section || !item) return null
    return {
      path: '/' + section.slug + '/' + item.slug,
      sections: [{ type: 'menu', variant: 'item-hero', data: { slug: item.slug, section: section.slug, eyebrow: section.name } }],
      meta: { title: item.name, metaTitle: item.name + (companyName ? ' — ' + companyName : ''), metaDescription: item.description || '' },
      about: { section, item },
    }
  }

  function sitemapPaths(facts: PageFacts, pages: Set<string>): string[] {
    const out: string[] = []
    for (const s of facts.site.menu as any[]) for (const it of s.items) if (it.isSignature) out.push('/' + s.slug + '/' + it.slug)
    for (const e of facts.site.timeline || []) {
      const slug = String((e as any)?.slug || '').replace(/[^a-z0-9_-]/gi, '')
      if (slug && (e as any).isPublished !== false && !pages.has('story/' + slug)) out.push('/story/' + slug)
    }
    return out
  }

  return { load, jsonLd, nestedPage, sitemapPaths }
}
