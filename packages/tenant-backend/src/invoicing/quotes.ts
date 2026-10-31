// Quotes — ONE implementation for every CRM template, vendored into each tenant at generation.
// Same shape as invoices.ts: the template injects db + tables + middleware + services and a small
// options object for what its vertical really does differently (field-service site/equipment fields,
// customer message, decline with timestamp, SMS on send, which conversions it offers).
import { Hono } from 'hono'
import { z } from 'zod'
// `sql` is for the FOR UPDATE lock on the quote in convert-to-invoice. (T41)
import { eq, and, or, count, desc, asc, ilike, inArray, isNull, isNotNull, sql } from 'drizzle-orm'
import { round2, calcTotals, rawSubtotal, businessToday, defaultTaxRateFrom, dueDateFromTerms, quoteExpiryFromTerms, normalizeDateInput, nextNumber, type NumberingOptions, money } from './money'
import { checkFilter } from '../listFilter'
import { QUOTE_TILES, pendingQuoteCondition } from '../reporting/tileConditions'
// A quote carries its customer's record, and that record carries their portal credential. Stripped
// on the way out with the same helper the contact routes use — one definition, so a column added to
// the credential set is removed everywhere at once. (T43)
import { withoutPortalCredential } from '../contacts/contacts'
import { resolveCustomer } from '../contacts/customer'
import { withoutSigningEvidence } from './signingEvidence'
import { documentLinkToken, documentLinkPath } from '../portal/documentLinks'
import { jobMoneyWithheld, withoutJobMoney } from '../jobs/jobMoney'
import { customerLines } from './itemCodes'
import { includedLines, depositProblem, chooseOptionalLine, retotalQuote, proposalView, proposalNeedsChoice, chooseProposalOption, hasProposalTables, proposalsLive, isPhotoAddress, lowestPrice, offersOptions, PROPOSAL_TIERS, MAX_PROPOSAL_OPTIONS, MAX_PROPOSAL_SETS, MAX_OPTION_PHOTOS, SET_KINDS, CHOOSE_FIRST, CHOOSE_FIRST_CODE } from './quoteOptions'
import { partialOf } from '../partialOf'
import { applyMarkups, sectionSummary } from './quoteSections'


export interface QuoteTables {
  quote: any
  quoteLineItem: any
  contact: any
  project: any
  invoice: any
  invoiceLineItem: any
  company: any
  job: any
  /** With the salesperson field: the team, to check the person named is on it. */
  user?: any
  /** field service / landscaping */
  equipment?: any
  site?: any
  /** The unified app's proposal options (quoteOptions.ts); a template's tables have none and keep what they had. */
  quoteProposalOption?: any
  /** With the proposal options: the pricebook, so an item's Good/Better/Best tiers can become a quote's options. */
  pricebookItem?: any
  pricebookGoodBetterBest?: any
}

export type QuoteExtraField = 'siteId' | 'equipmentId' | 'customerMessage' | 'jobId' | 'salespersonId'

export interface QuoteOptions {
  /** Extra quote columns this vertical has (siteId, equipmentId, customerMessage). */
  extraFields?: QuoteExtraField[]
  /** quote.declinedAt exists → POST /:id/decline is offered and reject stamps it. */
  hasDeclinedAt?: boolean
  /** quote.convertedToJobId exists → used for job-conversion idempotency (else job.quoteId is looked up). */
  hasConvertedToJobId?: boolean
  /** job.equipmentId / job.siteId exist → carried over from the quote. */
  jobHasSiteAndEquipment?: boolean
  /**
   * quote_line_item.unit_cost / .pricebook_item_id exist → a line can record what it COSTS and which
   * catalogue item it came from, and `type` (labour / material / part) is persisted. (T41)
   *
   * WHY THIS IS A FLAG AND NOT JUST ALWAYS ON. The columns are added per template by migration
   * (crm-fieldservice 0024). Writing them where they do not exist would make every quote save fail,
   * so the verticals that have not been migrated keep exactly the behaviour they have — the same
   * reason hasDeclinedAt and hasConvertedToJobId are flags.
   */
  hasLineCost?: boolean
  /** Which conversions this vertical offers. Default both. */
  conversions?: Array<'invoice' | 'job'>
  numbering?: { quote?: NumberingOptions; invoice?: NumberingOptions; job?: NumberingOptions }
  maxLimit?: number
  /**
   * May this business build a quote's proposal options (the Good/Better/Best a customer chooses from)? Asked when the
   * office saves them; a quote that already has options is shown and answered whatever this says. Default: yes where the
   * tables exist.
   */
  proposalsEnabled?: (companyId: string) => Promise<boolean> | boolean
  /**
   * The zone this business keeps its calendar in, for deciding what "today" is when an expiry is
   * defaulted. Render runs UTC, so from 19:00 Central a quote raised in the evening expired a day late
   * and the customer portal printed the wrong "Valid until" date. Invoices were given this in T27 H1;
   * quotes were not, so the same evening produced an invoice dated one day and a quote another.
   * Optional and UTC by default, so a template that does not wire it keeps today's behaviour.
   * (Field Service T28 M4)
   */
  timeZoneFor?: (companyId: string) => Promise<string | null | undefined> | string | null | undefined
  /**
   * Make the job a quote converts to, inside the conversion's transaction, in place of the CRM's default job — for a
   * vertical whose jobs are made one way of their own (roofing: numbered ROOF-0001 and titled by the property address,
   * server/crm/roof/jobs.ts insertRoofJob). Handed what the default job would have been made from; returns the new row.
   */
  makeJob?: (tx: any, from: { companyId: string; userId: string; quote: any; description: string; address: string; city: string; state: string; zip: string; estimatedValue: string }) => Promise<any>
  /** Optional: text the customer when a quote is sent (field service). */
  onSent?: (ctx: { companyId: string; quote: any; contact: any; company: any }) => Promise<void>
  /**
   * After the office marks a quote approved (the customer's own approval runs portal.ts's hook): the unified app raises
   * the deposit invoice a quote asks for (apps/unified/server/crm/billing/quoteBilling.ts). What it returns goes back
   * with the approved quote as `deposit`. A failure is logged, never undoes the approval.
   */
  onApproved?: (ctx: { companyId: string; quote: any }) => Promise<unknown>
  /**
   * What was billed against the quote before it is converted to its invoice — its deposit and progress invoices
   * (unified billing). Runs inside the conversion's transaction, under its lock. Returns the credit the invoice takes off
   * its total and the columns that mark it final, or a refusal (nothing left to bill).
   */
  billedBefore?: (tx: any, quote: any) => Promise<{ error?: string; credit?: number; values?: Record<string, unknown> } | null>
}

export interface QuoteDeps {
  db: any
  tables: QuoteTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: Record<string, string>
  loadPdf: () => Promise<(quote: any, company: any) => Promise<Buffer>>
  /**
   * Email the quote when it is sent. Optional ONLY so a template that has not wired it keeps the
   * behaviour it has today; every template email service already exports sendQuote(), it was simply
   * never called from here. (Field Service T30)
   */
  sendQuoteEmail?: (to: string, data: Record<string, unknown>) => Promise<unknown>
  /**
   * The template's audit service — `{ log, ACTIONS, ENTITIES }`, the same shape the invoices module
   * takes. Optional, so a template that has not been rewired keeps working rather than failing to
   * start. (T58k)
   *
   *   owner: "Contractor: delete and portal on/off rows show only 'Quote' or 'Contact', not the
   *           number or name."
   *
   * This module audited NOTHING, so every quote event was written by the request-level floor — which
   * knows the path and the status and cannot know a quote's number. A create could at least have its
   * number read back off the response; a DELETE cannot, because by the time the response exists the
   * row is gone. That is why the Record column said "Quote".
   */
  audit?: { log: (entry: any) => any; ACTIONS?: Record<string, string>; ENTITIES?: Record<string, string> }
  options?: QuoteOptions
  /**
   * May this person do X? The role's list plus the grants the owner made them — the contract the invoice and
   * inventory modules take. REQUIRED (T68): it decides who reads a line's cost (margin:read) and a customer's
   * signing evidence (quotes:update), and a quote module without it would hand both to every seat that can
   * open a quote. createQuoteRoutes refuses to start without it rather than default either way.
   */
  canSee: (role: string, permission: string, userId?: string) => Promise<boolean> | boolean
}

const lineItemSchema = z.object({
  description: z.string().min(1),
  // A line billing nothing has no business on the document: quantity 0 sailed through and produced a
  // $0.00 invoice from a slip of the keyboard. Fractions are real work (2.5 hours), so the rule is
  // "more than zero" rather than "at least one". A genuinely free item is priced at 0, not counted 0.
  // (Field Service T26 L7)
  quantity: z.number().gt(0, 'Quantity must be more than zero').default(1),
  // Money is kept to the cent, and the ROUNDED price is what everything downstream multiplies.
  // A 3-decimal price was stored as 12.35 (the column holds two) while the line total was worked out
  // from the raw 12.345 — so the document read "3.00 x $12.35 = $37.04", which does not multiply.
  // Rounding here means the number the customer reads is the number the arithmetic used.
  // (Field Service T28 L7)
  unitPrice: z.number().min(0, 'Price cannot be negative').default(0).transform((v: number) => Math.round((v + Number.EPSILON) * 100) / 100),
  /**
   * WHAT KIND OF LINE IT IS, and WHAT IT COSTS US. Both only persisted on a template that has the
   * columns (options.hasLineCost). (T41)
   *
   * `type` was the live bug. quote_line_item has carried a `type` column all along and job costing
   * READS it to split the estimate into labour and material — but nothing ever WROTE it: this schema
   * had no `type` field, so `toRow` never set one, so every row was NULL and both of those CASE
   * expressions summed to zero. The estimate was therefore £0 on every quoted job, which is why
   * margin read 100%: not a bad cost figure, no cost figure at all.
   *
   * `unitCost` is the other half. A line's unitPrice is what the CUSTOMER pays; the cost to deliver
   * had nowhere to live, so even a correctly-typed line could only have reported the price back as
   * the cost. The pricebook already records cost per item, and the picker fills this from it.
   */
  type: z.enum(['labor', 'material', 'part', 'service', 'other']).optional(),
  unitCost: z.number().min(0, 'Cost cannot be negative').optional()
    .transform((v) => (v === undefined ? undefined : Math.round((v + Number.EPSILON) * 100) / 100)),
  pricebookItemId: z.string().optional().transform(v => (v === '' ? undefined : v)),
  // An optional line, and whether it is ticked (quoteOptions.ts). Kept only where quote_line_item has the columns.
  optional: z.boolean().optional(),
  selected: z.boolean().optional(),
  /**
   * Estimating depth (quoteSections.ts), kept only where quote_line_item has the columns. The phase the line sits under;
   * the markup on our cost the price comes from (the server works the price out — a markup with no cost is refused);
   * an allowance the customer chooses against (approving the quote opens it on Selections); the cost code its budget
   * is filed under.
   */
  section: z.string().trim().max(120, 'A section name is 120 characters or fewer').optional(),
  markupPct: z.number().min(0, 'Markup cannot be negative').max(1000, 'Markup cannot be more than 1000%').optional(),
  allowance: z.boolean().optional(),
  costCode: z.string().trim().max(60, 'A cost code is 60 characters or fewer').optional(),
})
const optionalId = z.string().optional().transform(v => (v === '' ? undefined : v))
const QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'approved', 'rejected', 'declined', 'expired'] as const
/**
 * A quote not yet answered. 'viewed' is a sent quote the customer has opened (portal.ts marks it when they do): still
 * open — the office edits it, sends it again, and marks it approved or declined when the customer says so by phone.
 * Live retest 2026-10-23: once the customer had opened the link, the office could no longer mark it approved.
 */
export const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'viewed']
const EDITABLE = OPEN_QUOTE_STATUSES
/** The statuses an edit may set by hand: 'viewed' is the customer's act, never typed in. */
const SETTABLE = ['draft', 'sent']

const isOpt = (i: { optional?: boolean }) => !!i.optional
const toRow = (items: z.infer<typeof lineItemSchema>[], quoteId: string, hasLineCost = false, hasOptional = false, hasSections = false) => items.map((item, i) => ({
  description: item.description,
  quantity: item.quantity.toString(),
  unitPrice: item.unitPrice.toString(),
  total: round2(item.quantity * item.unitPrice).toString(),
  sortOrder: i,
  quoteId,
  // Only on a template whose quote_line_item carries these columns. `type` is included here rather
  // than unconditionally because it is written alongside the cost by the same picker, and a template
  // without the migration has no screen sending either. (T41)
  ...(hasLineCost ? {
    type: item.type ?? null,
    unitCost: item.unitCost === undefined ? null : item.unitCost.toString(),
    pricebookItemId: item.pricebookItemId ?? null,
  } : {}),
  // An optional line starts unticked unless the office ticked it; a line that is not optional is always included.
  ...(hasOptional ? { optional: isOpt(item), selected: isOpt(item) ? !!item.selected : true } : {}),
  ...(hasSections ? {
    section: item.section || null,
    markupPct: item.markupPct === undefined ? null : item.markupPct.toString(),
    allowance: !!item.allowance,
    costCode: item.costCode || null,
  } : {}),
}))
/** The lines that count, for a quote whose lines may be optional (quoteOptions.ts) — every line where none can be. */
const counted = (items: z.infer<typeof lineItemSchema>[], hasOptional: boolean) => (hasOptional ? includedLines(items.map((i) => ({ ...i, optional: isOpt(i), selected: isOpt(i) ? !!i.selected : true }))) : items)

export function createQuoteRoutes(deps: QuoteDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, loadPdf } = deps
  if (typeof deps.canSee !== 'function') throw new Error('createQuoteRoutes: canSee is required — it decides who reads line cost and signing evidence')

  /**
   * WHAT A QUOTE TELLS WHOM. (T43 viewer round, T68)
   *
   *   "Field service: the viewer can read cost. /api/quotes returns each line's unitCost (e.g. $45.00, $8.75)."
   *   "Contractor: the viewer gets customers' signing evidence … quote detail … returns the signature image,
   *    the signer's IP, their browser string and the signature hash."
   *
   * A line's unitPrice is what the customer pays; its unitCost is what the business pays — margin:read, the
   * rule the inventory and pricebook modules already apply. The signature image, IP, browser and fingerprint
   * are evidence about a person, for the seat that administers the quote (quotes:update) — see
   * signingEvidence.ts. A LIST never carries the image, IP or browser string, for anyone: that is evidence for
   * the one document it proves, not fifty rows of it (the change-order list's rule since T41).
   */
  const may = async (c: any, permission: string) => {
    const u = c.get('user') as any
    try { return !!(await deps.canSee(u?.role, permission, u?.userId)) } catch { return false }
  }
  // A markup is the cost in another form (price ÷ markup gives the cost back), so it goes with the cost.
  const withoutLineCost = (lines: any[] | undefined) => (lines || []).map(({ unitCost, markupPct, ...li }: any) => li)
  /** One quote, shaped for this caller. A list row drops the evidence for everyone except the tamper hash. */
  const forCaller = (q: any, seesCost: boolean, seesEvidence: boolean, list = false) => {
    if (!q) return q
    let out: any = seesEvidence ? { ...q } : withoutSigningEvidence(q)
    // The quote's private link opens Approve for whoever holds it: the seat that administers the quote keeps it, as it
    // keeps the signing evidence; every other seat (and every open screen) does not get it. (2026-10-22)
    if (!seesEvidence) delete out.publicToken
    if (list) { delete out.signature; delete out.signedIp; delete out.signedUserAgent }
    // The phases, with their subtotals — and, for a seat that reads margins, what each costs us.
    if (hasSections && Array.isArray(out.lineItems) && !list) out = { ...out, sections: sectionSummary(out.lineItems, seesCost) }
    if (!seesCost && Array.isArray(out.lineItems)) out = { ...out, lineItems: withoutLineCost(out.lineItems) }
    if (!seesCost && out.proposal?.options) out = { ...out, proposal: { ...out.proposal, options: out.proposal.options.map((op: any) => ({ ...op, lines: withoutLineCost(op.lines) })) } }
    return out
  }
  /** What goes to every open screen in the company: no cost, no evidence — whoever is watching. */
  const forBroadcast = (q: any) => forCaller(q, false, false, true)

  /**
   * One audit row per quote event, carrying the quote's NUMBER. (T58k)
   *
   * Writing it here also stops the request floor writing its duller one — audit.log marks the
   * request as logged — so the log gains a row that names QTE-00002 instead of one that says
   * "Quote".
   *
   * Never throws and never awaited: a quote must not fail to save because the log was unavailable.
   */
  const logQuote = (c: any, action: string, q: any, metadata?: Record<string, unknown>) => {
    try {
      deps.audit?.log?.({
        action,
        entity: deps.audit?.ENTITIES?.QUOTE ?? 'quote',
        entityId: q?.id ?? null,
        entityName: q?.number ?? null,
        metadata: metadata ?? null,
        req: c,
      })
    } catch { /* an unwritten log must not undo a saved quote */ }
  }
  const o = deps.options || {}
  const extra = new Set(o.extraFields || [])
  const conversions = new Set(o.conversions || ['invoice', 'job'])
  // 500, the same ceiling jobs and contacts use. These two capped at 100 while asking for more
  // was answered with a silent clamp, so limit=500 returned 100 rows and a caller paging by what it
  // asked for read a short page as the end of the list. (Field Service T28 L3)
  const maxLimit = o.maxLimit ?? 500
  const numQuote: NumberingOptions = o.numbering?.quote || { prefix: 'QTE', pad: 5, seed: 0 }
  const numInvoice: NumberingOptions = o.numbering?.invoice || { prefix: 'INV', pad: 5, seed: 0 }
  const numJob: NumberingOptions = o.numbering?.job || { prefix: 'JOB', pad: 5, seed: 0 }
  // Optional lines and a deposit on approval (quoteOptions.ts): where the table has the columns, as documentLinks.ts
  // decides a quote's own link by its public_token column. A template's tables have neither and keep what they had.
  const hasOptional = !!t.quoteLineItem?.optional
  const hasDeposit = !!t.quote?.depositType
  // Sections, markup, allowances and cost codes on a quote's lines: where the table has the columns (migration 0041).
  const hasSections = !!t.quoteLineItem?.section
  // Good/Better/Best options the customer chooses from (quoteOptions.ts). Needs the optional-lines columns it rides on.
  const hasProposal = hasOptional && hasProposalTables(t)
  const proposalAllowed = async (cid: string) => hasProposal && (await proposalsLive(t as any, o.proposalsEnabled, cid))
  /** The quote as the office reads it with its options: `lineItems` are the lines every option shares, `proposal` the options. */
  const withProposal = async (out: any) => {
    if (!hasProposal || !out) return out
    const view = await proposalView(db, t as any, out)
    return view ? { ...out, lineItems: (out.lineItems || []).filter((l: any) => !l.proposalOptionId), proposal: view } : out
  }
  /** A quote's lines as its job and its invoice take them: the included ones. */
  const billable = (rows: any[]) => (hasOptional ? includedLines(rows) : rows)

  const quoteSchema = z.object({
    name: z.string().min(1),
    contactId: optionalId,
    projectId: optionalId,
    ...(extra.has('siteId') ? { siteId: optionalId } : {}),
    ...(extra.has('equipmentId') ? { equipmentId: optionalId } : {}),
    ...(extra.has('customerMessage') ? { customerMessage: z.string().optional() } : {}),
    // The job a quote is for (roofing: a proposal belongs to its job — quote.job_id, migration 0012).
    ...(extra.has('jobId') ? { jobId: optionalId } : {}),
    // The salesperson credited with the quote (a team member), blank/null for none. Sent as a user id.
    ...(extra.has('salespersonId') ? { salespersonId: z.string().nullable().optional() } : {}),
    expiryDate: z.union([z.string(), z.null()]).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    discount: z.number().min(0, 'Discount cannot be negative').default(0),
    notes: z.string().optional(),
    terms: z.string().optional(),
    lineItems: z.array(lineItemSchema).default([]),
    status: z.enum(QUOTE_STATUSES).optional(),
    ...(hasDeposit ? { depositType: z.enum(['percent', 'fixed']).nullable().optional(), depositValue: z.number().nullable().optional() } : {}),
  })
  /** The deposit columns an edit writes, or the refusal — checked against the total the quote will have. */
  const depositValues = (data: any, existing: any, total: number): { error: string } | Record<string, unknown> => {
    if (!hasDeposit || (data.depositType === undefined && data.depositValue === undefined)) return {}
    const type = data.depositType !== undefined ? data.depositType : existing?.depositType ?? null
    const value = data.depositValue !== undefined ? data.depositValue : existing?.depositValue ?? null
    if (!type) return { depositType: null, depositValue: null }
    const problem = depositProblem(type, value, total)
    if (problem) return { error: problem }
    return { depositType: type, depositValue: round2(Number(value)).toString() }
  }
  const COPY_FIELDS = ['name', 'contactId', 'projectId', 'notes', 'terms', ...(extra.has('siteId') ? ['siteId'] : []), ...(extra.has('equipmentId') ? ['equipmentId'] : []), ...(extra.has('customerMessage') ? ['customerMessage'] : []), ...(extra.has('jobId') ? ['jobId'] : []), ...(extra.has('salespersonId') ? ['salespersonId'] : [])] as const

  const app = new Hono()
  app.use('*', authenticate)

  const companySettings = async (companyId: string) => {
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return (co?.settings as any) || {}
  }
  /** Who a quote is for, for what is made from it: its customer, else its project's (contacts/customer.ts). */
  const customerOfQuote = async (companyId: string, q: { contactId?: string | null; projectId?: string | null }): Promise<string | null> => {
    if (q.contactId) return q.contactId
    const r = await resolveCustomer(db, t, companyId, { projectId: q.projectId })
    return r.ok && r.contactId ? r.contactId : null
  }
  const ownProject = async (companyId: string, id: string) => (await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, id), eq(t.project.companyId, companyId))).limit(1))[0]
  const ownSalesperson = async (companyId: string, id: string) => !t.user || (await db.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, companyId))).limit(1))[0]
  const ownJob = async (companyId: string, id: string) => (await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, companyId))).limit(1))[0]
  const findOwn = async (companyId: string, id: string) => (await db.select().from(t.quote).where(and(eq(t.quote.id, id), eq(t.quote.companyId, companyId))).limit(1))[0]
  const lineRows = (id: string) => db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  /**
   * The invoice each quote was billed as (invoice.quote_id — the one convert-to-invoice writes and refuses a second of).
   * A quote's screens read it so they stop offering "Create Invoice" on a quote already billed and link the invoice
   * instead (live test 2026-10-22: offered beside INV-00001, refused only once pressed). `invoiced` goes to every reader
   * of the quote; the invoice's number and id only to a seat that reads invoices.
   */
  const invoicedAs = async (c: any, cid: string, quoteIds: string[]): Promise<Map<string, { invoiced: true; invoice: { id: string; number: string } | null }>> => {
    const out = new Map<string, { invoiced: true; invoice: { id: string; number: string } | null }>()
    if (!quoteIds.length || !t.invoice || !conversions.has('invoice')) return out
    const rows = await db.select({ id: t.invoice.id, number: t.invoice.number, quoteId: t.invoice.quoteId }).from(t.invoice)
      .where(and(eq(t.invoice.companyId, cid), inArray(t.invoice.quoteId, quoteIds))).orderBy(asc(t.invoice.createdAt), asc(t.invoice.id))
    const seesInvoices = await may(c, 'invoices:read')
    for (const r of rows) if (!out.has(r.quoteId)) out.set(r.quoteId, { invoiced: true, invoice: seesInvoices ? { id: r.id, number: r.number } : null })
    return out
  }
  const withInvoice = (q: any, billed: Map<string, any>) => ({ ...q, ...(billed.get(q.id) || { invoiced: false, invoice: null }) })

  // ---------------------------------------------------------------- list
  app.get('/', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const contactId = c.req.query('contactId')
    const jobId = extra.has('jobId') ? c.req.query('jobId') : undefined
    const search = c.req.query('search')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), maxLimit)
    // A status this CRM has no word for is a typo, not an empty page. (T29 N2)
    const badStatus = checkFilter(c, 'status', status, QUOTE_STATUSES)
    if (badStatus) return badStatus
    const conditions: any[] = [eq(t.quote.companyId, currentUser.companyId)]
    // ?tile=pending is the home screen's "Pending quotes" rows (reporting/tileConditions.ts — the count's own condition).
    const tile = c.req.query('tile')
    const badTile = checkFilter(c, 'tile', tile, QUOTE_TILES)
    if (badTile) return badTile
    if (status) conditions.push(eq(t.quote.status, status))
    if (tile === 'pending') conditions.push(pendingQuoteCondition(t.quote))
    if (contactId) conditions.push(eq(t.quote.contactId, contactId))
    if (jobId) conditions.push(eq(t.quote.jobId, jobId))
    if (search) { const p = `%${search}%`; conditions.push(or(ilike(t.quote.number, p), ilike(t.quote.name, p))) }
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.quote).where(where).orderBy(desc(t.quote.createdAt), asc(t.quote.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.quote).where(where),
    ])
    const quoteIds: string[] = data.map((q: any) => q.id)
    const contactIds: string[] = [...new Set<string>(data.filter((q: any) => q.contactId).map((q: any) => q.contactId))]
    const [contacts, lineItems] = await Promise.all([
      contactIds.length ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      quoteIds.length ? db.select().from(t.quoteLineItem).where(inArray(t.quoteLineItem.quoteId, quoteIds)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id)) : Promise.resolve([]),
    ])
    const contactMap = Object.fromEntries(contacts.map((ct: any) => [ct.id, ct]))
    const lineItemMap: Record<string, any[]> = {}; lineItems.forEach((li: any) => { (lineItemMap[li.quoteId] ||= []).push(li) })
    const [seesCost, seesEvidence, billed] = await Promise.all([may(c, 'margin:read'), may(c, 'quotes:update'), invoicedAs(c, currentUser.companyId, quoteIds)])
    const rows = data.map((q: any) => forCaller({ ...withInvoice(q, billed), contact: q.contactId ? contactMap[q.contactId] || null : null, lineItems: lineItemMap[q.id] || [] }, seesCost, seesEvidence, true))
    return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // ---------------------------------------------------------------- stats
  app.get('/stats', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const quotes = await db.select({ status: t.quote.status, total: t.quote.total }).from(t.quote).where(eq(t.quote.companyId, currentUser.companyId))
    // "The customer said no" is one bucket, under the word this CRM uses (Decline where the vertical declines, Reject
    // elsewhere). Counting rejected and declined separately left a phantom always-zero figure beside the real one, and
    // anything reading only its own word was short by the quotes refused under the other. (Landscaping T21 L5)
    const refused = o.hasDeclinedAt ? 'declined' : 'rejected'
    const stats: Record<string, number> = { total: quotes.length, draft: 0, sent: 0, approved: 0, [refused]: 0, expired: 0, totalValue: 0, approvedValue: 0 }
    // A viewed quote is a sent one the customer has opened: still awaiting an answer, counted with Sent.
    for (const q of quotes) { const k = q.status === 'rejected' || q.status === 'declined' ? refused : q.status === 'viewed' ? 'sent' : q.status; stats[k] = (stats[k] || 0) + 1; stats.totalValue = round2(stats.totalValue + Number(q.total)); if (q.status === 'approved') stats.approvedValue = round2(stats.approvedValue + Number(q.total)) }
    return c.json(stats)
  })

  // ---------------------------------------------------------------- read one
  app.get('/:id', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const found = await findOwn(cid, id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const [ct, pr, lineItems, eq_, st] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, cid))).limit(1) : Promise.resolve([]),
      lineRows(id),
      extra.has('equipmentId') && t.equipment && found.equipmentId ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model }).from(t.equipment).where(and(eq(t.equipment.id, found.equipmentId), eq(t.equipment.companyId, cid))).limit(1) : Promise.resolve([]),
      extra.has('siteId') && t.site && found.siteId ? db.select({ id: t.site.id, name: t.site.name, address: t.site.address }).from(t.site).where(and(eq(t.site.id, found.siteId), eq(t.site.companyId, cid))).limit(1) : Promise.resolve([]),
    ])
    // THE LEAK T43 FOUND, and the shape guard #201 could not see: the row is indexed and
    // defaulted on its way into the payload, so its bare name never appears. Measured live on
    // ctrtest, basictest and lndtest — owner and manager both received a working portalToken.
    const out: any = { ...withInvoice(found, await invoicedAs(c, cid, [found.id])), contact: withoutPortalCredential(ct[0]) || null, project: pr[0] || null, lineItems }
    if (extra.has('equipmentId')) out.equipment = eq_[0] || null
    if (extra.has('siteId')) out.site = st[0] || null
    return c.json(forCaller(await withProposal(out), await may(c, 'margin:read'), await may(c, 'quotes:update')))
  })

  // ---------------------------------------------------------------- create
  app.post('/', requirePermission('quotes:create'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const data = quoteSchema.parse(await c.req.json()) as any
    if (hasSections) {
      const priced = applyMarkups<any>(data.lineItems)
      if ('error' in priced) return c.json({ error: priced.error }, 400)
      data.lineItems = priced.lines
    }
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    // Who the quote is for: the customer named (never a vendor — the invoice it becomes would bill one), else the
    // project's (contacts/customer.ts).
    const forWhom = await resolveCustomer(db, t, cid, { contactId: data.contactId, projectId: data.projectId })
    if (!forWhom.ok) return c.json({ error: forWhom.error, ...(forWhom.code ? { code: forWhom.code } : {}) }, forWhom.status)
    if (forWhom.contactId !== undefined) data.contactId = forWhom.contactId ?? undefined
    if ((data as any).jobId && !(await ownJob(cid, (data as any).jobId))) return c.json({ error: 'That job does not exist.' }, 404)
    const subtotalRaw = rawSubtotal(counted(data.lineItems, hasOptional))
    if (data.discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
    // A quote is a priced offer: it needs something on it, and an expiry date that hasn't already passed — a $0.00
    // quote with no lines and one expiring in 2020 both saved. (Landscaping T14 L14)
    if (!data.lineItems.length) return c.json({ error: 'Add at least one line item.' }, 400)
    // …and something that is not optional: a quote of nothing but optional lines is no offer until one is ticked.
    // (Good / Better / Best options are added to the saved quote: PUT /:id/proposal.)
    if (hasOptional && !data.lineItems.some((l: any) => !isOpt(l))) return c.json({ error: 'Add at least one line that is not optional.' }, 400)
    const exp = normalizeDateInput(data.expiryDate)
    if (exp.error) return c.json({ error: `Expiry date: ${exp.error}` }, 400)
    // TODAY on the business's own calendar. This was `startOfToday()`, which is the UTC day, so from
    // 19:00 Central the server had already moved to tomorrow and refused a quote expiring on the date the
    // business was actually living in. Same clock the expiry fallback below uses. (T28 M4 family)
    const today = businessToday(await deps.options?.timeZoneFor?.(cid))
    if (exp.value && exp.value < today) return c.json({ error: 'Expiry date is in the past — pick today or later.' }, 400)
    // One read, two answers — the tax rate and how long the quote stands both come off the same settings blob.
    const settings = await companySettings(cid)
    const taxRate = data.taxRate ?? defaultTaxRateFrom(settings)
    const totals = calcTotals(counted(data.lineItems, hasOptional), taxRate, data.discount)
    const deposit = depositValues(data, null, totals.total)
    if ('error' in deposit) return c.json({ error: deposit.error }, 400)
    // A blank expiry means "use our usual validity", exactly as a blank due date on an invoice means "use our
    // payment terms" — the form sends `expiryDate: form.expiryDate || null` for both. It used to land as a
    // literal null, which is not a missing date but an open-ended price: no "Valid until" line for the
    // customer, no way for the status to reach `expired`, and convertible to an invoice for ever at a months-old
    // price. (Field Service T26 L2)
    const values: any = { companyId: cid, expiryDate: exp.value ?? quoteExpiryFromTerms(settings, today), subtotal: totals.subtotal.toString(), taxRate: String(taxRate), taxAmount: totals.taxAmount.toString(), discount: totals.effectiveDiscount.toString(), total: totals.total.toString() }
    for (const k of COPY_FIELDS) if (data[k] !== undefined) values[k] = data[k]
    // Salesperson: the signed-in writer unless the form names someone else (a blank is "no one"); checked against the team.
    if (extra.has('salespersonId')) {
      if (data.salespersonId === undefined) values.salespersonId = currentUser.userId || null
      else if (!data.salespersonId) values.salespersonId = null
      else if (!(await ownSalesperson(cid, data.salespersonId))) return c.json({ error: 'Choose the salesperson from your team.', fields: { salespersonId: 'Choose the salesperson from your team.' } }, 400)
    }
    Object.assign(values, deposit)
    // Who wrote it, for the per-person conversion report — only where the table has the column (additive for the templates).
    if (currentUser.userId && 'createdById' in t.quote) values.createdById = currentUser.userId
    // A quote is born a draft; the lifecycle routes stamp sentAt/approvedAt. A status in the body cannot skip them.
    const result = await db.transaction(async (tx: any) => {
      values.number = await nextNumber(tx, t.quote, t.quote.number, t.quote.companyId, cid, numQuote)
      const [created] = await tx.insert(t.quote).values(values).returning()
      const items = data.lineItems.length ? await tx.insert(t.quoteLineItem).values(toRow(data.lineItems, created.id, !!o.hasLineCost, hasOptional, hasSections)).returning() : []
      return { ...created, lineItems: items }
    })
    emitToCompany(cid, EVENTS.QUOTE_CREATED, forBroadcast(result))
    logQuote(c, deps.audit?.ACTIONS?.CREATE ?? 'create', result, { total: result.total, lineItems: result.lineItems?.length ?? 0 })
    return c.json(forCaller(result, await may(c, 'margin:read'), true), 201)
  })

  // ---------------------------------------------------------------- update
  app.put('/:id', requirePermission('quotes:update'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const id = c.req.param('id')
    const data = partialOf(quoteSchema).parse(await c.req.json()) as any
    const existing = await findOwn(cid, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    // A seat that is not shown a line's cost sends its lines back without one, and the lines are replaced
    // wholesale — so saving would wipe every cost on the quote. Each line keeps the cost of the stored line it
    // came from (same catalogue item, else same description). Only reachable by a seat granted quotes:update
    // without margin:read; owner, admin and manager hold both. (T68)
    const seesCost = await may(c, 'margin:read')
    if (o.hasLineCost && !seesCost && Array.isArray(data.lineItems)) {
      const stored = await lineRows(id)
      const left = [...stored]
      for (const li of data.lineItems) {
        const i = left.findIndex((s: any) => (li.pricebookItemId && s.pricebookItemId === li.pricebookItemId) || (!li.pricebookItemId && s.description === li.description))
        if (i >= 0) {
          const s = left.splice(i, 1)[0]
          li.unitCost = s.unitCost === null || s.unitCost === undefined ? undefined : Number(s.unitCost)
          // …and the markup it was priced from, which the same seat was never shown.
          if (hasSections && s.markupPct !== null && s.markupPct !== undefined && li.markupPct === undefined) li.markupPct = Number(s.markupPct)
        }
        else li.unitCost = undefined
      }
    }
    if (hasSections && Array.isArray(data.lineItems)) {
      // A seat that cannot see cost cannot reprice from a markup either: it keeps the price it sent.
      const priced = applyMarkups<any>(seesCost ? data.lineItems : data.lineItems.map((li: any) => ({ ...li, markupPct: undefined })))
      if ('error' in priced) return c.json({ error: priced.error }, 400)
      data.lineItems = seesCost ? priced.lines : data.lineItems
    }
    // Once a customer has approved (or declined) a quote it is a record, not a draft. Signed acceptances must not be mutable.
    if (!EDITABLE.includes(existing.status)) return c.json({ error: 'Only draft or sent quotes can be edited' }, 400)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    // The same rule on an edit; '' from the form is "not said" here (the schema's optionalId), as it always was.
    const forWhom = await resolveCustomer(db, t, cid, { contactId: data.contactId || undefined, projectId: data.projectId }, existing)
    if (!forWhom.ok) return c.json({ error: forWhom.error, ...(forWhom.code ? { code: forWhom.code } : {}) }, forWhom.status)
    if (forWhom.contactId) data.contactId = forWhom.contactId
    if ((data as any).jobId && !(await ownJob(cid, (data as any).jobId))) return c.json({ error: 'That job does not exist.' }, 404)
    const exp = normalizeDateInput(data.expiryDate)
    if (exp.error) return c.json({ error: `Expiry date: ${exp.error}` }, 400)
    const update: Record<string, any> = { updatedAt: new Date() }
    for (const k of COPY_FIELDS) if (data[k] !== undefined) update[k] = data[k]
    if (extra.has('salespersonId') && data.salespersonId !== undefined) {
      if (!data.salespersonId) update.salespersonId = null
      else if (!(await ownSalesperson(cid, data.salespersonId))) return c.json({ error: 'Choose the salesperson from your team.', fields: { salespersonId: 'Choose the salesperson from your team.' } }, 400)
    }
    if (exp.value !== undefined) update.expiryDate = exp.value
    // status may move between draft and sent from the editor; approvals go through their own routes
    if (data.status && SETTABLE.includes(data.status) && data.status !== existing.status) { update.status = data.status; if (data.status === 'sent') update.sentAt = new Date() }
    const recompute = data.lineItems !== undefined || data.taxRate !== undefined || data.discount !== undefined
    if (recompute) {
      // The lines of the quote's proposal options are not in the edit form (GET /:id sends them apart): they stay as they are.
      const keptOptionLines = hasProposal && data.lineItems !== undefined
        ? (await lineRows(id)).filter((li: any) => li.proposalOptionId).map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice), optional: true, selected: li.selected !== false }))
        : []
      const lines: z.infer<typeof lineItemSchema>[] = data.lineItems !== undefined ? [...data.lineItems, ...keptOptionLines] : (await lineRows(id)).map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice), optional: !!li.optional, selected: li.selected !== false }))
      // A quote with Good / Better / Best options is an offer by its options: the lines they share may be none, or optional.
      if (hasOptional && data.lineItems && data.lineItems.length && !data.lineItems.some((l: any) => !isOpt(l)) && !keptOptionLines.length) return c.json({ error: 'Add at least one line that is not optional.' }, 400)
      const taxRate = data.taxRate ?? Number(existing.taxRate)
      const discount = data.discount ?? Number(existing.discount)
      const subtotalRaw = rawSubtotal(counted(lines, hasOptional))
      if (discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
      const calc = calcTotals(counted(lines, hasOptional), taxRate, discount)
      Object.assign(update, { subtotal: calc.subtotal.toString(), taxRate: String(taxRate), taxAmount: calc.taxAmount.toString(), discount: calc.effectiveDiscount.toString(), total: calc.total.toString() })
    }
    // The deposit is checked against the total the quote will have once this edit is saved — with Good / Better / Best options,
    // against the least it can come to as this edit prices it (the cheapest pick of every set): any pick can still be the one.
    let depositBase = Number(update.total ?? existing.total)
    if (hasProposal) {
      const rows = await lineRows(id)
      const shared: any[] = data.lineItems !== undefined ? counted(data.lineItems, hasOptional) : includedLines<any>(rows.filter((li: any) => !li.proposalOptionId))
      const optionRows = await db.select().from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, id))
      const lowest = lowestPrice(shared, rows.filter((li: any) => li.proposalOptionId), optionRows, data.taxRate ?? existing.taxRate, data.discount ?? existing.discount)
      if (lowest) depositBase = lowest.total
    }
    const deposit = depositValues(data, existing, depositBase)
    if ('error' in deposit) return c.json({ error: deposit.error }, 400)
    Object.assign(update, deposit)
    const result = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(t.quote).set(update).where(eq(t.quote.id, id)).returning()
      let items: any[]
      if (data.lineItems !== undefined) {
        // The lines every option shares are replaced; a proposal option's own lines are not (PUT /:id/proposal changes those).
        await tx.delete(t.quoteLineItem).where(hasProposal ? and(eq(t.quoteLineItem.quoteId, id), isNull(t.quoteLineItem.proposalOptionId)) : eq(t.quoteLineItem.quoteId, id))
        if (data.lineItems.length) await tx.insert(t.quoteLineItem).values(toRow(data.lineItems, id, !!o.hasLineCost, hasOptional, hasSections))
        items = await tx.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
      // read the existing lines on the SAME connection as the transaction — going back to the pool for them while
      // this transaction is open waits on a second connection, which deadlocks when the pool is busy (and always on
      // a single-connection database). Every other caller reads before the transaction opens.
      } else items = await tx.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
      return { ...updated, lineItems: items }
    })
    const shaped = await withProposal(result)
    emitToCompany(cid, EVENTS.QUOTE_UPDATED, forBroadcast(shaped))
    return c.json(forCaller(shaped, seesCost, true))
  })

  // ---------------------------------------------------------------- delete
  app.delete('/:id', requirePermission('quotes:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await findOwn(currentUser.companyId, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    if (existing.status !== 'draft') return c.json({ error: 'Only draft quotes can be deleted' }, 400)
    await db.delete(t.quote).where(eq(t.quote.id, id))
    // The number is captured from the row we already loaded, BEFORE it was deleted. This is the case
    // the request floor structurally cannot cover: after a delete there is nothing left to name.
    logQuote(c, deps.audit?.ACTIONS?.DELETE ?? 'delete', existing, { total: existing.total, status: existing.status })
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- lifecycle
  const setStatus = async (c: any, id: string, patch: Record<string, any>, allowedFrom: string[] | null, event?: string, extraPayload?: (q: any) => Record<string, any>) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const existing = await findOwn(cid, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    if (allowedFrom && !allowedFrom.includes(existing.status)) return c.json({ error: `This quote is already ${existing.status} and cannot be marked ${patch.status}.` }, 400)
    const [updated] = await db.update(t.quote).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.quote.id, id), eq(t.quote.companyId, cid))).returning()
    if (event) emitToCompany(cid, event, { id: updated.id, number: updated.number, ...(extraPayload ? extraPayload(updated) : {}) })
    // Sent, approved, rejected, declined — every lifecycle move, named by its quote number and
    // carrying where it moved from and to, which is the part a status row has to say.
    logQuote(c, deps.audit?.ACTIONS?.STATUS_CHANGE ?? 'status_change', updated, { from: existing.status, status: patch.status ?? updated.status })
    return { updated, existing, cid }
  }

  /**
   * "Send quote" now actually sends the quote.
   *
   * This route set the status to `sent` and called onSent — which is the SMS hook — so the customer got a
   * text if they had a mobile and nothing at all otherwise. Every template's email service has had a
   * sendQuote() the whole time; nothing ever called it. T30 caught it the only way it can be caught from
   * outside: the app reported INV-00163 and QTE-00050 both sent in the same minute, the invoice arrived,
   * and the provider had no record of a quote ever existing. Marked as sent, never sent.
   *
   * The email goes out BEFORE the status moves, the same order invoices use: a quote that could not be
   * delivered must not be sitting in the list claiming it was. sendQuoteEmail is optional, so a template
   * that has not wired it keeps exactly the behaviour it has today rather than starting to 502.
   */
  // `c: any` matches setStatus below — the typed Hono context makes c.get('user') an error in this file,
  // which is why every other handler that needs the user is written the same way. Adding a fourteenth
  // instance of that error to buy nothing is not worth it.
  app.post('/:id/send', requirePermission('quotes:update'), async (c: any) => {
    const cid = (c.get('user') as any).companyId
    const id = c.req.param('id')

    /**
     * A QUOTE GETS ITS EXPIRY WHEN IT IS SENT, IF IT HAS NOT GOT ONE. (T58d)
     *
     * Owner: "35 old quotes with no expiry." Measured on fstest: exactly 35, every one raised on or
     * before 2026-09-21, and nothing raised since is missing one — because POST / has had the
     * `quoteExpiryFromTerms` fallback since Field Service T26 L2. So the create path is fixed and
     * those 35 are rows from before it. They are NOT back-dated here, and that is deliberate: a
     * quote is a document the customer may be holding, and stamping a validity onto one after the
     * fact changes what was offered. On fstest all 35 are approved, viewed, rejected or declined —
     * not one is a live open offer — so there is nothing outstanding to protect.
     *
     * What WAS still open is the gap this closes. ctrtest and lndtest hold unsent DRAFTS with no
     * expiry, and sending one shipped it to the customer with the validity line blank: the email
     * template is handed `expiryDate: found.expiryDate ? … : ''`. A draft has been shown to nobody,
     * so there is nothing to change — and sending it IS the moment the offer is made, which is
     * exactly when a validity period should attach.
     *
     * Only when it is null. Re-sending an already-dated quote must not quietly extend it, and the
     * status gate below still admits `sent`, so that case is reachable.
     */
    const [current] = await db.select().from(t.quote).where(and(eq(t.quote.id, id), eq(t.quote.companyId, cid))).limit(1)
    let stampedExpiry: Date | undefined
    if (current && !current.expiryDate) {
      const settings = await companySettings(cid)
      stampedExpiry = quoteExpiryFromTerms(settings, businessToday(await deps.options?.timeZoneFor?.(cid)))
    }
    const expiryForCustomer = (current?.expiryDate as any) ?? stampedExpiry ?? null

    let recipient: { email: string; name: string } | null = null
    // Can the customer approve this online? Always, where the quote has its own link (the unified app); a template's
    // table has no public_token, so there it is their client portal, when that is on and in date — as before.
    let approveOnline = false
    if (deps.sendQuoteEmail) {
      const found = current
      let contactRow: any = null
      if (found?.contactId) {
        const [ct] = await db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1)
        contactRow = ct || null
        if (ct?.email) recipient = { email: ct.email, name: ct.name || 'there' }
      }
      if (found && !recipient) return c.json({ error: 'This quote has no contact email address to send to. Add an email to the contact first.' }, 400)
      if (found && recipient) {
        const [co] = await db.select().from(t.company).where(eq(t.company.id, cid)).limit(1)
        /**
         * THE EMAIL A CUSTOMER GETS IS THE QUOTE. (E2E run 1, 10/14)
         *
         * It arrived as "Quote from Test comnapny: undefined" — the template reads quoteName, and this passed only
         * the number — with no lines and no way to approve. It now carries the quote's name and number, every line
         * (description, quantity, price, line total — never the internal cost) and the totals.
         *
         * The button opens the QUOTE'S OWN private link (portal/documentLinks.ts), where the customer sees it and
         * approves or declines it — every quote, every customer. It opened their client portal only when that was
         * switched on, so a customer without one was sent a quote with no way to accept it (live, 2026-10-22).
         */
        const token = await documentLinkToken(db, t.quote, found.id)
        // No token (a template's schema): the customer's own client portal on this quote, when it would let them in.
        const features: string[] = Array.isArray(co?.enabledFeatures) ? co.enabledFeatures : []
        const portalLive = !token && !!((!features.length || features.includes('client_portal')) && contactRow?.portalEnabled && contactRow?.portalToken &&
          (!contactRow.portalTokenExp || new Date(contactRow.portalTokenExp).getTime() > Date.now()))
        approveOnline = !!token || portalLive
        // The customer's copy: no pricebook item codes (itemCodes.ts).
        let lines = await customerLines(db, cid, billable(await lineRows(found.id)))
        let emailTotal = found.total, emailSubtotal = found.subtotal, emailTax = found.taxAmount
        // A quote whose customer has yet to choose is offered by its options: each at its whole price, the total "from" the lowest.
        const offered = (await proposalAllowed(cid)) ? await proposalView(db, t as any, found) : null
        if (offered?.needsChoice) {
          // Each option under its set when there is more than one set; an add-on at what it adds, a pick at the whole price.
          const manySets = offered.sets.length > 1
          lines = offered.options.map((op) => {
            const amount = op.setKind === 'any' ? op.addPrice : op.price
            const label = `${manySets ? `${op.setName}: ` : ''}${op.name}${op.brand ? ` — ${op.brand}` : ''}${op.warranty ? ` (${op.warranty})` : ''}${op.setKind === 'any' ? ' (add-on)' : ''}`
            return { description: label, quantity: '1', unitPrice: amount, total: amount }
          }) as any
          emailTotal = offered.lowest.total; emailSubtotal = offered.lowest.subtotal; emailTax = offered.lowest.taxAmount
        }
        try {
          await deps.sendQuoteEmail(recipient.email, {
            quoteNumber: found.number, quoteName: found.name || '', companyName: co?.name || 'Your provider', companyEmail: co?.email || '',
            companyPhone: co?.phone || '',
            contactName: recipient.name, total: emailTotal,
            subtotal: emailSubtotal, discount: found.discount, taxAmount: emailTax, taxRate: found.taxRate,
            lineItems: lines.map((l: any) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })),
            documentPath: token ? documentLinkPath(token) : null,
            portalQuotePath: portalLive ? '/portal/' + contactRow.portalToken + '/quotes/' + found.id : null,
            // The date the customer is about to be held to, including the one being stamped on by
            // this send. It used to be blank whenever the quote had none, so the offer went out
            // with no validity at all.
            expiryDate: expiryForCustomer ? new Date(expiryForCustomer).toLocaleDateString() : '',
          })
        } catch (err: any) {
          console.error('[quotes] send failed', { quote: found.number, to: recipient.email, error: err?.message })
          return c.json({ error: `Could not send the quote email. ${err?.message || 'The mail provider refused it.'} It was not marked as sent.` }, 502)
        }
      }
    }
    // The expiry lands in the SAME update that marks it sent, so a send that fails at the mail
    // provider (the 502 above) leaves the quote exactly as it was — still a draft, still undated,
    // and dated from the day it actually goes out rather than the day somebody first tried.
    const r: any = await setStatus(
      c, id,
      { status: 'sent', sentAt: new Date(), ...(stampedExpiry ? { expiryDate: stampedExpiry } : {}) },
      OPEN_QUOTE_STATUSES, EVENTS.QUOTE_SENT,
    )
    if (!r.updated) return r
    if (o.onSent && r.updated.contactId) {
      const [ct] = await db.select().from(t.contact).where(and(eq(t.contact.id, r.updated.contactId), eq(t.contact.companyId, r.cid))).limit(1)
      const [co] = await db.select().from(t.company).where(eq(t.company.id, r.cid)).limit(1)
      // Stripped here too, so this file needs no entry in the portal-token guard's allow list at
      // all. The hook's own consumers want the name and the phone number; none of them wants the
      // credential, and an allow entry written for this site is what hid the leak above. (T43)
      if (ct) o.onSent({ companyId: r.cid, quote: r.updated, contact: withoutPortalCredential(ct), company: co }).catch(() => {})
    }
    // approveOnline tells the screen whether the customer got an Approve button.
    return c.json({ ...r.updated, approveOnline })
  })
  app.post('/:id/approve', requirePermission('quotes:update'), async (c) => {
    // A quote with options is approved for ONE of them: the customer's (or, on the phone, the office's) pick comes first.
    if (hasProposal) {
      const cid = (c.get('user') as any).companyId
      const q = await findOwn(cid, c.req.param('id'))
      if (q && q.status !== 'approved' && (await proposalAllowed(cid)) && (await proposalNeedsChoice(db, t, q.id))) return c.json({ error: CHOOSE_FIRST, code: CHOOSE_FIRST_CODE }, 400)
    }
    const r: any = await setStatus(c, c.req.param('id'), { status: 'approved', approvedAt: new Date() }, [...OPEN_QUOTE_STATUSES, 'approved'], EVENTS.QUOTE_APPROVED, q => ({ total: q.total }))
    if (!r.updated) return r
    // The deposit the quote asks (unified billing): raised now, recorded by the office or paid on its own link.
    let deposit: unknown = null
    if (o.onApproved) {
      try { deposit = await o.onApproved({ companyId: r.cid, quote: r.updated }) } catch (err: any) { console.error('[quotes] after-approval hook failed', { quote: r.updated.number, error: err?.message }) }
    }
    return c.json({ ...r.updated, ...(o.onApproved ? { deposit } : {}) })
  })
  // Tick or untick an optional line while the quote is open (quoteOptions.ts): the totals are worked out again.
  if (hasOptional) {
    app.post('/:id/options', requirePermission('quotes:update'), async (c: any) => {
      const cid = (c.get('user') as any).companyId
      const id = c.req.param('id')
      const existing = await findOwn(cid, id)
      if (!existing) return c.json({ error: 'Quote not found' }, 404)
      if (!EDITABLE.includes(existing.status)) return c.json({ error: `This quote is ${existing.status}: its lines can no longer change.` }, 400)
      const body = await c.req.json().catch(() => ({}))
      const r: any = await chooseOptionalLine(db, t, cid, id, body?.lineItemId, body?.selected)
      if ('error' in r) return c.json({ error: r.error }, r.status)
      const shaped = await withProposal({ ...r.quote, lineItems: r.lineItems })
      emitToCompany(cid, EVENTS.QUOTE_UPDATED, forBroadcast(shaped))
      return c.json(forCaller(shaped, await may(c, 'margin:read'), await may(c, 'quotes:update')))
    })
  }
  // ---------------------------------------------------------------- proposal options (Good / Better / Best)
  // Options on one quote in up to three sets — pick one of a set, or any of an additive set — each option with its lines,
  // brand, warranty and photos; the customer picks on the quote's link (portal.ts) or the office does on the phone, and the
  // quote's price follows every pick (quoteOptions.ts).
  if (hasProposal) {
    const optionSchema = z.object({
      name: z.string().trim().min(1, 'Name each option.').max(80),
      tier: z.enum(PROPOSAL_TIERS).nullable().optional(),
      brand: z.string().trim().max(120).nullable().optional(),
      warranty: z.string().trim().max(300).nullable().optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      photos: z.array(z.string()).max(MAX_OPTION_PHOTOS, `An option shows at most ${MAX_OPTION_PHOTOS} photos.`).default([]),
      recommended: z.boolean().optional(),
      lines: z.array(lineItemSchema.omit({ optional: true, selected: true })).min(1, 'Each option needs at least one line.'),
    })
    const optionsSchema = z.array(optionSchema).max(MAX_PROPOSAL_OPTIONS, `A set has at most ${MAX_PROPOSAL_OPTIONS} options.`)
    const setSchema = z.object({
      name: z.string().trim().max(80).nullable().optional(),
      kind: z.enum(SET_KINDS).default('one'),
      options: optionsSchema.min(2, 'A set needs at least two options.'),
    })
    // `options` alone is the quote's one pick-one set (every screen written before sets); `sets` is the whole proposal.
    const proposalSchema = z.object({
      options: optionsSchema.optional(),
      sets: z.array(setSchema).max(MAX_PROPOSAL_SETS, `A quote has at most ${MAX_PROPOSAL_SETS} sets of options.`).optional(),
    })
    type OptionInput = z.infer<typeof optionSchema>
    type SetInput = z.infer<typeof setSchema>

    /** Replace the quote's options (no sets clears them). The customer's picks, if any, are cleared with them. */
    const saveProposal = async (cid: string, id: string, sets: SetInput[]): Promise<{ error: string; status: 400 } | { quote: any; lineItems: any[] }> => {
      if (sets.length > 1 && sets.some((s) => !s.name)) return { error: 'Name each set of options, so the customer knows what each choice is for.', status: 400 }
      for (const s of sets) for (const op of s.options) if (op.photos.some((x) => !isPhotoAddress(x))) return { error: `"${op.name}": a photo is an https address or one of your own /media files.`, status: 400 }
      // A deposit the quote already asks must fit the least the quote can come to, since the customer may pick any way.
      if (hasDeposit && sets.length) {
        const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, id), eq(t.quote.companyId, cid))).limit(1)
        if (q?.depositType) {
          const shared = includedLines<any>((await lineRows(id)).filter((li: any) => !li.proposalOptionId))
          const optionRows = sets.flatMap((s, si) => s.options.map((op, i) => ({ id: `${si}:${i}`, setIndex: si, setKind: s.kind, chosen: false, lines: op.lines })))
          const optionLines = optionRows.flatMap((r) => r.lines.map((l) => ({ ...l, proposalOptionId: r.id })))
          const problem = depositProblem(q.depositType, q.depositValue, lowestPrice(shared, optionLines, optionRows, q.taxRate, q.discount)?.total ?? 0)
          if (problem) return { error: `${problem} The cheapest option sets the limit — lower the deposit on the quote first.`, status: 400 }
        }
      }
      const out = await db.transaction(async (tx: any) => {
        await tx.delete(t.quoteLineItem).where(and(eq(t.quoteLineItem.quoteId, id), isNotNull(t.quoteLineItem.proposalOptionId)))
        await tx.delete(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, id))
        let n = 0
        for (const [si, s] of sets.entries()) {
          let sawRecommended = false
          for (const op of s.options) {
            const i = n++
            const recommended: boolean = !!op.recommended && !sawRecommended
            sawRecommended = sawRecommended || recommended
            const [row] = await tx.insert(t.quoteProposalOption).values({
              quoteId: id, name: op.name, tier: op.tier ?? null, brand: op.brand || null, warranty: op.warranty || null, description: op.description || null, photos: op.photos, recommended, sortOrder: i,
              setIndex: si, setName: s.name || null, setKind: s.kind,
            }).returning()
            // An option's lines are optional lines, ticked together when the option is chosen: unticked until then.
            const rows = toRow(op.lines as any, id, !!o.hasLineCost, true).map((r: any) => ({ ...r, optional: true, selected: false, proposalOptionId: row.id, sortOrder: i * 1000 + r.sortOrder }))
            await tx.insert(t.quoteLineItem).values(rows)
          }
        }
        return retotalQuote(tx, t as any, cid, id)
      })
      return out ?? { error: 'Quote not found', status: 400 as const }
    }
    /** The sets a request means: `sets`, or `options` as the one pick-one set (one option alone is not a choice; none clears). */
    const setsOf = (data: z.infer<typeof proposalSchema>): SetInput[] | { error: string } => {
      if (data.sets) return data.sets
      const options = data.options || []
      if (options.length === 1) return { error: 'A proposal needs at least two options to choose between.' }
      return options.length ? [{ name: null, kind: 'one', options }] : []
    }
    const answer = async (c: any, cid: string, r: { quote: any; lineItems: any[] }) => {
      const shaped = await withProposal({ ...r.quote, lineItems: r.lineItems })
      emitToCompany(cid, EVENTS.QUOTE_UPDATED, forBroadcast(shaped))
      return c.json(forCaller(shaped, await may(c, 'margin:read'), await may(c, 'quotes:update')))
    }
    const openQuote = async (c: any) => {
      const cid = (c.get('user') as any).companyId
      const existing = await findOwn(cid, c.req.param('id'))
      if (!existing) return { fail: c.json({ error: 'Quote not found' }, 404) }
      if (!EDITABLE.includes(existing.status)) return { fail: c.json({ error: `This quote is ${existing.status}: its options can no longer change.` }, 400) }
      return { cid, existing }
    }

    app.put('/:id/proposal', requirePermission('quotes:update'), async (c: any) => {
      const got = await openQuote(c)
      if ('fail' in got) return got.fail
      const parsed = proposalSchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the options.' }, 400)
      const sets = setsOf(parsed.data)
      if ('error' in sets) return c.json({ error: sets.error }, 400)
      if (sets.length && !(await proposalAllowed(got.cid))) return c.json({ error: 'Proposal options are not switched on for this account.' }, 403)
      const r = await saveProposal(got.cid, got.existing.id, sets)
      if ('error' in r) return c.json({ error: r.error }, r.status)
      logQuote(c, deps.audit?.ACTIONS?.UPDATE ?? 'update', r.quote, { sets: sets.length, options: sets.reduce((n, s) => n + s.options.length, 0) })
      return answer(c, got.cid, r)
    })

    // The office picks for a customer who said yes by phone (the customer's own pick is portal.ts's). `chosen: false`
    // unticks an add-on; a pick-one set's pick can only be moved to another option.
    app.post('/:id/proposal/choose', requirePermission('quotes:update'), async (c: any) => {
      const got = await openQuote(c)
      if ('fail' in got) return got.fail
      if (!(await proposalAllowed(got.cid))) return c.json({ error: 'Proposal options are not switched on for this account.' }, 403)
      const body = await c.req.json().catch(() => ({}))
      const r: any = await chooseProposalOption(db, t as any, got.cid, got.existing.id, body?.optionId, body?.chosen)
      if ('error' in r) return c.json({ error: r.error }, r.status)
      return answer(c, got.cid, r)
    })

    // An item's Good / Better / Best tiers (pricebook) become the quote's options: one tier per option, as priced there.
    if (t.pricebookItem && t.pricebookGoodBetterBest) {
      app.post('/:id/proposal/from-pricebook', requirePermission('quotes:update'), async (c: any) => {
        const got = await openQuote(c)
        if ('fail' in got) return got.fail
        if (!(await proposalAllowed(got.cid))) return c.json({ error: 'Proposal options are not switched on for this account.' }, 403)
        const body = await c.req.json().catch(() => ({}))
        if (typeof body?.pricebookItemId !== 'string' || !body.pricebookItemId) return c.json({ error: 'Say which pricebook item.' }, 400)
        const [item] = await db.select().from(t.pricebookItem).where(and(eq(t.pricebookItem.id, body.pricebookItemId), eq(t.pricebookItem.companyId, got.cid))).limit(1)
        if (!item) return c.json({ error: 'That pricebook item does not exist.' }, 404)
        const tiers = (await db.select().from(t.pricebookGoodBetterBest).where(eq(t.pricebookGoodBetterBest.pricebookItemId, item.id)))
          .sort((a: any, b: any) => PROPOSAL_TIERS.indexOf(a.tier) - PROPOSAL_TIERS.indexOf(b.tier))
        if (tiers.length < 2) return c.json({ error: 'That item has fewer than two Good / Better / Best tiers. Add them in the pricebook first.' }, 400)
        const label = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
        const options: OptionInput[] = tiers.map((tier: any) => {
          const features: string[] = Array.isArray(tier.features) ? tier.features.filter((f: unknown) => typeof f === 'string') : []
          const name = tier.name || label(tier.tier)
          return {
            name, tier: (PROPOSAL_TIERS as readonly string[]).includes(tier.tier) ? tier.tier : null, brand: null, warranty: null,
            description: [tier.description, features.length ? features.join(' · ') : ''].filter(Boolean).join('\n') || null,
            photos: isPhotoAddress(item.imageUrl) ? [item.imageUrl] : [], recommended: !!tier.recommended,
            lines: [{ description: `${item.name} — ${name}`, quantity: 1, unitPrice: round2(Number(tier.price)), ...(o.hasLineCost ? { pricebookItemId: item.id } : {}) }],
          } as OptionInput
        })
        // The item's tiers are the quote's one pick-one set, named after the item.
        const r = await saveProposal(got.cid, got.existing.id, [{ name: item.name, kind: 'one', options }])
        if ('error' in r) return c.json({ error: r.error }, r.status)
        return answer(c, got.cid, r)
      })
    }
  }
  app.post('/:id/reject', requirePermission('quotes:update'), async (c) => {
    const r: any = await setStatus(c, c.req.param('id'), { status: 'rejected', ...(o.hasDeclinedAt ? { declinedAt: new Date() } : {}) }, [...OPEN_QUOTE_STATUSES, 'rejected'])
    return r.updated ? c.json(r.updated) : r
  })
  if (o.hasDeclinedAt) {
    app.post('/:id/decline', requirePermission('quotes:update'), async (c) => {
      const r: any = await setStatus(c, c.req.param('id'), { status: 'declined', declinedAt: new Date() }, [...OPEN_QUOTE_STATUSES, 'declined'])
      return r.updated ? c.json(r.updated) : r
    })
  }

  // ---------------------------------------------------------------- convert → invoice
  if (conversions.has('invoice')) {
    app.post('/:id/convert-to-invoice', requirePermission('invoices:create'), async (c) => {
      const currentUser = c.get('user') as any
      const cid = currentUser.companyId
      const id = c.req.param('id')
      const found = await findOwn(cid, id)
      if (!found) return c.json({ error: 'Quote not found' }, 404)
      if (['rejected', 'declined', 'expired'].includes(found.status)) return c.json({ error: `A ${found.status} quote cannot be converted to an invoice.` }, 400)
      /**
       * The already-converted check is the FAST PATH. The one that decides is inside the
       * transaction, under a lock on the quote. (T41)
       *
       * This read ran outside the transaction, so two people pressing "Convert to invoice" together
       * both saw "not yet" and both converted: one quote, two invoices, the second of which nobody
       * is expecting and which sits in AR. It is the same shape T41 found on vet's "Bill this
       * visit", where four concurrent clicks produced four invoices — and this one is in shared
       * code, so it ships to every vertical that enables the conversion.
       *
       * A re-read alone would not fix it; the second caller has to BLOCK. So the quote row is locked
       * FOR UPDATE and the existence check repeated inside, where the first committer's invoice is
       * already visible.
       *
       * Everything after the lock uses `tx`. `items` and `settings` are deliberately read BEFORE the
       * transaction opens — going back to the pool while it is open deadlocks a single-connection
       * database, as the comment on the PUT path above records.
       */
      const [already] = await db.select({ id: t.invoice.id, number: t.invoice.number }).from(t.invoice).where(and(eq(t.invoice.quoteId, id), eq(t.invoice.companyId, cid))).limit(1)
      if (already) return c.json({ error: `This quote was already converted to invoice ${already.number}.`, invoiceId: already.id }, 400)
      // The invoice is the customer's document: its lines are written without pricebook item codes (itemCodes.ts).
      // Only the included lines: an optional line nobody ticked is not billed (quoteOptions.ts).
      const items = await customerLines(db, cid, billable(await lineRows(id)))
      const settings = await companySettings(cid)
      // Who it bills: the quote's customer, else its project's (contacts/customer.ts) — read before the transaction opens.
      const customerId = await customerOfQuote(cid, found)
      const result = await db.transaction(async (tx: any) => {
        // Serialises two converters of the SAME quote against each other.
        await tx.execute(sql`SELECT id FROM quote WHERE id = ${id} AND company_id = ${cid} FOR UPDATE`)
        const dup = await tx.select({ id: t.invoice.id, number: t.invoice.number }).from(t.invoice)
          .where(and(eq(t.invoice.quoteId, id), eq(t.invoice.companyId, cid))).limit(1)
        if (dup.length) return { conflict: dup[0] }
        // Billed in parts already (a deposit, progress invoices): this invoice is the final one, crediting them.
        const prior = o.billedBefore ? await o.billedBefore(tx, found) : null
        if (prior?.error) return { refused: prior.error }
        const credit = round2(Number(prior?.credit || 0))

        const number = await nextNumber(tx, t.invoice, t.invoice.number, t.invoice.companyId, cid, numInvoice)
        const [inv] = await tx.insert(t.invoice).values({
          number, contactId: customerId, projectId: found.projectId, quoteId: found.id,
          // The quote's job is the invoice's (roofing): the job's page lists the bill made from its proposal.
          ...(extra.has('jobId') && found.jobId ? { jobId: found.jobId } : {}),
          subtotal: found.subtotal, taxRate: found.taxRate, taxAmount: found.taxAmount, discount: found.discount, total: round2(Number(found.total) - credit).toString(), amountPaid: '0',
          dueDate: dueDateFromTerms(settings), notes: found.notes, terms: found.terms, companyId: cid,
          ...(prior?.values || {}),
        }).returning()
        const lines = items.length ? await tx.insert(t.invoiceLineItem).values(items.map((li: any) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total, sortOrder: li.sortOrder, invoiceId: inv.id }))).returning() : []
        return { invoice: { ...inv, lineItems: lines } }
      })
      if ('refused' in result && result.refused) return c.json({ error: result.refused }, 400)
      // The loser of the race gets the winner's invoice number, not a second invoice.
      if ('conflict' in result && result.conflict) {
        return c.json({ error: `This quote was already converted to invoice ${result.conflict.number}.`, invoiceId: result.conflict.id }, 400)
      }
      emitToCompany(cid, EVENTS.INVOICE_CREATED, (result as any).invoice)
      return c.json((result as any).invoice, 201)
    })
  }

  // ---------------------------------------------------------------- convert → job
  if (conversions.has('job')) {
    app.post('/:id/convert-to-job', requirePermission('jobs:create'), async (c) => {
      const currentUser = c.get('user') as any
      const cid = currentUser.companyId
      const id = c.req.param('id')
      const found = await findOwn(cid, id)
      if (!found) return c.json({ error: 'Quote not found' }, 404)
      if (found.status !== 'approved') return c.json({ error: 'Only approved quotes can be converted to jobs' }, 400)
      const [existingJob] = o.hasConvertedToJobId && found.convertedToJobId
        ? [{ id: found.convertedToJobId }]
        : await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.quoteId, id), eq(t.job.companyId, cid))).limit(1)
      if (existingJob) return c.json({ error: 'Quote already converted to a job', jobId: existingJob.id }, 400)
      // A quote written for a job (quote.job_id, roofing) is that job's proposal: it is not made into a second job.
      if (extra.has('jobId') && found.jobId) return c.json({ error: 'This quote is already on a job.', jobId: found.jobId }, 400)
      const items = await customerLines(db, cid, billable(await lineRows(id)))
      const description = items.map((li: any) => `${li.description} (${Number(li.quantity)} × ${money(Number(li.unitPrice))})`).join('\n')
      // Service address: the quote's site when the vertical has sites, else the contact's address.
      let address = '', city = '', state = '', zip = ''
      let src: any = null
      if (extra.has('siteId') && t.site && found.siteId) src = (await db.select().from(t.site).where(and(eq(t.site.id, found.siteId), eq(t.site.companyId, cid))).limit(1))[0]
      // A quote on a project that names no customer is for the project's (contacts/customer.ts) — the job made from it too.
      const customerId = await customerOfQuote(cid, found)
      if (!src && customerId) src = (await db.select().from(t.contact).where(and(eq(t.contact.id, customerId), eq(t.contact.companyId, cid))).limit(1))[0]
      if (src) { address = src.address || ''; city = src.city || ''; state = src.state || ''; zip = src.zip || '' }
      const result = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, cid, numJob)
        /**
         * UNSCHEDULED, AND WORTH THE WORK — NOT THE WORK PLUS TAX. (T32 M15)
         *
         * The job came out `status: 'scheduled'` with `scheduledDate: null`, which is a contradiction
         * the dispatch board cannot draw: it sat on a schedule with no day. "Scheduled" is a promise
         * to a customer about a date, and converting a quote does not make one — somebody still has
         * to book it. `pending` is the honest status, and it is already in OPEN_JOB_STATUSES, so the
         * job still counts as open work everywhere that matters.
         *
         * And `estimatedValue: found.total` carried the sales tax: the report's QTE-00036 was $10,600
         * of work plus $583 tax, and JOB-00119 was created at $11,183. Tax is the state's money, it is
         * not what the job is worth, and that figure is what job costing reads for revenue and
         * variance (T32 B3) — so the tax was landing in the margin on every converted job.
         *
         * `total - taxAmount` rather than `subtotal`, because `total` has the discount already taken
         * off and `subtotal` does not: a quote discounted $250 is worth $250 less, and that IS the
         * job's value.
         */
        const exTax = Math.round((Number(found.total || 0) - Number(found.taxAmount || 0)) * 100) / 100
        const values: any = {
          number, title: found.name, description, status: 'pending', priority: 'normal', estimatedValue: exTax.toFixed(2),
          address, city, state, zip, notes: `Converted from Quote ${found.number}`,
          contactId: customerId, projectId: found.projectId, quoteId: found.id, createdById: currentUser.userId, companyId: cid,
        }
        if (o.jobHasSiteAndEquipment) { values.equipmentId = found.equipmentId || null; values.siteId = found.siteId || null }
        const newJob = o.makeJob
          ? await o.makeJob(tx, { companyId: cid, userId: currentUser.userId, quote: found, description, address, city, state, zip, estimatedValue: exTax.toFixed(2) })
          : (await tx.insert(t.job).values(values).returning())[0]
        // The quote is the new job's proposal: it records the job it became and, where quotes belong to jobs, sits on it.
        if (o.hasConvertedToJobId || extra.has('jobId')) {
          await tx.update(t.quote).set({ ...('convertedAt' in t.quote ? { convertedAt: new Date() } : {}), ...(o.hasConvertedToJobId ? { convertedToJobId: newJob.id } : {}), ...(extra.has('jobId') ? { jobId: newJob.id } : {}), updatedAt: new Date() }).where(eq(t.quote.id, id))
        }
        return newJob
      })
      const [pr, ct] = await Promise.all([
        result.projectId ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(eq(t.project.id, result.projectId)).limit(1) : Promise.resolve([]),
        result.contactId ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(eq(t.contact.id, result.contactId)).limit(1) : Promise.resolve([]),
      ])
      const out = { ...result, project: pr[0] || null, contact: ct[0] || null }
      emitToCompany(cid, EVENTS.JOB_CREATED, out)
      // This route asks jobs:create, not quotes:read: the new job's row is shaped by the one rule (../jobs/jobMoney.ts).
      return c.json(withoutJobMoney(out, await jobMoneyWithheld(deps.canSee, currentUser)), 201)
    })
  }

  // ---------------------------------------------------------------- pdf
  app.get('/:id/pdf', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const id = c.req.param('id')
    const generateQuotePDF = await loadPdf()
    const found = await findOwn(cid, id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const [ct, lineItems, [co]] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      lineRows(id).then((rows: any[]) => customerLines(db, cid, billable(rows))),
      db.select().from(t.company).where(eq(t.company.id, cid)),
    ])
    // Same strip for the PDF payload. The renderer does not print a token today, but handing it
    // one is how it ends up in a file somebody emails.
    // A quote whose customer has yet to choose prints the lines every option shares and each option at its whole price.
    const view = hasProposal ? await proposalView(db, t as any, found) : null
    const options = offersOptions(view, found.status) ? await Promise.all(view!.options.map(async (op) => ({ ...op, lines: await customerLines(db, cid, op.lines) }))) : undefined
    const pdfBuffer = await generateQuotePDF({ ...found, contact: withoutPortalCredential(ct[0]) || null, lineItems: options ? lineItems.filter((li: any) => !li.proposalOptionId) : lineItems, ...(options ? { options, offer: { needsChoice: view!.needsChoice, lowest: view!.lowest.total } } : {}) }, co)
    return new Response(pdfBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quote-${found.number}.pdf"` } })
  })

  return app
}
