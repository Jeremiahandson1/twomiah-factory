// /api/roof-reports — roof reports: a free hand-drawn measurement, or a professional report bought for $9.99 (Stripe)
// that the Factory's reviewers check; the shared link a homeowner opens; the PDF, the 3D grid, edits and the AI roof
// detection. Moved from templates/crm-roof/backend/src/routes/roofReports.ts, with the engine in packages/roof-core and
// the glue in ./roofReportService.ts.
//
// Mounted 'public': the shared view of a report (/:id/html) and its aerial (/:id/aerial.png) answer WITHOUT a session —
// a homeowner follows the link (the template's PUBLIC_WITHIN_GATED). Everything after them signs the person in and
// needs measurement_reports switched on, here in the router, in the template's order (sign-in, the feature, then each
// action's permission).
//
// The money: a professional report is charged on Twomiah's own Stripe account (CrmServices.stripe, the platform key —
// the CRM's stripeService is for the business's customers' invoices, on the business's connected account), exactly as
// the template's getStripe() was: a Checkout session for $9.99, then /confirm-purchase generates the report once
// Stripe says it is paid. Without Stripe configured the report is generated straight away and records $0.00.
//
// Changes from the template:
//   · Stripe's return addresses are the CRM's own pages (/crm/roof-reports, /crm/contacts/:id): the template sent the
//     roofer back to /roof-reports, which the CRM has no page at — after paying they landed on Not Found and
//     /confirm-purchase never ran, so the report they paid for was never made;
//   · what a report was charged is true: $0.00 for a hand-drawn report and where no Stripe is configured (the template
//     wrote $9.99 on all of them), and Stripe's own amount for a paid one;
//   · /finalize saves only imagery the server stored for this company, no payment reference, and a contact only of this
//     company (see roofReportService.ts: the template's public aerial route read any file a client's preview named);
//   · a contact named on a purchase must be this company's (404);
//   · what a report was charged comes off every reply for a reader without margin:read (the template stripped it from
//     GET /:id only);
//   · /:id/pdf is the print-ready page, without first trying a headless browser (see the route);
//   · SAM 2 without REPLICATE_API_TOKEN is the 503 the template wrote for it (it was reached as a 500);
//   · a 500 says what failed in its sentence and no longer carries `details` (the error's text) beside it;
//   · lists are { data, pagination } with a total; the 3D grid's cached-file branch is gone (nothing ever wrote
//     dsm_grid_path).
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { and, count, desc, eq } from 'drizzle-orm'
import { generateReportHTML, generateReportPDF, getNearmapRoofAI, getNearmapRollup, segmentRoof } from '@twomiah/roof-core'
import { company, contact, roofReport } from '../../../db/schema/index.ts'
import { escapeHtml, escapeRow } from '../../../core/sanitize.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { createRoofReportService, imageKeyFor, imageryPrefix, REPORT_PRICE_CENTS } from './roofReportService.ts'

const PRICE = (REPORT_PRICE_CENTS / 100).toFixed(2)

/** What the company paid for a report comes off it for a reader without margin:read (T43, T68). */
const withoutPaid = (r: any) => { if (!r) return r; const { amountCharged: _paid, ...rest } = r; return rest }

function haversineFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 3.28084
}

function pointInPolygonSimple(lat: number, lng: number, polygon: any[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat, xi = polygon[i].lng
    const yj = polygon[j].lat, xj = polygon[j].lng
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const png = (c: any, body: Buffer, cache: string) => c.body(new Uint8Array(body), 200, { 'Content-Type': 'image/png', 'Cache-Control': cache })

export function createRoofReportRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const reports = createRoofReportService(d)
  const app = new Hono<AppEnv>()

  const frontendUrl = () => String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
  const seesPaid = async (c: any) => { const u = c.get('user'); try { return !!(await canSee(u?.role, 'margin:read', u?.userId)) } catch { return false } }
  const shaped = async (c: any, r: any) => ((await seesPaid(c)) ? r : withoutPaid(r))
  const ownContact = async (companyId: string, id: string) =>
    (await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, companyId))).limit(1))[0] || null

  // ══════════ Public: the shared link (no session) ══════════

  // GET /:id/aerial.png — the report's stored aerial, for the shared view.
  app.get('/:id/aerial.png', async (c) => {
    const [report] = await db.select({ companyId: roofReport.companyId, aerialImagePath: roofReport.aerialImagePath })
      .from(roofReport).where(eq(roofReport.id, c.req.param('id'))).limit(1)
    const bytes = report ? await reports.imageBytes(imageKeyFor(report.companyId, report.aerialImagePath)) : null
    if (!bytes) return fail(c, 404, 'Aerial image not available')
    return png(c, bytes, 'public, max-age=86400')
  })

  // GET /:id/html — the report as a page, shareable with the homeowner.
  app.get('/:id/html', async (c) => {
    const id = c.req.param('id')
    try {
      const [report] = await db.select().from(roofReport).where(eq(roofReport.id, id)).limit(1)
      if (!report) return fail(c, 404, 'Report not found')
      const [companyRecord] = await db.select().from(company).where(eq(company.id, report.companyId)).limit(1)
      const fullAddress = escapeHtml(`${report.address}, ${report.city}, ${report.state} ${report.zip}`)
      return c.html(await generateReportHTML(await reports.renderData(report), escapeRow(companyRecord as any), fullAddress))
    } catch (err: any) {
      logger.error('Roof report HTML generation failed', { id, error: err?.message, stack: err?.stack })
      return fail(c, 500, 'Failed to generate report HTML')
    }
  })

  // ══════════ Everything else: signed in, with Roof Reports switched on ══════════
  app.use('*', d.authenticate, d.features.requireEnabledFeature('measurement_reports'))

  // GET / — the company's reports (no money on the list).
  app.get('/', async (c) => {
    const me = c.get('user')
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    const limit = Math.max(parseInt(c.req.query('limit') || '20') || 20, 1)
    const contactId = c.req.query('contactId')
    const where = and(eq(roofReport.companyId, me.companyId), ...(contactId ? [eq(roofReport.contactId, contactId)] : []))
    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
        id: roofReport.id, address: roofReport.address, city: roofReport.city, state: roofReport.state, zip: roofReport.zip,
        totalSquares: roofReport.totalSquares, totalAreaSqft: roofReport.totalAreaSqft, segmentCount: roofReport.segmentCount,
        imageryQuality: roofReport.imageryQuality, imageryDate: roofReport.imageryDate, status: roofReport.status,
        contactId: roofReport.contactId, createdAt: roofReport.createdAt,
      }).from(roofReport).where(where).orderBy(desc(roofReport.createdAt), desc(roofReport.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(roofReport).where(where),
    ])
    return list(c, rows, { page, limit, total: Number(total) })
  })

  /**
   * POST /purchase — ONE ROUTE, TWO PRICES, SO IT CANNOT BE ONE GATE (T42). `mode: 'manual'` draws a preview by hand and
   * buys nothing (roof-reports:create — a manager may); anything else is the $9.99 professional report
   * (roof-reports:purchase). Decided from the body, before it is validated, so an unauthorised caller gets 403 and not a
   * description of what the endpoint wanted. The refusal is the shared permission check's own.
   */
  const purchaseGate: MiddlewareHandler = async (c, next) => {
    const body: any = await c.req.json().catch(() => ({}))
    return requirePermission(body?.mode === 'manual' ? 'roof-reports:create' : 'roof-reports:purchase')(c, next)
  }
  app.post('/purchase', purchaseGate, async (c) => {
    const me = c.get('user')
    const body: any = await c.req.json().catch(() => ({}))
    const { address, city, state, zip, contactId, eaveOverhangInches, mode } = body || {}
    const overhang = typeof eaveOverhangInches === 'number' ? Math.max(0, Math.min(36, eaveOverhangInches)) : 12
    if (!address || !city || !state || !zip) return fail(c, 400, 'Address, city, state, and zip are required')
    if (contactId && !(await ownContact(me.companyId, contactId))) return fail(c, 404, 'Contact not found')

    // Manual (free): a preview with no edges; the roofer draws them, then /finalize saves it.
    if (mode === 'manual') {
      try {
        const preview = await reports.generateReportPreview(me.companyId, address, city, state, zip, overhang)
        preview.edges = []
        preview.measurements = { ...preview.measurements, ridgeLF: 0, valleyLF: 0, hipLF: 0, rakeLF: 0, eaveLF: 0, totalPerimeterLF: 0, wasteFactor: 0, iceWaterShieldSqft: 0 }
        return one(c, { preview: { ...preview, address, city, state, zip, contactId, mode: 'manual' }, free: true })
      } catch (err: any) {
        logger.error('Roof report generation failed', { error: err?.message })
        return fail(c, 500, 'Failed to generate roof report')
      }
    }

    // Professional ($9.99): Stripe Checkout, then auto-detect and a person's review.
    const stripe = d.services.stripe
    if (!stripe) {
      // No Stripe configured (development): generated now, sent for review, nothing charged.
      try {
        const report = await reports.generateAndSaveReport({ companyId: me.companyId, address, city, state, zip, contactId, eaveOverhangInches: overhang, amountCharged: '0.00', status: 'pending_review' })
        reports.notifyFactoryNewReport(report.id, address, city, state, me.companyId).catch(() => {})
        return one(c, { report: await shaped(c, report), pendingReview: true }, 201)
      } catch (err: any) {
        logger.error('Roof report generation failed', { error: err?.message })
        return fail(c, 500, 'Failed to generate roof report')
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: REPORT_PRICE_CENTS,
          product_data: {
            name: 'Professional Roof Measurement Report',
            description: `${address}, ${city}, ${state} ${zip} — Satellite-based roof analysis with ridge, valley, hip, rake, eave measurements, waste factor, and ice & water shield calculations.`,
          },
        },
        quantity: 1,
      }],
      metadata: { type: 'roof_report', companyId: me.companyId, address, city, state, zip, contactId: contactId || '', eaveOverhangInches: String(overhang) },
      success_url: `${frontendUrl()}/crm/roof-reports?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl()}/crm/roof-reports?cancelled=true`,
    })
    return one(c, { checkoutUrl: session.url, sessionId: session.id })
  })

  // POST /confirm-purchase — after Stripe's return: the paid session becomes its report (once).
  app.post('/confirm-purchase', requirePermission('roof-reports:purchase'), async (c) => {
    const me = c.get('user')
    const { sessionId } = (await c.req.json().catch(() => ({}))) as any
    if (!sessionId) return fail(c, 400, 'Session ID required')
    const stripe = d.services.stripe
    if (!stripe) return fail(c, 503, 'Stripe not configured')
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') return fail(c, 402, 'Payment not completed')
    const meta: Record<string, string> = (session.metadata || {}) as any
    if (meta.companyId !== me.companyId) return fail(c, 403, 'Session does not belong to this company')
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id
    const [existing] = await db.select({ id: roofReport.id }).from(roofReport)
      .where(and(eq(roofReport.stripePaymentIntentId, paymentIntent), eq(roofReport.companyId, me.companyId))).limit(1)
    if (existing) return one(c, { report: existing, alreadyGenerated: true })
    try {
      const report = await reports.generateAndSaveReport({
        companyId: me.companyId, address: meta.address || '', city: meta.city || '', state: meta.state || '', zip: meta.zip || '',
        contactId: meta.contactId || null, stripePaymentIntentId: paymentIntent,
        eaveOverhangInches: meta.eaveOverhangInches ? Number(meta.eaveOverhangInches) : 12,
        amountCharged: session.amount_total != null ? (session.amount_total / 100).toFixed(2) : PRICE,
        // A person at the Factory checks it before the customer sees it.
        status: 'pending_review',
      })
      reports.notifyFactoryNewReport(report.id, meta.address || '', meta.city || '', meta.state || '', me.companyId).catch(() => {})
      return one(c, { report: await shaped(c, report), pendingReview: true }, 201)
    } catch (err: any) {
      logger.error('Roof report generation after payment failed', { error: err?.message })
      return fail(c, 500, 'Report generation failed after payment — contact support for a refund')
    }
  })

  // POST /purchase-for-contact/:contactId — a report for a contact's address on file.
  app.post('/purchase-for-contact/:contactId', requirePermission('roof-reports:purchase'), async (c) => {
    const me = c.get('user')
    const contactId = c.req.param('contactId')
    const who = await ownContact(me.companyId, contactId)
    if (!who) return fail(c, 404, 'Contact not found')
    if (!who.address) return fail(c, 400, 'Contact has no address on file')
    const address = who.address, city = who.city || '', state = who.state || '', zip = who.zip || ''
    const stripe = d.services.stripe
    if (!stripe) {
      try {
        const report = await reports.generateAndSaveReport({ companyId: me.companyId, address, city, state, zip, contactId, amountCharged: '0.00' })
        return one(c, { report: await shaped(c, report), free: true }, 201)
      } catch (err: any) {
        logger.error('Roof report generation failed', { error: err?.message })
        return fail(c, 500, 'Failed to generate roof report')
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: { currency: 'usd', unit_amount: REPORT_PRICE_CENTS, product_data: { name: 'Professional Roof Measurement Report', description: `${address}, ${city}, ${state} ${zip}` } },
        quantity: 1,
      }],
      metadata: { type: 'roof_report', companyId: me.companyId, address, city, state, zip, contactId },
      success_url: `${frontendUrl()}/crm/roof-reports?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl()}/crm/contacts/${contactId}`,
    })
    return one(c, { checkoutUrl: session.url, sessionId: session.id })
  })

  // GET /preview-aerial/:filename — a preview's aerial for the editor, before the report is saved (this company's only).
  app.get('/preview-aerial/:filename', async (c) => {
    const filename = c.req.param('filename')
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return fail(c, 400, 'Invalid filename')
    const bytes = await reports.imageBytes(imageryPrefix(c.get('user').companyId) + filename)
    if (!bytes) return fail(c, 404, 'Image not found')
    return png(c, bytes, 'private, max-age=3600')
  })

  // POST /finalize — a hand-drawn preview and the roofer's edges, saved. Nothing was bought.
  app.post('/finalize', requirePermission('roof-reports:create'), async (c) => {
    const me = c.get('user')
    const { preview, edges, measurements } = (await c.req.json().catch(() => ({}))) as any
    if (!preview || !edges) return fail(c, 400, 'Preview data and edges required')
    const contactId = preview.contactId || null
    if (contactId && !(await ownContact(me.companyId, contactId))) return fail(c, 404, 'Contact not found')
    try {
      const report = await reports.saveReportToDb(preview, {
        companyId: me.companyId, address: preview.address, city: preview.city, state: preview.state, zip: preview.zip,
        edges, measurements: measurements || preview.measurements, contactId, stripePaymentIntentId: null, amountCharged: '0.00',
      })
      return one(c, { report: await shaped(c, report) }, 201)
    } catch (err: any) {
      logger.error('Report finalization failed', { error: err?.message })
      return fail(c, 500, 'Failed to save report')
    }
  })

  // POST /sam-segment — AI roof detection: Nearmap AI first, SAM 2 (Replicate) where Nearmap has none.
  app.post('/sam-segment', requirePermission('roof-reports:create'), async (c) => {
    const { imageBase64, clickPoints, labels, imageWidth, imageHeight, centerLat, centerLng, zoom } = (await c.req.json().catch(() => ({}))) as any
    if (!centerLat || !centerLng) return fail(c, 400, 'centerLat and centerLng required')
    try {
      const nearmapAI = await getNearmapRoofAI(centerLat, centerLng)
      if (nearmapAI.available && nearmapAI.planes.length > 0) {
        const edges = nearmapAI.edges.map((e) => ({
          type: e.type, startLat: e.start.lat, startLng: e.start.lng, endLat: e.end.lat, endLng: e.end.lng,
          lengthFt: Math.round(e.lengthMeters * 3.28084 * 10) / 10,
        }))
        const polygons = nearmapAI.planes.map((p) => ({ vertices: p.polygon, area: p.areaSqm * 10.7639, pitch: p.pitchDeg, azimuth: p.azimuthDeg, material: p.material, condition: p.conditionScore }))
        const rollup = await getNearmapRollup(centerLat, centerLng)
        return one(c, {
          source: 'nearmap_ai', polygons, edges,
          roofCondition: nearmapAI.overallCondition, roofMaterial: nearmapAI.primaryMaterial, treeOverhangPct: nearmapAI.treeOverhangPct,
          rollup: rollup.available ? rollup : null, processingTimeMs: 0,
        })
      }
      if (!process.env.REPLICATE_API_TOKEN) return fail(c, 503, 'AI segmentation not available (no Nearmap AI coverage and missing REPLICATE_API_TOKEN)')
      if (!imageBase64 || !clickPoints || !labels) return fail(c, 400, 'imageBase64, clickPoints, and labels required for SAM 2 fallback')
      const sam2 = await segmentRoof({ imageBase64, points: clickPoints, labels, imageWidth: imageWidth || 800, imageHeight: imageHeight || 600 })
      // Pixel polygons → map coordinates (Web Mercator at the editor's zoom, centred on the address).
      const polygons = sam2.masks.map((mask: any) => {
        const vertices = mask.polygon.map((p: any) => {
          const scale = Math.pow(2, zoom) * 256
          const cx = (centerLng + 180) / 360 * scale
          const cy = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * scale
          const wx = cx + (p.x - imageWidth / 2)
          const wy = cy + (p.y - imageHeight / 2)
          const n = Math.PI - 2 * Math.PI * wy / scale
          return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: wx / scale * 360 - 180 }
        })
        return { vertices, confidence: mask.confidence, area: mask.area }
      })
      const edges: any[] = []
      if (polygons.length > 0) {
        const verts = polygons[0].vertices
        for (let i = 0; i < verts.length; i++) {
          const j = (i + 1) % verts.length
          edges.push({ type: 'eave', startLat: verts[i].lat, startLng: verts[i].lng, endLat: verts[j].lat, endLng: verts[j].lng,
            lengthFt: Math.round(haversineFeet(verts[i].lat, verts[i].lng, verts[j].lat, verts[j].lng) * 10) / 10 })
        }
      }
      return one(c, { source: 'sam2', polygons, edges, processingTimeMs: sam2.processingTimeMs })
    } catch (err: any) {
      logger.error('AI roof detection failed', { error: err?.message })
      return fail(c, 500, 'AI detection failed')
    }
  })

  // GET /:id — one report; what it was charged only to whoever reads cost.
  app.get('/:id', async (c) => {
    const report = await reports.ownReport(c.get('user').companyId, c.req.param('id'))
    if (!report) return fail(c, 404, 'Report not found')
    return one(c, await shaped(c, report))
  })

  /**
   * GET /:id/pdf — the report's print-ready page (the browser's Print saves it as a PDF). The template first tried a
   * server-side PDF through Puppeteer and fell back to this page; the unified app does not launch a headless browser in
   * a tenant's server: Chromium wants ~150–300 MB of memory per render beside a server measured at 326 MB peak on a
   * 512 MB Starter instance, and the template's deployment never installed a Chromium it could find at run time (its
   * Render blueprint sets no PUPPETEER_EXECUTABLE_PATH and keeps no browser cache), so this page is what it served.
   */
  app.get('/:id/pdf', async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    try {
      const report = await reports.ownReport(me.companyId, id)
      if (!report) return fail(c, 404, 'Report not found')
      const [companyRecord] = await db.select().from(company).where(eq(company.id, report.companyId)).limit(1)
      const fullAddress = escapeHtml(`${report.address}, ${report.city}, ${report.state} ${report.zip}`)
      const html = await generateReportPDF(await reports.renderData(report), escapeRow(companyRecord as any), fullAddress)
      return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="roof-report-${id}.html"` })
    } catch (err: any) {
      logger.error('Roof report PDF generation failed', { id, error: err?.message })
      return fail(c, 500, 'Failed to generate report PDF')
    }
  })

  app.delete('/:id', requirePermission('roof-reports:delete'), async (c) => {
    const me = c.get('user')
    const report = await reports.ownReport(me.companyId, c.req.param('id'))
    if (!report) return fail(c, 404, 'Report not found')
    await db.delete(roofReport).where(and(eq(roofReport.id, report.id), eq(roofReport.companyId, me.companyId)))
    return done(c)
  })

  // PATCH /:id/edges — the roofer's corrections; the first edit keeps the original to revert to.
  app.patch('/:id/edges', requirePermission('roof-reports:update'), async (c) => {
    const me = c.get('user')
    const report = await reports.ownReport(me.companyId, c.req.param('id'))
    if (!report) return fail(c, 404, 'Report not found')
    const { edges, measurements } = (await c.req.json().catch(() => ({}))) as any
    if (!edges || !Array.isArray(edges)) return fail(c, 400, 'edges array required')
    const set: Record<string, any> = { edges, measurements: measurements || report.measurements, userEdited: true, updatedAt: new Date() }
    if (!report.userEdited) { set.originalEdges = report.edges; set.originalMeasurements = report.measurements }
    await db.update(roofReport).set(set).where(and(eq(roofReport.id, report.id), eq(roofReport.companyId, me.companyId)))
    return done(c)
  })

  // POST /:id/revert — undo every correction.
  app.post('/:id/revert', requirePermission('roof-reports:update'), async (c) => {
    const me = c.get('user')
    const report = await reports.ownReport(me.companyId, c.req.param('id'))
    if (!report) return fail(c, 404, 'Report not found')
    if (!report.userEdited || !report.originalEdges) return fail(c, 400, 'No manual edits to revert')
    await db.update(roofReport).set({
      edges: report.originalEdges, measurements: report.originalMeasurements || report.measurements,
      userEdited: false, originalEdges: null, originalMeasurements: null, updatedAt: new Date(),
    } as any).where(and(eq(roofReport.id, report.id), eq(roofReport.companyId, me.companyId)))
    return done(c)
  })

  // GET /:id/dsm-grid — an elevation grid for the 3D viewer, built from the segments' pitch and azimuth.
  app.get('/:id/dsm-grid', async (c) => {
    const id = c.req.param('id')
    try {
      const report = await reports.ownReport(c.get('user').companyId, id)
      if (!report) return fail(c, 404, 'Report not found')
      const segments = (report.segments || []) as any[]
      if (segments.length === 0) return fail(c, 404, 'No segment data available for 3D view')
      const lat = Number(report.lat)
      const lng = Number(report.lng)
      const gridSize = 50
      const pixelSize = 0.0001 // ~11m
      const grid = {
        data: new Array(gridSize * gridSize).fill(0) as number[],
        width: gridSize, height: gridSize,
        originLat: lat - gridSize * pixelSize / 2, originLng: lng - gridSize * pixelSize / 2,
        pixelSizeLat: pixelSize, pixelSizeLng: pixelSize,
      }
      for (const seg of segments) {
        if (!seg.polygon || seg.polygon.length < 3) continue
        const pitchRad = (seg.pitchDegrees || 0) * Math.PI / 180
        const azRad = (seg.azimuthDegrees || 0) * Math.PI / 180
        for (let r = 0; r < gridSize; r++) {
          for (let col = 0; col < gridSize; col++) {
            const pLat = grid.originLat + r * pixelSize
            const pLng = grid.originLng + col * pixelSize
            if (pointInPolygonSimple(pLat, pLng, seg.polygon)) {
              const dx = (pLng - lng) * 111319 * Math.cos(lat * Math.PI / 180)
              const dy = (pLat - lat) * 111319
              grid.data[r * gridSize + col] = 8 + (dx * Math.sin(azRad) + dy * Math.cos(azRad)) * Math.tan(pitchRad)
            }
          }
        }
      }
      return one(c, grid)
    } catch (err: any) {
      logger.error('DSM grid generation failed', { id, error: err?.message })
      return fail(c, 500, 'Failed to generate DSM grid')
    }
  })

  return app
}

/**
 * /api/internal/roof-reports — the Factory's review of a professional report (apps/api routes/factory/roofReview.ts
 * reads one and approves it, with X-Factory-Key). Moved from the template's index.ts; the registry checks the key.
 * Each acts on the report by id: the Factory's queue names the tenant, and a tenant's database holds one company.
 */
export function createRoofReportInternalRoutes(d: CrmDeps) {
  const { db } = d
  const reports = createRoofReportService(d)
  const app = new Hono<AppEnv>()

  app.get('/pending', async (c) => {
    const rows = await db.select().from(roofReport).where(eq(roofReport.status, 'pending_review')).orderBy(desc(roofReport.createdAt))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.get('/:id', async (c) => {
    const [report] = await db.select().from(roofReport).where(eq(roofReport.id, c.req.param('id'))).limit(1)
    if (!report) return fail(c, 404, 'Not found')
    return one(c, report)
  })

  // POST /:id/approve — the reviewer's edges become the report's; the auto-detected ones are kept as training data.
  app.post('/:id/approve', async (c) => {
    const id = c.req.param('id')
    const { edges, measurements } = (await c.req.json().catch(() => ({}))) as any
    const [report] = await db.select().from(roofReport).where(eq(roofReport.id, id)).limit(1)
    if (!report) return fail(c, 404, 'Not found')
    const set: Record<string, any> = { status: 'completed', edges: edges || report.edges, measurements: measurements || report.measurements, updatedAt: new Date() }
    if (!report.userEdited) { set.userEdited = true; set.originalEdges = report.edges; set.originalMeasurements = report.measurements }
    await db.update(roofReport).set(set).where(eq(roofReport.id, id))
    return done(c)
  })

  app.get('/:id/aerial', async (c) => {
    const [report] = await db.select({ companyId: roofReport.companyId, aerialImagePath: roofReport.aerialImagePath }).from(roofReport).where(eq(roofReport.id, c.req.param('id'))).limit(1)
    if (!report?.aerialImagePath) return fail(c, 404, 'No image')
    const bytes = await reports.imageBytes(imageKeyFor(report.companyId, report.aerialImagePath))
    if (!bytes) return fail(c, 404, 'Image file missing')
    return png(c, bytes, 'private, max-age=0')
  })

  return app
}
