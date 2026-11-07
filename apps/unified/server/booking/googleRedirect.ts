// Reserve with Google — the Actions Center APPOINTMENTS REDIRECT integration (salon parity row 23; feature `reserve_with_google`, not ready),
// built to Google's published spec (developers.google.com/actions-center/verticals/appointments/redirect, read 11/07):
//
//   · three feeds, full refreshes uploaded once a day to Google's Generic SFTP server, each a JSON data file {"data": [...]} plus its
//     fileset descriptor {generation_timestamp, name, data_file[]}:
//       entity  (reservewithgoogle.entity)        entity_id, name, telephone, url, location {latitude?, longitude?, address {country,
//                                                 locality, region, postal_code, street_address}}
//       action  (reservewithgoogle.action.v2)     entity_id, link_id, url, actions [{ appointment_info: {} }]
//       service (glam.service.v0)                 merchant_id, service_id, localized_service_name/category/description {value},
//                                                 service_price {price_interpretation, min_price {price_micros, currency_code}},
//                                                 action_link [{url}], service_duration {duration_interpretation, min_duration_sec}
//   · conversion tracking: Google appends `rwg_token` to the links it shows; the booking page keeps it 30 days (a new referral replaces it);
//     a booking made in that window is reported with a POST of {conversion_partner_id, rwg_token, merchant_changed} as text/plain to
//     https://www.google.com/maps/conversion/collect (the sandbox's: …/conversion/debug/collect). No personal data is sent.
//
// Appointments END-TO-END (booking inside Google through a partner booking server) is not offered for appointments in Google's current
// docs (the Appointments card lists Redirect and Offers only), so it is not built: the booking happens on the salon's own page.
//
// The PARTNER STEP (outside the app): Twomiah applies as an Actions Center partner (the interest form), gets its Partner Portal, its
// partner id (GOOGLE_RWG_PARTNER_ID) and SFTP account (an SSH key in the portal), uploads these feeds daily for every salon with the
// switch on, passes Google's sandbox review (GOOGLE_RWG_SANDBOX=1 sends conversions to the debug endpoint), then its production review.
import { and, eq, inArray } from 'drizzle-orm'
import { company, serviceMenu } from '../db/schema/index.ts'
import type { BookingEngine, ServiceRow } from './engine.ts'
import { siteOrigin } from './happenings.ts'

export const RWG_FEATURE = 'reserve_with_google'
export const RWG_COOKIE = 'rwg_token'
/** Google's attribution window: 30 days from the referral. */
export const RWG_MAX_AGE = 30 * 24 * 3600
export const FEED_NAMES = { entity: 'reservewithgoogle.entity', action: 'reservewithgoogle.action.v2', service: 'glam.service.v0' } as const
export const CONVERSION_URL = 'https://www.google.com/maps/conversion/collect'
export const CONVERSION_DEBUG_URL = 'https://www.google.com/maps/conversion/debug/collect'

/** A token as Google sends it (opaque, URL-safe); anything else is not kept. */
export const cleanToken = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s && s.length <= 1000 && /^[A-Za-z0-9_\-.~=+/]+$/.test(s) ? s : null
}

/** The cookie that keeps a referral for Google's 30 days (first-party, the server reads it when the booking is made). */
export const rwgCookie = (token: string) => `${RWG_COOKIE}=${encodeURIComponent(token)}; Max-Age=${RWG_MAX_AGE}; Path=/; SameSite=Lax; Secure; HttpOnly`

/** A phone number in the form Google's samples use (+14567891234); US numbers without a country code get +1. Null when unreadable. */
export function e164(phone: unknown): string | null {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

const text = (value: string) => ({ value })
const micros = (dollars: unknown) => Math.round(Number(dollars) * 1_000_000)

/** One service as Google's services feed takes it. A price the salon does not show is NOT_DISPLAYED; a "from" price STARTS_AT. */
export function serviceEntry(merchantId: string, svc: Pick<ServiceRow, 'id' | 'slug' | 'name' | 'description' | 'durationMinutes' | 'price' | 'priceIsFrom'>, category: string | null, origin: string) {
  const price = svc.price != null && Number(svc.price) > 0 ? Number(svc.price) : null
  return {
    merchant_id: merchantId,
    service_id: svc.id,
    localized_service_name: text(svc.name),
    localized_service_category: text(category ? category.charAt(0).toUpperCase() + category.slice(1) : 'All Services'),
    ...(svc.description ? { localized_service_description: text(String(svc.description).slice(0, 2000)) } : {}),
    service_price: price == null
      ? { price_interpretation: 'INTERPRETATION_NOT_DISPLAYED' }
      : { price_interpretation: svc.priceIsFrom ? 'INTERPRETATION_STARTS_AT' : 'INTERPRETATION_EXACT', min_price: { price_micros: micros(price), currency_code: 'USD' } },
    action_link: [{ url: `${origin}/book/${svc.slug}` }],
    service_duration: { duration_interpretation: 'INTERPRETATION_EXACT', min_duration_sec: svc.durationMinutes * 60 },
  }
}

export type FeedProblem = string

/**
 * The three feeds for one salon (one merchant: entity_id = merchant_id = the company's id, which never changes), with the problems that keep
 * Google from taking them (Google needs a street address it can match on Maps, and at least one service with its link).
 */
export async function feedsFor(db: any, engine: BookingEngine, companyId: string, at = new Date()) {
  const origin = siteOrigin()
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const problems: FeedProblem[] = []
  if (!co) return { problems: ['No such company.'], entity: null, action: null, service: null, descriptors: null }
  if (!origin) problems.push('Your website has no public address yet, so Google has no page to send clients to. Ask Twomiah support to finish setting up your site.')
  if (!co.address || !co.city || !co.zip) problems.push('Add the salon’s street address, city and ZIP in Settings › Company: Google matches it to the salon on Maps.')
  const services = (await engine.listServices(companyId, { activeOnly: true })).filter((s) => engine.offered(s))
  if (!services.length) problems.push('No service is offered online yet: Google needs at least one.')
  const menuIds = services.map((s) => s.serviceMenuId).filter(Boolean) as string[]
  const cats = menuIds.length ? await db.select({ id: serviceMenu.id, category: serviceMenu.category }).from(serviceMenu).where(and(eq(serviceMenu.companyId, companyId), inArray(serviceMenu.id, menuIds))) : []
  const catOf = (s: ServiceRow) => (cats as any[]).find((c) => c.id === s.serviceMenuId)?.category ?? null

  const entity = {
    data: [{
      entity_id: companyId,
      name: co.name,
      ...(e164(co.phone) ? { telephone: e164(co.phone) } : {}),
      ...(origin ? { url: origin } : {}),
      location: {
        address: { country: 'US', locality: co.city || '', ...(co.state ? { region: co.state } : {}), postal_code: co.zip || '', street_address: co.address || '' },
      },
    }],
  }
  const action = { data: [{ entity_id: companyId, link_id: `book-${companyId}`, url: `${origin}/book`, actions: [{ appointment_info: {} }] }] }
  const service = { data: services.map((s) => serviceEntry(companyId, s, catOf(s), origin)) }
  const ts = Math.floor(at.getTime() / 1000)
  const file = (kind: keyof typeof FEED_NAMES) => `${kind}_${ts}_0001.json`
  const descriptors = Object.fromEntries((Object.keys(FEED_NAMES) as Array<keyof typeof FEED_NAMES>).map((k) => [k, { generation_timestamp: ts, name: FEED_NAMES[k], data_file: [file(k)] }]))
  return { problems, entity, action, service, descriptors, files: { entity: file('entity'), action: file('action'), service: file('service') } }
}

/** The body Google's conversion endpoint takes. One salon per site, so the booking is always with the merchant Google sent them to ("2"). */
export const conversionBody = (partnerId: string, token: string) => ({ conversion_partner_id: partnerId, rwg_token: token, merchant_changed: '2' })

/** Google's endpoint, as text/plain (the only Content-Type it accepts). Swappable for tests; nothing leaves a test. */
export const googleConversions = {
  post: async (url: string, body: string): Promise<number> => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })).status,
}

/** Report a booking Google referred. False when there is nothing to send (no token, no partner id yet) or Google refused it. */
export async function sendConversion(token: string | null | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const partnerId = String(env.GOOGLE_RWG_PARTNER_ID || '').trim()
  if (!token || !partnerId) return false
  const url = env.GOOGLE_RWG_SANDBOX === '1' ? CONVERSION_DEBUG_URL : CONVERSION_URL
  try { const status = await googleConversions.post(url, JSON.stringify(conversionBody(partnerId, token))); return status >= 200 && status < 300 }
  catch { return false }
}
