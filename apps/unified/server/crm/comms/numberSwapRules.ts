// WHICH VISITORS SEE WHICH NUMBER on the business's website (CallRail's dynamic number insertion; ./numberSwap.ts). Pure, so it is
// tested without a server. A visit is read from where it landed (its address's utm_* tags and ad click ids) and where it came from
// (the referrer), as CallRail reads it: an ad click id or a paid utm_medium is the ad network's; a search engine's referrer with
// none is its organic search; a social site, Yelp, an email tag, another site, or nothing at all (direct) each its own.

export const SWAP_SOURCES = [
  { id: 'all', label: 'Every visitor' },
  { id: 'google_ads', label: 'Google Ads' },
  { id: 'google_organic', label: 'Google search (not ads)' },
  { id: 'google_business', label: 'Google Business Profile' },
  { id: 'bing_ads', label: 'Microsoft Ads' },
  { id: 'bing_organic', label: 'Bing search (not ads)' },
  { id: 'other_search', label: 'Other search engines' },
  { id: 'facebook', label: 'Facebook and Instagram' },
  { id: 'yelp', label: 'Yelp' },
  { id: 'email', label: 'Email' },
  { id: 'referral', label: 'Other websites' },
  { id: 'direct', label: 'Direct (typed in, bookmarks)' },
] as const
export type SwapSource = typeof SWAP_SOURCES[number]['id']
const IDS = new Set<string>(SWAP_SOURCES.map((s) => s.id))

/** A swapSource as stored: one of the ids above, or 'utm:<utm_source>' (lowercase letters, digits, - _ .). */
export const UTM_RULE = /^utm:[a-z0-9._-]{1,60}$/
export const isSwapSource = (v: unknown): v is string => typeof v === 'string' && (IDS.has(v) || UTM_RULE.test(v))
export const swapSourceLabel = (v: string) => (v.startsWith('utm:') ? `utm_source = ${v.slice(4)}` : SWAP_SOURCES.find((s) => s.id === v)?.label ?? v)

export interface Landing {
  /** The address the visit landed on (its query carries the utm tags and click ids). */
  page: string
  referrer: string
}

export interface Classified {
  /** The rules this visit matches, most particular first, ending with 'all'. */
  rules: string[]
  /** What a call from it is credited with (call_log source / medium / campaign / keyword / landing page). */
  source: string; medium: string; campaign: string | null; keyword: string | null; landingPage: string | null; referrer: string | null
}

const hostOf = (u: string): string => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }
const isHost = (h: string, ...names: string[]) => names.some((n) => h === n || h.endsWith('.' + n) || h.startsWith(n + '.') || h.includes('.' + n + '.'))
const PAID = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|cpm|display|paid_social|paidsocial)$/

export function classifyVisit(l: Landing): Classified {
  let url: URL | null = null
  try { url = new URL(l.page) } catch { url = null }
  const q = (k: string) => (url?.searchParams.get(k) || '').trim()
  const utmSource = q('utm_source').toLowerCase(), utmMedium = q('utm_medium').toLowerCase(), utmCampaign = q('utm_campaign')
  const keyword = q('utm_term') || null
  const ref = hostOf(l.referrer)
  const own = url ? url.hostname.toLowerCase().replace(/^www\./, '') : ''
  const from = ref && ref !== own ? ref : ''
  const landingPage = url ? `${url.origin}${url.pathname}` : null
  const rules: string[] = []
  let source = 'direct', medium = 'none'

  const gbp = /(^|[^a-z])(gbp|gmb|google[_-]?business|business[_-]?profile)([^a-z]|$)/i.test(`${utmSource} ${utmCampaign} ${utmMedium}`)
  if (gbp) { rules.push('google_business'); source = 'google'; medium = 'business_profile' }
  else if (q('gclid') || q('gbraid') || q('wbraid') || (utmSource === 'google' && PAID.test(utmMedium))) { rules.push('google_ads'); source = 'google'; medium = 'cpc' }
  else if (q('msclkid') || ((utmSource === 'bing' || utmSource === 'microsoft') && PAID.test(utmMedium))) { rules.push('bing_ads'); source = 'bing'; medium = 'cpc' }
  else if (q('fbclid') || ['facebook', 'fb', 'instagram', 'ig', 'meta'].includes(utmSource) || isHost(from, 'facebook.com', 'instagram.com', 'fb.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com')) {
    rules.push('facebook'); source = utmSource || (isHost(from, 'instagram.com') ? 'instagram' : 'facebook'); medium = utmMedium || 'social'
  } else if (utmSource === 'yelp' || isHost(from, 'yelp.com')) { rules.push('yelp'); source = 'yelp'; medium = utmMedium || 'referral' }
  else if (utmMedium === 'email' || utmSource === 'newsletter') { rules.push('email'); source = utmSource || 'email'; medium = 'email' }
  else if (utmSource === 'google' || (!utmSource && (isHost(from, 'google.com') || /^google\.[a-z.]+$/.test(from)))) { rules.push('google_organic'); source = 'google'; medium = utmMedium || 'organic' }
  else if (utmSource === 'bing' || (!utmSource && isHost(from, 'bing.com'))) { rules.push('bing_organic'); source = 'bing'; medium = utmMedium || 'organic' }
  else if (!utmSource && (isHost(from, 'duckduckgo.com', 'yahoo.com', 'search.yahoo.com', 'ecosia.org', 'search.brave.com', 'baidu.com', 'yandex.com'))) { rules.push('other_search'); source = from.split('.').slice(-2, -1)[0] || from; medium = 'organic' }
  else if (utmSource || from) { rules.push('referral'); source = utmSource || from; medium = utmMedium || 'referral' }
  else { rules.push('direct') }

  if (utmSource) rules.unshift(`utm:${utmSource.replace(/[^a-z0-9._-]/g, '').slice(0, 60)}`)
  rules.push('all')
  return { rules, source, medium, campaign: utmCampaign || null, keyword, landingPage, referrer: l.referrer ? l.referrer.slice(0, 500) : null }
}

/** What a call to a website number is credited with when the owner named no source of their own: its rule's source and medium. */
export function ruleAttribution(rule: string): { source: string; medium: string } | null {
  if (rule.startsWith('utm:')) return { source: rule.slice(4), medium: 'referral' }
  const m: Record<string, { source: string; medium: string }> = {
    google_ads: { source: 'google', medium: 'cpc' }, google_organic: { source: 'google', medium: 'organic' }, google_business: { source: 'google', medium: 'business_profile' },
    bing_ads: { source: 'bing', medium: 'cpc' }, bing_organic: { source: 'bing', medium: 'organic' }, other_search: { source: 'search', medium: 'organic' },
    facebook: { source: 'facebook', medium: 'social' }, yelp: { source: 'yelp', medium: 'referral' }, email: { source: 'email', medium: 'email' },
    referral: { source: 'referral', medium: 'referral' }, direct: { source: 'direct', medium: 'none' }, all: { source: 'website', medium: 'website' },
  }
  return m[rule] ?? null
}
