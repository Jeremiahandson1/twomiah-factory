// BID PACKAGES TO SUBS (parity tier 3, contractor — Buildertrend's bid requests; feature bid_packages, not ready). On the vendor
// portal and purchase orders the contractor already has (vendor_portal, purchase_orders), not beside them:
//   · the office makes a package on a project — a scope, a due date, the lines to price — and invites subcontractors (vendor
//     contacts); sending it emails each their vendor-portal link (../office/vendorPortal.ts ensureVendorLink);
//   · each sub, in their portal, prices the lines (or declines) — ./bidPackages.ts vendorBids, mounted by vendorPortal.ts;
//   · the office compares the bids line by line and awards one: the winner's PURCHASE ORDER is made from their prices (a draft,
//     numbered like every PO), the others are marked lost. Nothing is sent or paid by awarding.
//
// OFFICE  /api/bid-packages        projects:read to read (prices: the project money right too), projects:update to change
//   GET    /?projectId=             the project's packages, each with its bids' standing
//   POST   /                        { projectId, title, scope?, dueDate?, lines: [{ description, quantity?, unit? }], vendorIds }
//   GET    /:id                     the package, its invites and the comparison
//   POST   /:id/send                open it and email the subs their link
//   POST   /:id/award               { inviteId } — the winner's purchase order
//   POST   /:id/invites/:inviteId/link  that sub's portal link, for the office to send another way (text, or a missed email)
//   POST   /:id/close               no award
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { nextNumber } from '@twomiah/tenant-backend'
import { bidInvite, bidPackage, company, contact, jobPurchaseOrder, jobPurchaseOrderLine, project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { MONEY_PERMISSION } from './projects.ts'
import { ensureVendorLink } from '../office/vendorPortal.ts'
import { escapeHtml } from '../../core/sanitize.ts'

export const BID_PACKAGES = 'bid_packages'
export interface BidLine { id: string; description: string; quantity: number; unit: string | null }
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31')
const createBody = z.object({
  projectId: z.string().min(1, 'Choose the project'),
  title: z.string().trim().min(1, 'Name the package').max(120, 'At most 120 characters'),
  scope: z.string().trim().max(5000).optional().nullable(),
  dueDate: ymd.optional().nullable(),
  lines: z.array(z.object({ description: z.string().trim().min(1, 'Describe the item').max(300), quantity: z.number().positive('A quantity above 0').max(1_000_000).optional(), unit: z.string().trim().max(20).optional().nullable() }))
    .min(1, 'Add at least one item to price').max(100, 'At most 100 items'),
  vendorIds: z.array(z.string().min(1)).min(1, 'Invite at least one subcontractor').max(30, 'At most 30 subcontractors'),
})
const round2 = (n: number) => Math.round(n * 100) / 100

/** A bid's figure from its prices: each line's quantity × the sub's unit price. */
export function bidTotal(lines: BidLine[], prices: Array<{ lineId: string; unitPrice: number }>): number {
  const by = new Map(prices.map((p) => [p.lineId, Number(p.unitPrice) || 0]))
  return round2(lines.reduce((s, l) => s + l.quantity * (by.get(l.id) ?? 0), 0))
}

export function createBidPackageRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()
  const seesMoney = async (c: any) => { const me = c.get('user'); return !!(await mayWith(me.role, MONEY_PERMISSION, me.userId).catch(() => false)) }

  const packageOf = async (companyId: string, id: string) => (await db.select().from(bidPackage).where(and(eq(bidPackage.id, id), eq(bidPackage.companyId, companyId))).limit(1))[0] ?? null
  const invitesOf = async (companyId: string, packageId: string) =>
    db.select({ i: bidInvite, name: contact.name, company: contact.company, email: contact.email }).from(bidInvite).innerJoin(contact, eq(contact.id, bidInvite.vendorId))
      .where(and(eq(bidInvite.companyId, companyId), eq(bidInvite.packageId, packageId))).orderBy(asc(contact.name))

  /** The package for the office: its bids, and line by line what each sub asked (money only for a seat that sees it). */
  const view = async (c: any, p: any) => {
    const money = await seesMoney(c)
    const rows = (await invitesOf(p.companyId, p.id)) as any[]
    const lines = (p.lines || []) as BidLine[]
    return {
      id: p.id, projectId: p.projectId, title: p.title, scope: p.scope, dueDate: p.dueDate ? new Date(p.dueDate).toISOString().slice(0, 10) : null,
      status: p.status, lines, purchaseOrderId: p.purchaseOrderId, awardedInviteId: p.awardedInviteId,
      bids: rows.map((r) => ({
        id: r.i.id, vendorId: r.i.vendorId, vendor: r.company || r.name, email: r.email, status: r.i.status, notes: r.i.notes, declinedReason: r.i.declinedReason,
        submittedAt: r.i.submittedAt ? new Date(r.i.submittedAt).toISOString() : null,
        ...(money ? { total: r.i.total != null ? Number(r.i.total) : null, prices: r.i.prices || [] } : {}),
      })),
    }
  }

  app.get('/', requirePermission('projects:read'), async (c) => {
    const companyId = c.get('user').companyId
    const projectId = c.req.query('projectId')
    if (!projectId) return fail(c, 400, 'Choose the project.')
    const rows = await db.select().from(bidPackage).where(and(eq(bidPackage.companyId, companyId), eq(bidPackage.projectId, projectId))).orderBy(desc(bidPackage.createdAt), desc(bidPackage.id))
    const out = []
    for (const p of rows as any[]) out.push(await view(c, p))
    return one(c, { data: out })
  })

  app.post('/', requirePermission('projects:update'), async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const me = c.get('user')
    const [proj] = await db.select({ id: project.id, name: project.name }).from(project).where(and(eq(project.id, parsed.data.projectId), eq(project.companyId, me.companyId))).limit(1)
    if (!proj) return fail(c, 404, 'Project not found')
    const vendors = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, me.companyId), inArray(contact.id, parsed.data.vendorIds)))
    if (vendors.length !== new Set(parsed.data.vendorIds).size) return fail(c, 400, 'One of those subcontractors is not in your contacts.')
    const lines: BidLine[] = parsed.data.lines.map((l) => ({ id: createId(), description: l.description, quantity: l.quantity ?? 1, unit: l.unit || null }))
    const p = await db.transaction(async (tx: any) => {
      const [row] = await tx.insert(bidPackage).values({ companyId: me.companyId, projectId: proj.id, title: parsed.data.title, scope: parsed.data.scope || null, dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00Z`) : null, lines, createdById: me.userId }).returning()
      await tx.insert(bidInvite).values(vendors.map((v: any) => ({ companyId: me.companyId, packageId: row.id, vendorId: v.id })))
      return row
    })
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'bid_package', entityId: p.id, entityName: `${proj.name}: ${p.title}`, metadata: { lines: lines.length, invited: vendors.length }, req: c })
    return one(c, await view(c, p), 201)
  })

  app.get('/:id', requirePermission('projects:read'), async (c) => {
    const p = await packageOf(c.get('user').companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Bid package not found')
    return one(c, await view(c, p))
  })

  app.post('/:id/send', requirePermission('projects:update'), async (c) => {
    const companyId = c.get('user').companyId
    const p = await packageOf(companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Bid package not found')
    if (p.status !== 'draft' && p.status !== 'open') return fail(c, 400, 'This package was already awarded or closed.')
    await db.update(bidPackage).set({ status: 'open', updatedAt: new Date() }).where(eq(bidPackage.id, p.id))
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const rows = (await invitesOf(companyId, p.id)) as any[]
    let emailed = 0
    for (const r of rows) {
      if (!['invited', 'viewed'].includes(r.i.status) || !String(r.email || '').trim()) continue
      const [v] = await db.select().from(contact).where(eq(contact.id, r.i.vendorId)).limit(1)
      const { link } = await ensureVendorLink(db, v)
      try {
        await (d.services as any).emailService.sendRaw({
          to: String(r.email).trim(), subject: `Bid request: ${p.title} — ${co?.name || ''}`.trim(),
          html: `<p>${escapeHtml(co?.name || 'A contractor')} asks you to price <strong>${escapeHtml(p.title)}</strong>${p.dueDate ? ` by ${escapeHtml(new Date(p.dueDate).toISOString().slice(0, 10))}` : ''}.</p>${p.scope ? `<p>${escapeHtml(p.scope)}</p>` : ''}<p><a href="${escapeHtml(link)}">Open your portal to see it and send your bid</a></p>`,
        })
        emailed++
      } catch { /* the link is still in the portal */ }
    }
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'bid_package', entityId: p.id, entityName: p.title, metadata: { sent: true, emailed }, req: c })
    return one(c, { ...(await view(c, { ...p, status: 'open' })), emailed })
  })

  // A sub's link, to copy and send another way (live test 11/11: it was only ever in their email — Buildertrend's bid request can
  // be resent; the contact page copies a customer's portal link the same way). The same link the email carries.
  app.post('/:id/invites/:inviteId/link', requirePermission('projects:update'), async (c) => {
    const companyId = c.get('user').companyId
    const p = await packageOf(companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Bid package not found')
    if (p.status !== 'open') return fail(c, 400, 'Send the package first — the link opens it for the sub.')
    const row = ((await invitesOf(companyId, p.id)) as any[]).find((r) => r.i.id === c.req.param('inviteId'))
    if (!row) return fail(c, 404, 'That sub is not on this package')
    const [v] = await db.select().from(contact).where(and(eq(contact.id, row.i.vendorId), eq(contact.companyId, companyId))).limit(1)
    return one(c, { link: (await ensureVendorLink(db, v)).link })
  })

  app.post('/:id/award', requirePermission('projects:update'), async (c) => {
    const inviteId = String(((await c.req.json().catch(() => ({}))) as any)?.inviteId || '')
    const me = c.get('user')
    const p = await packageOf(me.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Bid package not found')
    if (p.status !== 'open') return fail(c, 400, p.status === 'draft' ? 'Send the package first.' : 'This package was already awarded or closed.')
    const [win] = await db.select().from(bidInvite).where(and(eq(bidInvite.id, inviteId), eq(bidInvite.packageId, p.id), eq(bidInvite.companyId, me.companyId))).limit(1)
    if (!win) return fail(c, 404, 'That bid was not found on this package.')
    if (win.status !== 'submitted') return fail(c, 400, 'Only a bid that was sent in can be awarded.')
    const lines = (p.lines || []) as BidLine[]
    const prices = new Map(((win.prices || []) as any[]).map((x) => [x.lineId, Number(x.unitPrice) || 0]))
    const po = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, jobPurchaseOrder, jobPurchaseOrder.number, jobPurchaseOrder.companyId, me.companyId, { prefix: 'PO', pad: 5 })
      const subtotal = bidTotal(lines, [...prices].map(([lineId, unitPrice]) => ({ lineId, unitPrice })))
      const [order] = await tx.insert(jobPurchaseOrder).values({ companyId: me.companyId, number, status: 'draft', vendorId: win.vendorId, projectId: p.projectId, subtotal: String(subtotal), total: String(subtotal), notes: `From bid package: ${p.title}`, createdById: me.userId }).returning()
      await tx.insert(jobPurchaseOrderLine).values(lines.map((l, i) => {
        const unit = prices.get(l.id) ?? 0
        return { purchaseOrderId: order.id, description: l.unit ? `${l.description} (${l.unit})` : l.description, quantity: String(l.quantity), unitCost: String(unit), total: String(round2(unit * l.quantity)), sortOrder: i }
      }))
      await tx.update(bidInvite).set({ status: 'awarded', updatedAt: new Date() }).where(eq(bidInvite.id, win.id))
      await tx.update(bidInvite).set({ status: 'lost', updatedAt: new Date() }).where(and(eq(bidInvite.packageId, p.id), ne(bidInvite.id, win.id), eq(bidInvite.status, 'submitted')))
      await tx.update(bidPackage).set({ status: 'awarded', awardedInviteId: win.id, purchaseOrderId: order.id, updatedAt: new Date() }).where(eq(bidPackage.id, p.id))
      return order
    })
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'bid_package', entityId: p.id, entityName: p.title, metadata: { awarded: win.vendorId, purchaseOrder: po.number }, req: c })
    return one(c, { ...(await view(c, { ...p, status: 'awarded', awardedInviteId: win.id, purchaseOrderId: po.id })), purchaseOrder: { id: po.id, number: po.number } })
  })

  app.post('/:id/close', requirePermission('projects:update'), async (c) => {
    const p = await packageOf(c.get('user').companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Bid package not found')
    if (p.status === 'awarded') return fail(c, 400, 'This package was awarded; its purchase order is where the work goes on.')
    await db.update(bidPackage).set({ status: 'closed', updatedAt: new Date() }).where(eq(bidPackage.id, p.id))
    return done(c, 'Bid package closed.')
  })

  return app
}

// ── the sub's side, in the vendor portal (mounted by ../office/vendorPortal.ts; `vendor` is the link's contact) ─────────────
export function vendorBids(d: CrmDeps) {
  const { db } = d
  const priceBody = z.object({
    prices: z.array(z.object({ lineId: z.string().min(1), unitPrice: z.number({ error: 'Enter a price' }).min(0, 'A price cannot be below 0').max(100_000_000) })).max(100),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  const mine = async (vendor: { id: string; companyId: string }, inviteId: string) => {
    const [r] = await db.select({ i: bidInvite, p: bidPackage }).from(bidInvite).innerJoin(bidPackage, eq(bidPackage.id, bidInvite.packageId))
      .where(and(eq(bidInvite.id, inviteId), eq(bidInvite.vendorId, vendor.id), eq(bidInvite.companyId, vendor.companyId), ne(bidPackage.status, 'draft'))).limit(1)
    return r ?? null
  }
  const shape = (r: any) => ({
    id: r.i.id, status: r.i.status, title: r.p.title, scope: r.p.scope, dueDate: r.p.dueDate ? new Date(r.p.dueDate).toISOString().slice(0, 10) : null,
    open: r.p.status === 'open', lines: r.p.lines || [], prices: r.i.prices || [], total: r.i.total != null ? Number(r.i.total) : null, notes: r.i.notes,
  })
  return {
    /** Every package this sub was asked to price (not drafts). Opening the list marks new ones viewed. */
    async list(vendor: { id: string; companyId: string }) {
      const rows = await db.select({ i: bidInvite, p: bidPackage }).from(bidInvite).innerJoin(bidPackage, eq(bidPackage.id, bidInvite.packageId))
        .where(and(eq(bidInvite.vendorId, vendor.id), eq(bidInvite.companyId, vendor.companyId), ne(bidPackage.status, 'draft'))).orderBy(desc(bidPackage.createdAt))
      const fresh = (rows as any[]).filter((r) => r.i.status === 'invited').map((r) => r.i.id)
      if (fresh.length) await db.update(bidInvite).set({ status: 'viewed', viewedAt: new Date(), updatedAt: new Date() }).where(and(inArray(bidInvite.id, fresh), eq(bidInvite.vendorId, vendor.id)))
      return (rows as any[]).map((r) => shape(fresh.includes(r.i.id) ? { ...r, i: { ...r.i, status: 'viewed' } } : r))
    },
    async submit(vendor: { id: string; companyId: string }, inviteId: string, raw: unknown): Promise<{ ok: true; bid: any } | { ok: false; status: number; error: string }> {
      const parsed = priceBody.safeParse(raw)
      if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message || 'Check the prices.' }
      const r = await mine(vendor, inviteId)
      if (!r) return { ok: false, status: 404, error: 'Bid request not found' }
      if (r.p.status !== 'open') return { ok: false, status: 400, error: 'This bid request is no longer open.' }
      const lines = (r.p.lines || []) as BidLine[]
      const ids = new Set(lines.map((l) => l.id))
      const prices = parsed.data.prices.filter((x) => ids.has(x.lineId))
      if (prices.length !== lines.length) return { ok: false, status: 400, error: 'Price every item, or decline the request.' }
      const total = bidTotal(lines, prices)
      const [row] = await db.update(bidInvite).set({ status: 'submitted', prices, total: String(total), notes: parsed.data.notes || null, submittedAt: new Date(), declinedReason: null, updatedAt: new Date() })
        .where(and(eq(bidInvite.id, r.i.id), eq(bidInvite.vendorId, vendor.id))).returning()
      return { ok: true, bid: shape({ i: row, p: r.p }) }
    },
    async decline(vendor: { id: string; companyId: string }, inviteId: string, reason: unknown): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
      const r = await mine(vendor, inviteId)
      if (!r) return { ok: false, status: 404, error: 'Bid request not found' }
      if (r.p.status !== 'open') return { ok: false, status: 400, error: 'This bid request is no longer open.' }
      await db.update(bidInvite).set({ status: 'declined', declinedReason: String(reason || '').trim().slice(0, 500) || null, updatedAt: new Date() }).where(and(eq(bidInvite.id, r.i.id), eq(bidInvite.vendorId, vendor.id)))
      return { ok: true }
    },
  }
}
