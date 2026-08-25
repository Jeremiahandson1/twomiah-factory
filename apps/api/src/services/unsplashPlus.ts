/**
 * Unsplash+ API client — opt-in via UNSPLASH_PLUS_ACCESS_KEY env var.
 *
 * Used by the section composer to fetch licensed stock photos relevant
 * to the business when the customer hasn't supplied their own. Plus
 * subscription required for unlimited downloads + commercial use;
 * https://unsplash.com/plus.
 *
 * No key set → searchStockPhotos returns []; composer falls back to the
 * free Unsplash placeholder URLs in its hardcoded prompt examples. So
 * this integration ships dormant until the key is configured — no risk
 * to existing flows.
 *
 * Unsplash terms require:
 *   - Triggering /photos/:id/download for each photo actually used
 *     (download tracking). We do this lazily — fire-and-forget POST
 *     after handing the URL to the composer, accepting that we may
 *     ping for photos the AI ends up not using. Their terms don't
 *     require precision; they say "as long as the user could have
 *     downloaded it."
 *   - Attribution on each photo. The composer prompt instructs Claude
 *     to include credit copy in the section data, and the renderer
 *     can optionally surface it. (Not enforced strictly here — that's
 *     a follow-up if attribution becomes a Unsplash compliance issue.)
 */

export interface StockPhoto {
  url: string
  alt: string
  tag?: string
  /**
   * Photo id + photographer name so callers can ping the download
   * endpoint and surface attribution when displaying the photo.
   */
  unsplashId: string
  photographer: string
  photographerLink: string
}

const API_BASE = 'https://api.unsplash.com'

function isConfigured(): boolean {
  return !!process.env.UNSPLASH_PLUS_ACCESS_KEY
}

async function unsplashFetch(path: string): Promise<any | null> {
  const key = process.env.UNSPLASH_PLUS_ACCESS_KEY
  if (!key) return null
  try {
    const res = await fetch(API_BASE + path, {
      headers: {
        'Authorization': 'Client-ID ' + key,
        'Accept-Version': 'v1',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.warn('[Unsplash+] API returned', res.status, 'for', path)
      return null
    }
    return await res.json()
  } catch (err: any) {
    console.warn('[Unsplash+] Fetch failed:', err.message)
    return null
  }
}

interface SearchOpts {
  perPage?: number
  /** 'landscape' | 'portrait' | 'squarish' */
  orientation?: 'landscape' | 'portrait' | 'squarish'
  /** Free-form tag passed through onto every returned photo (e.g. 'hero', 'team', 'services') */
  tag?: string
}

/**
 * One Unsplash+ search returning the requested number of photos.
 * Empty array if the key is missing or the API fails.
 */
async function searchOne(query: string, opts: SearchOpts = {}): Promise<StockPhoto[]> {
  if (!isConfigured()) return []
  const perPage = Math.min(Math.max(opts.perPage || 8, 1), 30)
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    plus: 'only',  // Unsplash+ licensed photos only — commercial-safe
    content_filter: 'high',
  })
  if (opts.orientation) params.set('orientation', opts.orientation)

  const data = await unsplashFetch('/search/photos?' + params.toString())
  if (!data || !Array.isArray(data.results)) return []

  return data.results.map((p: any) => ({
    url: p.urls?.regular || p.urls?.full || p.urls?.raw || '',
    alt: p.alt_description || p.description || query,
    tag: opts.tag,
    unsplashId: p.id,
    photographer: p.user?.name || 'Unknown',
    photographerLink: p.user?.links?.html || 'https://unsplash.com',
  })).filter((p: StockPhoto) => p.url)
}

/**
 * Search multiple buckets in parallel, optimized for the section
 * composer's needs. Returns a flat list with each photo tagged so the
 * composer can match it to the right slot.
 *
 * For a contractor business: queries for hero (landscape exterior),
 * team (portrait shots of construction crews), and a service-action
 * shot. ~24 photos total, deduplicated by id.
 */
export async function searchStockPhotosForBusiness(
  businessType: string,
  services: string | string[] | undefined,
  city: string | undefined,
  description?: string,
  businessName?: string,
): Promise<StockPhoto[]> {
  const svcArr = Array.isArray(services) ? services.filter(Boolean) : services ? [services] : []

  // Unsplash+ not subscribed → source tier-2 live from Pexels (free commercial
  // license; attribution is registered so the composed page credits it). Scoped
  // to verticals WITHOUT a curated hero set (stores/dropship → 'generic', plus
  // empty groups like dispensary) so the hand-picked, eye-verified library still
  // wins for the established trades — this only fills the gap, never overrides.
  if (!isConfigured()) {
    const { pickHeroGroup, HERO_LIBRARY } = await import('../config/heroLibrary.ts')
    const group = pickHeroGroup(businessType)
    const hasCurated = group !== 'generic' && (HERO_LIBRARY[group]?.length || 0) > 0
    if (hasCurated) return []
    const { searchPexelsStock } = await import('./pexelsStock.ts')
    return searchPexelsStock({ businessType, services: svcArr, description, businessName })
  }

  const primaryService = svcArr[0]
  const heroQuery   = [businessType, city].filter(Boolean).join(' ').trim() || 'business'
  const teamQuery   = (businessType || 'professional') + ' team'
  const serviceQuery = (primaryService || businessType || 'service').trim()

  const [heroes, team, serviceShots] = await Promise.all([
    searchOne(heroQuery,   { perPage: 8, orientation: 'landscape', tag: 'hero' }),
    searchOne(teamQuery,   { perPage: 8, orientation: 'portrait',  tag: 'team' }),
    searchOne(serviceQuery,{ perPage: 8, orientation: 'landscape', tag: 'services' }),
  ])

  // Dedupe by unsplashId — same photo can match multiple queries
  const seen = new Set<string>()
  const out: StockPhoto[] = []
  for (const p of [...heroes, ...team, ...serviceShots]) {
    if (!seen.has(p.unsplashId)) {
      seen.add(p.unsplashId)
      out.push(p)
    }
  }
  return out
}

/**
 * Fire-and-forget download endpoint ping — required by Unsplash terms
 * for any photo actually used. We don't know upfront which photos the
 * composer/AI selects, so this is called for every candidate photo
 * after the composition is done. Failures are ignored.
 */
export async function trackDownload(unsplashId: string): Promise<void> {
  if (!isConfigured() || !unsplashId) return
  void unsplashFetch('/photos/' + encodeURIComponent(unsplashId) + '/download')
}

export const __unsplashPlusForTests = { isConfigured }
