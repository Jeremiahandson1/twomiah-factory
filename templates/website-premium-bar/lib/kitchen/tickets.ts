/**
 * lib/kitchen/tickets.ts — tickets in and out of the grill.
 *
 *   fireTicket   an order (bar pad, table, website) → one ticket with its food items
 *   kitchenState what every grill screen shows: open tickets, recently bumped, thresholds
 *   bumpTicket   done → learns the real cook time; a web order gets its "it's up" text
 *   recallTicket an accidental bump comes back
 *
 * Every change calls notifyKitchen(), and every open grill screen (SSE) repaints.
 * One Render instance, so an in-process emitter is the whole bus.
 */
import { EventEmitter } from 'events'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { kitchenTicketItems, kitchenTickets, menuItems, menuSections, onlineOrders, serviceStatus, settings as settingsTbl } from '../../db/schema'
import { sendSms } from '../sms/twilio'
import { firedText, readyText } from '../square/texts'
import { effectivePrep, learn, lessonFromBump } from './pacing'

// ─── The bus ────────────────────────────────────────────────────────────────
export const kitchenBus = new EventEmitter()
kitchenBus.setMaxListeners(50)
export function notifyKitchen(): void { kitchenBus.emit('changed') }

// ─── Firing ─────────────────────────────────────────────────────────────────
export interface FireLine { menuItemId: string | null; name: string; variation?: string | null; qty: number; note?: string | null; seat?: number | null }
export interface FireInput { label: string; source: 'bar' | 'table' | 'web'; note?: string | null; firedBy?: string | null; onlineOrderId?: string | null; lines: FireLine[] }

async function houseSettings(db: typeof DB) {
  const [s] = await db.select({ warn: serviceStatus.ticketWarnSeconds, late: serviceStatus.ticketLateSeconds, def: serviceStatus.defaultPrepSeconds }).from(serviceStatus).limit(1)
  return { warn: s?.warn ?? 600, late: s?.late ?? 900, defaultPrep: s?.def ?? 480 }
}

/**
 * Put the food on the grill screen. Drinks (and anything marked not-for-kitchen)
 * are left off. Returns null when nothing on the order needs cooking.
 */
export async function fireTicket(db: typeof DB, input: FireInput): Promise<{ id: string } | null> {
  const { defaultPrep } = await houseSettings(db)
  const ids = [...new Set(input.lines.map(l => l.menuItemId).filter(Boolean))] as string[]
  const rows = ids.length
    ? await db.select({ id: menuItems.id, toKitchen: menuItems.toKitchen, prepSeconds: menuItems.prepSeconds, learnedPrepSeconds: menuItems.learnedPrepSeconds, learnedSamples: menuItems.learnedSamples, kind: menuSections.kind })
        .from(menuItems).leftJoin(menuSections, eq(menuSections.id, menuItems.sectionId)).where(inArray(menuItems.id, ids))
    : []
  const byId = new Map(rows.map(r => [r.id, r]))
  const food = input.lines.filter(l => {
    if (!l.menuItemId) return true                      // a free-typed line from the bar is for the cook
    const r = byId.get(l.menuItemId)
    if (!r) return true
    return r.toKitchen ?? (r.kind !== 'drink')
  }).filter(l => l.qty > 0)
  if (!food.length) return null

  const id = await db.transaction(async (tx) => {
    const [t] = await tx.insert(kitchenTickets).values({
      label: input.label.slice(0, 80), source: input.source, note: input.note?.slice(0, 200) || null,
      firedBy: input.firedBy || null, onlineOrderId: input.onlineOrderId || null,
    }).returning({ id: kitchenTickets.id })
    await tx.insert(kitchenTicketItems).values(food.map((l, n) => {
      const r = l.menuItemId ? byId.get(l.menuItemId) : undefined
      return {
        ticketId: t.id, menuItemId: l.menuItemId, name: l.name.slice(0, 80), variation: l.variation || null,
        qty: Math.max(1, Math.min(50, Math.floor(l.qty))), note: l.note?.slice(0, 140) || null, seat: l.seat ?? null,
        prepSeconds: r ? effectivePrep(r, defaultPrep) : defaultPrep, sortOrder: n,
      }
    }))
    return t.id
  })
  notifyKitchen()
  return { id }
}

// ─── What the screen shows ──────────────────────────────────────────────────
export interface KitchenTicketView {
  id: string; label: string; source: string; note: string | null; firedAt: number; recalled: boolean
  items: Array<{ key: string; name: string; variation: string | null; qty: number; note: string | null; seat: number | null; prepSeconds: number; menuItemId: string | null }>
}
export interface KitchenState {
  serverNow: number
  warnSeconds: number
  lateSeconds: number
  open: KitchenTicketView[]
  bumped: Array<{ id: string; label: string; bumpedAt: number }>
}

export async function kitchenState(db: typeof DB, now = new Date()): Promise<KitchenState> {
  const { warn, late } = await houseSettings(db)
  const open = await db.select().from(kitchenTickets).where(isNull(kitchenTickets.bumpedAt)).orderBy(asc(kitchenTickets.firedAt)).limit(60)
  const recent = await db.select({ id: kitchenTickets.id, label: kitchenTickets.label, bumpedAt: kitchenTickets.bumpedAt }).from(kitchenTickets)
    .where(and(isNotNull(kitchenTickets.bumpedAt), gte(kitchenTickets.bumpedAt, new Date(now.getTime() - 30 * 60000))))
    .orderBy(desc(kitchenTickets.bumpedAt)).limit(6)
  const items = open.length ? await db.select().from(kitchenTicketItems).where(inArray(kitchenTicketItems.ticketId, open.map(t => t.id))).orderBy(asc(kitchenTicketItems.sortOrder)) : []
  return {
    serverNow: now.getTime(),
    warnSeconds: warn,
    lateSeconds: late,
    open: open.map(t => ({
      id: t.id, label: t.label, source: t.source, note: t.note, firedAt: t.firedAt.getTime(), recalled: !!t.recalledAt,
      items: items.filter(i => i.ticketId === t.id).map(i => ({ key: i.id, name: i.name, variation: i.variation, qty: i.qty, note: i.note, seat: i.seat, prepSeconds: i.prepSeconds, menuItemId: i.menuItemId })),
    })),
    bumped: recent.map(r => ({ id: r.id, label: r.label, bumpedAt: (r.bumpedAt as Date).getTime() })),
  }
}

// ─── Bump / recall ──────────────────────────────────────────────────────────
async function company(db: typeof DB) {
  const [s] = await db.select({ name: settingsTbl.companyName, tz: settingsTbl.timezone }).from(settingsTbl).limit(1)
  return { name: s?.name || 'The bar', tz: s?.tz || 'America/Chicago' }
}

export async function bumpTicket(db: typeof DB, id: string, by: string | null, now = new Date()): Promise<boolean> {
  const [t] = await db.update(kitchenTickets).set({ bumpedAt: now, bumpedBy: by }).where(and(eq(kitchenTickets.id, id), isNull(kitchenTickets.bumpedAt))).returning()
  if (!t) return false
  // Learn the real cook time from clean tickets.
  const items = await db.select().from(kitchenTicketItems).where(eq(kitchenTicketItems.ticketId, id))
  const lesson = lessonFromBump(items.map(i => ({ key: i.id, name: i.name, qty: i.qty, prepSeconds: i.prepSeconds, menuItemId: i.menuItemId })), t.firedAt.getTime(), now.getTime(), !!t.recalledAt)
  if (lesson) {
    const [m] = await db.select({ learned: menuItems.learnedPrepSeconds, samples: menuItems.learnedSamples }).from(menuItems).where(eq(menuItems.id, lesson.menuItemId)).limit(1)
    if (m) await db.update(menuItems).set(learn(m.learned, m.samples, lesson.observedSeconds)).where(eq(menuItems.id, lesson.menuItemId))
  }
  // A web order is up: say so on the confirmation page, and text if they asked.
  if (t.onlineOrderId) {
    const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, t.onlineOrderId)).limit(1)
    if (o && o.status !== 'ready' && o.status !== 'completed' && o.status !== 'canceled') {
      const patch: Partial<typeof onlineOrders.$inferInsert> = { status: 'ready', updatedAt: now }
      if (o.textUpdates && !o.readySmsAt) {
        const r = await sendSms(o.phone, readyText((await company(db)).name))
        if (r.ok) patch.readySmsAt = now; else if (!r.skipped) console.warn('[kitchen] ready text failed:', r.error)
      }
      await db.update(onlineOrders).set(patch).where(eq(onlineOrders.id, o.id))
    }
  }
  notifyKitchen()
  return true
}

export async function recallTicket(db: typeof DB, id: string, now = new Date()): Promise<boolean> {
  const [t] = await db.update(kitchenTickets).set({ bumpedAt: null, bumpedBy: null, recalledAt: now }).where(and(eq(kitchenTickets.id, id), isNotNull(kitchenTickets.bumpedAt))).returning({ id: kitchenTickets.id, onlineOrderId: kitchenTickets.onlineOrderId })
  if (!t) return false
  if (t.onlineOrderId) await db.update(onlineOrders).set({ status: 'in_progress', updatedAt: now }).where(and(eq(onlineOrders.id, t.onlineOrderId), eq(onlineOrders.status, 'ready')))
  notifyKitchen()
  return true
}

/** A paid web order goes straight to the grill; the customer hears it's on (if they asked for texts). */
export async function fireWebOrder(db: typeof DB, orderId: string): Promise<void> {
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).limit(1)
  if (!o) return
  const [existing] = await db.select({ id: kitchenTickets.id }).from(kitchenTickets).where(eq(kitchenTickets.onlineOrderId, o.id)).limit(1)
  if (existing) return   // a retried payment call must not double the ticket
  const { name, tz } = await company(db)
  const at = o.pickupAt ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(o.pickupAt) : ''
  const lines = (Array.isArray(o.lines) ? o.lines : []) as Array<{ itemId?: string; name: string; variation?: string; qty: number; note?: string }>
  const t = await fireTicket(db, {
    label: `Web · ${o.customerName}${at ? ' · ' + at : ''}`, source: 'web', onlineOrderId: o.id,
    lines: lines.map(l => ({ menuItemId: l.itemId || null, name: l.name, variation: l.variation && l.variation !== 'Regular' ? l.variation : null, qty: l.qty, note: l.note || null })),
  })
  if (!t) return
  const now = new Date()
  const patch: Partial<typeof onlineOrders.$inferInsert> = { status: 'in_progress', updatedAt: now }
  if (o.textUpdates && !o.firedSmsAt) {
    const r = await sendSms(o.phone, firedText(name, o.pickupAt, tz))
    if (r.ok) patch.firedSmsAt = now; else if (!r.skipped) console.warn('[kitchen] fired text failed:', r.error)
  }
  await db.update(onlineOrders).set(patch).where(eq(onlineOrders.id, o.id))
  await db.update(kitchenTickets).set({ startedNotifiedAt: now }).where(eq(kitchenTickets.id, t.id))
}
