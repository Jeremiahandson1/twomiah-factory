/**
 * lib/bar.ts — the bar's live facts, read from its CRM (templates/crm-bar), and the one `site` bundle
 * every bar partial reads.
 *
 * The CRM owns every changing fact — menu, 86, specials, taps, hours, the bartender's live status, public
 * events, games — on one database the register will share. This site owns the look, the pages and the
 * story, and READS the facts: GET {CRM_API_URL}/api/public/bar/{live,menu,taps,hours,events} (the shapes
 * are the crm-bar public routes'). Server side only, cached ~20 s; the browser never calls the CRM.
 *
 * CRM_BAR=1 (deploy sets it for the bar vertical) turns it on. Off, or the CRM unreachable with nothing
 * cached, every partial gets empty data and degrades to a correct static fallback (call the bar) —
 * never a 500 and never a stale claim presented as live.
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { pages as pagesTbl, photos as photosTbl } from '../db/schema'
import { openingHoursSpecification, specialOpeningHours, EMPTY_HOURS, type HoursConfig, type DateOverride, type WeeklyHours } from './hours'
import type { HoursSpec } from './schema-org/business'

export const CRM_BAR = process.env.CRM_BAR === '1' && !!process.env.CRM_API_URL
const crmBase = () => String(process.env.CRM_API_URL || '').replace(/\/+$/, '')

const TTL_MS = 20_000
const FETCH_TIMEOUT_MS = 6_000

// ── The CRM's public shapes (BAR_CONTRACT.md) ───────────────────────────────────────────────────
export interface LiveDepartment { isOpen: boolean; closesAt: string | null; opensAt: string | null; line: string; short: string; countdown: string | null; source: string; note: string | null }
export interface LiveState {
  generatedAt: string
  timezone: string
  localDate: string
  kitchen: LiveDepartment
  bar: LiveDepartment
  room: { status: 'quiet' | 'filling' | 'packed'; label: string }
  note: string | null
  special: { title: string; description: string | null; price: string | null } | null
  game: { league: string; home: string; away: string; startsAt: string; startsAtLabel: string; note: string | null; isToday: boolean } | null
  taps: { count: number; featured: Array<{ name: string; brewery: string | null; style: string | null; status: string; badge: string | null }>; updatedAt: string | null }
  ordering: { available: boolean; reason: string; prepMinutes: number; lastCallAt: string | null }
  speakeasy?: { enabled: boolean }
  updatedAt: string | null
  updatedBy: string | null
}
export interface MenuItem {
  slug: string; name: string; description: string | null; priceCents: number | null; priceLabel: string | null; price: string | null
  dietary: string[]; imageUrl: string | null; heroImageUrl: string | null; story: string | null; isSignature: boolean; is86ed: boolean
  variations: Array<{ name: string; priceCents: number }>
  /** Site-side: every item the CRM lists is active (it never sends inactive ones). */
  isActive: true
}
export interface MenuSection { slug: string; name: string; description: string | null; kind: 'food' | 'drink'; items: MenuItem[] }
export interface Tap {
  lineNumber: number; beerName: string; brewery: string | null; style: string | null; abv: string | null; originCountry: string | null
  description: string | null; badge: string | null; price: string | null; status: 'pouring' | 'just_tapped' | 'last_keg'
}
export interface BarEvent { slug: string; title: string; description: string | null; startsAt: string; endsAt: string | null; imageUrl: string | null; isRecurring: boolean; recurrenceRule: string | null }

export interface SiteData {
  /** null = no live data (CRM_BAR off or the CRM unreachable): partials show their static fallback. */
  live: LiveState | null
  /** null until the bar has entered hours in the CRM — the hours table then says so, never "Closed". */
  hours: HoursConfig | null
  hoursSchema: HoursSpec
  menu: MenuSection[]
  signatureItems: MenuItem[]
  taps: Tap[]
  /** The story's eras: section content (the timeline section on the `story` page), not a table. */
  timeline: any[] | null
  events: BarEvent[]
  /** The Regulars sign-up: the exact consent words shown — and sent with the sign-up as evidence. */
  regulars: { loyalty: null; emailConsentText: string }
  /** The owner's own cover art and header lettering (photos tagged brand-* / header-logo in the admin). */
  brandArt: { leather?: string; corner?: string; rivet?: string }
  headerLogoUrl: string | null
  loadedAt: number
}

/** Shown beside the (never pre-ticked) box, and stored by the CRM with the sign-up as consent evidence. */
export const EMAIL_CONSENT_TEXT = 'Yes, email me now and then — the birthday note and the occasional night worth knowing about. Unsubscribe any time.'

// ── Fetching (cached per endpoint; a failure serves the last good copy) ───────────────────────────
const cache = new Map<string, { at: number; data: any }>()
async function crmGet<T>(path: string, now: number): Promise<T | null> {
  if (!CRM_BAR) return null
  const hit = cache.get(path)
  if (hit && now - hit.at < TTL_MS) return hit.data as T
  try {
    const r = await fetch(crmBase() + '/api/public/bar' + path, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const data = await r.json()
    cache.set(path, { at: now, data })
    return data as T
  } catch (e: any) {
    console.warn('[Bar] CRM ' + path + ' failed:', e?.message)
    return (hit?.data as T) || null
  }
}

/** The bartender's live state, fresh (the board's poller and the console's "did it take?"). */
export async function fetchLive(now: number = Date.now()): Promise<LiveState | null> {
  return isLive(await crmGet<any>('/live', now))
}

function isLive(v: any): LiveState | null {
  return v && typeof v === 'object' && v.kitchen && v.bar && typeof v.timezone === 'string' ? v as LiveState : null
}

const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function menuFrom(raw: any): MenuSection[] {
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
    })).filter((i: MenuItem) => i.slug && i.name),
  })).filter((s: MenuSection) => s.slug && s.name)
}

function tapsFrom(raw: any): Tap[] {
  const ok = new Set(['pouring', 'just_tapped', 'last_keg'])
  return (Array.isArray(raw?.taps) ? raw.taps : []).filter((t: any) => t && t.beerName && ok.has(t.status)).map((t: any) => ({
    lineNumber: num(t.lineNumber) ?? 0, beerName: String(t.beerName), brewery: str(t.brewery), style: str(t.style), abv: t.abv == null ? null : String(t.abv),
    originCountry: str(t.originCountry), description: str(t.description), badge: str(t.badge), price: str(t.price), status: t.status,
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

function eventsFrom(raw: any): BarEvent[] {
  return (Array.isArray(raw?.events) ? raw.events : []).filter((e: any) => e && e.slug && e.title && e.startsAt).map((e: any) => ({
    slug: String(e.slug).replace(/[^a-z0-9_-]/gi, ''), title: String(e.title), description: str(e.description), startsAt: String(e.startsAt),
    endsAt: str(e.endsAt), imageUrl: str(e.imageUrl), isRecurring: e.isRecurring === true, recurrenceRule: str(e.recurrenceRule),
  }))
}

// The story's eras live in the `story` page's timeline section (data.entries), so the era pages
// (/story/<slug>) and the book read the same list the owner edits.
async function timelineEntries(): Promise<any[] | null> {
  try {
    const [p] = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, 'story')).limit(1)
    const secs = p && Array.isArray(p.sections) ? (p.sections as any[]) : []
    const t = secs.find((s) => s && s.type === 'timeline' && Array.isArray(s.data?.entries))
    return t ? t.data.entries : null
  } catch { return null }
}

const ART_TAGS: Record<string, 'leather' | 'corner' | 'rivet'> = { 'brand-leather': 'leather', 'brand-corner': 'corner', 'brand-rivet': 'rivet' }
async function ownersArt(): Promise<{ brandArt: SiteData['brandArt']; headerLogoUrl: string | null }> {
  try {
    const rows = await db.select().from(photosTbl).orderBy(asc(photosTbl.createdAt))
    const brandArt: SiteData['brandArt'] = {}
    let headerLogoUrl: string | null = null
    for (const r of rows) {
      const k = r.tag ? ART_TAGS[r.tag] : undefined
      if (k) brandArt[k] = r.url
      if (r.tag === 'header-logo') headerLogoUrl = r.url
    }
    return { brandArt, headerLogoUrl }
  } catch { return { brandArt: {}, headerLogoUrl: null } }
}

let bundle: SiteData | null = null
let inflight: Promise<SiteData> | null = null

export async function loadSiteData(now: Date = new Date()): Promise<SiteData> {
  if (bundle && now.getTime() - bundle.loadedAt < TTL_MS) return bundle
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const t = now.getTime()
      const [liveRaw, menuRaw, tapsRaw, hoursRaw, eventsRaw, timeline, art] = await Promise.all([
        crmGet<any>('/live', t), crmGet<any>('/menu', t), crmGet<any>('/taps', t), crmGet<any>('/hours', t), crmGet<any>('/events', t),
        timelineEntries(), ownersArt(),
      ])
      const hours = hoursFrom(hoursRaw)
      const h = hours || EMPTY_HOURS
      const menu = menuFrom(menuRaw)
      bundle = {
        live: isLive(liveRaw),
        hours,
        hoursSchema: {
          bar: [...openingHoursSpecification(h.bar), ...specialOpeningHours(h.holidays || [], 'bar')],
          kitchen: [...openingHoursSpecification(h.kitchen), ...specialOpeningHours(h.holidays || [], 'kitchen')],
        },
        menu,
        signatureItems: menu.flatMap((s) => s.items.filter((i) => i.isSignature)),
        taps: tapsFrom(tapsRaw),
        timeline,
        events: eventsFrom(eventsRaw),
        regulars: { loyalty: null, emailConsentText: EMAIL_CONSENT_TEXT },
        brandArt: art.brandArt,
        headerLogoUrl: art.headerLogoUrl,
        loadedAt: t,
      }
      return bundle
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** The speakeasy door: the answer is checked by the CRM; the password never reaches the browser. */
export async function checkSpeakeasy(answer: string): Promise<{ ok: boolean; note?: string } | null> {
  if (!CRM_BAR) return null
  try {
    const r = await fetch(crmBase() + '/api/public/bar/speakeasy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: String(answer || '').slice(0, 80) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (r.status === 429) return { ok: false, note: 'Too many guesses. Ask the bartender.' }
    if (!r.ok) return null
    const j: any = await r.json().catch(() => null)
    return j && typeof j.ok === 'boolean' ? { ok: j.ok, ...(typeof j.note === 'string' ? { note: j.note } : {}) } : null
  } catch { return null }
}
