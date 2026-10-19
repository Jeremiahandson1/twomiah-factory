// The dealership's AI tools: the Lead Responder (a first-touch email and text for a fresh lead, inventory-aware), AI
// Reports (a plain-English question answered over the dealership's own records, totals computed by code) and the
// Trade Appraisal (a directional market estimate, never a book quote). Each reports its token use to the Factory.
// Moved from templates/crm-rv/backend/src/routes/{aiLeads,aiReports,aiTrade}.ts.
import { Hono } from 'hono'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { salesLead, contact, unit, company, user, repairOrder, invoice } from '../../db/schema/index.ts'
import { reportAiUsage } from '@twomiah/tenant-backend'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { LEAD_STAGES } from './salesLeads.ts'
import { hideUnitCost } from './units.ts'
import { precomputedTotals, fixReportTotals } from './aiReportTotals.ts'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

async function askClaude(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
}

// unit.status → how the draft may describe a unit that can't be offered
const UNIT_STATUS_NOTE: Record<string, string> = {
  sold: 'already sold',
  pending: 'sale pending with another buyer',
  on_order: 'on order and not in stock yet',
  in_service: 'in the service department and not for sale right now',
}

const LEAD_SYSTEM = `You are an elite powersports / RV / marine dealership salesperson writing the FIRST response to a fresh internet lead. Warm, concise, human — NOT corporate spam. Use the customer's first name. Reference the SPECIFIC unit they asked about (year/make/model + price if given). Offer a clear next step (schedule a test ride / visit, answer questions, financing pre-qual). If an "alsoAvailable" unit fits, you may mention ONE briefly as an alternative. NEVER invent specs or prices not provided. Write like a top closer who replies within 5 minutes.
If "interestedIn.availableNow" is false, that unit can NOT be sold to this customer: say briefly and honestly what "interestedIn.status" says (e.g. already sold), do NOT offer a test ride, visit, price or financing on it, and offer ONE "alsoAvailable" unit instead (or, if there are none, offer to find them a similar one). Only units in "alsoAvailable" or an available "interestedIn" may be offered.
Return your answer in EXACTLY this format — these three literal markers each on their own line, with the content between them, and nothing else:
===SUBJECT===
(the email subject line)
===EMAIL===
(the email body, 60–110 words, friendly sign-off with the salesperson + dealership name; normal line breaks are fine)
===SMS===
(the text message, under 300 chars, casual, names the dealership, ends with a question)`


const REPORT_SYSTEM = `You are the dealership's data analyst, built into its CRM (an RV / powersports / marine dealership). Answer the manager's question using ONLY the data provided below. Correlate records by their IDs: salesLead.contactId→contact.id, salesLead.unitId→unit.id, salesLead.assignedTo→user.id, repairOrder.customerId→contact.id, invoice.contactId→contact.id. Be specific and quantitative — cite real numbers, dollar amounts (with $), counts, names, and dates. Money fields are strings; parse them as numbers. Sales stages: closed_won = sold, closed_lost = lost; everything else is still open. For any count or total, use the PRECOMPUTED TOTALS section (exact, grouped by status / category / condition / stage) — do not add up numbers yourself. When a table has a Total row, it must equal the sum of the rows shown in that table. If the data genuinely can't answer the question, say so plainly and name what's missing. Format the answer as a clean, scannable Markdown report: a one-line bold headline answer first, then supporting bullets or a small table, then 1–2 short "what this means" insight callouts. Keep it tight and useful — a busy GM is reading it.`

const TRADE_SYSTEM = `You are a powersports / RV / marine trade-in appraiser estimating CURRENT US market values (2026). Be realistic and CONSERVATIVE on trade-in (wholesale) and fair on retail. Account for the unit's age, mileage/hours, and condition. Return ONLY raw JSON (no markdown/code fences):
{"tradeIn":{"low":N,"avg":N,"high":N},"retail":{"low":N,"high":N},"conditionNote":"one line on how condition/mileage moved it","reasoning":"2-3 sentences a sales manager would trust","comps":["short comp/context line","..."]}
All values are whole-dollar integers, no symbols. Trade-in (wholesale) must be below retail.`


// The deal pickers (Desking, F&I, Title & Reg) ask for up to this many leads at once (RV T20).
const PICKER_MAX = 500

/** AI Lead Responder. The template asked no permission beyond a session on either path. */
export function createAiLeadRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /inbox — recent leads with the customer and the unit they're interested in. No options: the 30 newest. The deal
  // pickers pass ?stages=… and a larger ?limit= (max 500), most recently active first.
  app.get('/inbox', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const stagesParam = c.req.query('stages')
    const stages = stagesParam === undefined ? null : stagesParam.split(',').map((s) => s.trim()).filter(Boolean)
    if (stages && (!stages.length || stages.some((s) => !(LEAD_STAGES as readonly string[]).includes(s)))) {
      return fail(c, 400, `stages must be from: ${LEAD_STAGES.join(', ')}`)
    }
    const limitParam = c.req.query('limit')
    const limit = limitParam === undefined ? 30 : Number(limitParam)
    if (!Number.isInteger(limit) || limit < 1 || limit > PICKER_MAX) return fail(c, 400, `limit must be a whole number from 1 to ${PICKER_MAX}`)
    try {
      const rows = await db.select({
        id: salesLead.id, stage: salesLead.stage, source: salesLead.source, createdAt: salesLead.createdAt,
        contactId: salesLead.contactId, customerName: contact.name, email: contact.email, phone: contact.phone,
        unitYear: unit.year, unitMake: unit.make, unitModel: unit.modelName, unitPrice: unit.internetPrice, unitCategory: unit.category, unitStatus: unit.status,
      })
        .from(salesLead)
        .leftJoin(contact, eq(salesLead.contactId, contact.id))
        .leftJoin(unit, eq(salesLead.unitId, unit.id))
        .where(and(eq(salesLead.companyId, u.companyId), stages ? inArray(salesLead.stage, stages) : undefined))
        .orderBy(stages ? desc(salesLead.updatedAt) : desc(salesLead.createdAt))
        .limit(limit)
      return one(c, { leads: rows })
    } catch (e: any) { return one(c, { leads: [], error: e?.message }) }
  })

  // POST /draft — { leadId } → an AI-drafted first-touch email + SMS
  // A paid model call that writes outreach for a lead: the seat that works leads.
  app.post('/draft', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const cid = u.companyId
    const body = await c.req.json().catch(() => ({} as any))
    const leadId = String(body.leadId || '')
    if (!leadId) return fail(c, 400, 'Pick a lead first.')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return fail(c, 503, 'AI isn’t configured yet (missing ANTHROPIC_API_KEY).')

    const [lead] = await db.select().from(salesLead).where(and(eq(salesLead.id, leadId), eq(salesLead.companyId, cid))).limit(1)
    if (!lead) return fail(c, 404, 'Lead not found.')
    const [cust] = lead.contactId ? await db.select().from(contact).where(eq(contact.id, lead.contactId)).limit(1) : [null]
    const [interest] = lead.unitId ? await db.select().from(unit).where(eq(unit.id, lead.unitId)).limit(1) : [null]
    const [co] = await db.select().from(company).where(eq(company.id, cid)).limit(1)
    const [me] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(eq(user.id, u.userId)).limit(1)

    let pool: any[] = []
    try { pool = await db.select().from(unit).where(and(eq(unit.companyId, cid), eq(unit.status, 'available'))).limit(50) } catch { /* no alternatives */ }
    const alsoAvailable = (interest?.category ? pool.filter(m => m.category === interest.category && m.id !== interest.id) : pool)
      .slice(0, 3).map(m => ({ year: m.year, make: m.make, model: m.modelName, price: m.internetPrice }))

    // Only an available unit can be offered; one that is sold, pending, on order or in service goes with its status and
    // without a price (RV T19 H3).
    const availableNow = interest?.status === 'available'
    const interestedIn = interest ? (availableNow
      ? { year: interest.year, make: interest.make, model: interest.modelName, price: interest.internetPrice, category: interest.category, availableNow: true }
      : { year: interest.year, make: interest.make, model: interest.modelName, category: interest.category, availableNow: false, status: UNIT_STATUS_NOTE[interest.status] || 'no longer available' }
    ) : null

    const ctx = {
      dealership: { name: co?.name, phone: co?.phone, city: co?.city, state: co?.state },
      salesperson: { name: `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || 'the team', email: me?.email },
      customer: { name: cust?.name || 'there', firstName: (cust?.name || 'there').split(' ')[0], leadSource: lead.source },
      interestedIn,
      alsoAvailable,
    }

    let res: Response
    try {
      res = await askClaude(apiKey, { model: MODEL, max_tokens: 1024, system: LEAD_SYSTEM, messages: [{ role: 'user', content: 'Lead context:\n' + JSON.stringify(ctx, null, 2) + '\n\nWrite the first-touch email + SMS now. JSON only.' }] })
    } catch (e: any) { return fail(c, 502, 'AI request failed: ' + (e?.message || e)) }
    if (!res.ok) { const t = await res.text().catch(() => ''); return fail(c, 502, 'AI error (' + res.status + '): ' + t.slice(0, 200)) }

    const data: any = await res.json().catch(() => ({}))
    reportAiUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, data?.model)
    const txt: string = data?.content?.[0]?.text || ''
    const between = (start: string, end: string | null) => {
      const i = txt.indexOf('===' + start + '===')
      if (i < 0) return ''
      const from = i + start.length + 6
      const j = end ? txt.indexOf('===' + end + '===', from) : -1
      return txt.slice(from, j < 0 ? txt.length : j).trim()
    }
    const parsed: any = { email: { subject: between('SUBJECT', 'EMAIL'), body: between('EMAIL', 'SMS') }, sms: between('SMS', null) }
    // The model ignored the markers but emitted JSON: salvage it.
    if (!parsed.email.body && !parsed.sms) {
      try { const j = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); if (j?.email) { parsed.email = { subject: j.email.subject || '', body: j.email.body || '' }; parsed.sms = j.sms || '' } } catch { /* unreadable */ }
    }
    // (The template also sent the first 300 characters of the raw answer; no screen showed it.)
    if (!parsed.email.body && !parsed.sms) return fail(c, 502, 'AI returned an unreadable draft. Try again.')
    return one(c, {
      draft: parsed,
      lead: { customerName: cust?.name, email: cust?.email, phone: cust?.phone, interestedIn: ctx.interestedIn },
      generatedAt: new Date().toISOString(),
    })
  })

  return app
}

const SUGGESTIONS = [
  'How many units did we sell last month, and what was the total gross?',
  'Show my aged inventory — units in stock longest, with prices.',
  'Which salesperson has the most closed deals this quarter?',
  'What’s sitting in service right now and what’s the open RO value?',
  'Which leads are stalled in the pipeline and need follow-up?',
  'Break down my inventory by category and condition.',
]

/**
 * AI Reports. The template asked only for a session and handed the model every unit with its cost and every invoice,
 * so a seat the invoice routes and T41/T42 refuse could ask for the dealer cost or the ledger in plain English. The
 * model now sees what the asker may: cost only with margin:read, invoices only with invoices:read.
 */
export function createAiReportRoutes(d: CrmDeps) {
  const { db } = d
  const { hasPermission, getExtraPermissions, requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // Reports are reports:read; the figures inside still follow margin:read and invoices:read below.
  app.get('/suggestions', requirePermission('reports:read'), (c) => one(c, { suggestions: SUGGESTIONS }))

  app.post('/generate', requirePermission('reports:read'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json().catch(() => ({} as any))
    const question = String(body.question || '').trim()
    if (!question) return fail(c, 400, 'Ask a question first.')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return fail(c, 503, 'AI Reports isn’t configured yet (missing ANTHROPIC_API_KEY).')

    const extra = await getExtraPermissions(u.userId)
    const mayCost = hasPermission(u.role, 'margin:read', extra)
    const mayInvoices = hasPermission(u.role, 'invoices:read', extra)
    const cid = u.companyId
    const grab = async (fn: () => Promise<any[]>) => { try { return await fn() } catch { return [] } }
    const [unitRows, leads, ros, invoices, contacts, users] = await Promise.all([
      grab(() => db.select().from(unit).where(eq(unit.companyId, cid)).limit(500)),
      grab(() => db.select().from(salesLead).where(eq(salesLead.companyId, cid)).limit(500)),
      grab(() => db.select().from(repairOrder).where(eq(repairOrder.companyId, cid)).limit(500)),
      mayInvoices ? grab(() => db.select().from(invoice).where(eq(invoice.companyId, cid)).limit(500)) : Promise.resolve([] as any[]),
      grab(() => db.select().from(contact).where(eq(contact.companyId, cid)).limit(500)),
      grab(() => db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role }).from(user).where(eq(user.companyId, cid)).limit(100)),
    ])
    const units = mayCost ? unitRows : unitRows.map(hideUnitCost)

    const today = new Date().toISOString().slice(0, 10)
    const dataContext = [
      `TODAY: ${today}`,
      `=== PRECOMPUTED TOTALS (exact — copy counts and totals from here; money in dollars) ===\n${JSON.stringify(precomputedTotals(units, leads, ros, invoices))}`,
      `=== INVENTORY / UNITS (${units.length}) ===\n${JSON.stringify(units)}`,
      `=== SALES PIPELINE / LEADS (${leads.length}) ===\n${JSON.stringify(leads)}`,
      `=== SERVICE / REPAIR ORDERS (${ros.length}) ===\n${JSON.stringify(ros)}`,
      `=== INVOICES (${invoices.length}) ===\n${mayInvoices ? JSON.stringify(invoices) : 'Not available to this user.'}`,
      `=== CONTACTS (${contacts.length}) ===\n${JSON.stringify(contacts)}`,
      `=== TEAM / USERS (${users.length}) ===\n${JSON.stringify(users)}`,
    ].join('\n\n')

    let res: Response
    try {
      res = await askClaude(apiKey, { model: MODEL, max_tokens: 2048, system: REPORT_SYSTEM, messages: [{ role: 'user', content: dataContext + '\n\n---\nMANAGER’S QUESTION: ' + question }] })
    } catch (e: any) { return fail(c, 502, 'AI request failed: ' + (e?.message || e)) }
    if (!res.ok) { const t = await res.text().catch(() => ''); return fail(c, 502, 'AI error (' + res.status + '): ' + t.slice(0, 300)) }
    const data: any = await res.json().catch(() => ({}))
    reportAiUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, data?.model)
    const raw = data?.content?.[0]?.text || 'No response generated.'
    const checked = fixReportTotals(raw)
    const report = checked.corrections.length
      ? `${checked.report}\n\n**Note:** ${checked.corrections.length === 1 ? 'a total' : `${checked.corrections.length} totals`} in this report didn't add up and ${checked.corrections.length === 1 ? 'was' : 'were'} recalculated from the rows shown (${checked.corrections.map((x) => `${x.wrong} → ${x.right}`).join(', ')}).`
      : checked.report
    return one(c, {
      report, question, generatedAt: new Date().toISOString(), totalsCorrected: checked.corrections,
      rowsAnalyzed: { units: units.length, leads: leads.length, service: ros.length, invoices: invoices.length, contacts: contacts.length },
    })
  })

  return app
}

const DISCLAIMER = 'AI market estimate based on typical 2026 US values — directional, not a book quote. Authoritative book + wholesale-auction values connect via J.D. Power / Price Digests (book) and NPA Value Guide Pro (auction).'
// A unit the model can actually value: a real model year, a known category and condition (RV T19 L4).
const CATEGORIES = ['motorhome', 'towable', 'motorcycle', 'atv', 'utv', 'sxs', 'pwc', 'snowmobile', 'boat']
const CONDITIONS = ['excellent', 'good', 'fair', 'rough']

/** AI Trade Appraisal: a paid model call made while working a deal, so the seat that works deals (contacts:update). */
export function createAiTradeRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  app.post('/appraise', d.permissions.requirePermission('contacts:update'), async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    const make = String(body.make || '').trim()
    const model = String(body.model || '').trim()
    if (!make || !model) return fail(c, 400, 'Enter at least a make and model.')
    const maxYear = new Date().getFullYear() + 1
    if (body.year !== undefined && body.year !== null && body.year !== '' && !(Number.isInteger(body.year) && body.year >= 1900 && body.year <= maxYear)) return fail(c, 400, `Year must be between 1900 and ${maxYear}.`)
    if (body.category !== undefined && body.category !== null && body.category !== '' && !CATEGORIES.includes(body.category)) return fail(c, 400, `Category must be one of: ${CATEGORIES.join(', ')}.`)
    if (body.condition !== undefined && body.condition !== null && body.condition !== '' && !CONDITIONS.includes(body.condition)) return fail(c, 400, `Condition must be one of: ${CONDITIONS.join(', ')}.`)
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return fail(c, 503, 'AI isn’t configured yet (missing ANTHROPIC_API_KEY).')

    const tradeUnit = {
      year: body.year || undefined, make, model, category: body.category || undefined,
      mileageHours: body.mileageHours || undefined, condition: body.condition || 'good',
    }
    let res: Response
    try {
      res = await askClaude(apiKey, { model: MODEL, max_tokens: 800, system: TRADE_SYSTEM, messages: [{ role: 'user', content: 'Appraise this trade-in:\n' + JSON.stringify(tradeUnit, null, 2) + '\n\nJSON only.' }] })
    } catch (e: any) { return fail(c, 502, 'AI request failed: ' + (e?.message || e)) }
    if (!res.ok) { const t = await res.text().catch(() => ''); return fail(c, 502, 'AI error (' + res.status + '): ' + t.slice(0, 200)) }
    const data: any = await res.json().catch(() => ({}))
    reportAiUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, data?.model)
    const txt = data?.content?.[0]?.text || ''
    let parsed: any = null
    try { parsed = JSON.parse(txt) } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch { /* unreadable */ } } }
    if (!parsed?.tradeIn) return fail(c, 502, 'AI returned an unreadable estimate. Try again.')
    return one(c, { appraisal: parsed, unit: tradeUnit, disclaimer: DISCLAIMER, generatedAt: new Date().toISOString() })
  })
  return app
}
