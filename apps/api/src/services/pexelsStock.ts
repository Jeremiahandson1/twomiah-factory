/**
 * Live stock imagery from Pexels — the composer's tier-2 source when the
 * curated hero library has no set for a vertical (stores, niche businesses)
 * and Unsplash+ isn't subscribed. Free for commercial use; the Pexels
 * Guidelines require crediting the photographer + linking back, which we do by
 * registering every returned photo's attribution in heroLibrary's live registry
 * so the existing URL-driven credit path picks it up.
 *
 * Dormant when PEXELS_API_KEY is unset → returns [], behavior unchanged.
 */
import type { StockPhoto } from './unsplashPlus.ts'
import { registerLiveImage } from '../config/heroLibrary.ts'

const API = 'https://api.pexels.com/v1/search'

// Business types that are not themselves a photo subject — for these the hero
// subject is derived from the products/description instead of the type word.
const GENERIC_TYPE = /drop\s?ship|e-?commerce|online store|\bstore\b|\bshop\b|retail|boutique|marketplace|general|other|business/i

const STOP = new Set([
  'the','and','for','with','your','our','their','from','that','this','you','are','was','were','has','have',
  'kit','kits','pack','packs','set','sets','new','store','shop','online','best','premium','quality','products',
  'product','items','item','gift','gifts','free','shipping','more','plus','style','styles','collection',
])

/** Strip a suffix so bird/birds/birding/birders all collapse to one token. */
function stem(w: string): string {
  return w.replace(/(ing|ers|er|es|s)$/i, '') || w
}

/** The dominant subject noun for the store — e.g. "bird" for a birding store —
 *  used to anchor otherwise-ambiguous product queries ("journals" → "bird journals"). */
function subjectAnchor(businessType: string, services: string[], description: string, businessName: string): string {
  if (businessType && !GENERIC_TYPE.test(businessType)) {
    return businessType.toLowerCase().split(/\s+/).filter(w => !STOP.has(w))[0] || businessType.toLowerCase()
  }
  const text = [description, services.join(' '), businessName].join(' ').toLowerCase()
  const counts = new Map<string, number>()
  for (const raw of text.match(/[a-z]{4,}/g) || []) {
    const w = stem(raw)
    if (w.length < 3 || STOP.has(raw) || STOP.has(w)) continue
    counts.set(w, (counts.get(w) || 0) + 1)
  }
  let best = '', bestN = 0
  for (const [w, n] of counts) if (n > bestN) { best = w; bestN = n }
  return best
}

/** Turn one service/product line into a short, photo-friendly Pexels query. */
function serviceQuery(service: string, anchor: string): string | null {
  let s = service.toLowerCase()
    .replace(/\([^)]*\)/g, ' ')          // drop parentheticals
    .split(/\band\b|[,+/]/)[0]           // first item of a compound
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  const words = s.split(' ').filter(w => w && !STOP.has(w)).slice(0, 3)
  if (words.length === 0) return null
  let q = words.join(' ')
  // Anchor the query to the store's subject when the product word doesn't
  // already carry it (so "journals" reads as "bird journals", not stationery).
  if (anchor && !words.some(w => stem(w).includes(anchor) || anchor.includes(stem(w)))) {
    q = anchor + ' ' + q
  }
  return q.trim()
}

interface QuerySpec { query: string; tag: string; orientation: 'landscape' | 'portrait' | 'square'; perPage: number }

export function deriveStockQueries(
  businessType: string, services: string[], description: string, businessName: string,
): QuerySpec[] {
  const anchor = subjectAnchor(businessType, services, description, businessName)
  const specs: QuerySpec[] = []
  // Hero: the subject itself, wide.
  const hero = (anchor || businessType || 'business').trim()
  specs.push({ query: hero, tag: 'hero', orientation: 'landscape', perPage: 6 })
  // One product/service photo per line — these fill the "what we stock" cards.
  const seen = new Set<string>([hero])
  for (const svc of services.slice(0, 10)) {
    const q = serviceQuery(svc, anchor)
    if (!q || seen.has(q)) continue
    seen.add(q)
    specs.push({ query: q, tag: 'services', orientation: 'landscape', perPage: 3 })
    if (specs.length >= 9) break
  }
  return specs
}

/** Ask a small model to turn products/description into concrete, on-theme
 *  photo search phrases — it resolves brand/compound names ("binocular harness"
 *  → "birdwatching binoculars") far better than word heuristics. Returns null on
 *  any failure so the caller falls back to deriveStockQueries(). */
export async function deriveStockQueriesAI(
  businessType: string, services: string[], description: string, businessName: string,
): Promise<QuerySpec[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 })
    const prompt = `Choose stock-photo search queries for a website's imagery.
Business: "${businessName}" — ${businessType}.
${description ? 'About: ' + description : ''}
Products / sections (in order):
${services.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a JSON array (no prose) of up to 9 objects: {"query": string, "tag": "hero"|"services"}.
- Exactly one object with tag "hero": a 1-3 word phrase for a striking on-theme lifestyle photo (the store's subject in its natural setting).
- One "services" object per product line, in the same order: a 2-3 word CONCRETE phrase that returns a photo evoking that product.
- Resolve brand / kit / compound names to real photographable subjects and anchor every query to the store's theme. Example (birding store): "binocular harness + lens kit" -> "birdwatching binoculars"; "life-list journal" -> "nature journal"; "smart feeder" -> "bird feeder camera".
- Only things that exist as stock photos. No brand names. Lowercase.`
    const resp: any = await anthropic.messages.create({
      model: process.env.ANTHROPIC_IMAGE_QUERY_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (resp?.content || []).map((b: any) => b?.text || '').join('')
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const specs: QuerySpec[] = []
    for (const it of parsed) {
      const query = typeof it?.query === 'string' ? it.query.trim().toLowerCase() : ''
      if (!query || query.length > 40) continue
      const tag = it?.tag === 'hero' ? 'hero' : 'services'
      specs.push({ query, tag, orientation: 'landscape', perPage: tag === 'hero' ? 6 : 3 })
    }
    return specs.length > 0 ? specs.slice(0, 9) : null
  } catch (err: any) {
    console.warn('[Pexels] AI query derivation failed:', err?.message)
    return null
  }
}

async function pexelsSearch(spec: QuerySpec): Promise<StockPhoto[]> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []
  const params = new URLSearchParams({
    query: spec.query,
    per_page: String(Math.min(Math.max(spec.perPage, 1), 30)),
    orientation: spec.orientation,
  })
  try {
    const res = await fetch(API + '?' + params.toString(), {
      headers: { Authorization: key }, signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn('[Pexels] search', spec.query, '→', res.status); return [] }
    const data = await res.json() as any
    const photos = Array.isArray(data?.photos) ? data.photos : []
    return photos.map((p: any): StockPhoto | null => {
      const url = p?.src?.large2x || p?.src?.large || p?.src?.original
      if (!url) return null
      // Register attribution so the composed page credits this photo.
      registerLiveImage(url, {
        file: url, tag: spec.tag, source: 'pexels',
        photographer: p.photographer || 'Unknown',
        photographerUrl: p.photographer_url || 'https://www.pexels.com',
        sourceUrl: p.url, sourceId: String(p.id || ''), license: 'Pexels License',
      })
      return {
        url, alt: p.alt || spec.query, tag: spec.tag,
        unsplashId: '', photographer: p.photographer || 'Unknown',
        photographerLink: p.photographer_url || 'https://www.pexels.com',
      }
    }).filter(Boolean) as StockPhoto[]
  } catch (err: any) {
    console.warn('[Pexels] search failed:', err?.message)
    return []
  }
}

/** Fetch a diverse, subject-relevant stock pool from Pexels. Deduped by URL. */
export async function searchPexelsStock(input: {
  businessType: string; services?: string[]; description?: string; businessName?: string;
}): Promise<StockPhoto[]> {
  if (!process.env.PEXELS_API_KEY) return []
  const services = (input.services || []).filter(Boolean)
  const specs = await deriveStockQueriesAI(input.businessType || '', services, input.description || '', input.businessName || '')
    || deriveStockQueries(input.businessType || '', services, input.description || '', input.businessName || '')
  const batches = await Promise.all(specs.map(pexelsSearch))
  const seen = new Set<string>()
  const out: StockPhoto[] = []
  for (const batch of batches) for (const p of batch) {
    const clean = p.url.split(/[?#]/)[0]
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(p)
  }
  return out
}
