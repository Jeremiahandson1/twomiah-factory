/**
 * lib/register/checks.ts — the check lifecycle.
 *
 *   openCheck → addItem (held) → sendCheck (food → one grill ticket; drinks just marked sent)
 *   → addPayment (cash / card run on Square's reader) … until the balance is zero → closed.
 *   splitItems moves items to a new check; voidItem / voidPayment / voidCheck need a reason.
 *
 * Every write bumps the register bus so every open register screen repaints.
 * Errors are thrown as CheckError with words a bartender can act on.
 */
import { EventEmitter } from 'events'
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { taps } from '../../db/schema'
import { checkItems, checkPayments, checks, giftCards, guests, kitchenTickets, loyaltyLedger, menuItems, menuSections, onlineOrders, settings as settingsTbl } from '../../db/schema'
import { guestByPhone, loyaltySettings, recordVisit } from '../crm/guests'
import { rewardAmount } from '../crm/loyalty'
import { findCard, GiftCardError, issueCard, normalizeCode, refundTo, spend, validAmount } from '../giftcards/cards'
import { sizesOf } from '../menu/sizes'
import { fireTicket, notifyKitchen } from '../kitchen/tickets'
import { changeDue, checkTotals, type CheckTotals } from './money'

export class CheckError extends Error { constructor(message: string, public status = 400) { super(message) } }

export const registerBus = new EventEmitter()
registerBus.setMaxListeners(50)
export function notifyRegister(): void { registerBus.emit('changed') }

async function taxRate(db: typeof DB): Promise<number> {
  const [s] = await db.select({ bps: settingsTbl.taxRateBps }).from(settingsTbl).limit(1)
  return s?.bps ?? 550
}

async function openRow(db: typeof DB, id: string) {
  const [c] = await db.select().from(checks).where(eq(checks.id, id)).limit(1)
  if (!c) throw new CheckError('That check is gone.', 404)
  if (c.status !== 'open') throw new CheckError(c.status === 'paid' ? 'That check is already paid.' : 'That check was voided.', 409)
  return c
}

const clean = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }

// ─── Reading ────────────────────────────────────────────────────────────────
export interface CheckView {
  id: string; number: number; kind: string; label: string; spot: string | null; note: string | null; status: string; guestId: string | null
  openedAt: string; openedBy: string | null; closedAt: string | null
  items: Array<typeof checkItems.$inferSelect>
  payments: Array<typeof checkPayments.$inferSelect>
  totals: CheckTotals
  heldFood: number
}

export async function getCheck(db: typeof DB, id: string): Promise<CheckView> {
  const [c] = await db.select().from(checks).where(eq(checks.id, id)).limit(1)
  if (!c) throw new CheckError('That check is gone.', 404)
  const [items, payments, rate] = await Promise.all([
    db.select().from(checkItems).where(eq(checkItems.checkId, id)).orderBy(asc(checkItems.addedAt)),
    db.select().from(checkPayments).where(eq(checkPayments.checkId, id)).orderBy(asc(checkPayments.takenAt)),
    taxRate(db),
  ])
  return {
    id: c.id, number: c.number, kind: c.kind, label: c.label, spot: c.spot, note: c.note, status: c.status, guestId: c.guestId,
    openedAt: c.openedAt.toISOString(), openedBy: c.openedBy, closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    items, payments, totals: checkTotals(items, payments, rate),
    heldFood: items.filter(i => i.state === 'held' && i.toKitchen).length,
  }
}

export interface OpenCheckRow { id: string; number: number; kind: string; label: string; spot: string | null; openedAt: string; openedBy: string | null; totalCents: number; balanceCents: number; itemCount: number; heldCount: number; foodUpAt: string | null; onGrill: number }

export async function listOpen(db: typeof DB): Promise<OpenCheckRow[]> {
  const open = await db.select().from(checks).where(eq(checks.status, 'open')).orderBy(asc(checks.openedAt)).limit(200)
  if (!open.length) return []
  const ids = open.map(c => c.id)
  const [items, payments, rate, tickets] = await Promise.all([
    db.select().from(checkItems).where(inArray(checkItems.checkId, ids)),
    db.select().from(checkPayments).where(inArray(checkPayments.checkId, ids)),
    taxRate(db),
    db.select({ checkId: kitchenTickets.checkId, bumpedAt: kitchenTickets.bumpedAt }).from(kitchenTickets).where(inArray(kitchenTickets.checkId, ids)),
  ])
  const upSince = Date.now() - 15 * 60000
  return open.map(c => {
    const mine = tickets.filter(t => t.checkId === c.id)
    const lastUp = mine.filter(t => t.bumpedAt && t.bumpedAt.getTime() > upSince).reduce<Date | null>((m, t) => (!m || (t.bumpedAt as Date) > m ? t.bumpedAt as Date : m), null)
    const its = items.filter(i => i.checkId === c.id)
    const t = checkTotals(its, payments.filter(p => p.checkId === c.id), rate)
    return {
      id: c.id, number: c.number, kind: c.kind, label: c.label, spot: c.spot, openedAt: c.openedAt.toISOString(), openedBy: c.openedBy,
      totalCents: t.totalCents, balanceCents: t.balanceCents,
      foodUpAt: lastUp ? lastUp.toISOString() : null,
      onGrill: mine.filter(t => !t.bumpedAt).length,
      itemCount: its.filter(i => i.state !== 'void').reduce((s, i) => s + i.qty, 0),
      heldCount: its.filter(i => i.state === 'held').length,
    }
  })
}

/** Closed today (for the "recent" list and reopening a mistake). */
export async function listRecentClosed(db: typeof DB, since: Date): Promise<Array<{ id: string; number: number; label: string; status: string; totalCents: number | null; closedAt: string }>> {
  const rows = await db.select().from(checks).where(and(or(eq(checks.status, 'paid'), eq(checks.status, 'void')), gte(checks.closedAt, since))).orderBy(desc(checks.closedAt)).limit(30)
  return rows.map(c => ({ id: c.id, number: c.number, label: c.label, status: c.status, totalCents: c.totalCents, closedAt: (c.closedAt as Date).toISOString() }))
}

// ─── Writing ────────────────────────────────────────────────────────────────
export async function openCheck(db: typeof DB, input: { kind: string; label: string; spot?: string | null; note?: string | null }, by: string): Promise<CheckView> {
  const kind = ['tab', 'table', 'walkup'].includes(input.kind) ? input.kind : 'walkup'
  const spot = clean(input.spot, 40)
  const label = clean(input.label, 40) || spot || (kind === 'walkup' ? 'Walk-up' : null)
  if (!label) throw new CheckError(kind === 'tab' ? 'Whose tab is it?' : 'Which table?')
  const [row] = await db.insert(checks).values({ kind, label, spot, note: clean(input.note, 200), openedBy: by }).returning({ id: checks.id })
  notifyRegister()
  return getCheck(db, row.id)
}

export async function addItem(db: typeof DB, checkId: string, input: { menuItemId: string; sizeId?: string | null; qty?: number; note?: string | null; seat?: number | null; priceCents?: number | null }, by: string): Promise<CheckView> {
  await openRow(db, checkId)
  if (String(input.menuItemId || '').startsWith('tap:')) return addPour(db, checkId, { ...input, tapId: String(input.menuItemId).slice(4) }, by)
  const [row] = await db.select({ item: menuItems, section: menuSections }).from(menuItems).leftJoin(menuSections, eq(menuSections.id, menuItems.sectionId)).where(eq(menuItems.id, input.menuItemId)).limit(1)
  if (!row || !row.item.isActive) throw new CheckError('That item is off the menu.')
  if (row.item.is86ed) throw new CheckError(`${row.item.name} is 86'd.`)
  const sizes = sizesOf(row.item, row.section?.description)
  const size = sizes.find(s => s.id === input.sizeId) || (sizes.length === 1 ? sizes[0] : null)
  if (!size) throw new CheckError(`Which size of ${row.item.name}?`)
  // Open price: the item has no price on file yet, so the bartender types one.
  let price = size.priceCents
  if (price === null) {
    const typed = Math.round(Number(input.priceCents))
    if (!Number.isFinite(typed) || typed < 0 || typed > 100000) throw new CheckError(`${row.item.name} has no price on file. Enter one.`)
    price = typed
  }
  const qty = Math.floor(Number(input.qty ?? 1))
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new CheckError('Check the quantity.')
  const seat = input.seat === null || input.seat === undefined || String(input.seat) === '' ? null : Math.floor(Number(input.seat))
  await db.insert(checkItems).values({
    checkId, menuItemId: row.item.id, name: row.item.name, size: size.name === 'Regular' ? null : size.name,
    qty, unitPriceCents: price, note: clean(input.note, 140), seat: seat !== null && seat >= 1 && seat <= 20 ? seat : null,
    toKitchen: row.item.toKitchen ?? (row.section?.kind !== 'drink'), addedBy: by,
  })
  await db.update(checks).set({ updatedAt: new Date() }).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

/**
 * A pour from the tap list. The line's keg and pour size are copied onto the
 * check line, because tapping a new beer on that line later must not change
 * what this one cost.
 */
async function addPour(db: typeof DB, checkId: string, input: { tapId: string; qty?: number; note?: string | null; seat?: number | null; priceCents?: number | null }, by: string): Promise<CheckView> {
  const UUIDISH = /^[0-9a-f-]{36}$/i
  if (!UUIDISH.test(input.tapId)) throw new CheckError('That tap is gone.')
  const [t] = await db.select().from(taps).where(eq(taps.id, input.tapId)).limit(1)
  if (!t || !t.isActive || t.status === 'blown') throw new CheckError('That keg is blown.')
  let price = t.priceCents
  if (price === null) {
    const typed = Math.round(Number(input.priceCents))
    if (!Number.isFinite(typed) || typed < 0 || typed > 100000) throw new CheckError(`${t.beerName} has no price on file. Enter one.`)
    price = typed
  }
  const qty = Math.floor(Number(input.qty ?? 1))
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new CheckError('Check the quantity.')
  const seat = input.seat === null || input.seat === undefined || String(input.seat) === '' ? null : Math.floor(Number(input.seat))
  await db.insert(checkItems).values({
    checkId, menuItemId: null, tapId: t.id, stockItemId: t.stockItemId, stockQty: t.stockItemId ? String(t.pourOz) : null,
    name: t.beerName, size: null, qty, unitPriceCents: price, note: clean(input.note, 140), seat: seat !== null && seat >= 1 && seat <= 20 ? seat : null,
    toKitchen: false, addedBy: by,
  })
  await db.update(checks).set({ updatedAt: new Date() }).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

/** Change a held item (qty, note, seat). Sent items are the kitchen's now: void, don't edit. */
export async function updateItem(db: typeof DB, itemId: string, patch: { qty?: number; note?: string | null; seat?: number | null }): Promise<CheckView> {
  const [it] = await db.select().from(checkItems).where(eq(checkItems.id, itemId)).limit(1)
  if (!it) throw new CheckError('That item is gone.', 404)
  await openRow(db, it.checkId)
  if (it.state !== 'held') throw new CheckError('Already sent to the grill. Void it instead.', 409)
  const set: Partial<typeof checkItems.$inferInsert> = {}
  if (patch.qty !== undefined) {
    const q = Math.floor(Number(patch.qty))
    if (q < 1) { await db.delete(checkItems).where(eq(checkItems.id, itemId)); notifyRegister(); return getCheck(db, it.checkId) }
    if (q > 50) throw new CheckError('Check the quantity.')
    set.qty = q
  }
  if (patch.note !== undefined) set.note = clean(patch.note, 140)
  if (patch.seat !== undefined) { const s = patch.seat === null || String(patch.seat) === '' ? null : Math.floor(Number(patch.seat)); set.seat = s !== null && s >= 1 && s <= 20 ? s : null }
  if (Object.keys(set).length) await db.update(checkItems).set(set).where(eq(checkItems.id, itemId))
  notifyRegister()
  return getCheck(db, it.checkId)
}

/** Take a sent item off the check (it stays on the record with the reason). */
export async function voidItem(db: typeof DB, itemId: string, reason: string, by: string): Promise<CheckView> {
  const [it] = await db.select().from(checkItems).where(eq(checkItems.id, itemId)).limit(1)
  if (!it) throw new CheckError('That item is gone.', 404)
  await openRow(db, it.checkId)
  if (it.state === 'void') throw new CheckError('Already voided.', 409)
  if (it.kind === 'reward') return unredeem(db, it)
  if (it.kind === 'giftcard' && !it.giftCardId) { await db.delete(checkItems).where(eq(checkItems.id, itemId)); notifyRegister(); return getCheck(db, it.checkId) }
  if (it.state === 'held') { await db.delete(checkItems).where(eq(checkItems.id, itemId)); notifyRegister(); return getCheck(db, it.checkId) }
  const why = clean(reason, 80)
  if (!why) throw new CheckError('Give a reason for the void.')
  await db.update(checkItems).set({ state: 'void', voidReason: why, voidedBy: by }).where(eq(checkItems.id, itemId))
  const view = await getCheck(db, it.checkId)
  if (view.totals.balanceCents < 0) {
    // Voiding below what's already paid would owe the guest money; undo and say so.
    await db.update(checkItems).set({ state: it.state, voidReason: null, voidedBy: null }).where(eq(checkItems.id, itemId))
    throw new CheckError('That would take the check below what has been paid. Void a payment first.', 409)
  }
  // Food already on the grill screen: tell the cook, on the ticket itself.
  if (it.toKitchen && it.ticketId) {
    const [t] = await db.select({ note: kitchenTickets.note, bumpedAt: kitchenTickets.bumpedAt }).from(kitchenTickets).where(eq(kitchenTickets.id, it.ticketId)).limit(1)
    if (t && !t.bumpedAt) {
      const line = `VOID: ${it.qty} × ${it.name}${it.size ? ' (' + it.size.toLowerCase() + ')' : ''}`
      await db.update(kitchenTickets).set({ note: (t.note ? t.note + ' · ' : '') + line }).where(eq(kitchenTickets.id, it.ticketId))
      notifyKitchen()
    }
  }
  notifyRegister()
  return view
}

/** Fire held food to the grill as one ticket; held drinks just become sent. */
export async function sendCheck(db: typeof DB, checkId: string, by: string, onlyItemIds?: string[]): Promise<CheckView> {
  const c = await openRow(db, checkId)
  let held = await db.select().from(checkItems).where(and(eq(checkItems.checkId, checkId), eq(checkItems.state, 'held'))).orderBy(asc(checkItems.addedAt))
  // Coursing: send just the chosen items (apps now); the rest wait on the check.
  if (onlyItemIds) held = held.filter(i => onlyItemIds.includes(i.id))
  if (!held.length) throw new CheckError('Nothing new to send.', 409)
  const food = held.filter(i => i.toKitchen)
  let ticketId: string | null = null
  if (food.length) {
    const label = c.spot && c.spot !== c.label ? `${c.spot} · ${c.label}` : c.label
    const t = await fireTicket(db, {
      label, source: c.kind === 'table' ? 'table' : 'bar', note: c.note, firedBy: by, checkId,
      lines: food.map(i => ({ menuItemId: i.menuItemId, name: i.name, variation: i.size, qty: i.qty, note: i.note, seat: i.seat })),
    })
    ticketId = t?.id || null
  }
  const now = new Date()
  const plain = held.filter(i => !i.toKitchen || !ticketId).map(i => i.id)
  if (plain.length) await db.update(checkItems).set({ state: 'sent', sentAt: now }).where(inArray(checkItems.id, plain))
  if (ticketId && food.length) await db.update(checkItems).set({ state: 'sent', sentAt: now, ticketId }).where(inArray(checkItems.id, food.map(i => i.id)))
  await db.update(checks).set({ updatedAt: now }).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

async function closeIfPaid(db: typeof DB, checkId: string, by: string): Promise<void> {
  const view = await getCheck(db, checkId)
  if (view.status !== 'open' || view.totals.balanceCents > 0 || view.totals.totalCents === 0) return
  // Food still held on a paid check is food someone is waiting for: send it.
  if (view.heldFood || view.items.some(i => i.state === 'held')) await sendCheck(db, checkId, by)
  const t = view.totals
  await db.update(checks).set({ status: 'paid', closedAt: new Date(), closedBy: by, subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents, tipCents: t.tipCents, updatedAt: new Date() }).where(eq(checks.id, checkId))
  // Gift cards sold on this check come to life now that they're paid for.
  const cards = await db.select().from(checkItems).where(and(eq(checkItems.checkId, checkId), eq(checkItems.kind, 'giftcard'), isNull(checkItems.giftCardId)))
  for (const line of cards) {
    if (line.state === 'void') continue
    await db.transaction(async (tx) => {
      const card = await issueCard(tx, { cents: line.unitPriceCents, soldVia: 'register', soldBy: by, checkId, code: line.note || null })
      await tx.update(checkItems).set({ giftCardId: card.id, note: card.code }).where(eq(checkItems.id, line.id))
    }).catch((e) => console.error('[register] gift card not issued:', e?.message || e))
  }
  // A regular's visit, spend and points. Never lets a loyalty hiccup undo a paid check.
  await recordVisit(db, checkId).catch((e) => console.error('[register] visit not recorded:', e?.message || e))
}

export async function addPayment(db: typeof DB, checkId: string, input: { tender: string; amountCents: number; tipCents?: number; cashTenderedCents?: number | null; giftCardCode?: string | null }, by: string): Promise<CheckView & { changeCents: number | null; giftCard?: { code: string; balanceCents: number } }> {
  await openRow(db, checkId)
  if (input.tender === 'giftcard') return payWithGiftCard(db, checkId, input, by)
  const tender = input.tender === 'cash' ? 'cash' : input.tender === 'card_external' ? 'card_external' : null
  if (!tender) throw new CheckError('Cash or card?')
  const before = await getCheck(db, checkId)
  if (before.totals.totalCents <= 0) throw new CheckError('Nothing on the check to pay for.')
  const amount = Math.round(Number(input.amountCents))
  if (!Number.isFinite(amount) || amount <= 0) throw new CheckError('Enter an amount.')
  if (amount > before.totals.balanceCents) throw new CheckError('That is more than the balance. For cash, enter what they handed you as cash tendered.')
  const tip = Math.max(0, Math.round(Number(input.tipCents || 0)))
  if (tip > Math.max(10000, amount * 2)) throw new CheckError('That tip looks wrong. Check it.')
  let change: number | null = null, tendered: number | null = null
  if (tender === 'cash' && input.cashTenderedCents !== undefined && input.cashTenderedCents !== null && String(input.cashTenderedCents) !== '') {
    tendered = Math.round(Number(input.cashTenderedCents))
    change = changeDue(amount + tip, tendered)
    if (change === null) throw new CheckError('Not enough cash for that amount.')
  }
  await db.insert(checkPayments).values({ checkId, tender, amountCents: amount, tipCents: tip, cashTenderedCents: tendered, changeCents: change, takenBy: by })
  await closeIfPaid(db, checkId, by)
  notifyRegister()
  return { ...(await getCheck(db, checkId)), changeCents: change }
}

/** Take what's owed (up to the card's balance) off a gift card. No tips from a gift card. */
async function payWithGiftCard(db: typeof DB, checkId: string, input: { amountCents: number; tipCents?: number; giftCardCode?: string | null }, by: string) {
  if (Math.round(Number(input.tipCents || 0)) > 0) throw new CheckError('Take the tip in cash or on a card; gift cards pay for the check.')
  const card = await findCard(db, String(input.giftCardCode || ''))
  if (!card) throw new CheckError('No gift card with that number.', 404)
  const before = await getCheck(db, checkId)
  const want = Math.min(Math.round(Number(input.amountCents) || before.totals.balanceCents), before.totals.balanceCents)
  if (want <= 0) throw new CheckError('Nothing left to pay on this check.')
  let taken = 0
  try {
    await db.transaction(async (tx) => {
      const [p] = await tx.insert(checkPayments).values({ checkId, tender: 'giftcard', amountCents: want, tipCents: 0, takenBy: by, giftCardId: card.id }).returning({ id: checkPayments.id })
      taken = await spend(tx, card.id, want, { checkId, paymentId: p.id, by })
      if (taken !== want) await tx.update(checkPayments).set({ amountCents: taken }).where(eq(checkPayments.id, p.id))
    })
  } catch (e) {
    if (e instanceof GiftCardError) throw new CheckError(e.message, e.status)
    throw e
  }
  await closeIfPaid(db, checkId, by)
  notifyRegister()
  const [after] = await db.select({ code: giftCards.code, balanceCents: giftCards.balanceCents }).from(giftCards).where(eq(giftCards.id, card.id)).limit(1)
  return { ...(await getCheck(db, checkId)), changeCents: null, giftCard: after }
}

/** Sell a gift card on this check. It's issued (and its number is final) when the check is paid. */
export async function addGiftCardLine(db: typeof DB, checkId: string, input: { amountCents: number; code?: string | null }, by: string): Promise<CheckView> {
  await openRow(db, checkId)
  const cents = Math.round(Number(input.amountCents))
  if (!validAmount(cents)) throw new CheckError('A gift card is $5 to $500.')
  let code: string | null = null
  if (input.code && String(input.code).trim()) {
    code = normalizeCode(String(input.code))
    if (code.length < 6) throw new CheckError('That card number is too short.')
    if (await findCard(db, code)) throw new CheckError('That card number is already in use.', 409)
  }
  await db.insert(checkItems).values({ checkId, name: 'Gift card', qty: 1, unitPriceCents: cents, kind: 'giftcard', toKitchen: false, state: 'sent', sentAt: new Date(), note: code, addedBy: by })
  notifyRegister()
  return getCheck(db, checkId)
}

export async function voidPayment(db: typeof DB, paymentId: string, reason: string, by: string): Promise<CheckView> {
  const [p] = await db.select().from(checkPayments).where(eq(checkPayments.id, paymentId)).limit(1)
  if (!p) throw new CheckError('That payment is gone.', 404)
  await openRow(db, p.checkId)
  if (p.voidedAt) throw new CheckError('Already voided.', 409)
  const why = clean(reason, 80)
  if (!why) throw new CheckError('Give a reason.')
  await db.transaction(async (tx) => {
    await tx.update(checkPayments).set({ voidedAt: new Date(), voidReason: `${why} (${by})` }).where(eq(checkPayments.id, paymentId))
    // Money that came off a gift card goes back on it.
    if (p.tender === 'giftcard' && p.giftCardId) await refundTo(tx, p.giftCardId, p.amountCents, { checkId: p.checkId, paymentId, by, note: why })
  })
  notifyRegister()
  return getCheck(db, p.checkId)
}

/** Split by item: the chosen items move to a new check for the same spot. */
export async function splitItems(db: typeof DB, checkId: string, itemIds: string[], label: string | null, by: string): Promise<{ from: CheckView; to: CheckView }> {
  const c = await openRow(db, checkId)
  const items = await db.select().from(checkItems).where(and(eq(checkItems.checkId, checkId), inArray(checkItems.id, itemIds.slice(0, 100))))
  const movable = items.filter(i => i.state !== 'void' && i.kind !== 'reward')   // a reward stays with the regular's check
  if (!movable.length) throw new CheckError('Pick what goes on the new check.')
  const all = await getCheck(db, checkId)
  if (movable.length === all.items.filter(i => i.state !== 'void').length) throw new CheckError('That is everything. Leave it on this check.')
  const rate = await taxRate(db)
  const remaining = checkTotals(all.items.filter(i => !movable.some(m => m.id === i.id)), all.payments, rate)
  if (remaining.balanceCents < 0) throw new CheckError('This check already has payments that cover those items. Split before paying.', 409)
  const [n] = await db.insert(checks).values({
    kind: c.kind, label: clean(label, 40) || `${c.label} (split)`, spot: c.spot, note: c.note, openedBy: by, splitFromId: c.id,
  }).returning({ id: checks.id })
  await db.update(checkItems).set({ checkId: n.id }).where(inArray(checkItems.id, movable.map(i => i.id)))
  notifyRegister()
  return { from: await getCheck(db, checkId), to: await getCheck(db, n.id) }
}

/** Split by seat: every seat after the first goes to its own check ("Booth 2 · Seat 3"). Items with no seat stay. */
export async function splitBySeat(db: typeof DB, checkId: string, by: string): Promise<{ from: CheckView; created: CheckView[] }> {
  const c = await openRow(db, checkId)
  const items = await db.select().from(checkItems).where(and(eq(checkItems.checkId, checkId), eq(checkItems.kind, 'item')))
  const live = items.filter(i => i.state !== 'void')
  const seats = [...new Set(live.map(i => i.seat).filter((s): s is number => s !== null))].sort((a, b) => a - b)
  if (seats.length < 2) throw new CheckError('Put items on at least two seats first.')
  const created: CheckView[] = []
  for (const seat of seats.slice(1)) {
    const r = await splitItems(db, checkId, live.filter(i => i.seat === seat).map(i => i.id), `${c.spot || c.label} · Seat ${seat}`, by)
    created.push(r.to)
  }
  return { from: await getCheck(db, checkId), created }
}

/** Void a whole check: only with nothing paid on it. */
export async function voidCheck(db: typeof DB, checkId: string, reason: string, by: string): Promise<CheckView> {
  const view = await getCheck(db, checkId)
  if (view.status !== 'open') throw new CheckError('Only an open check can be voided.', 409)
  if (view.totals.paidCents > 0) throw new CheckError('Void its payments first.', 409)
  const why = clean(reason, 80)
  if (!why && view.items.length) throw new CheckError('Give a reason.')
  await db.update(checks).set({ status: 'void', voidReason: why || 'empty', closedAt: new Date(), closedBy: by, updatedAt: new Date() }).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

/**
 * A paid web order, recorded as a closed check so the night's sales include it.
 * Idempotent on the order id (unique index), so a retried payment call can't double it.
 */
export async function recordWebOrder(db: typeof DB, orderId: string, ticketId: string | null): Promise<void> {
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).limit(1)
  if (!o || !o.totalCents) return
  const [prior] = await db.select({ id: checks.id }).from(checks).where(eq(checks.onlineOrderId, o.id)).limit(1)
  if (prior) return
  const lines = (Array.isArray(o.lines) ? o.lines : []) as Array<{ itemId?: string; name: string; variation?: string; qty: number; note?: string; priceCents: number }>
  await db.transaction(async (tx) => {
    const now = new Date()
    const [c] = await tx.insert(checks).values({
      kind: 'online', label: 'Web · ' + o.customerName, status: 'paid', onlineOrderId: o.id,
      subtotalCents: o.subtotalCents, taxCents: o.taxCents, totalCents: o.totalCents, tipCents: 0,
      openedAt: o.createdAt, openedBy: 'Website', closedAt: now, closedBy: 'Website',
    }).returning({ id: checks.id })
    if (lines.length) await tx.insert(checkItems).values(lines.map(l => ({
      checkId: c.id, menuItemId: l.itemId || null, name: l.name, size: l.variation && l.variation !== 'Regular' ? l.variation : null,
      qty: l.qty, unitPriceCents: l.priceCents, note: l.note || null, state: 'sent', ticketId, sentAt: now, addedBy: 'Website',
    })))
    await tx.insert(checkPayments).values({ checkId: c.id, tender: 'card_online', amountCents: o.totalCents as number, tipCents: 0, squarePaymentId: o.squarePaymentId, takenBy: 'Website' })
  })
  // Someone already on the Regulars list gets the visit and the points. Nobody new is created from a web order.
  const guestId = await guestByPhone(db, o.phone)
  if (guestId) {
    const [c] = await db.select({ id: checks.id }).from(checks).where(eq(checks.onlineOrderId, o.id)).limit(1)
    if (c) { await db.update(checks).set({ guestId }).where(eq(checks.id, c.id)); await recordVisit(db, c.id).catch(() => {}) }
  }
  notifyRegister()
}

/** Put a regular on a check (or take them off with null). */
export async function attachGuest(db: typeof DB, checkId: string, guestId: string | null): Promise<CheckView> {
  await openRow(db, checkId)
  if (guestId) {
    const [g] = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, guestId)).limit(1)
    if (!g) throw new CheckError('That guest is gone.', 404)
  } else {
    const [reward] = await db.select({ id: checkItems.id }).from(checkItems).where(and(eq(checkItems.checkId, checkId), eq(checkItems.kind, 'reward'))).limit(1)
    if (reward) throw new CheckError('Take the reward off first.', 409)
  }
  await db.update(checks).set({ guestId, updatedAt: new Date() }).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

/** Spend a reward on this check: a negative line worth the reward (never more than the food and drink). */
export async function redeemReward(db: typeof DB, checkId: string, by: string): Promise<CheckView> {
  const c = await openRow(db, checkId)
  if (!c.guestId) throw new CheckError('Put a regular on the check first.')
  const cfg = await loyaltySettings(db)
  if (!cfg.enabled) throw new CheckError('The Regulars program is off.')
  const [g] = await db.select().from(guests).where(eq(guests.id, c.guestId)).limit(1)
  if (!g) throw new CheckError('That guest is gone.', 404)
  const items = await db.select().from(checkItems).where(eq(checkItems.checkId, checkId))
  if (items.some(i => i.kind === 'reward' && i.state !== 'void')) throw new CheckError('One reward per check.', 409)
  if (g.pointsBalance < cfg.rewardPoints) throw new CheckError(`${g.name} has ${g.pointsBalance} of ${cfg.rewardPoints} points.`)
  const amount = rewardAmount(items.filter(i => i.kind === 'item' && i.state !== 'void').reduce((s, i) => s + i.qty * i.unitPriceCents, 0), cfg)
  if (amount <= 0) throw new CheckError('Nothing on the check to take it off.')
  await db.transaction(async (tx) => {
    await tx.insert(checkItems).values({ checkId, name: 'Regulars reward', qty: 1, unitPriceCents: -amount, kind: 'reward', toKitchen: false, state: 'sent', sentAt: new Date(), addedBy: by })
    await tx.insert(loyaltyLedger).values({ guestId: g.id, points: -cfg.rewardPoints, reason: 'redeem', checkId, by })
    await tx.update(guests).set({ pointsBalance: sql`${guests.pointsBalance} - ${cfg.rewardPoints}`, updatedAt: new Date() }).where(eq(guests.id, g.id))
  })
  notifyRegister()
  return getCheck(db, checkId)
}

async function unredeem(db: typeof DB, it: typeof checkItems.$inferSelect): Promise<CheckView> {
  // Taking a discount off only raises what's owed, so this can never undercut a payment.
  const [spent] = await db.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.checkId, it.checkId), eq(loyaltyLedger.reason, 'redeem'))).limit(1)
  await db.transaction(async (tx) => {
    await tx.delete(checkItems).where(eq(checkItems.id, it.id))
    if (spent) {
      await tx.insert(loyaltyLedger).values({ guestId: spent.guestId, points: -spent.points, reason: 'unredeem', checkId: it.checkId, by: it.addedBy })
      await tx.update(guests).set({ pointsBalance: sql`${guests.pointsBalance} + ${-spent.points}`, updatedAt: new Date() }).where(eq(guests.id, spent.guestId))
    }
  })
  notifyRegister()
  return getCheck(db, it.checkId)
}

/** Rename or move a check ("Mike" → "Booth 3"). */
export async function renameCheck(db: typeof DB, checkId: string, input: { label?: string | null; spot?: string | null }): Promise<CheckView> {
  await openRow(db, checkId)
  const set: Partial<typeof checks.$inferInsert> = { updatedAt: new Date() }
  if (input.label !== undefined) { const l = clean(input.label, 40); if (!l) throw new CheckError('A check needs a name.'); set.label = l }
  if (input.spot !== undefined) set.spot = clean(input.spot, 40)
  await db.update(checks).set(set).where(eq(checks.id, checkId))
  notifyRegister()
  return getCheck(db, checkId)
}

