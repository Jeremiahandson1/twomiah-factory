// Tickets in and out of the grill (the screen at /grill, routes/barKitchen.ts).
//
//   fireTicket    an order from the register → one ticket with its food items (drinks never make a ticket)
//   kitchenState  what every grill screen shows: open tickets, each paced with its cue, recently bumped, the
//                 "on now" and all-day counts. Worked out HERE with services/barPacing.ts, so the screen only
//                 counts its clocks forward between refreshes and never does the arithmetic itself.
//   bumpTicket    done → learns the real cook time for clean tickets
//   recallTicket  an accidental bump comes back
//
// Every change tells the company's screens (socket 'bar:kitchen' and 'bar:register'); the screens also refresh
// on a timer, so a dropped socket costs seconds, never a lost ticket. Ported from website-premium-bar's
// lib/kitchen/tickets.ts (Amber Inn, 9/26), scoped to a company.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { barKitchenTicket, barKitchenTicketItem, barMenuItem, barMenuSection, barSettings } from '../../db/schema.ts'
import { emitToCompany } from './socket.ts'
import { ageState, allDay, cueFor, effectivePrep, learn, lessonFromBump, paceTicket, startNow, type Cue } from './barPacing.ts'

type Tx = typeof db | any

export function notifyKitchen(companyId: string): void {
  emitToCompany(companyId, 'bar:kitchen', { at: Date.now() })
  // A bump is "food's up" on the register.
  emitToCompany(companyId, 'bar:register', { at: Date.now() })
}

export async function kitchenSettings(companyId: string, tx: Tx = db) {
  const [s] = await tx.select({ warn: barSettings.ticketWarnSeconds, late: barSettings.ticketLateSeconds, def: barSettings.defaultPrepSeconds })
    .from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
  return { warn: s?.warn ?? 600, late: s?.late ?? 900, defaultPrep: s?.def ?? 480 }
}

export interface FireLine { menuItemId: string | null; name: string; variation?: string | null; qty: number; note?: string | null; seat?: number | null }
export interface FireInput { label: string; source: 'bar' | 'table' | 'web'; note?: string | null; firedByName?: string | null; checkId?: string | null; lines: FireLine[] }

/** Put the food on the grill screen. Returns null when nothing on the order needs cooking. Runs inside `tx`. */
export async function fireTicket(tx: Tx, companyId: string, input: FireInput): Promise<{ id: string } | null> {
  const { defaultPrep } = await kitchenSettings(companyId, tx)
  const ids = [...new Set(input.lines.map(l => l.menuItemId).filter(Boolean))] as string[]
  const rows = ids.length
    ? await tx.select({ id: barMenuItem.id, toKitchen: barMenuItem.toKitchen, prepSeconds: barMenuItem.prepSeconds, learnedPrepSeconds: barMenuItem.learnedPrepSeconds, learnedSamples: barMenuItem.learnedSamples, kind: barMenuSection.kind })
        .from(barMenuItem).leftJoin(barMenuSection, eq(barMenuSection.id, barMenuItem.sectionId))
        .where(and(eq(barMenuItem.companyId, companyId), inArray(barMenuItem.id, ids)))
    : []
  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]))
  const food = input.lines.filter(l => {
    if (!l.menuItemId) return true                      // a free-typed line from the bar is for the cook
    const r = byId.get(l.menuItemId)
    if (!r) return true
    return r.toKitchen ?? (r.kind !== 'drink')
  }).filter(l => l.qty > 0)
  if (!food.length) return null
  const [t] = await tx.insert(barKitchenTicket).values({
    label: input.label.slice(0, 80), source: input.source, note: input.note?.slice(0, 200) || null,
    firedByName: input.firedByName || null, checkId: input.checkId || null, companyId,
  }).returning({ id: barKitchenTicket.id })
  await tx.insert(barKitchenTicketItem).values(food.map((l, n) => {
    const r = l.menuItemId ? byId.get(l.menuItemId) : undefined
    return {
      ticketId: t.id, menuItemId: l.menuItemId, name: l.name.slice(0, 80), variation: l.variation || null,
      qty: Math.max(1, Math.min(50, Math.floor(l.qty))), note: l.note?.slice(0, 140) || null, seat: l.seat ?? null,
      prepSeconds: r ? effectivePrep(r, defaultPrep) : defaultPrep, sortOrder: n, companyId,
    }
  }))
  return { id: t.id }
}

export interface KitchenTicketView {
  id: string; label: string; source: string; note: string | null; firedAt: number; recalled: boolean
  readyAt: number; cue: Cue; age: 'fresh' | 'warn' | 'late'
  items: Array<{ key: string; name: string; variation: string | null; qty: number; note: string | null; seat: number | null; prepSeconds: number; startAt: number }>
}
export interface KitchenState {
  serverNow: number; warnSeconds: number; lateSeconds: number
  open: KitchenTicketView[]
  bumped: Array<{ id: string; label: string; bumpedAt: number }>
  startNow: Array<{ name: string; qty: number }>
  allDay: Array<{ name: string; qty: number }>
}

export async function kitchenState(companyId: string, now = new Date()): Promise<KitchenState> {
  const { warn, late } = await kitchenSettings(companyId)
  const open = await db.select().from(barKitchenTicket)
    .where(and(eq(barKitchenTicket.companyId, companyId), isNull(barKitchenTicket.bumpedAt))).orderBy(asc(barKitchenTicket.firedAt)).limit(60)
  const recent = await db.select({ id: barKitchenTicket.id, label: barKitchenTicket.label, bumpedAt: barKitchenTicket.bumpedAt }).from(barKitchenTicket)
    .where(and(eq(barKitchenTicket.companyId, companyId), isNotNull(barKitchenTicket.bumpedAt), gte(barKitchenTicket.bumpedAt, new Date(now.getTime() - 30 * 60000))))
    .orderBy(desc(barKitchenTicket.bumpedAt)).limit(6)
  const items = open.length
    ? await db.select().from(barKitchenTicketItem).where(and(eq(barKitchenTicketItem.companyId, companyId), inArray(barKitchenTicketItem.ticketId, open.map(t => t.id)))).orderBy(asc(barKitchenTicketItem.sortOrder))
    : []
  const at = now.getTime()
  const views = open.map(t => {
    const its = items.filter(i => i.ticketId === t.id).map(i => ({ key: i.id, name: i.name, variation: i.variation, qty: i.qty, note: i.note, seat: i.seat, prepSeconds: i.prepSeconds, menuItemId: i.menuItemId }))
    const paced = paceTicket(t.firedAt.getTime(), its)
    return {
      paced,
      view: {
        id: t.id, label: t.label, source: t.source, note: t.note, firedAt: t.firedAt.getTime(), recalled: !!t.recalledAt,
        readyAt: paced.readyAt, cue: cueFor(paced, at), age: ageState(t.firedAt.getTime(), at, warn, late),
        items: paced.items.map(i => ({ key: i.key, name: i.name, variation: (i as any).variation ?? null, qty: i.qty, note: (i as any).note ?? null, seat: (i as any).seat ?? null, prepSeconds: i.prepSeconds, startAt: i.startAt })),
      } as KitchenTicketView,
    }
  })
  return {
    serverNow: at, warnSeconds: warn, lateSeconds: late,
    open: views.map(v => v.view),
    bumped: recent.map(r => ({ id: r.id, label: r.label, bumpedAt: (r.bumpedAt as Date).getTime() })),
    startNow: startNow(views.map(v => v.paced), at),
    allDay: allDay(views.map(v => v.view)),
  }
}

export async function bumpTicket(companyId: string, id: string, byName: string | null, now = new Date()): Promise<boolean> {
  const [t] = await db.update(barKitchenTicket).set({ bumpedAt: now, bumpedByName: byName })
    .where(and(eq(barKitchenTicket.id, id), eq(barKitchenTicket.companyId, companyId), isNull(barKitchenTicket.bumpedAt))).returning()
  if (!t) return false
  // Learn the real cook time from clean tickets.
  const items = await db.select().from(barKitchenTicketItem).where(and(eq(barKitchenTicketItem.ticketId, id), eq(barKitchenTicketItem.companyId, companyId)))
  const lesson = lessonFromBump(items.map(i => ({ key: i.id, name: i.name, qty: i.qty, prepSeconds: i.prepSeconds, menuItemId: i.menuItemId })), t.firedAt.getTime(), now.getTime(), !!t.recalledAt)
  if (lesson) {
    const [m] = await db.select({ learned: barMenuItem.learnedPrepSeconds, samples: barMenuItem.learnedSamples }).from(barMenuItem)
      .where(and(eq(barMenuItem.id, lesson.menuItemId), eq(barMenuItem.companyId, companyId))).limit(1)
    if (m) await db.update(barMenuItem).set(learn(m.learned, m.samples, lesson.observedSeconds)).where(and(eq(barMenuItem.id, lesson.menuItemId), eq(barMenuItem.companyId, companyId)))
  }
  notifyKitchen(companyId)
  return true
}

export async function recallTicket(companyId: string, id: string, now = new Date()): Promise<boolean> {
  const [t] = await db.update(barKitchenTicket).set({ bumpedAt: null, bumpedByName: null, recalledAt: now })
    .where(and(eq(barKitchenTicket.id, id), eq(barKitchenTicket.companyId, companyId), isNotNull(barKitchenTicket.bumpedAt))).returning({ id: barKitchenTicket.id })
  if (!t) return false
  notifyKitchen(companyId)
  return true
}

/** A void on food the cook already has: say so on the ticket itself, while it is still on the screen. */
export async function noteVoidOnTicket(tx: Tx, companyId: string, ticketId: string, line: string): Promise<boolean> {
  const [t] = await tx.select({ note: barKitchenTicket.note, bumpedAt: barKitchenTicket.bumpedAt }).from(barKitchenTicket)
    .where(and(eq(barKitchenTicket.id, ticketId), eq(barKitchenTicket.companyId, companyId))).limit(1)
  if (!t || t.bumpedAt) return false
  await tx.update(barKitchenTicket).set({ note: ((t.note ? t.note + ' · ' : '') + line).slice(0, 500) })
    .where(and(eq(barKitchenTicket.id, ticketId), eq(barKitchenTicket.companyId, companyId)))
  return true
}
