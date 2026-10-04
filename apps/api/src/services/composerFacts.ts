/**
 * Facts policy for the premium-site composer.
 *
 * The composer may WRITE freely — headlines, service descriptions and the
 * "why us" paragraph are framing of what the owner told us. It may not STATE
 * A FACT the owner did not give: a number, a price, a year, a count, a
 * rating, a person, a credential, a customer quote, a caption saying where or
 * when a photo was taken. Those reached a real customer's site (Higgs
 * Heritage Builders, 2026-10-03: a 16-job portfolio, prices, a $15k minimum,
 * invented staff roles, stock faces captioned as the owners).
 *
 * The prompt tells the model the rule; this enforces it afterwards so the
 * prompt does not have to be perfect. It is deterministic and pure — no model
 * call, no I/O — so scripts/check-composer-facts.ts exercises it directly.
 *
 * What it cannot catch: an invented claim with no number, name, quote or photo
 * in it ("we pull every permit"). The prompt carries that rule alone.
 *
 * What a missing fact becomes: the section or the sentence is left out (never
 * a placeholder), a page left with nothing real on it is held back
 * unpublished, and the gap is reported as a ContentGap — a short list of what
 * the owner can add and what it unlocks, shown on the preview, in the preview
 * email and in the site admin.
 */
import type { ComposerInput, Section } from './sectionComposer'

/** Facts the owner can give at intake. Every one is optional. */
export interface IntakeFacts {
  yearFounded?: number
  credentials?: string[]
  freeEstimates?: boolean
  hours?: string
  pricing?: string
  testimonials?: Array<{ quote: string; author?: string }>
}

/**
 * The intake form's optional fact fields → IntakeFacts. Undefined when the
 * owner gave none. Reviews come from one textarea: reviews are separated by a
 * blank line, and a last line starting with a dash is the attribution
 * ("— Dana R., Fort Worth").
 */
export function parseIntakeFacts(raw: {
  yearFounded?: string
  credentials?: string[]
  freeEstimates?: boolean
  hours?: string
  pricing?: string
  testimonials?: string
}, now: Date = new Date()): IntakeFacts | undefined {
  const out: IntakeFacts = {}
  const year = parseInt(String(raw.yearFounded || '').trim(), 10)
  if (Number.isFinite(year) && year >= 1800 && year <= now.getFullYear()) out.yearFounded = year
  const credentials = (raw.credentials || []).map(s => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 12)
  if (credentials.length) out.credentials = credentials
  if (raw.freeEstimates === true) out.freeEstimates = true
  const hours = String(raw.hours || '').trim().slice(0, 200)
  if (hours) out.hours = hours
  const pricing = String(raw.pricing || '').trim().slice(0, 1000)
  if (pricing) out.pricing = pricing
  const testimonials: Array<{ quote: string; author?: string }> = []
  for (const block of String(raw.testimonials || '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const by = /^[—–-]+\s*(.+)$/.exec(lines[lines.length - 1])
    const author = by && lines.length > 1 ? by[1].slice(0, 120) : undefined
    const quote = (author ? lines.slice(0, -1) : lines).join(' ').replace(/^["“]|["”]$/g, '').trim().slice(0, 600)
    if (quote) testimonials.push(author ? { quote, author } : { quote })
    if (testimonials.length >= 5) break
  }
  if (testimonials.length) out.testimonials = testimonials
  return Object.keys(out).length ? out : undefined
}

export type ContentGapId =
  | 'description' | 'photos' | 'ownerPhoto' | 'testimonials'
  | 'yearFounded' | 'credentials' | 'hours' | 'pricing'

export interface ContentGap {
  id: ContentGapId
  /** What the owner can add, in their words. */
  label: string
  /** What appears on the site when they do. */
  unlocks: string
}

export interface FactEnforcementOptions {
  /** Required data keys for a type/variant — SECTION_SCHEMA's `required`. */
  requiredOf: (type: string, variant: string) => readonly string[]
  /** Every section type this vertical's page recipes allow. Decides which gaps apply. */
  allowedTypes: ReadonlySet<string>
  /** Injected so "years in business" is testable. */
  now?: Date
}

export interface FactEnforcement {
  pages: Record<string, Section[]>
  /** Pages left with nothing real on them — seeded unpublished, kept out of the nav. */
  heldPages: string[]
  /** Every sentence, item or section removed, for the staff review queue and the logs. */
  removedClaims: string[]
  contentGaps: ContentGap[]
}

// ─── Numbers ────────────────────────────────────────────────────────────────

// "one" is left out on purpose: "the one who shows up", "no one", "one call"
// read as words far more often than as a count. "first"/"second" likewise.
const SPELLED: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, hundreds: 100, thousand: 1000, thousands: 1000, dozen: 12, dozens: 12,
  third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
}
const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}
const TENS = new Set(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'])

// Contact details are not claims — the owner gave them, and their digits would
// otherwise read as numbers. URLs and e-mail addresses go with them.
const CONTACT_RE = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gi

function norm(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * Every number a piece of copy asserts, normalised ("$1,850" → "1850",
 * "15k" → "15000", "twenty-six" → "26", "8am" → "8"). Contact details excluded.
 */
export function extractNumbers(text: string): string[] {
  const s = String(text || '').replace(CONTACT_RE, ' ')
  const out: string[] = []
  const digitRe = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = digitRe.exec(s))) {
    const raw = m[0].replace(/,+$/, '')
    let value = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const after = s.slice(m.index + m[0].length)
    const unit = /^\s?([kKmM])(?![a-zA-Z])/.exec(after)
    if (unit) value *= unit[1].toLowerCase() === 'k' ? 1000 : 1_000_000
    out.push(norm(value))
  }
  const wordRe = /[a-z]+(?:-[a-z]+)?/gi
  while ((m = wordRe.exec(s))) {
    const [a, b] = m[0].toLowerCase().split('-')
    if (TENS.has(a) && b && UNITS[b]) out.push(norm(SPELLED[a] + UNITS[b]))
    else if (SPELLED[a] !== undefined) out.push(norm(SPELLED[a]))
    else if (b && SPELLED[b] !== undefined) out.push(norm(SPELLED[b]))
  }
  // Response-time and availability promises carry their count as "one"/"a"
  // ("within one business day", "within an hour"), or none at all
  // ("same-day service"). Both are commitments the owner has to keep.
  const promiseRe = /\bwithin\s+(?:one|an?|a single)\s+(?:business\s+|working\s+)?(?:minute|hour|day|week)s?\b/gi
  while ((m = promiseRe.exec(s))) out.push('1')
  if (/\bsame[\s-]day\b/i.test(s)) out.push(SAME_DAY)
  return out
}

/** Sentinel for "same-day" — traceable only when the intake itself promises it. */
const SAME_DAY = 'same-day'

// ─── The intake, as something to check copy against ─────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'our', 'your', 'you', 'are', 'was', 'from', 'that', 'this',
  'have', 'has', 'all', 'any', 'but', 'not', 'its', 'who', 'how', 'what', 'when', 'where',
  'will', 'can', 'into', 'out', 'per', 'via', 'inc', 'llc', 'co',
])

function tokens(text: string): string[] {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function significant(text: string): string[] {
  return tokens(text).filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

interface Corpus {
  text: string
  words: Set<string>
  numbers: Set<string>
  testimonialWords: Set<string>
  testimonials: Array<{ quote: string; author?: string }>
  /** Every photo the owner uploaded. */
  customerPhotos: Set<string>
  /** Uploaded photos that are not the logo — the only ones that may stand for their work or their face. */
  workPhotos: Set<string>
  workPhotoAlt: Map<string, string>
}

function buildCorpus(input: ComposerInput, now: Date): Corpus {
  const f: IntakeFacts = input.facts || {}
  const testimonials = (f.testimonials || []).filter(t => t && typeof t.quote === 'string' && t.quote.trim())
  const parts = [
    input.businessName, input.businessType, input.city, input.state,
    input.description, input.notes, input.ownerName,
    ...(input.services || []), ...(input.nearbyCities || []),
    ...(f.credentials || []), f.hours, f.pricing,
    f.freeEstimates ? 'free estimates free estimate' : '',
    ...testimonials.flatMap(t => [t.quote, t.author || '']),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const text = parts.join('\n')

  const numbers = new Set(extractNumbers(text))
  if (f.yearFounded && Number.isFinite(f.yearFounded)) {
    numbers.add(norm(f.yearFounded))
    // "since 2014" and "11 years" both trace to a founding year; allow the
    // count either side of the anniversary.
    const years = now.getFullYear() - f.yearFounded
    if (years >= 0) { numbers.add(norm(years)); if (years > 0) numbers.add(norm(years - 1)) }
  }

  const customerPhotos = new Set<string>()
  const workPhotos = new Set<string>()
  const workPhotoAlt = new Map<string, string>()
  for (const p of input.customerPhotos || []) {
    if (!p || !p.url) continue
    customerPhotos.add(p.url)
    const isLogo = p.tag === 'misc' || /\blogo\b/i.test(p.alt || '')
    if (isLogo) continue
    workPhotos.add(p.url)
    if (p.alt) workPhotoAlt.set(p.url, p.alt)
  }

  return {
    text: text.toLowerCase(),
    words: new Set(tokens(text)),
    numbers,
    testimonialWords: new Set(testimonials.flatMap(t => tokens(t.quote))),
    testimonials,
    customerPhotos,
    workPhotos,
    workPhotoAlt,
  }
}

function untraceableNumbers(text: string, c: Corpus): string[] {
  return extractNumbers(text).filter(n => !c.numbers.has(n))
}

/** Most of the distinctive words of `text` appear in the intake. */
function wordsTraceable(text: string, c: Corpus, ratio = 0.6): boolean {
  const sig = significant(text)
  if (sig.length === 0) return false
  const hits = sig.filter(t => c.words.has(t)).length
  return hits >= 1 && hits / sig.length >= ratio && untraceableNumbers(text, c).length === 0
}

/** A person's name is theirs only if its first name is in the intake. */
function nameTraceable(name: unknown, c: Corpus): boolean {
  const first = tokens(String(name || '')).find(t => t.length >= 2)
  return !!first && c.words.has(first)
}

function quoteMatch(quote: unknown, c: Corpus): { quote: string; author?: string } | null {
  const sig = significant(String(quote || ''))
  if (sig.length === 0 || c.testimonials.length === 0) return null
  const hits = sig.filter(t => c.testimonialWords.has(t)).length
  if (hits / sig.length < 0.8) return null
  // The intake quote it came from — its author is the only author we can print.
  let best: { quote: string; author?: string } | null = null
  let bestHits = -1
  for (const t of c.testimonials) {
    const words = new Set(tokens(t.quote))
    const h = sig.filter(w => words.has(w)).length
    if (h > bestHits) { best = t; bestHits = h }
  }
  return best
}

function statTraceable(stat: any, c: Corpus): boolean {
  if (!stat || typeof stat !== 'object') return false
  const value = String(stat.value ?? '')
  if (extractNumbers(value).length > 0) return untraceableNumbers(value, c).length === 0
  return wordsTraceable(value, c)
}

// ─── Copy ───────────────────────────────────────────────────────────────────

// Keys whose values are not copy — URLs, enums, machine config. Never scrubbed.
const NON_PROSE_KEYS = new Set([
  'image', 'photo', 'portrait', 'url', 'href', 'beforeImage', 'afterImage', 'bookingPath',
  'exitUrl', 'formAction', 'platform', 'tier', 'type', 'variant', 'filters', 'dietary',
  'serviceZips', 'times', 'defaultTime', 'partySizes', 'mapCenter', 'mapZoom', 'phone',
  'email', 'handle', 'flip', 'seasonOnly', 'currentSeason', 'gateAge', 'stateSelector',
  'dismissable', 'smsOptIn', 'limit', 'maxLeadDays', 'noEmail', 'yesHref', 'startDate',
  'endDate', 'showFinancing', 'guestNoun', 'guestNounPlural', 'partyLabel',
])

// Numeric fields that state a fact about the business. Untraceable → removed.
const NUMERIC_CLAIM_KEYS = new Set([
  'pricePerMonth', 'pricePerSqFt', 'fromMonthly', 'apr', 'minLoanAmount', 'maxLoanAmount',
  'maxTermMonths', 'minSqFt', 'maxSqFt', 'yearsExperience', 'year', 'minHeadcount', 'leadTimeWeeks',
])

function splitSentences(s: string): string[] {
  return s.split(/(?<=[.!?])\s+/)
}

/** Drop each sentence that asserts a number the intake does not contain. */
function scrubText(s: string, c: Corpus, removed: string[]): string {
  const kept: string[] = []
  for (const sentence of splitSentences(s)) {
    if (untraceableNumbers(sentence, c).length > 0) removed.push(sentence.trim())
    else kept.push(sentence)
  }
  return kept.join(' ').trim()
}

function scrubValue(value: any, key: string, c: Corpus, removed: string[]): any {
  if (NON_PROSE_KEYS.has(key)) return value
  if (NUMERIC_CLAIM_KEYS.has(key)) {
    const asText = String(value ?? '')
    if (extractNumbers(asText).length && untraceableNumbers(asText, c).length) {
      removed.push(key + ': ' + asText)
      return undefined
    }
    return value
  }
  if (typeof value === 'string') return scrubText(value, c, removed)
  if (Array.isArray(value)) {
    return value
      .map(v => scrubValue(v, key, c, removed))
      .filter(v => v !== undefined && v !== null && v !== '')
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      const next = scrubValue(v, k, c, removed)
      if (next !== undefined) out[k] = next
    }
    return out
  }
  return value
}

function isEmpty(v: any): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

// ─── Sections ───────────────────────────────────────────────────────────────

/**
 * The per-type rules: what in each section is a fact, and what it must trace
 * to. Returns null to drop the section. Runs before the generic number scrub.
 */
function applySectionPolicy(s: Section, input: ComposerInput, c: Corpus, removed: string[]): Section | null {
  const d: Record<string, any> = { ...(s.data || {}) }
  const label = s.type + '/' + s.variant
  const keepItems = (key: string, ok: (item: any) => boolean) => {
    if (!Array.isArray(d[key])) return
    d[key] = d[key].filter((item: any) => {
      const keep = ok(item)
      if (!keep) removed.push(label + ' item: ' + JSON.stringify(item).slice(0, 160))
      return keep
    })
  }
  const ownPhoto = (url: unknown) => typeof url === 'string' && c.workPhotos.has(url)
  const drop = (why: string): null => { removed.push(label + ' — ' + why); return null }
  const biz = input.businessName

  switch (s.type) {
    case 'testimonials':
      keepItems('items', q => !!quoteMatch(q?.quote, c))
      d.items = (d.items || []).map((q: any) => {
        const src = quoteMatch(q.quote, c)!
        const out: Record<string, any> = { quote: q.quote, author: src.author || '' }
        if (ownPhoto(q.photo)) out.photo = q.photo
        return out
      })
      break
    case 'team':
      keepItems('members', m => nameTraceable(m?.name, c))
      d.members = (d.members || []).map((m: any) => {
        const out = { ...m }
        if (!ownPhoto(out.portrait)) delete out.portrait
        // A role is a fact about the person too. The intake's own words, or
        // owner/founder for the owner the intake names — nothing else.
        const isOwner = !!input.ownerName && nameTraceable(out.name, c) &&
          tokens(input.ownerName)[0] === tokens(String(out.name))[0]
        if (out.role && !wordsTraceable(out.role, c) && !(isOwner && /\b(?:co-?)?(?:owner|founder)\b|\bprincipal\b/i.test(out.role))) {
          removed.push(label + ' role: ' + out.name + ', ' + out.role)
          delete out.role
        }
        return out
      })
      break
    case 'caregivers':
      keepItems('items', m => nameTraceable(m?.name, c))
      d.items = (d.items || []).map((m: any) => {
        const out = { ...m }
        if (!ownPhoto(out.photo)) delete out.photo
        return out
      })
      break
    case 'trust':
      keepItems('items', b => wordsTraceable(b?.name || '', c))
      break
    case 'stats':
      keepItems('items', it => statTraceable(it, c))
      break
    case 'hero':
      keepItems('stats', it => statTraceable(it, c))
      break
    case 'about':
      keepItems('stats', it => statTraceable(it, c))
      if (d.portrait && !ownPhoto(d.portrait)) { removed.push(label + ' portrait (not the owner\'s photo)'); d.portrait = '' }
      if (d.signature) {
        if (input.ownerName && nameTraceable(d.signature, c)) d.signature = input.ownerName
        else { removed.push(label + ' signature: ' + d.signature); delete d.signature }
      }
      break
    case 'gallery':
      // The model never sees an image — any caption it writes is a guess about
      // what, where and when. Only the owner's photos; captions go.
      keepItems('photos', p => ownPhoto(p?.url))
      d.photos = (d.photos || []).map((p: any) => ({ url: p.url, alt: c.workPhotoAlt.get(p.url) || 'Photo from ' + biz }))
      break
    case 'before_after':
      keepItems('items', it => ownPhoto(it?.beforeImage) && ownPhoto(it?.afterImage))
      d.items = (d.items || []).map((it: any) => ({ beforeImage: it.beforeImage, afterImage: it.afterImage }))
      delete d.filters
      break
    case 'pricing':
      keepItems('items', it => untraceableNumbers(String(it?.priceLabel ?? ''), c).length === 0)
      break
    case 'menu':
      keepItems('items', it => wordsTraceable(it?.name || '', c))
      for (const it of d.items || []) {
        if (it.price && untraceableNumbers(String(it.price), c).length) { removed.push(label + ' price: ' + it.price); delete it.price }
      }
      break
    case 'strain':
      keepItems('items', it => wordsTraceable(it?.name || '', c))
      break
    case 'deals':
      keepItems('items', it => wordsTraceable(it?.title || '', c))
      break
    case 'schedule':
      keepItems('days', day => wordsTraceable(day?.location || '', c))
      break
    case 'location':
      if (d.currentAddress && !wordsTraceable(d.currentAddress, c, 0.8)) { removed.push(label + ' address: ' + d.currentAddress); delete d.currentAddress }
      keepItems('recentLocations', l => wordsTraceable(l?.label || '', c))
      break
    case 'contact':
      if (input.facts?.hours) d.hours = [input.facts.hours]
      else if (d.hours) { removed.push(label + ' hours (none supplied)'); delete d.hours }
      if (d.address && !wordsTraceable(d.address, c, 0.8)) { removed.push(label + ' address: ' + d.address); delete d.address }
      break
    case 'emergency':
      if (!/24\s*\/\s*7|24 hours|emergenc|after[\s-]hours/.test(c.text)) return drop('no 24/7 or emergency service in the intake')
      if (d.businessHours && untraceableNumbers(String(d.businessHours), c).length) delete d.businessHours
      break
    case 'financing':
      // The partial falls back to "from $99/mo at 7.99%" when a figure is
      // missing, so a partial section is worse than none.
      if (!/financ/.test(c.text)) return drop('no financing in the intake')
      if (untraceableNumbers(String(d.fromMonthly ?? ''), c).length || untraceableNumbers(String(d.apr ?? ''), c).length || d.fromMonthly == null || d.apr == null) {
        return drop('financing terms not supplied')
      }
      break
    case 'quote':
      // Same: the partial defaults pricePerSqFt to 5.5 and prints a price range from it.
      if (d.pricePerSqFt == null || untraceableNumbers(String(d.pricePerSqFt), c).length) return drop('no price per square foot supplied')
      break
    case 'banner':
      if (!d.startDate || !c.text.includes(String(d.startDate).toLowerCase())) return drop('no storm date in the intake')
      break
    case 'social': {
      const handle = String(d.handle || '').replace(/^@/, '').toLowerCase()
      if (!handle || !c.text.includes(handle)) return drop('no social handle in the intake')
      break
    }
  }
  return { ...s, data: d }
}

/** List-shaped sections are pointless once their list is empty. */
const LIST_KEY: Record<string, string> = {
  testimonials: 'items', team: 'members', caregivers: 'items', trust: 'items', stats: 'items',
  gallery: 'photos', before_after: 'items', pricing: 'items', menu: 'items', strain: 'items',
  deals: 'items', schedule: 'days', faq: 'items', services: 'items', packages: 'items',
  coverage: 'items',
}

// Pages that always publish, however thin. Everything else needs at least one
// section that isn't framing (hero / cta / booking button).
const ALWAYS_PUBLISHED = new Set(['home', 'contact'])
const FRAMING_TYPES = new Set(['hero', 'cta', 'reservation'])

// ─── Entry point ────────────────────────────────────────────────────────────

export function enforceIntakeFacts(
  pagesIn: Record<string, Section[]>,
  input: ComposerInput,
  opts: FactEnforcementOptions,
): FactEnforcement {
  const now = opts.now || new Date()
  const c = buildCorpus(input, now)
  const removed: string[] = []
  const pages: Record<string, Section[]> = {}
  const droppedByPage: Record<string, Set<string>> = {}
  let portraitRemoved = false

  for (const [slug, sections] of Object.entries(pagesIn)) {
    const out: Section[] = []
    droppedByPage[slug] = new Set()
    for (const original of sections || []) {
      const hadPortrait = original.type === 'about' && !!original.data?.portrait
      const policed = applySectionPolicy(original, input, c, removed)
      if (!policed) { droppedByPage[slug].add(original.type); continue }
      if (hadPortrait && !policed.data.portrait) portraitRemoved = true

      const data = scrubValue(policed.data, '', c, removed) as Record<string, any>
      // A question whose answer was an unsupplied fact goes with its answer.
      if (policed.type === 'faq' && Array.isArray(data.items)) {
        data.items = data.items.filter((q: any) => q && !isEmpty(q.question) && !isEmpty(q.answer))
      }
      if (policed.type === 'hero' && isEmpty(data.title)) data.title = input.businessName

      const listKey = LIST_KEY[policed.type]
      if (listKey && isEmpty(data[listKey])) {
        removed.push(policed.type + '/' + policed.variant + ' — nothing left after removing unsupplied facts')
        droppedByPage[slug].add(policed.type)
        continue
      }
      const missing = opts.requiredOf(policed.type, policed.variant).filter(k => isEmpty(data[k]))
      if (missing.length > 0) {
        removed.push(policed.type + '/' + policed.variant + ' — required ' + missing.join(', ') + ' was an unsupplied fact')
        droppedByPage[slug].add(policed.type)
        continue
      }
      out.push({ ...policed, data })
    }
    pages[slug] = out
  }

  const heldPages = Object.keys(pages).filter(slug =>
    !ALWAYS_PUBLISHED.has(slug) && !pages[slug].some(s => !FRAMING_TYPES.has(s.type)))
  if (heldPages.length) {
    for (const slug of Object.keys(pages)) {
      pages[slug] = pages[slug].map(s => ({ ...s, data: unlinkHeld(s.data, new Set(heldPages), removed) }))
    }
  }

  return {
    pages,
    heldPages,
    removedClaims: removed,
    contentGaps: contentGaps(input, c, opts.allowedTypes, heldPages, droppedByPage, portraitRemoved),
  }
}

/** The page slug an href points at ("projects", "/projects", "projects.html#x" → "projects"). */
function hrefSlug(href: unknown): string {
  return String(href || '').replace(/^\//, '').replace(/[?#].*$/, '').replace(/\.html$/i, '').toLowerCase()
}

/**
 * A held page is unpublished on the live site, so a link to it is a 404.
 * A button pointing there ({ label, href }) is removed; a card whose href
 * points there just loses the href.
 */
function unlinkHeld(value: any, held: ReadonlySet<string>, removed: string[]): any {
  if (Array.isArray(value)) {
    return value
      .filter(v => !(v && typeof v === 'object' && 'label' in v && held.has(hrefSlug(v.href))))
      .map(v => unlinkHeld(v, held, removed))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'href' && held.has(hrefSlug(v))) { removed.push('link to held page ' + hrefSlug(v)); continue }
      if (v && typeof v === 'object' && !Array.isArray(v) && 'label' in v && held.has(hrefSlug((v as any).href))) {
        removed.push('button "' + (v as any).label + '" → held page ' + hrefSlug((v as any).href))
        continue
      }
      out[k] = unlinkHeld(v, held, removed)
    }
    return out
  }
  return value
}

// ─── What the owner can add ─────────────────────────────────────────────────

const PAGE_NAME = (slug: string) => slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

function contentGaps(
  input: ComposerInput,
  c: Corpus,
  allowed: ReadonlySet<string>,
  heldPages: string[],
  droppedByPage: Record<string, Set<string>>,
  portraitRemoved: boolean,
): ContentGap[] {
  const f: IntakeFacts = input.facts || {}
  const gaps: ContentGap[] = []
  const heldFor = (types: string[]) => heldPages.filter(slug => types.some(t => droppedByPage[slug]?.has(t)))
  const pagesLine = (slugs: string[]) =>
    'Your ' + joinNames(slugs.map(PAGE_NAME)) + ' page' + (slugs.length > 1 ? 's go' : ' goes') + ' live'

  if (!input.description && !input.notes) {
    gaps.push({ id: 'description', label: 'A few sentences about your business — what you do, who for, and what sets you apart', unlocks: 'Every page reads more like you and less like a template' })
  }
  if (c.workPhotos.size === 0 && (allowed.has('gallery') || allowed.has('before_after'))) {
    const held = heldFor(['gallery', 'before_after'])
    gaps.push({ id: 'photos', label: 'Photos of your real work — three or more', unlocks: held.length ? pagesLine(held) + ', with a gallery of your work' : 'A gallery of your work on the site' })
  }
  if (portraitRemoved || (c.workPhotos.size === 0 && allowed.has('about'))) {
    gaps.push({ id: 'ownerPhoto', label: 'A photo of you (and your team, if you have one)', unlocks: 'Real faces on your About page' })
  }
  if (!(f.testimonials && f.testimonials.length) && allowed.has('testimonials')) {
    gaps.push({ id: 'testimonials', label: 'One or two reviews from customers — copy and paste is fine', unlocks: 'A reviews section on your site' })
  }
  // A fact already in the owner's own words is not a gap, even when the
  // structured field was left blank ("Licensed, insured and bonded", "since 2014").
  if (!f.yearFounded && !/\b(?:since|founded|established|est\.?|started)\s+(?:in\s+)?(?:19|20)\d\d\b/.test(c.text)) {
    gaps.push({ id: 'yearFounded', label: 'The year you started', unlocks: 'Your site can say how long you have been in business' })
  }
  if (!(f.credentials && f.credentials.length) && !/\blicen[cs]ed\b|\binsured\b|\bbonded\b|\bcertified\b|\bcertification/.test(c.text) &&
      (allowed.has('trust') || allowed.has('stats'))) {
    gaps.push({ id: 'credentials', label: 'Licenses, insurance and certifications you hold', unlocks: 'A credentials section customers check before they call' })
  }
  if (!f.hours) {
    gaps.push({ id: 'hours', label: 'Your business hours', unlocks: 'Hours on your contact page' })
  }
  const pricingTypes = ['pricing', 'packages', 'menu', 'quote', 'financing']
  if (!f.pricing && pricingTypes.some(t => allowed.has(t))) {
    const held = heldFor(pricingTypes)
    gaps.push({ id: 'pricing', label: 'Your prices, or where they start', unlocks: held.length ? pagesLine(held) : 'Pricing on your site' })
  }
  return gaps
}
