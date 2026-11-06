// Proposals a guest reads, chooses on and signs (restaurant-bar-depth #1; Tripleseat proposal / contract / BEO from one
// record, Perfect Venue proposal with the guest picking their menu online and e-signing).
//
//   staff   /api/event-proposals         build a proposal from the event, add the choices the guest makes (a main, a bar
//                                        package, add-ons), send it, withdraw it, print it (invoices:read / invoices:update)
//   guest   /api/proposal-links/<token>  read it, choose, sign and accept — or decline — with no sign-in; the page is
//                                        /proposal/<token> (web/src/crm/proposal.tsx)
//
// What the guest sees is FROZEN when it is sent (the snapshot): the room, date and hours, head count, the menu lines with
// their prices, the minimum, the instalments and the terms. The signature records what they saw — the same evidence a
// quote keeps (name, drawn signature, consent to sign electronically, address, browser, the fingerprint of the page).
// On acceptance the choices become menu lines on the event, the event moves to Confirmed (the room is held; a clash
// refuses the signing, which stays unsigned), and the instalments are billed on the event's invoice. A PDF copy of the
// proposal, with the signature, is at /pdf. Behind the 'event_proposals' feature (not ready).
//
// Contract and several signers (parity #1, behind 'event_contracts'): the proposal can carry the venue's contract template, filled
// from the event (eventContracts.ts), and be signed by several people in a send order — the client first, then a second client
// signer and/or the venue's countersignature. Each signer has a private link, emailed when the one before signs, and keeps their
// own evidence (event_proposal_signer); the event books, its menu lines are made and its instalments billed only when the LAST
// one signs. After the first signature the choices are locked: what the others sign is what the first saw.
//
// Moved nothing: new. The signing rules are the quote portal's (packages/tenant-backend portal.ts validateSignatureInput),
// written here because that function is private to the portal and its tables are the quote's.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { calcTotals, defaultTaxRateFrom, round2, money, withoutSigningEvidence, companyTimeZone } from '@twomiah/tenant-backend'
import { event, eventSpace, eventMenuItem, eventProposal, eventProposalSigner, eventContractTemplate, eventPayment, contact, company, auditLog } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { createTokenGuessGuard } from '../../http/guards.ts'
import { lockEventBook } from '../../data/restaurantEvents.ts'
import { loadEventLedger, eventInvoiceLines, ensureEventInvoice, syncEventInvoice, LedgerError } from './eventLedger.ts'
import { HELD, SpaceClash, findClash, clashMessage, eventDayWords, eventCodeWords } from './eventBooking.ts'
import { getEventSettings, featureOn } from './eventSettings.ts'
import { dayBefore } from './eventGuarantee.ts'
import { mountInstalmentPaying, leadInstalment, paymentOffer, type InstalmentModel } from './eventPayments.ts'
import { cleanSigners, defaultContractTemplate, renderContract, roleLabel, type ContractContext, type SignerPlanEntry, type SignerRole } from './eventContracts.ts'

const MAX_SIGNATURE_BYTES = 500_000
const OPEN = ['sent', 'viewed', 'partly_signed']
const CONSENT_TEXT = 'I agree that my electronic signature is the legal equivalent of my handwritten signature.'

export interface ProposalChoice { id: string; label: string; perPerson: boolean; price: number }
export interface ProposalOption { id: string; title: string; kind: 'single' | 'multi'; required: boolean; choices: ProposalChoice[] }
export type Selections = Record<string, string[]>

/** The options a coordinator typed, checked and given ids; or the first problem as a sentence. */
export function cleanOptions(raw: unknown): { ok: true; options: ProposalOption[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, options: [] }
  if (!Array.isArray(raw) || raw.length > 20) return { ok: false, error: 'Options must be a list of at most 20 groups.' }
  const options: ProposalOption[] = []
  for (const o of raw) {
    const title = typeof o?.title === 'string' ? o.title.trim().slice(0, 120) : ''
    if (!title) return { ok: false, error: 'Every option group needs a title, like "Choose your main".' }
    if (!Array.isArray(o.choices) || o.choices.length < 1 || o.choices.length > 30) return { ok: false, error: `"${title}" needs between 1 and 30 choices.` }
    const choices: ProposalChoice[] = []
    for (const ch of o.choices) {
      const label = typeof ch?.label === 'string' ? ch.label.trim().slice(0, 160) : ''
      const price = Number(ch?.price ?? 0)
      if (!label) return { ok: false, error: `Every choice in "${title}" needs a name.` }
      if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return { ok: false, error: `The price of "${label}" must be $0 or more.` }
      choices.push({ id: typeof ch.id === 'string' && /^[\w-]{4,40}$/.test(ch.id) ? ch.id : createId(), label, perPerson: ch.perPerson !== false, price: round2(price) })
    }
    options.push({ id: typeof o.id === 'string' && /^[\w-]{4,40}$/.test(o.id) ? o.id : createId(), title, kind: o.kind === 'multi' ? 'multi' : 'single', required: o.required === true, choices })
  }
  return { ok: true, options }
}

/** A guest's selections checked against the options: known choices only, one for a single choice, a required group answered. */
export function selectionsRefusal(options: ProposalOption[], sel: Selections, needAll: boolean): string | null {
  for (const [optId, ids] of Object.entries(sel)) {
    const o = options.find((x) => x.id === optId)
    if (!o) return 'That choice is not on this proposal.'
    if (!Array.isArray(ids) || ids.some((i) => !o.choices.some((c) => c.id === i))) return `"${o.title}" has a choice that is not on this proposal.`
    if (o.kind === 'single' && ids.length > 1) return `Choose just one for "${o.title}".`
  }
  if (needAll) for (const o of options) if (o.required && !(sel[o.id]?.length)) return `Please choose for "${o.title}".`
  return null
}

const heads = (ev: any) => Math.max(1, Number(ev.guestCountFinal ?? ev.guestCount ?? 1) || 1)

/** What the guest's choices add, line by line. */
export function chosenLines(options: ProposalOption[], sel: Selections, guests: number) {
  const out: Array<{ name: string; perPerson: boolean; quantity: number; unitPrice: number; total: number }> = []
  for (const o of options) for (const id of sel[o.id] || []) {
    const ch = o.choices.find((c) => c.id === id)
    if (!ch) continue
    const quantity = ch.perPerson ? guests : 1
    out.push({ name: `${o.title} — ${ch.label}`, perPerson: ch.perPerson, quantity, unitPrice: ch.price, total: round2(quantity * ch.price) })
  }
  return out
}

/** The event as the guest is shown it. Frozen into the proposal when it is sent. */
export async function buildSnapshot(db: any, companyId: string, eventId: string) {
  const ledger = await loadEventLedger(db, companyId, eventId)
  if (!ledger) return null
  const { ev, menu, minimum } = ledger as any
  const [space] = ev.spaceId ? await db.select().from(eventSpace).where(eq(eventSpace.id, ev.spaceId)).limit(1) : [null]
  const [client] = ev.contactId ? await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const schedule = await db.select().from(eventPayment).where(and(eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, companyId)))
  const taxRate = defaultTaxRateFrom(co?.settings)
  const lines = eventInvoiceLines(ev, menu, minimum.lines)
  const totals = calcTotals(lines, taxRate, 0)
  // The rules a contract states (#1): the guest-count deadline and how a minimum shortfall is billed, as they stand when it is sent.
  const rules = await getEventSettings(db, companyId)
  const guarantee = rules.guaranteeDays > 0 && (await featureOn(db, companyId, 'event_guarantee')) ? { days: rules.guaranteeDays, cutoff: dayBefore(ev.eventDate, rules.guaranteeDays) } : null
  return {
    event: { id: ev.id, name: ev.name, type: eventCodeWords(ev.eventType), eventDate: ev.eventDate, dateWords: eventDayWords(ev.eventDate), startTime: ev.startTime, endTime: ev.endTime, guestCount: ev.guestCountFinal ?? ev.guestCount ?? null, spaceId: ev.spaceId },
    space: space ? { name: space.name, seatedCapacity: space.seatedCapacity, standingCapacity: space.standingCapacity } : null,
    client: client ? { name: client.name, email: client.email } : null,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, total: round2(l.quantity * l.unitPrice), taxable: l.taxable !== false })),
    taxRate, subtotal: totals.subtotal, tax: totals.taxAmount, total: totals.total,
    minimum: minimum.required != null ? { required: minimum.required, spend: minimum.spend, shortfall: minimum.shortfall, parts: minimum.parts.map((x: any) => ({ category: x.category, label: x.label, required: x.required, spend: x.spend, shortfall: x.shortfall })) } : null,
    guarantee, shortfallTaxed: rules.shortfallTaxed,
    schedule: schedule.sort((a: any, b: any) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9'))).map((p: any) => ({ label: p.label, amount: Number(p.amount), dueDate: p.dueDate })),
    brand: { name: co?.name, phone: co?.phone, email: co?.email, logo: co?.logo || null, color: co?.primaryColor || null },
  }
}

const SHORTFALL = 'Food and beverage minimum shortfall'
/**
 * The proposal's price with the guest's choices: the frozen lines, the chosen ones, and the tax on both. What the guest chooses is food
 * and drink, so it counts toward the room's minimum: the shortfall line is worked out again with it (as the event's invoice does at
 * signing), taxed or not as the venue's setting was when it was sent. A proposal frozen before the minimum's parts were kept keeps
 * its shortfall line as it was.
 */
export function priceWith(snap: any, options: ProposalOption[], sel: Selections) {
  const guests = Math.max(1, Number(snap.event.guestCount ?? 1) || 1)
  const chosen = chosenLines(options, sel, guests)
  const chosenTotal = round2(chosen.reduce((s, l) => s + l.total, 0))
  let lines: Array<{ description: string; quantity: number; unitPrice: number; total: number; taxable?: boolean }> = snap.lines
  let minimum = snap.minimum
  if (snap.minimum?.parts) {
    const parts = snap.minimum.parts.map((x: any) => (x.category ? x : { ...x, spend: round2(x.spend + chosenTotal), shortfall: round2(Math.max(0, x.required - (x.spend + chosenTotal))) }))
    lines = [
      ...snap.lines.filter((l: any) => !String(l.description).startsWith(SHORTFALL)),
      ...parts.filter((x: any) => x.shortfall > 0.004).map((x: any) => ({ description: x.category ? `${SHORTFALL} — ${x.category}` : SHORTFALL, quantity: 1, unitPrice: x.shortfall, total: x.shortfall, taxable: snap.shortfallTaxed !== false })),
    ]
    minimum = { ...snap.minimum, parts, spend: round2(snap.minimum.spend + chosenTotal), shortfall: round2(parts.reduce((s: number, x: any) => s + x.shortfall, 0)) }
  }
  const t = calcTotals([...lines, ...chosen].map((l: any) => ({ quantity: l.quantity, unitPrice: l.unitPrice, ...(l.taxable === false ? { taxable: false } : {}) })), snap.taxRate, 0)
  return { lines, minimum, chosen, subtotal: t.subtotal, tax: t.taxAmount, total: t.total }
}

const fingerprint = (payload: unknown) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
const tokenNew = () => crypto.randomBytes(32).toString('hex')
const signerIp = (c: any): string | null => { const f = c.req.header('x-forwarded-for'); return f ? f.split(',')[0].trim() || null : c.req.header('x-real-ip') || null }

// ── Signers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A proposal's signers in send order. A proposal sent before signers existed has just its client, made here from what it kept. */
export async function signersOf(db: any, p: any): Promise<any[]> {
  const read = () => db.select().from(eventProposalSigner).where(eq(eventProposalSigner.proposalId, p.id)).orderBy(asc(eventProposalSigner.position))
  const rows = await read()
  if (rows.length || p.status === 'draft' || !p.publicToken) return rows
  const [ev] = await db.select({ contactId: event.contactId }).from(event).where(eq(event.id, p.eventId)).limit(1)
  const [client] = ev?.contactId ? await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
  const signed = p.status === 'accepted'
  await db.insert(eventProposalSigner).values({
    id: createId(), proposalId: p.id, position: 1, role: 'client', name: client?.name || null, email: client?.email || '', token: p.publicToken, status: signed ? 'signed' : 'sent', sentAt: p.sentAt,
    ...(signed ? { signature: p.signature, signedBy: p.signedBy, signedAt: p.signedAt, signedIp: p.signedIp, signedUserAgent: p.signedUserAgent, signatureHash: p.signatureHash, consentAt: p.consentAt, consentText: CONSENT_TEXT } : {}),
    companyId: p.companyId,
  }).onConflictDoNothing()
  return read()
}

const contractCtx = (snap: any, priced: ReturnType<typeof priceWith>, signers: any[]): ContractContext => ({
  snap, priced, names: Object.fromEntries(signers.filter((s) => s.name).map((s) => [s.role, s.name])) as Partial<Record<SignerRole, string>>,
})
/** The contract text a proposal carries, filled; null when it has none. */
const contractTextOf = (p: any, snap: any, signers: any[]): string | null =>
  p.contractBody ? renderContract(p.contractBody, contractCtx(snap, priceWith(snap, p.options, p.selections || {}), signers)) : null

/** Who signed, who is next — names and times only, never the evidence. */
const signersPublic = (signers: any[]) => signers.map((s) => ({ position: s.position, role: s.role, roleLabel: roleLabel(s.role), name: s.signedBy || s.name || roleLabel(s.role), status: s.status, signedAt: s.signedAt }))

/** The proposal as a guest may see it: named fields only, never the evidence or the staff's ids. */
function guestView(p: any, snap: any, signers: any[], you: any | null) {
  const priced = priceWith(snap, p.options, p.selections || {})
  const text = contractTextOf(p, snap, signers)
  return {
    status: p.status, expiresAt: p.expiresAt, message: p.message, terms: p.terms, acceptedAt: p.acceptedAt, signedBy: p.signedBy,
    event: snap.event, space: snap.space, lines: priced.lines, minimum: priced.minimum ? { required: priced.minimum.required, spend: priced.minimum.spend, shortfall: priced.minimum.shortfall } : null, schedule: snap.schedule, brand: snap.brand,
    taxRate: snap.taxRate, options: p.options, selections: p.selections || {},
    chosen: priced.chosen, subtotal: priced.subtotal, tax: priced.tax, total: priced.total,
    contract: text ? { name: p.contractName || 'Contract', text } : null,
    signers: signersPublic(signers),
    you: you ? { position: you.position, role: you.role, roleLabel: roleLabel(you.role), status: you.status, name: you.name || null } : null,
  }
}

const when = (d: any, tz: string) => d ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' }).format(new Date(d)) : ''

export function proposalPdf(p: any, snap: any, signers: any[] = [], tz = 'UTC'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54 })
    const chunks: Buffer[] = []
    doc.on('data', (ch: Buffer) => chunks.push(ch)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    const priced = priceWith(snap, p.options, p.selections || {})
    const room = (need: number) => { if (doc.y + need > doc.page.height - 60) doc.addPage() }
    doc.fontSize(20).text(snap.brand?.name || 'Proposal')
    doc.fontSize(9).fillColor('#555').text([snap.brand?.phone, snap.brand?.email].filter(Boolean).join(' · ')).fillColor('black').moveDown()
    doc.fontSize(15).text(`Proposal — ${snap.event.name}`).fontSize(10).moveDown(0.5)
    doc.text(`${snap.event.dateWords}${snap.event.startTime ? `, ${snap.event.startTime}${snap.event.endTime ? ' – ' + snap.event.endTime : ''}` : ''}`)
    if (snap.space) doc.text(`Room: ${snap.space.name}`)
    if (snap.event.guestCount) doc.text(`Guests: ${snap.event.guestCount}`)
    if (snap.client?.name) doc.text(`Prepared for: ${snap.client.name}`)
    doc.moveDown()
    const row = (a: string, b: string) => { room(16); const y = doc.y; doc.fontSize(10).text(a, 54, y, { width: 380 }); doc.text(b, 440, y, { width: 100, align: 'right' }); doc.moveDown(0.2) }
    for (const l of priced.lines) row(`${l.description}  (${l.quantity} × ${money(l.unitPrice)})`, money(l.total))
    for (const l of priced.chosen) row(`${l.name}  (${l.quantity} × ${money(l.unitPrice)})`, money(l.total))
    doc.moveDown(0.3)
    row('Subtotal', money(priced.subtotal)); if (priced.tax > 0) row(`Tax (${snap.taxRate}%)`, money(priced.tax)); row('Total', money(priced.total))
    if (snap.schedule?.length) { doc.moveDown().fontSize(11).text('Payment schedule').fontSize(10); for (const s of snap.schedule) row(`${s.label}${s.dueDate ? ' — due ' + eventDayWords(s.dueDate) : ''}`, money(s.amount)) }
    const contract = contractTextOf(p, snap, signers)
    if (contract) { doc.addPage(); doc.fontSize(14).text(p.contractName || 'Contract').moveDown(0.5).fontSize(10).text(contract, 54, doc.y, { width: 486 }) }
    if (p.terms) { room(60); doc.moveDown().fontSize(11).text('Terms').fontSize(9).text(p.terms, 54, doc.y, { width: 486 }) }
    if (signers.length) {
      doc.addPage()
      doc.fontSize(13).text('Signatures').moveDown(0.5)
      for (const s of signers) {
        room(130)
        doc.fontSize(11).text(`${s.position}. ${roleLabel(s.role)}`).fontSize(9)
        if (s.status === 'signed') {
          doc.text(`Signed by ${s.signedBy} on ${when(s.signedAt, tz)}`)
          if (s.consentText) doc.text(`Agreed to sign electronically: “${s.consentText}”`, { width: 486 })
          doc.text(`Document fingerprint: ${s.signatureHash}`)
          if (typeof s.signature === 'string' && s.signature.startsWith('data:image/png;base64,')) {
            try { doc.image(Buffer.from(s.signature.split(',')[1], 'base64'), { fit: [200, 70] }) } catch { /* an unreadable image: the typed name stands */ }
          }
        } else doc.fillColor('#777').text(`${s.name || roleLabel(s.role)} — awaiting signature`).fillColor('black')
        doc.moveDown()
      }
    } else if (p.status === 'accepted') {
      doc.moveDown().fontSize(11).text('Accepted').fontSize(9)
      doc.text(`Signed by ${p.signedBy} on ${when(p.signedAt, tz)}`)
      doc.text(`Document fingerprint: ${p.signatureHash}`)
    }
    doc.end()
  })
}

class SignRefusal extends Error { constructor(message: string, public status: 409 | 400, public code?: string) { super(message) } }

export function createEventProposalRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany } = d.realtime
  const REFRESH = d.realtime.EVENTS.REFRESH
  const app = new Hono<AppEnv>()
  const mayEvidence = async (u: any) => d.permissions.hasPermission(u?.role, 'invoices:update', await d.permissions.getExtraPermissions(u?.userId))
  const contractsOn = (companyId: string) => d.features.isFeatureEnabled(companyId, 'event_contracts')

  async function ownProposal(companyId: string, id: string) {
    const [p] = await db.select().from(eventProposal).where(and(eq(eventProposal.id, id), eq(eventProposal.companyId, companyId))).limit(1)
    return p || null
  }
  /** The signers as staff see them: names, stages and times; the emails, the private links and the fingerprints only for a seat that may edit money. */
  const staffSigners = async (u: any, p: any) => {
    const evidence = await mayEvidence(u)
    const rows = await signersOf(db, p)
    if (!rows.length) return (Array.isArray(p.signerPlan) ? p.signerPlan : []).map((s: SignerPlanEntry, i: number) => ({ position: i + 1, role: s.role, roleLabel: roleLabel(s.role), name: s.name, status: 'draft', ...(evidence ? { email: s.email } : {}) }))
    return rows.map((s: any) => ({
      position: s.position, role: s.role, roleLabel: roleLabel(s.role), name: s.signedBy || s.name, status: s.status, sentAt: s.sentAt, signedAt: s.signedAt,
      ...(evidence ? { email: s.email, consentAt: s.consentAt, signatureHash: s.signatureHash, ...(s.status !== 'signed' && OPEN.includes(p.status) ? { path: `/event-proposal/${s.token}` } : {}) } : {}),
    }))
  }
  const shown = async (u: any, p: any) => {
    const row = (await mayEvidence(u)) ? p : withoutSigningEvidence(p)
    return { ...row, signers: await staffSigners(u, p), ...(p.publicToken && (await mayEvidence(u)) ? { path: `/event-proposal/${p.publicToken}` } : { publicToken: undefined }) }
  }
  const stale = async (p: any) => {
    const [ev] = await db.select().from(event).where(eq(event.id, p.eventId)).limit(1)
    const s = (p.snapshot as any)?.event
    return !ev || !s || ev.eventDate !== s.eventDate || (ev.spaceId || null) !== (s.spaceId || null) || (ev.startTime || null) !== (s.startTime || null) || (ev.endTime || null) !== (s.endTime || null) || (ev.guestCountFinal ?? ev.guestCount ?? null) !== s.guestCount
  }
  /** The contract and signers a body asks for, checked: the template (the venue's default when none is named) and the signer plan. */
  async function contractParts(companyId: string, ev: any, b: any, cur?: any) {
    const on = await contractsOn(companyId)
    if (!on && (b.signers != null || b.contractTemplateId)) return { error: 'Contract templates and several signers are not switched on for this business.' } as const
    if (!on) return { set: {} } as const
    const set: Record<string, unknown> = {}
    if (b.contractTemplateId !== undefined || !cur) {
      let t: any = null
      if (b.contractTemplateId) {
        ;[t] = await db.select().from(eventContractTemplate).where(and(eq(eventContractTemplate.id, String(b.contractTemplateId)), eq(eventContractTemplate.companyId, companyId), eq(eventContractTemplate.active, true))).limit(1)
        if (!t) return { error: 'That contract template was not found, or is switched off.' } as const
      } else if (b.contractTemplateId === undefined) t = await defaultContractTemplate(db, companyId)
      Object.assign(set, { contractTemplateId: t?.id ?? null, contractName: t?.name ?? null, contractBody: t?.body ?? null })
    }
    if (b.signers !== undefined) {
      const [client] = ev.contactId ? await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
      const [co] = await db.select({ email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
      const plan = cleanSigners(b.signers, client, co?.email || null)
      if (!plan.ok) return { error: plan.error } as const
      set.signerPlan = b.signers == null || (Array.isArray(b.signers) && !b.signers.length) ? [] : plan.signers
    }
    return { set } as const
  }

  // GET /event-proposals?eventId= — a proposal is a priced document: invoices:read.
  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const eventId = c.req.query('eventId')
    const rows = await db.select().from(eventProposal).where(and(eq(eventProposal.companyId, u.companyId), ...(eventId ? [eq(eventProposal.eventId, eventId)] : []))).orderBy(desc(eventProposal.createdAt))
    const out = []
    for (const p of rows) out.push({ ...(await shown(u, p)), stale: OPEN.includes(p.status) ? await stale(p) : false })
    return listAll(c, out)
  })

  app.get('/:id', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const p = await ownProposal(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Proposal not found')
    return one(c, { ...(await shown(u, p)), stale: OPEN.includes(p.status) ? await stale(p) : false })
  })

  // POST /event-proposals — a draft from the event as it stands now.
  app.post('/', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [ev] = typeof b.eventId === 'string' ? await db.select().from(event).where(and(eq(event.id, b.eventId), eq(event.companyId, u.companyId))).limit(1) : []
    if (!ev) return fail(c, 404, 'Event not found')
    if (['cancelled', 'lost'].includes(ev.status)) return fail(c, 409, 'This event is no longer open, so it cannot have a proposal.')
    const opts = cleanOptions(b.options)
    if (!opts.ok) return fail(c, 400, opts.error)
    const parts = await contractParts(u.companyId, ev, b)
    if ('error' in parts) return fail(c, 400, parts.error!)
    const snapshot = await buildSnapshot(db, u.companyId, ev.id)
    const settings = await getEventSettings(db, u.companyId)
    const n = (await db.select({ id: eventProposal.id }).from(eventProposal).where(eq(eventProposal.eventId, ev.id))).length
    const [row] = await db.insert(eventProposal).values({
      id: createId(), eventId: ev.id, version: n + 1, status: 'draft', message: b.message ? String(b.message).slice(0, 4000) : null,
      terms: typeof b.terms === 'string' ? b.terms.slice(0, 8000) : settings.proposalTerms || null, options: opts.options, snapshot: snapshot as any, createdBy: u.userId, companyId: u.companyId,
      ...parts.set,
    }).returning()
    await audit.log({ action: 'create', entity: 'event_proposal', entityId: row.id, entityName: `Proposal ${row.version} — ${ev.name}`, metadata: { eventId: ev.id }, req: { user: u } })
    return one(c, await shown(u, row), 201)
  })

  // PUT /event-proposals/:id — a draft's message, terms, choices, contract and signers.
  app.put('/:id', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const p = await ownProposal(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Proposal not found')
    if (p.status !== 'draft') return fail(c, 409, 'A proposal that has been sent cannot be changed. Withdraw it and make a new one.')
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const set: any = { updatedAt: new Date() }
    if ('message' in b) set.message = b.message ? String(b.message).slice(0, 4000) : null
    if ('terms' in b) set.terms = b.terms ? String(b.terms).slice(0, 8000) : null
    if ('options' in b) { const o = cleanOptions(b.options); if (!o.ok) return fail(c, 400, o.error); set.options = o.options }
    const [ev] = await db.select().from(event).where(eq(event.id, p.eventId)).limit(1)
    const parts = await contractParts(u.companyId, ev, b, p)
    if ('error' in parts) return fail(c, 400, parts.error!)
    Object.assign(set, parts.set)
    const [row] = await db.update(eventProposal).set(set).where(eq(eventProposal.id, p.id)).returning()
    return one(c, await shown(u, row))
  })

  // POST /event-proposals/:id/send — freeze it, make the signers' links, email the first, and replace any earlier open one.
  app.post('/:id/send', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const p = await ownProposal(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Proposal not found')
    if (p.status !== 'draft') return fail(c, 409, 'That proposal has already been sent.')
    const [ev] = await db.select().from(event).where(eq(event.id, p.eventId)).limit(1)
    if (!ev || ['cancelled', 'lost'].includes(ev.status)) return fail(c, 409, 'This event is no longer open.')
    const [client] = ev.contactId ? await db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
    if (!client?.email) return fail(c, 400, 'Add a client with an email address to this event first — the proposal is sent to them.')
    const [co] = await db.select({ name: company.name, email: company.email }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const on = await contractsOn(u.companyId)
    const plan = cleanSigners(on && Array.isArray(p.signerPlan) && p.signerPlan.length ? p.signerPlan : null, client, co?.email || null)
    if (!plan.ok) return fail(c, 400, plan.error)
    // The contract as the template reads now (an edit since the draft is picked up); a template since deleted leaves the draft's own copy.
    let contract: Record<string, unknown> = {}
    if (on && p.contractTemplateId) {
      const [t] = await db.select().from(eventContractTemplate).where(and(eq(eventContractTemplate.id, p.contractTemplateId), eq(eventContractTemplate.companyId, u.companyId))).limit(1)
      if (t) contract = { contractName: t.name, contractBody: t.body }
    }
    const snapshot = await buildSnapshot(db, u.companyId, ev.id)
    const settings = await getEventSettings(db, u.companyId)
    const now = new Date()
    const tokens = plan.signers.map(() => tokenNew())
    const row = await db.transaction(async (tx: any) => {
      await tx.update(eventProposal).set({ status: 'superseded', updatedAt: now }).where(and(eq(eventProposal.eventId, ev.id), inArray(eventProposal.status, OPEN)))
      const [r] = await tx.update(eventProposal).set({
        status: 'sent', publicToken: tokens[0], snapshot: snapshot as any, sentAt: now, expiresAt: new Date(now.getTime() + settings.proposalValidDays * 86400000), updatedAt: now, ...contract,
      }).where(eq(eventProposal.id, p.id)).returning()
      for (let i = 0; i < plan.signers.length; i++) {
        const s = plan.signers[i]
        await tx.insert(eventProposalSigner).values({ id: createId(), proposalId: p.id, position: i + 1, role: s.role, name: s.name, email: s.email, token: tokens[i], status: i === 0 ? 'sent' : 'waiting', sentAt: i === 0 ? now : null, companyId: u.companyId })
      }
      return r
    })
    await d.services.emailService.send(client.email, 'eventNote', {
      companyName: co?.name || 'The venue', contactName: client.name || 'there', subject: `Your proposal for ${eventDayWords(ev.eventDate)} from ${co?.name || 'us'}`,
      headline: `Your proposal for ${ev.name} is ready.`, body: `${row.message ? row.message + '\n\n' : ''}Open it to see the menu and the price, choose what you would like and sign. It stays open until ${eventDayWords(row.expiresAt.toISOString().slice(0, 10))}.`,
      button: 'Open your proposal', path: `/event-proposal/${tokens[0]}`,
    })
    await audit.log({ action: 'update', entity: 'event_proposal', entityId: row.id, entityName: `Proposal ${row.version} sent — ${ev.name}`, metadata: { to: client.email, signers: plan.signers.length }, req: { user: u } })
    emitToCompany(u.companyId, REFRESH, { entity: 'event' })
    return one(c, await shown(u, row))
  })

  // POST /event-proposals/:id/withdraw — the links stop working.
  app.post('/:id/withdraw', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const p = await ownProposal(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Proposal not found')
    if (!OPEN.includes(p.status)) return fail(c, 409, 'Only a proposal that is out with the guest can be withdrawn.')
    const [row] = await db.update(eventProposal).set({ status: 'superseded', updatedAt: new Date() }).where(eq(eventProposal.id, p.id)).returning()
    await audit.log({ action: 'update', entity: 'event_proposal', entityId: row.id, entityName: 'Proposal withdrawn', req: { user: u } })
    return one(c, await shown(u, row))
  })

  app.get('/:id/pdf', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const p = await ownProposal(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Proposal not found')
    return new Response(new Uint8Array(await proposalPdf(p, p.snapshot, await signersOf(db, p), await companyTimeZone(db, u.companyId))), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="proposal-${p.version}.pdf"` } })
  })
  return app
}

/** The contract filled from an event as it stands now, for the template editor's preview; null when the event is not this business's. */
export async function previewContract(db: any, companyId: string, eventId: string, body: string): Promise<string | null> {
  const snap = await buildSnapshot(db, companyId, eventId)
  if (!snap) return null
  return renderContract(body, contractCtx(snap, priceWith(snap, [], {}), []))
}

/** The guest's side: by a signer's secret link alone. Every answer is scoped to that one proposal and that one signer. */
export function createProposalLinkRoutes(d: CrmDeps) {
  const { db } = d
  const { emitToCompany } = d.realtime
  const REFRESH = d.realtime.EVENTS.REFRESH
  const app = new Hono<AppEnv>()
  // Guessing links: 20 wrong ones in 15 minutes from one address and every link from it reads "not valid" for the rest of the window.
  app.use('/:token/*', createTokenGuessGuard(15 * 60_000, 20, 'This proposal link is not valid.'))

  /** The proposal and the signer a link belongs to: a signer's own link, or the first link a proposal had before signers existed. */
  async function open(c: any) {
    const token = c.req.param('token')
    if (!/^[0-9a-f]{64}$/.test(token)) return { res: fail(c, 404, 'This proposal link is not valid.') }
    const [bySigner] = await db.select().from(eventProposalSigner).where(eq(eventProposalSigner.token, token)).limit(1)
    const [p] = bySigner
      ? await db.select().from(eventProposal).where(eq(eventProposal.id, bySigner.proposalId)).limit(1)
      : await db.select().from(eventProposal).where(eq(eventProposal.publicToken, token)).limit(1)
    if (!p || p.status === 'draft') return { res: fail(c, 404, 'This proposal link is not valid.') }
    const signers = await signersOf(db, p)
    const signer = signers.find((s: any) => s.token === token)
    if (!signer) return { res: fail(c, 404, 'This proposal link is not valid.') }
    // A sent proposal past its date reads as expired.
    if (OPEN.includes(p.status) && p.expiresAt && new Date(p.expiresAt) < new Date()) {
      await db.update(eventProposal).set({ status: 'expired', updatedAt: new Date() }).where(eq(eventProposal.id, p.id))
      p.status = 'expired'
    }
    return { p, signer, signers }
  }
  const answerable = (p: any) => (OPEN.includes(p.status) ? null : p.status === 'accepted' ? 'This proposal has already been signed.' : p.status === 'expired' ? 'This proposal has expired. Please ask for a new one.' : p.status === 'declined' ? 'This proposal was declined.' : 'This proposal has been replaced. Please use the newest link you were sent.')

  async function mailSigner(p: any, s: any, kind: 'turn' | 'booked') {
    const snap = p.snapshot as any
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, p.companyId)).limit(1)
    await d.services.emailService.send(s.email, 'eventNote', {
      companyName: co?.name || 'The venue', contactName: s.name || 'there',
      subject: kind === 'turn' ? `${snap.event.name}: your signature is needed` : `Your date is booked: ${snap.event.name}`,
      headline: kind === 'turn' ? `It is your turn to sign the proposal for ${snap.event.name}.` : `Everyone has signed — ${snap.event.dateWords} is booked.`,
      body: kind === 'turn' ? 'The others before you have signed. Open it to read the contract and sign.' : 'Open your proposal to download the signed copy and to pay your deposit if one is due.',
      button: kind === 'turn' ? 'Read and sign' : 'Open your proposal', path: `/event-proposal/${s.token}`,
    })
  }

  /**
   * Sign and pay in one flow (#2): once the date is booked, the CLIENT's page offers the first payment
   * (the deposit; once it is paid the page says so and never offers the balance), on the venue's own Stripe, with the option to keep the card for the rest. Only when the venue has payment
   * automation on (the same switch as the pay link) and has not turned off paying at signing. Everyone else's page offers nothing.
   */
  async function payTarget(p: any, signer: any): Promise<InstalmentModel | null> {
    if (p.status !== 'accepted' || signer.role !== 'client') return null
    if (!(await d.features.isFeatureEnabled(p.companyId, 'event_payment_automation'))) return null
    if ((await getEventSettings(db, p.companyId)).payAtSigning === false) return null
    return leadInstalment(d, p.companyId, p.eventId)
  }
  const withPay = async (view: Record<string, unknown>, p: any, signer: any) => {
    const m = await payTarget(p, signer)
    return { ...view, pay: m ? await paymentOffer(d, m) : null }
  }
  mountInstalmentPaying(app, d, '/:token/pay', async (c) => {
    const o = await open(c); if ('res' in o) return { res: o.res as Response }
    const m = await payTarget(o.p, o.signer)
    return m ? { m, via: 'the proposal page' } : { res: fail(c, 409, 'There is nothing to pay on this proposal right now.', 'nothing_to_pay') }
  })

  app.get('/:token', async (c) => {
    const { p, signer, signers, res } = await open(c); if (res) return res
    if (p.status === 'sent' && signer.position === 1) {
      await db.update(eventProposal).set({ status: 'viewed', viewedAt: new Date(), updatedAt: new Date() }).where(eq(eventProposal.id, p.id))
      p.status = 'viewed'
      emitToCompany(p.companyId, REFRESH, { entity: 'event' })
    }
    return one(c, await withPay(guestView(p, p.snapshot, signers, signer), p, signer))
  })

  app.put('/:token/choices', async (c) => {
    const { p, signer, signers, res } = await open(c); if (res) return res
    const no = answerable(p); if (no) return fail(c, 409, no)
    if (signer.position !== 1 || signers.some((s: any) => s.status === 'signed')) return fail(c, 409, 'The choices were settled when the first person signed.', 'choices_locked')
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const sel: Selections = b.selections && typeof b.selections === 'object' ? b.selections : {}
    const bad = selectionsRefusal(p.options, sel, false)
    if (bad) return fail(c, 400, bad)
    const [row] = await db.update(eventProposal).set({ selections: sel, updatedAt: new Date() }).where(eq(eventProposal.id, p.id)).returning()
    return one(c, guestView(row, row.snapshot, signers, signer))
  })

  app.post('/:token/decline', async (c) => {
    const { p, signer, signers, res } = await open(c); if (res) return res
    const no = answerable(p); if (no) return fail(c, 409, no)
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [row] = await db.update(eventProposal).set({ status: 'declined', declinedAt: new Date(), declineReason: b.reason ? String(b.reason).slice(0, 1000) : null, updatedAt: new Date() }).where(eq(eventProposal.id, p.id)).returning()
    emitToCompany(p.companyId, REFRESH, { entity: 'event' })
    return one(c, guestView(row, row.snapshot, signers, signer))
  })

  app.post('/:token/accept', async (c) => {
    const { p, signer, signers, res } = await open(c); if (res) return res
    const no = answerable(p); if (no) return fail(c, 409, no)
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const typed = typeof b.signedBy === 'string' ? b.signedBy.trim().slice(0, 160) : ''
    if (typeof b.signature !== 'string' || !b.signature.startsWith('data:image/')) return fail(c, 400, 'A signature is required.')
    if (b.signature.length > MAX_SIGNATURE_BYTES) return fail(c, 400, 'Signature image is too large.')
    if (!typed) return fail(c, 400, 'Please type your full name to sign.')
    if (b.consent !== true) return fail(c, 400, 'You must agree to sign electronically before accepting.')
    if (signer.status === 'signed') return fail(c, 409, 'You have already signed this proposal.', 'already_signed')
    if (signer.status !== 'sent') {
      const before = signers.filter((s: any) => s.position < signer.position && s.status !== 'signed')[0]
      return fail(c, 409, `${before ? roleLabel(before.role) : 'The signer before you'} has to sign first — you will be emailed when it is your turn.`, 'not_your_turn')
    }
    // The first signer makes the choices; everyone after signs exactly what they chose.
    const first = signer.position === 1
    const sel: Selections = first ? (b.selections && typeof b.selections === 'object' ? b.selections : (p.selections || {})) : (p.selections || {})
    const bad = selectionsRefusal(p.options, sel, true)
    if (bad) return fail(c, 400, bad)

    const [ev] = await db.select().from(event).where(eq(event.id, p.eventId)).limit(1)
    if (!ev || ['cancelled', 'lost'].includes(ev.status)) return fail(c, 409, 'This event is no longer open. Please contact us.')
    const s = (p.snapshot as any).event
    if (ev.eventDate !== s.eventDate || (ev.spaceId || null) !== (s.spaceId || null) || (ev.startTime || null) !== (s.startTime || null) || (ev.endTime || null) !== (s.endTime || null)) {
      return fail(c, 409, 'The date, time or room changed after this proposal was sent. Please ask us for a new one.', 'proposal_stale')
    }
    const signedAt = new Date(), ip = signerIp(c), userAgent = c.req.header('user-agent') || null
    const contract = p.contractBody ? renderContract(p.contractBody, contractCtx(p.snapshot, priceWith(p.snapshot, p.options, sel), signers)) : ''
    const hash = fingerprint({ id: p.id, version: p.version, snapshot: p.snapshot, options: p.options, selections: sel, terms: p.terms || '', contract, signer: signer.id })
    let result: { row: any; next: any | null; finished: boolean }
    try {
      result = await db.transaction(async (tx: any) => {
        await lockEventBook(tx, p.companyId)
        // Read again under the lock: two signers, or the same one twice, at once.
        const [fresh] = await tx.select().from(eventProposal).where(eq(eventProposal.id, p.id)).limit(1)
        if (!fresh || !OPEN.includes(fresh.status)) throw new SignRefusal('This proposal is no longer open.', 409)
        const [mine] = await tx.select().from(eventProposalSigner).where(eq(eventProposalSigner.id, signer.id)).limit(1)
        if (mine?.status === 'signed') throw new SignRefusal('You have already signed this proposal.', 409, 'already_signed')
        if (mine?.status !== 'sent') throw new SignRefusal('It is not your turn to sign yet.', 409, 'not_your_turn')
        // Signing holds the date: the room must still be free of anyone else's hold.
        if (ev.spaceId && !HELD.includes(ev.status)) {
          const held = await findClash(tx, p.companyId, ev.spaceId, ev.eventDate, ev.id, ev)
          if (held) throw new SpaceClash(clashMessage(ev.eventDate, held), held.id)
        }
        await tx.update(eventProposalSigner).set({
          status: 'signed', signature: b.signature, signedBy: typed, signedAt, signedIp: ip, signedUserAgent: userAgent, signatureHash: hash, consentAt: signedAt, consentText: CONSENT_TEXT,
        }).where(eq(eventProposalSigner.id, signer.id))
        await tx.insert(auditLog).values({
          companyId: p.companyId, action: 'event_proposal.signed', entity: 'event_proposal', entityId: p.id, entityName: `Proposal ${p.version} — ${s.name}`, ipAddress: ip, userAgent, userName: typed,
          metadata: { signedAt: signedAt.toISOString(), documentHash: hash, consent: true, consentText: CONSENT_TEXT, method: 'proposal-link-drawn-signature', signerRole: signer.role, position: signer.position, of: signers.length },
        } as any)
        const waiting = signers.filter((x: any) => x.id !== signer.id && x.status !== 'signed').sort((a: any, z: any) => a.position - z.position)
        if (waiting.length) {
          // Not the last: this signature is kept and the next in line is sent theirs. Nothing is booked yet.
          const next = waiting[0]
          await tx.update(eventProposalSigner).set({ status: 'sent', sentAt: signedAt }).where(eq(eventProposalSigner.id, next.id))
          const [row] = await tx.update(eventProposal).set({ status: 'partly_signed', selections: sel, updatedAt: signedAt }).where(eq(eventProposal.id, p.id)).returning()
          return { row, next, finished: false }
        }
        // The last signature books the date. The guest's choices become the event's menu lines.
        const guests = Math.max(1, Number(s.guestCount ?? 1) || 1)
        for (const l of chosenLines(p.options, sel, guests)) {
          await tx.insert(eventMenuItem).values({ id: createId(), eventId: ev.id, name: l.name, perPerson: l.perPerson, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), companyId: p.companyId })
        }
        if (['enquiry', 'tentative'].includes(ev.status)) {
          await tx.update(event).set({ status: 'confirmed', bookedAt: ev.bookedAt || signedAt, updatedAt: signedAt }).where(eq(event.id, ev.id))
        }
        // The instalments scheduled on the event are billed on its invoice from now.
        const scheduled = await tx.select({ id: eventPayment.id }).from(eventPayment).where(eq(eventPayment.eventId, ev.id)).limit(1)
        if (scheduled.length && ev.contactId) await ensureEventInvoice(tx, p.companyId, ev.id)
        await syncEventInvoice(tx, p.companyId, ev.id)
        const [row] = await tx.update(eventProposal).set({
          status: 'accepted', selections: sel, acceptedAt: signedAt, signature: b.signature, signedBy: typed, signedAt, signedIp: ip, signedUserAgent: userAgent, signatureHash: hash, consentAt: signedAt, updatedAt: signedAt,
        }).where(eq(eventProposal.id, p.id)).returning()
        return { row, next: null, finished: true }
      })
    } catch (e: unknown) {
      if (e instanceof SpaceClash) return fail(c, 409, 'Sorry — that date was taken before this was signed. We will be in touch.', 'space_held')
      if (e instanceof SignRefusal) return fail(c, e.status, e.message, e.code)
      if (e instanceof LedgerError) return fail(c, e.status, e.message)
      throw e
    }
    // The emails go after the signature is kept: a mail that fails never undoes a signing.
    try {
      if (result.next) await mailSigner(result.row, result.next, 'turn')
      else if (signer.role !== 'client') {
        const client = signers.find((x: any) => x.role === 'client')
        if (client) await mailSigner(result.row, client, 'booked')
      }
    } catch (err: any) { d.logger.warn('[events] signer email not sent', { proposal: p.id, error: err?.message }) }
    emitToCompany(p.companyId, REFRESH, { entity: 'event' })
    const after = await signersOf(db, result.row)
    const me = after.find((x: any) => x.id === signer.id) || signer
    return one(c, await withPay(guestView(result.row, result.row.snapshot, after, me), result.row, me))
  })

  app.get('/:token/pdf', async (c) => {
    const { p, signers, res } = await open(c); if (res) return res
    return new Response(new Uint8Array(await proposalPdf(p, p.snapshot, signers, await companyTimeZone(db, p.companyId))), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="proposal-${p.version}.pdf"` } })
  })
  return app
}
