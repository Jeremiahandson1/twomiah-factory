// The instant estimator: a homeowner types an address on the roofer's website and gets a price range from the roof's
// measured squares and the company's own price per square. Moved from templates/crm-roof/backend/src/routes/
// estimator.ts (public, no sign-in) and the estimator part of routes/settings.ts (PUT /api/settings/estimator). The
// measuring is packages/roof-core's.
//
// How the roof is measured (2026-11-11): from Google's height map and roof mask (roof-core v2 measureRoof — the roof
// under the address pin, area on the slope, with a grade of how far to trust it), not from Google's ready-made building
// summary, which read 19–94% short on four of nine professionally measured houses and said nothing. A roof graded red
// (pin not on a roof, too cut-up, too much under trees) or that cannot be measured is NOT priced: the visitor is told
// the business will measure it and get back to them, and the lead is kept all the same.
//
// What a visitor must give: a name and a phone number or an email — before any price, so every estimate is a lead
// (as Zuper's and Roofle's estimators ask; looked at 2026-11-11). Someone the business already has, by email or phone,
// stays one contact (Zuper's rule).
// What it costs the roofer: ONE ROOF REPORT from their balance (roofCredits.ts — the same pack the drawn roof report
// spends from) for each new house measured, because that is the call that costs Twomiah. No add-on, no monthly charge
// (owner, 2026-11-11). It is taken before Google is asked, and given back if Google never answered. A house already
// measured in the last 30 days is answered from the kept measurement and costs nothing. One visitor may ask a few
// times an hour, which now guards the roofer's balance. A BUSINESS is never limited.
// With no roof reports left the estimator is OFF the website (its config answers as when the roofer has switched it
// off, so the widget shows nothing) until they top up — no visitor meets a tool that cannot answer (owner, 2026-11-11).
//
// Changes from the template:
//   · the lead it captures is a CRM contact with one `name` (decision 3) and roofing's lead_source is the CRM's
//     `source`;
//   · the public estimator is mounted behind instant_estimator — the menu's switch for it — so a business without the
//     feature has no public estimator (404); the company's own "estimator enabled" setting still refuses with 403;
//   · the settings write asks company:update (owner and admin — the rank the template's requireAdmin named), validates
//     the prices as money, and replies { success, message };
//   · a bad body is the rulebook's validation reply (400, `fields`).
//
// /api/settings' /company and /branding are not moved: they are the CRM's own company record, GET and PUT /api/company
// (server/modules/company.ts, the shared createCompanyRoutes), which reads the whole company — the estimator columns and
// slug included — and writes the name, contact details, address and brand colour (admin; a hex colour checked).
//
// Three things the estimators it stands beside do (Roofle RoofQuote PRO, Zuper, Roofr; looked at 2026-11-11), built here:
//   · a price for each roof the business sells — its own list of options (asphalt, metal…), each with its own low and
//     high per square, a line about it and a picture; the visitor says which one they are interested in, and that is
//     kept on the lead. With financing connected, each shows the lender's "as low as" monthly figure. A business with
//     no list has the one range from its two prices, as before;
//   · the service area — a business may say how many miles from its own address it works; an address outside it is
//     told so, is not measured, uses no roof report and is not kept as a lead (Roofle: "only addresses within your
//     market can generate quotes");
//   · the outline — the visitor sees their roof outlined on the aerial picture, can drag a corner where it is wrong,
//     or tap the right building when the pin landed on the wrong one, and the estimate is worked out again from what
//     they showed (Zuper: "the homeowner can adjust the outline"). A roof that was not priced because the pin was off
//     it, or too much of it could not be read, is priced once the visitor has shown which roof and where. Correcting
//     costs nothing more: it is worked out from a small slope map kept with the measurement, not from Google again.
// These settings live in the company's `settings.estimator` (no new columns).
import { Hono } from 'hono'
import { z } from 'zod'
import sharp from 'sharp'
import { createId } from '@paralleldrive/cuid2'
import { and, count, desc, eq, gte, ilike, isNull, or } from 'drizzle-orm'
import { geocodeAddress, getDataLayers, downloadGeoTiff, formatSolarDate } from '@twomiah/roof-core'
import { measureRoof, type RoofMeasurement } from '@twomiah/roof-core/src/v2/index.ts'
import { roofOutlines, outlineArea, outlineProblem, type OutlinePoint, type RoofOutlines, type SlopeMap } from '@twomiah/roof-core/src/v2/roofOutline.ts'
import { normaliseZip, ZIP_ERROR } from '@twomiah/tenant-backend'
import { company, contact, measurementReport } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import { PLACE_ID_RE, SESSION_RE, pickedAddress, suggestAddresses } from './addressSuggest.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { email as emailShape, optional } from '../validation.ts'
import { recordConsent } from '../../../site/smsConsent.ts'
import { createFinancingService, offerFor } from '../../financing/service.ts'
import { createRoofCredits } from './roofCredits.ts'
import { callerAddress } from '../../../http/guards.ts'

const estimateSchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1).refine((v) => normaliseZip(v) !== null, { message: ZIP_ERROR }),
  name: z.string().trim().min(1, 'Your name is needed'),
  email: optional(emailShape),
  phone: z.string().optional(),
}).superRefine((v, ctx) => {
  if (!v.email && !v.phone?.trim()) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'A phone number or an email is needed' })
})

/** Aerial data around the pin (m): wide enough for a large house, as the scoreboard measured with. */
const RADIUS_M = 50
/** Estimates one visitor (by internet address) may ask for in an hour: their own house, and a second try or a second
 *  property. A business is not limited — as with Roofle ("unlimited instant quotes") and the others looked at. */
const ASKS_PER_VISITOR = 3
/** Corrections to the outline, and choices of an option, one visitor may send in an hour (neither costs anything). */
const CHANGES_PER_VISITOR = 40
/** Address look-ups (suggestions and the one picked) one visitor may ask in an hour: a few addresses typed out, with
 *  room to spare; each one is a call to Google that Twomiah pays for. */
const LOOKUPS_PER_VISITOR = 120
/** A house the estimator has measured is not measured again for this many days; the kept measurement answers. */
const REMEASURE_AFTER_DAYS = 30
/** How many times one estimate's outline may be corrected. */
const MAX_ADJUSTMENTS = 8
/** A corrected outline must be a roof: between these many squares. */
const MIN_SQUARES = 2, MAX_SQUARES = 200
const MAX_OPTIONS = 6
const NOT_QUOTED = 'Thanks — we could not measure this roof from the air. We will measure it ourselves and get back to you with your estimate.'
const PICK_YOUR_ROOF = 'We could not be sure which roof is yours, or where its edges are. Tap your roof on the picture and drag its corners to fit, and we will work out your estimate.'
const OUT_OF_AREA = 'Sorry — that address is outside the area we serve, so we cannot give an estimate for it.'

/** The measured faces in the shape the measurement record keeps its segments in. */
const segmentsOf = (m: RoofMeasurement) => m.faces.faces.map((f, i) => ({
  name: `Segment ${i + 1}`, area: f.slopeSqft, pitch: `${Math.round(f.pitchOver12)}/12`,
  pitchDegrees: Math.round(Math.atan(f.pitchOver12 / 12) * (180 / Math.PI) * 10) / 10, azimuthDegrees: f.azimuthDeg,
}))

/** A price per square as the column stores it: a decimal string, not negative. */
const pricePerSquare = z.union([z.string(), z.number()]).transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), { message: 'must be an amount like 350.00' })

// ── The business's own options and service area (company.settings.estimator) ──

/** One roof the business sells, as the estimator prices it. */
export interface EstimatorOption { id: string; name: string; description: string; pricePerSquareLow: string; pricePerSquareHigh: string; imageUrl: string | null }
export interface EstimatorExtras {
  options: EstimatorOption[]
  /** Miles from the business's own address it works within; null = anywhere. */
  serviceRadiusMiles: number | null
  /** The business's own address on the map, found when the radius was saved. */
  base: { lat: number; lng: number } | null
}

const optionSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, 'Give the option a name').max(60),
  description: z.string().trim().max(240).optional().default(''),
  pricePerSquareLow: pricePerSquare,
  pricePerSquareHigh: pricePerSquare,
  imageUrl: z.union([z.literal(''), z.null(), z.string().trim().max(500).refine((v) => /^https:\/\/[^\s"'<>]+$/.test(v), { message: 'A picture address must start with https://' })]).optional(),
}).refine((o) => Number(o.pricePerSquareHigh) >= Number(o.pricePerSquareLow), { path: ['pricePerSquareHigh'], message: 'The high price cannot be under the low price' })

const settingsSchema = z.object({
  estimatorEnabled: z.boolean(),
  pricePerSquareLow: pricePerSquare,
  pricePerSquareHigh: pricePerSquare,
  estimatorHeadline: z.string(),
  estimatorDisclaimer: z.string(),
  // Absent = left as they are (an older screen saving the five above).
  options: z.array(optionSchema).max(MAX_OPTIONS, `At most ${MAX_OPTIONS} options`).optional(),
  serviceRadiusMiles: z.union([z.null(), z.literal(''), z.coerce.number().int('Whole miles').min(1, 'At least 1 mile').max(500, 'At most 500 miles')]).optional(),
})

/** New houses the public estimator may measure (and spend a report on) in 24 hours: settings.estimator.dailyCeiling, else 40. */
export const ESTIMATOR_DAILY_CEILING = 40
export function estimatorDailyCeiling(comp: { settings?: unknown }): number {
  let s: any = comp.settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  const n = Number(s?.estimator?.dailyCeiling)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : ESTIMATOR_DAILY_CEILING
}

export function estimatorExtras(comp: { settings?: unknown }): EstimatorExtras {
  let s: any = comp.settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  const e = s && typeof s === 'object' && s.estimator && typeof s.estimator === 'object' ? s.estimator : {}
  const options: EstimatorOption[] = (Array.isArray(e.options) ? e.options : []).filter((o: any) => o && typeof o.name === 'string' && o.name).slice(0, MAX_OPTIONS).map((o: any) => ({
    id: String(o.id || ''), name: String(o.name), description: String(o.description || ''),
    pricePerSquareLow: String(o.pricePerSquareLow ?? '0'), pricePerSquareHigh: String(o.pricePerSquareHigh ?? '0'), imageUrl: o.imageUrl ? String(o.imageUrl) : null,
  }))
  const radius = Number(e.serviceRadiusMiles)
  const base = e.base && Number.isFinite(Number(e.base.lat)) && Number.isFinite(Number(e.base.lng)) ? { lat: Number(e.base.lat), lng: Number(e.base.lng) } : null
  return { options, serviceRadiusMiles: Number.isFinite(radius) && radius > 0 ? radius : null, base }
}

/** What is priced: the business's own options, or — with none — the one range from its two prices. */
function pricedOptions(comp: any): EstimatorOption[] {
  const own = estimatorExtras(comp).options
  return own.length ? own : [{ id: 'standard', name: 'Roof replacement', description: '', pricePerSquareLow: String(comp.pricePerSquareLow), pricePerSquareHigh: String(comp.pricePerSquareHigh), imageUrl: null }]
}

/** Miles between two places on the earth. */
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** /api/estimator — public. */
export function createEstimatorRoutes(d: CrmDeps) {
  const { db, logger } = d
  const app = new Hono<AppEnv>()
  const credits = createRoofCredits(d)
  const financing = createFinancingService(d)

  /** Each option priced for a roof of `squares`, with the lender's monthly figure when the business offers financing. */
  async function priced(comp: any, squares: number) {
    const finance = (await d.features.isFeatureEnabled(comp.id, 'consumer_financing')) && !!(await financing.connection(comp.id).catch(() => null))
    let disclosure: string | null = null
    const options = pricedOptions(comp).map((o) => {
      const estimateLow = Math.round(squares * Number(o.pricePerSquareLow)), estimateHigh = Math.round(squares * Number(o.pricePerSquareHigh))
      const offer = finance ? offerFor(estimateLow) : null
      if (offer) disclosure = offer.disclosure
      return {
        id: o.id, name: o.name, description: o.description, imageUrl: o.imageUrl, estimateLow, estimateHigh,
        ...(offer ? { financing: { asLowAs: offer.asLowAs, apr: offer.apr, termMonths: offer.termMonths, lender: offer.lender } } : {}),
      }
    })
    // The first option's range is also the reply's own (what a page written for the one-range estimator reads).
    return { options, estimateLow: options[0].estimateLow, estimateHigh: options[0].estimateHigh, ...(disclosure ? { financingDisclosure: disclosure } : {}) }
  }

  /** The company behind a slug with its estimator on, or the refusal. */
  async function openCompany(c: any): Promise<{ comp: any } | { refusal: Response }> {
    const [comp] = await db.select().from(company).where(eq(company.slug, c.req.param('slug'))).limit(1)
    if (!comp) return { refusal: fail(c, 404, 'Company not found') }
    if (!comp.estimatorEnabled) return { refusal: fail(c, 403, 'Estimator not enabled') }
    return { comp }
  }

  /** One of this business's estimator records, by the id the widget was given. */
  async function ownEstimate(companyId: string, id: unknown) {
    if (typeof id !== 'string' || !id) return null
    const [row] = await db.select().from(measurementReport).where(and(
      eq(measurementReport.id, id), eq(measurementReport.companyId, companyId), isNull(measurementReport.jobId), eq(measurementReport.cost, '0.00'),
    )).limit(1)
    return row && (row.rawData as any)?.source === 'instant_estimator' ? row : null
  }

  // GET /config/:slug — what the widget shows: the company's name, colour, headline, disclaimer and price per square.
  app.get('/config/:slug', async (c) => {
    const [comp] = await db.select({
      name: company.name, slug: company.slug, primaryColor: company.primaryColor, estimatorEnabled: company.estimatorEnabled,
      pricePerSquareLow: company.pricePerSquareLow, pricePerSquareHigh: company.pricePerSquareHigh,
      estimatorHeadline: company.estimatorHeadline, estimatorDisclaimer: company.estimatorDisclaimer,
      phone: company.phone, email: company.email, reportCredits: company.reportCredits,
    }).from(company).where(eq(company.slug, c.req.param('slug'))).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    // Off: switched off by the roofer, or no roof reports left to measure with.
    if (!comp.estimatorEnabled || Number(comp.reportCredits) <= 0) return fail(c, 403, 'Estimator not enabled')
    const { reportCredits: _balance, ...shown } = comp
    return one(c, shown)
  })

  // GET /addresses/:slug?q=&s= — street addresses for what the visitor has typed (addressSuggest.ts), and
  // GET /address/:slug?id=&s= — the street, city, state and zip of the one they picked. `s` is the widget's session token
  // for the one address being typed. Only while the business's estimator is on; Google not answering is an empty list.
  const lookups = createRateLimiter(60 * 60 * 1000, process.env.NODE_ENV === 'production' ? LOOKUPS_PER_VISITOR : 100000)
  app.get('/addresses/:slug', lookups, async (c) => {
    const opened = await openCompany(c)
    if ('refusal' in opened) return opened.refusal
    const q = String(c.req.query('q') || '').trim().slice(0, 120)
    const s = String(c.req.query('s') || '')
    if (!SESSION_RE.test(s)) return fail(c, 400, 'A session token is required', 'bad_session')
    if (q.length < 3) return one(c, { suggestions: [] })
    return one(c, { suggestions: await suggestAddresses(q, s) })
  })
  app.get('/address/:slug', lookups, async (c) => {
    const opened = await openCompany(c)
    if ('refusal' in opened) return opened.refusal
    const id = String(c.req.query('id') || '')
    const s = String(c.req.query('s') || '')
    if (!SESSION_RE.test(s) || !PLACE_ID_RE.test(id)) return fail(c, 400, 'A suggestion and its session token are required', 'bad_lookup')
    const picked = await pickedAddress(id, s)
    return picked ? one(c, picked) : fail(c, 404, 'That address could not be looked up', 'not_found')
  })

  // POST /estimate/:slug — keep the lead, measure the roof, and price it at the company's own prices when the
  // measurement can be trusted.
  app.post('/estimate/:slug', createRateLimiter(60 * 60 * 1000, process.env.NODE_ENV === 'production' ? ASKS_PER_VISITOR : 100000), async (c) => {
    const slug = c.req.param('slug')
    const opened = await openCompany(c)
    if ('refusal' in opened) return opened.refusal
    const comp = opened.comp
    const body: any = (await c.req.json().catch(() => null)) ?? {}
    if (typeof body.email === 'string') body.email = body.email.toLowerCase().trim()
    const parsed = estimateSchema.safeParse(body)
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const who = { companyName: comp.name, companyPhone: comp.phone, companyEmail: comp.email }

    // A house this business's estimator has already measured in the last 30 days is not measured (or paid for) again:
    // the kept measurement answers, at today's prices.
    const [prior] = await db.select().from(measurementReport).where(and(
      eq(measurementReport.companyId, comp.id), isNull(measurementReport.jobId), eq(measurementReport.cost, '0.00'),
      ilike(measurementReport.address, data.address.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)), eq(measurementReport.zip, data.zip),
      gte(measurementReport.createdAt, new Date(Date.now() - REMEASURE_AFTER_DAYS * 24 * 60 * 60 * 1000)),
    )).orderBy(desc(measurementReport.createdAt)).limit(1)

    // An address Google cannot place is the visitor's to correct: nothing is kept.
    let geo: { lat: number; lng: number } | null = null
    if (!prior) {
      try { geo = await geocodeAddress(data.address, data.city, data.state, data.zip) } catch (err: any) {
        logger.error('Instant estimate failed', { slug, error: err?.message })
        return fail(c, 422, 'Unable to generate estimate for this address. Please try again or contact us directly.')
      }
    }

    // The service area: an address outside it is told so — not measured, no roof report used, not kept as a lead.
    const extras = estimatorExtras(comp)
    const place = geo ?? (prior?.center as any)
    if (extras.serviceRadiusMiles && extras.base && place && Number.isFinite(Number(place.lat)) && milesBetween(extras.base, { lat: Number(place.lat), lng: Number(place.lng) }) > extras.serviceRadiusMiles) {
      logger.info('Instant estimate: outside the service area', { slug })
      return one(c, { quoted: false, outOfArea: true, message: OUT_OF_AREA, ...who })
    }

    // The visitor is a lead whether or not the roof can be priced. Someone the business already has — the same email
    // or the same phone number — stays the one contact they are, rather than becoming a second.
    const phone = data.phone?.trim() || null
    let leadContactId: string | null = null
    let leadCreated = false
    try {
      const same = [data.email ? eq(contact.email, data.email) : null, phone ? eq(contact.phone, phone) : null].filter((x) => x !== null)
      const [known] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, comp.id), or(...same))).limit(1)
      if (known) leadContactId = known.id
      else {
        const [created] = await db.insert(contact).values({
          companyId: comp.id, type: 'lead', name: data.name,
          email: data.email || null, phone,
          address: data.address, city: data.city, state: data.state, zip: data.zip,
          source: 'instant_estimator', propertyType: 'residential',
        } as any).returning()
        leadContactId = created?.id ?? null
        leadCreated = !!leadContactId
      }
    } catch { /* the estimate still goes back */ }
    // The widget's "Text me about my estimate" (site/smsConsent.ts; the box is in site/public/scripts/estimator.ts).
    if (data.phone && body.smsConsent === true) {
      await recordConsent(db, comp.id, { phone: data.phone, source: 'website_form', topic: 'estimate', page: c.req.header('referer') || null, ip: callerAddress(c) })
        .catch(() => { /* the estimate still goes back */ })
    }

    const notQuoted = () => one(c, { quoted: false, message: NOT_QUOTED, ...who })

    if (prior) {
      const squares = Number(prior.totalSquares)
      if (prior.status !== 'complete' || !(squares > 0)) return notQuoted()
      logger.info('Instant estimate served from the kept measurement', { slug, squares })
      return one(c, {
        quoted: true, estimateId: prior.id,
        totalSquares: squares, totalAreaSqft: Math.round(Number(prior.totalArea)), segments: Array.isArray(prior.segments) ? prior.segments.length : 0,
        imageryQuality: prior.imageryQuality, ...(await priced(comp, squares)),
        disclaimer: comp.estimatorDisclaimer, ...who,
      })
    }
    if (!geo) return notQuoted()

    // One roof report for this house. None left (the last went while this visitor's page was open): the lead is kept
    // and the business follows up.
    // A DAY'S CEILING (security review S2-14, 2026-11-13). Each new house spends one of the roofer's paid reports, and the
    // only limit was three an hour per address: a list of addresses could empty the balance in an afternoon. Past the
    // ceiling the visitor is still a lead (kept above) and the business follows up, exactly as when no reports are left.
    const [spentToday] = await db.select({ n: count() }).from(measurementReport).where(and(
      eq(measurementReport.companyId, comp.id), isNull(measurementReport.jobId), eq(measurementReport.provider, 'google_solar'),
      gte(measurementReport.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ))
    if (Number(spentToday?.n || 0) >= estimatorDailyCeiling(comp)) {
      logger.warn('Instant estimate not priced', { slug, reason: 'the daily ceiling of estimator reports is reached' })
      return notQuoted()
    }
    if (!(await credits.spend(comp.id))) {
      logger.info('Instant estimate not priced', { slug, reason: 'no roof reports left' })
      return notQuoted()
    }

    let roof: RoofMeasurement | null = null
    let shapes: RoofOutlines | null = null
    let picture: string | null = null
    let imageryQuality: string | null = null
    let imageryDate: string | null = null
    let failure: string | null = null
    try {
      const layers = await getDataLayers(geo.lat, geo.lng, RADIUS_M, 0.25)
      imageryQuality = layers.imageryQuality || null
      imageryDate = layers.imageryDate ? formatSolarDate(layers.imageryDate) : null
      const [dsmTif, maskTif] = await Promise.all([downloadGeoTiff(layers.dsmUrl), downloadGeoTiff(layers.maskUrl)])
      const now = new Date()
      roof = await measureRoof(dsmTif, maskTif, { quality: layers.imageryQuality, date: layers.imageryDate, today: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } })
      if (!roof) failure = 'no roof found at the address'
      // The picture and the outlines on it, for the visitor to check — the estimate stands without them.
      try {
        shapes = await roofOutlines(dsmTif, maskTif, roof ? roof.faces : null)
        if (shapes.outlines.length) picture = `data:image/jpeg;base64,${(await sharp(await downloadGeoTiff(layers.rgbUrl)).removeAlpha().jpeg({ quality: 80 }).toBuffer()).toString('base64')}`
      } catch (err: any) {
        logger.warn('Instant estimate: no picture to check the outline on', { slug, error: err?.message })
      }
      if (!picture) shapes = null
    } catch (err: any) {
      failure = err?.message || 'measuring failed'
      // Google never answered with a roof to measure: the roof report is given back.
      await credits.giveBack(comp.id)
    }
    const quoted = !!roof && roof.grade !== 'red'
    const prices = quoted ? await priced(comp, roof!.squares) : null

    // M8: the measurement is kept (no job yet; one roof report from the balance, no money charged here — cost 0.00,
    // which with the missing job is also how the estimator's own records are told apart), so the rep who calls back has
    // the squares and the range the homeowner was shown — or, for a roof that was not priced, why not. The slope map is
    // kept with it, so the visitor's corrected outline can be measured later without asking Google again.
    const id = createId()
    let kept = false
    try {
      await db.insert(measurementReport).values({
        id, companyId: comp.id, jobId: null, address: data.address, city: data.city, state: data.state, zip: data.zip,
        provider: 'google_solar', status: quoted ? 'complete' : 'failed',
        totalSquares: quoted ? String(roof!.squares) : null, totalArea: quoted ? String(Math.round(roof!.areaSqft)) : null,
        segments: quoted ? segmentsOf(roof!) : null, imageryQuality, imageryDate,
        center: { lat: geo.lat, lng: geo.lng },
        cost: '0.00',
        rawData: {
          source: 'instant_estimator', quoted, grade: roof?.grade ?? null, reasons: roof?.reasons ?? [],
          ...(failure ? { error: failure } : {}),
          ...(roof ? { measuredSquares: roof.squares, hiddenSqft: roof.faces.hiddenSlopeSqft } : {}),
          estimateLow: prices?.estimateLow ?? null, estimateHigh: prices?.estimateHigh ?? null,
          pricePerSquareLow: Number(comp.pricePerSquareLow), pricePerSquareHigh: Number(comp.pricePerSquareHigh),
          ...(prices ? { options: prices.options.map((o) => ({ id: o.id, name: o.name, estimateLow: o.estimateLow, estimateHigh: o.estimateHigh })) } : {}),
          contactId: leadContactId, leadCreated, servedAt: new Date().toISOString(),
          ...(shapes ? { slope: shapes.slope, adjustments: 0 } : {}),
        },
      } as any)
      kept = true
    } catch (e: any) {
      logger.error('Could not record the instant estimate', { slug, message: e?.message })
    }
    // A new lead's note says what they were shown, so whoever calls back reads it on the contact.
    if (leadCreated && prices) await noteOnLead(leadContactId!, `Instant estimate on the website: ${roof!.squares} squares, $${prices.estimateLow.toLocaleString('en-US')} – $${prices.estimateHigh.toLocaleString('en-US')}${prices.options.length > 1 ? ` (${prices.options[0].name})` : ''}.`)

    // The picture goes back only with a record to correct against.
    const check = shapes && kept ? { picture: { image: picture, width: shapes.slope.width, height: shapes.slope.height, metresPerPixel: shapes.slope.px, outlines: shapes.outlines } } : {}
    if (!quoted) {
      logger.info('Instant estimate not priced', { slug, grade: roof?.grade ?? null, reason: failure ?? roof?.reasons[0] ?? null })
      // With roofs in the picture the visitor can show which is theirs; with none there is nothing to show.
      if (shapes && kept) return one(c, { quoted: false, canPick: true, estimateId: id, message: PICK_YOUR_ROOF, ...check, ...who })
      return notQuoted()
    }
    logger.info('Instant estimate served', { slug, squares: roof!.squares, grade: roof!.grade })
    return one(c, {
      quoted: true, ...(kept ? { estimateId: id } : {}),
      totalSquares: roof!.squares, totalAreaSqft: Math.round(roof!.areaSqft), segments: roof!.faces.faces.length,
      imageryQuality, ...prices!, ...check,
      disclaimer: comp.estimatorDisclaimer, ...who,
    })
  })

  /** Add a line to a lead's notes (a lead this estimator made). Never throws. */
  async function noteOnLead(contactId: string, line: string) {
    try {
      const [row] = await db.select({ notes: contact.notes }).from(contact).where(eq(contact.id, contactId)).limit(1)
      if (!row) return
      await db.update(contact).set({ notes: [row.notes, line].filter(Boolean).join('\n'), updatedAt: new Date() } as any).where(eq(contact.id, contactId))
    } catch { /* the note is a convenience */ }
  }

  const changes = createRateLimiter(60 * 60 * 1000, process.env.NODE_ENV === 'production' ? CHANGES_PER_VISITOR : 100000)

  // POST /adjust/:slug — the visitor's corrected outline (or the roof they tapped): the estimate worked out again from
  // it. Costs nothing: the slope map kept with the measurement stands in for Google's height data.
  app.post('/adjust/:slug', changes, async (c) => {
    const opened = await openCompany(c)
    if ('refusal' in opened) return opened.refusal
    const comp = opened.comp
    const body: any = (await c.req.json().catch(() => null)) ?? {}
    const row = await ownEstimate(comp.id, body.estimateId)
    const raw = (row?.rawData || {}) as any
    const slope = raw.slope as SlopeMap | undefined
    if (!row || !slope) return fail(c, 404, 'That estimate was not found. Please start again.')
    if (Number(raw.adjustments || 0) >= MAX_ADJUSTMENTS) return fail(c, 429, 'This estimate has been changed as many times as it can be. Contact us and we will measure your roof ourselves.')
    const problem = outlineProblem(body.outline, slope)
    if (problem) return fail(c, 400, problem)
    const outline = (body.outline as OutlinePoint[]).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as OutlinePoint)
    const area = outlineArea(outline, slope)
    if (area.squares < MIN_SQUARES) return fail(c, 400, 'That outline is too small to be a roof. Drag the corners out to the edges of your roof.')
    if (area.squares > MAX_SQUARES) return fail(c, 400, 'That outline is too large to be one roof. Drag the corners in to the edges of your roof.')
    const squares = Math.round(area.slopeSqft) / 100
    const prices = await priced(comp, squares)
    await db.update(measurementReport).set({
      status: 'complete', totalSquares: String(squares), totalArea: String(area.slopeSqft),
      rawData: {
        ...raw, quoted: true, estimateLow: prices.estimateLow, estimateHigh: prices.estimateHigh,
        options: prices.options.map((o) => ({ id: o.id, name: o.name, estimateLow: o.estimateLow, estimateHigh: o.estimateHigh })),
        adjustments: Number(raw.adjustments || 0) + 1,
        // What the homeowner showed, beside what the engine read — the rep sees both.
        adjusted: { outline, squares, at: new Date().toISOString() },
      },
    } as any).where(eq(measurementReport.id, row.id))
    if (raw.leadCreated && raw.contactId) await noteOnLead(raw.contactId, `They corrected the roof outline on the website: ${squares} squares, $${prices.estimateLow.toLocaleString('en-US')} – $${prices.estimateHigh.toLocaleString('en-US')}${raw.measuredSquares ? ` (measured from the air: ${raw.measuredSquares})` : ''}.`)
    logger.info('Instant estimate: outline corrected by the visitor', { slug: comp.slug, squares, was: raw.measuredSquares ?? null })
    return one(c, {
      quoted: true, estimateId: row.id, adjusted: true,
      totalSquares: squares, totalAreaSqft: area.slopeSqft, imageryQuality: row.imageryQuality, ...prices,
      disclaimer: comp.estimatorDisclaimer, companyName: comp.name, companyPhone: comp.phone, companyEmail: comp.email,
    })
  })

  // POST /choose/:slug — the option the visitor says they are interested in, kept for whoever calls them back.
  app.post('/choose/:slug', changes, async (c) => {
    const opened = await openCompany(c)
    if ('refusal' in opened) return opened.refusal
    const comp = opened.comp
    const body: any = (await c.req.json().catch(() => null)) ?? {}
    const row = await ownEstimate(comp.id, body.estimateId)
    if (!row) return fail(c, 404, 'That estimate was not found. Please start again.')
    const option = pricedOptions(comp).find((o) => o.id === body.optionId)
    if (!option) return fail(c, 400, 'That option is no longer offered.')
    const raw = (row.rawData || {}) as any
    if (raw.chosenOption?.id === option.id) return done(c)
    await db.update(measurementReport).set({ rawData: { ...raw, chosenOption: { id: option.id, name: option.name, at: new Date().toISOString() } } } as any).where(eq(measurementReport.id, row.id))
    if (raw.leadCreated && raw.contactId) await noteOnLead(raw.contactId, `Interested in: ${option.name}.`)
    return done(c)
  })

  return app
}

/** /api/settings — the estimator's settings (the template's settings router's PUT /estimator). */
export function createEstimatorSettingsRoutes(d: CrmDeps) {
  const { db, logger } = d
  const app = new Hono<AppEnv>()
  app.put('/estimator', d.permissions.requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { options, serviceRadiusMiles, ...columns } = parsed.data
    const [comp] = await db.select().from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    const was = estimatorExtras(comp)
    const next: EstimatorExtras = { ...was }
    if (options !== undefined) {
      next.options = options.map((o) => ({
        id: o.id && /^[a-z0-9]{6,40}$/i.test(o.id) ? o.id : createId(), name: o.name, description: o.description || '',
        pricePerSquareLow: o.pricePerSquareLow, pricePerSquareHigh: o.pricePerSquareHigh, imageUrl: o.imageUrl || null,
      }))
    }
    if (serviceRadiusMiles !== undefined) {
      const miles = serviceRadiusMiles === null || serviceRadiusMiles === '' ? null : Number(serviceRadiusMiles)
      next.serviceRadiusMiles = miles
      if (miles === null) next.base = null
      else {
        // The area's centre is the business's own address, found on the map once, here.
        if (!comp.address || !comp.city || !comp.state || !comp.zip) return fail(c, 400, 'Add your business address under Company settings first, so the service area has a centre.', undefined, { serviceRadiusMiles: 'Add your business address under Company settings first.' })
        try {
          const g = await geocodeAddress(comp.address, comp.city, comp.state, comp.zip)
          next.base = { lat: g.lat, lng: g.lng }
        } catch (err: any) {
          logger.warn('Estimator settings: the business address could not be found on the map', { error: err?.message })
          return fail(c, 400, 'Your business address could not be found on the map. Check it under Company settings, then save again.', undefined, { serviceRadiusMiles: 'Your business address could not be found on the map.' })
        }
      }
    }
    let settings: any = comp.settings
    if (typeof settings === 'string') { try { settings = JSON.parse(settings) } catch { settings = {} } }
    settings = { ...(settings && typeof settings === 'object' ? settings : {}), estimator: next }
    await db.update(company).set({ ...columns, settings, updatedAt: new Date() } as any).where(eq(company.id, comp.id))
    return done(c, 'Saved')
  })
  return app
}
