/**
 * lib/schema-org/business.ts — typed builder for the sitewide BarOrPub /
 * Restaurant JSON-LD. Built from the settings row so name/address/phone can
 * only ever come from one place (NAP consistency is a local-ranking factor).
 *
 * Hours are deliberately NOT read from free text here. lib/hours (prompt 2)
 * supplies `openingHoursSpecification` for the bar and a `department` entry
 * for the kitchen, because bar hours ≠ kitchen hours and Google needs both.
 */

export interface BusinessSettings {
  companyName?: string | null
  tagline?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  streetAddress?: string | null
  addressLocality?: string | null
  addressRegion?: string | null
  postalCode?: string | null
  geoLat?: string | number | null
  geoLng?: string | number | null
  geo?: { lat?: number | string; lng?: number | string } | null
  sameAs?: string[] | null
  schemaType?: string | null
  siteOrigin?: string | null
  logoUrl?: string | null
  heroPhotoUrl?: string | null
  seoDescription?: string | null
  servesCuisine?: string | null
  priceRange?: string | null
  established?: number | string | null
}

export interface HoursSpec {
  /** schema.org OpeningHoursSpecification objects for the BAR (the business itself). */
  bar?: object[]
  /** schema.org OpeningHoursSpecification objects for the KITCHEN — emitted as a `department`. */
  kitchen?: object[]
}

const ALLOWED_TYPES = new Set(['BarOrPub', 'Restaurant', 'Brewery', 'Winery', 'Distillery', 'NightClub', 'CafeOrCoffeeShop', 'LocalBusiness'])

function clean(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

function telephone(v: unknown): string | undefined {
  const s = clean(v)
  if (!s) return undefined
  const digits = s.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return s
}

export function buildBusinessSchema(s: BusinessSettings, hours?: HoursSpec): Record<string, unknown> {
  const type = ALLOWED_TYPES.has(String(s.schemaType || '')) ? String(s.schemaType) : 'BarOrPub'
  const origin = (clean(s.siteOrigin) || '').replace(/\/+$/, '')
  const name = clean(s.companyName) || 'Bar'

  const out: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': type,
    name,
  }
  if (origin) { out['@id'] = origin + '/#business'; out.url = origin }
  const description = clean(s.seoDescription) || clean(s.tagline)
  if (description) out.description = description
  const tel = telephone(s.phone)
  if (tel) out.telephone = tel
  const email = clean(s.email)
  if (email) out.email = email
  const image = clean(s.logoUrl) || clean(s.heroPhotoUrl)
  if (image) { out.image = image; out.logo = clean(s.logoUrl) || undefined }

  const street = clean(s.streetAddress)
  if (street || clean(s.addressLocality)) {
    out.address = {
      '@type': 'PostalAddress',
      streetAddress: street,
      addressLocality: clean(s.addressLocality),
      addressRegion: clean(s.addressRegion),
      postalCode: clean(s.postalCode),
      addressCountry: 'US',
    }
  } else if (clean(s.address)) {
    out.address = clean(s.address)
  }

  const lat = clean(s.geoLat) ?? clean(s.geo?.lat)
  const lng = clean(s.geoLng) ?? clean(s.geo?.lng)
  if (lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
    out.geo = { '@type': 'GeoCoordinates', latitude: Number(lat), longitude: Number(lng) }
  }

  const sameAs = Array.isArray(s.sameAs) ? s.sameAs.map(clean).filter(Boolean) : []
  if (sameAs.length) out.sameAs = sameAs
  if (clean(s.servesCuisine)) out.servesCuisine = clean(s.servesCuisine)
  if (clean(s.priceRange)) out.priceRange = clean(s.priceRange)
  const est = clean(s.established)
  if (est && /^\d{4}$/.test(est)) out.foundingDate = est
  if (origin) out.menu = origin + '/menu'

  if (hours?.bar?.length) out.openingHoursSpecification = hours.bar
  if (hours?.kitchen?.length) {
    out.department = [{
      '@type': 'Restaurant',
      name: name + ' Kitchen',
      telephone: tel,
      openingHoursSpecification: hours.kitchen,
      ...(origin ? { url: origin + '/menu', menu: origin + '/menu' } : {}),
    }]
  }

  return prune(out)
}

/** Drop undefined values (recursively) so the emitted JSON is tidy. */
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

/** Serialize for an inline <script type="application/ld+json"> — escapes `</` so the block can't be broken out of. */
export function toJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, '<\\/')
}
