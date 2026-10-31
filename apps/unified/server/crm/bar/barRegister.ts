// The check lifecycle — the register (barRegisterRoutes.ts, the screen at /crm/register).
//
//   openCheck → addItem (held) → sendCheck (food → one grill ticket; drinks just marked sent)
//   → addPayment (cash / card run on the card reader) … until the balance is zero → paid.
//   splitItems / splitBySeat move items to a new check; voidItem / voidPayment / voidCheck need a reason.
//
// Every write runs in ONE transaction that first locks the check row (FOR UPDATE), and reads through that same
// transaction, so two registers paying one tab at once cannot both take the balance. Errors are CheckError with
// words a bartender can act on. Every write tells the company's register screens ('bar:register').
//
// Ported from website-premium-bar's lib/register/checks.ts (Amber Inn, 9/26): scoped to a company, people are
// login users (actor id + name), the guest is a CRM contact, and the tax rate is Settings › Company's.
//
// Moved from templates/crm-bar/backend/src/services/barRegister.ts. The arithmetic and every rule are unchanged (the
// money is barCheckMoney.ts, untouched); the functions are made with the app's database, live updates, and the
// grill, Regulars and gift-card services; the check-number counter and the reward-use counts are server/data/bar.ts.
import { refreshMenu, servingNow, windowWords } from './menuDay.ts'
import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { canRedeem, rewardDiscountCents, type BasketLine, type Reward } from '@twomiah/tenant-backend'
import { barCheck, barCheckItem, barCheckPayment, barKitchenTicket, barMenuItem, barMenuSection, barTap, barTerminalCharge, company, contact, loyaltyMember, loyaltyReward, loyaltyTransaction } from '../../db/schema/index.ts'
import { nextCheckNumber, rewardUseTakenBack, rewardUsedOnce } from '../../data/bar.ts'
import type { BarKitchen } from './barKitchen.ts'
import { sizesOf } from './barMenuSizes.ts'
import { modifierNote, modifiersOf, pickModifiers } from './barModifiers.ts'
import { changeDue, checkTotals, quickCash, taxRateBpsFrom, type CheckTotals } from './barCheckMoney.ts'
import type { Actor } from './barManagers.ts'
import { BAR_WORDS, LoyaltyError, type BarLoyalty } from './barLoyalty.ts'
import { GiftCardError, normalizeCode, validAmount, MIN_CARD_CENTS, MAX_CARD_CENTS, type BarGiftCards } from './barGiftCards.ts'
import { tapSizes } from './barTapSizes.ts'
import type { BarDb } from './db.ts'

type Tx = any

export class CheckError extends Error { constructor(message: string, public status = 400) { super(message) } }

export interface CheckView {
  id: string; number: number; kind: string; label: string; spot: string | null; note: string | null; status: string
  contactId: string | null; guestName: string | null; guestPoints: number | null
  openedAt: string; openedByName: string | null; closedAt: string | null; closedByName: string | null; voidReason: string | null
  items: Array<typeof barCheckItem.$inferSelect>
  payments: Array<typeof barCheckPayment.$inferSelect>
  totals: CheckTotals
  taxRateBps: number
  heldFood: number
  quickCash: number[]
}

export interface OpenCheckRow { id: string; number: number; kind: string; label: string; spot: string | null; openedAt: string; openedByName: string | null; totalCents: number; balanceCents: number; itemCount: number; heldCount: number; foodUpAt: string | null; onGrill: number }

export const TENDERS = ['cash', 'card_external'] as const

/** One priced line of a kiosk or website order (bar_order.lines). */
export interface OrderLine { menuItemId: string; name: string; size: string | null; qty: number; unitPriceCents: number; note: string | null; toKitchen: boolean }

const clean = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }
const seatOf = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v) === '') return null
  const s = Math.floor(Number(v))
  return Number.isFinite(s) && s >= 1 && s <= 20 ? s : null
}
const qtyOf = (v: unknown): number => {
  const q = Math.floor(Number(v ?? 1))
  if (!Number.isFinite(q) || q < 1 || q > 50) throw new CheckError('Check the quantity.')
  return q
}

function typedPrice(v: unknown, name: string): number {
  const typed = Math.round(Number(v))
  if (v === null || v === undefined || v === '' || !Number.isFinite(typed) || typed < 0 || typed > 100000) throw new CheckError(`${name} has no price on file. Enter one.`)
  return typed
}

/** What the shared engine prices a reward against: the check's food and drink, one entry per line. */
function basketFor(items: Array<typeof barCheckItem.$inferSelect>, reward: { type: string }): BasketLine[] {
  const live = items.filter(i => i.state !== 'void' && i.kind === 'item')
  // A free item is ONE of it, at what it costs on this check — not the whole line of three.
  return live.map(i => ({ itemId: i.menuItemId || i.id, lineTotalCents: reward.type === 'free_item' ? i.unitPriceCents : i.qty * i.unitPriceCents }))
}

export function createBarRegister(
  db: BarDb,
  emitToCompany: (companyId: string, event: string, data: unknown) => void,
  kitchen: BarKitchen,
  loyalty: BarLoyalty,
  giftCards: BarGiftCards,
) {
const { fireTicket, noteVoidOnTicket, notifyKitchen } = kitchen
const { earnForPaidCheck, ensureMember, loyaltyRunning } = loyalty
const { findCard, issueCard, cardPrefix, refundTo, spend } = giftCards

function notifyRegister(companyId: string): void { emitToCompany(companyId, 'bar:register', { at: Date.now() }) }

/**
 * A check that ends without its card tab (voided, or paid another way) lets the tab's hold go (barTerminal.ts sets this;
 * restaurant-bar-depth #12). Never throws: a hold that would not release lapses on its own and is said so on the tab.
 */
const hooks: { checkEnded: null | ((companyId: string, checkId: string) => Promise<void>) } = { checkEnded: null }
async function checkEnded(companyId: string, checkId: string): Promise<void> {
  try { if (hooks.checkEnded) await hooks.checkEnded(companyId, checkId) } catch { /* the hold lapses on its own */ }
}

async function taxRateBps(companyId: string, tx: Tx = db): Promise<number> {
  const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  return taxRateBpsFrom(co?.settings)
}

/** The open check, locked for this transaction. */
async function lockOpen(tx: Tx, companyId: string, id: string) {
  const [c] = await tx.select().from(barCheck).where(and(eq(barCheck.id, id), eq(barCheck.companyId, companyId))).limit(1).for('update')
  if (!c) throw new CheckError('That check is gone.', 404)
  if (c.status !== 'open') throw new CheckError(c.status === 'paid' ? 'That check is already paid.' : 'That check was voided.', 409)
  return c
}

/**
 * While the card reader is taking a payment on this check, nothing else may be paid on it: the reader's amount was
 * checked against the balance when it was sent, and a cash payment in the meantime would leave the card overpaying.
 */
async function refuseWhileOnReader(tx: Tx, companyId: string, checkId: string): Promise<void> {
  const [busy] = await tx.select({ id: barTerminalCharge.id }).from(barTerminalCharge)
    .where(and(eq(barTerminalCharge.companyId, companyId), eq(barTerminalCharge.checkId, checkId), eq(barTerminalCharge.status, 'pending'))).limit(1)
  if (busy) throw new CheckError('The card reader is taking a payment on this check. Wait for it, or cancel it on the register.', 409)
}

// ─── Reading ────────────────────────────────────────────────────────────────
async function getCheck(companyId: string, id: string, tx: Tx = db): Promise<CheckView> {
  const [c] = await tx.select().from(barCheck).where(and(eq(barCheck.id, id), eq(barCheck.companyId, companyId))).limit(1)
  if (!c) throw new CheckError('That check is gone.', 404)
  const [items, payments, liveRate, guest] = await Promise.all([
    tx.select().from(barCheckItem).where(and(eq(barCheckItem.checkId, id), eq(barCheckItem.companyId, companyId))).orderBy(asc(barCheckItem.addedAt)),
    tx.select().from(barCheckPayment).where(and(eq(barCheckPayment.checkId, id), eq(barCheckPayment.companyId, companyId))).orderBy(asc(barCheckPayment.takenAt)),
    taxRateBps(companyId, tx),
    c.contactId ? tx.select({ name: contact.name, points: loyaltyMember.pointsBalance }).from(contact).leftJoin(loyaltyMember, and(eq(loyaltyMember.contactId, contact.id), eq(loyaltyMember.companyId, companyId))).where(and(eq(contact.id, c.contactId), eq(contact.companyId, companyId))).limit(1) : Promise.resolve([]),
  ])
  // A closed check keeps the rate it closed at; an open one is at today's rate.
  const rate = c.status === 'open' || c.taxRateBps === null ? liveRate : c.taxRateBps
  const totals = checkTotals(items, payments, rate)
  return {
    id: c.id, number: c.number, kind: c.kind, label: c.label, spot: c.spot, note: c.note, status: c.status,
    contactId: c.contactId, guestName: (guest as any[])[0]?.name ?? null, guestPoints: (guest as any[])[0]?.points ?? null,
    openedAt: c.openedAt.toISOString(), openedByName: c.openedByName, closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    closedByName: c.closedByName, voidReason: c.voidReason,
    items, payments, totals, taxRateBps: rate,
    heldFood: items.filter((i: any) => i.state === 'held' && i.toKitchen).length,
    quickCash: totals.balanceCents > 0 ? quickCash(totals.balanceCents) : [],
  }
}

async function listOpen(companyId: string): Promise<OpenCheckRow[]> {
  const open = await db.select().from(barCheck).where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'open'))).orderBy(asc(barCheck.openedAt)).limit(200)
  if (!open.length) return []
  const ids = open.map(c => c.id)
  const [items, payments, rate, tickets] = await Promise.all([
    db.select().from(barCheckItem).where(and(eq(barCheckItem.companyId, companyId), inArray(barCheckItem.checkId, ids))),
    db.select().from(barCheckPayment).where(and(eq(barCheckPayment.companyId, companyId), inArray(barCheckPayment.checkId, ids))),
    taxRateBps(companyId),
    db.select({ checkId: barKitchenTicket.checkId, bumpedAt: barKitchenTicket.bumpedAt }).from(barKitchenTicket).where(and(eq(barKitchenTicket.companyId, companyId), inArray(barKitchenTicket.checkId, ids))),
  ])
  const upSince = Date.now() - 15 * 60000
  return open.map(c => {
    const mine = tickets.filter(t => t.checkId === c.id)
    const lastUp = mine.filter(t => t.bumpedAt && t.bumpedAt.getTime() > upSince).reduce<Date | null>((m, t) => (!m || (t.bumpedAt as Date) > m ? t.bumpedAt as Date : m), null)
    const its = items.filter(i => i.checkId === c.id)
    const t = checkTotals(its, payments.filter(p => p.checkId === c.id), rate)
    return {
      id: c.id, number: c.number, kind: c.kind, label: c.label, spot: c.spot, openedAt: c.openedAt.toISOString(), openedByName: c.openedByName,
      totalCents: t.totalCents, balanceCents: t.balanceCents,
      foodUpAt: lastUp ? lastUp.toISOString() : null,
      onGrill: mine.filter(t => !t.bumpedAt).length,
      itemCount: its.filter(i => i.state !== 'void').reduce((s, i) => s + i.qty, 0),
      heldCount: its.filter(i => i.state === 'held').length,
    }
  })
}

/** Closed since the night began (the "recent" list, to look back at a mistake). */
async function listRecentClosed(companyId: string, since: Date) {
  const rows = await db.select().from(barCheck)
    .where(and(eq(barCheck.companyId, companyId), or(eq(barCheck.status, 'paid'), eq(barCheck.status, 'void')), gte(barCheck.closedAt, since)))
    .orderBy(desc(barCheck.closedAt)).limit(30)
  return rows.map(c => ({ id: c.id, number: c.number, label: c.label, status: c.status, totalCents: c.totalCents, closedAt: (c.closedAt as Date).toISOString() }))
}

/** What the register rings from: the active menu by section (with every size), and what is on tap right now. */
async function menuForRegister(companyId: string) {
  await refreshMenu(db, companyId)   // an 86 "until we open" is back once we have opened (menu_dayparts)
  const served = await servingNow(db, companyId)
  const [allSections, items, lines] = await Promise.all([
    db.select().from(barMenuSection).where(and(eq(barMenuSection.companyId, companyId), eq(barMenuSection.isActive, true))).orderBy(asc(barMenuSection.sortOrder), asc(barMenuSection.name)),
    db.select().from(barMenuItem).where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.isActive, true))).orderBy(asc(barMenuItem.sortOrder), asc(barMenuItem.name)),
    db.select().from(barTap).where(and(eq(barTap.companyId, companyId), eq(barTap.isActive, true))).orderBy(asc(barTap.sortOrder), asc(barTap.lineNumber)),
  ])
  const sections = allSections.filter(s => served(s))   // a section outside its hours is not on the picker
  const onTap = lines.filter(t => t.status !== 'blown').map(t => ({
    id: 'tap:' + t.id, name: t.beerName, is86ed: false,
    // Its pour sizes (a pint, a pitcher); more than one and the register asks which, as it does for a menu item.
    sizes: tapSizes(t).map(s => ({ id: s.id, name: s.name, priceCents: s.priceCents })),
  }))
  const menu: Array<{ id: string; name: string; kind: string; items: Array<{ id: string; name: string; is86ed: boolean; description?: string | null; imageUrl?: string | null; sizes: Array<{ id: string; name: string; priceCents: number | null }>; modifiers?: Array<{ id: string; name: string; priceCents: number }> }> }> = sections.map(s => ({
    id: s.id, name: s.name, kind: s.kind,
    items: items.filter(i => i.sectionId === s.id).map(i => ({
      id: i.id, name: i.name, is86ed: i.is86ed, description: i.description, imageUrl: i.imageUrl,
      sizes: sizesOf(i, s.description).map(v => ({ id: v.id, name: v.name, priceCents: v.priceCents })),
      modifiers: modifiersOf(i),
    })),
  })).filter(s => s.items.length)
  // Food first (the grill is the bar's first job); the taps lead the drinks.
  if (onTap.length) {
    const at = menu.findIndex(s => s.kind === 'drink')
    menu.splice(at < 0 ? menu.length : at, 0, { id: 'taps', name: 'On tap', kind: 'drink', items: onTap })
  }
  return menu
}

// ─── Writing ────────────────────────────────────────────────────────────────
// The next check number for this company is a counter that only goes forwards (never MAX+1): data/bar.ts nextCheckNumber.

async function openCheck(actor: Actor, input: { kind?: string; label?: string; spot?: string | null; note?: string | null }): Promise<CheckView> {
  const kind = ['tab', 'table', 'walkup'].includes(String(input.kind)) ? String(input.kind) : 'walkup'
  const spot = clean(input.spot, 40)
  const label = clean(input.label, 40) || spot || (kind === 'walkup' ? 'Walk-up' : null)
  if (!label) throw new CheckError(kind === 'tab' ? 'Whose tab is it?' : 'Which table?')
  const id = await db.transaction(async (tx: Tx) => {
    const number = await nextCheckNumber(tx, actor.companyId)
    const [row] = await tx.insert(barCheck).values({ number, kind, label, spot, note: clean(input.note, 200), openedById: actor.id, openedByName: actor.name, companyId: actor.companyId }).returning({ id: barCheck.id })
    return row.id as string
  })
  notifyRegister(actor.companyId)
  return getCheck(actor.companyId, id)
}

async function addItem(actor: Actor, checkId: string, input: { menuItemId?: string; sizeId?: string | null; modifierIds?: unknown; qty?: number; note?: string | null; seat?: number | null; priceCents?: number | null }): Promise<CheckView> {
  const companyId = actor.companyId
  await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    const ref = String(input.menuItemId || '')
    if (ref.startsWith('tap:')) {
      // A pour from the tap list. The beer's name and price are copied onto the line, because tapping a new beer
      // on that line later must not change what this one was.
      const [t] = await tx.select().from(barTap).where(and(eq(barTap.id, ref.slice(4)), eq(barTap.companyId, companyId))).limit(1)
      if (!t || !t.isActive || t.status === 'blown') throw new CheckError('That keg is blown.')
      const sizes = tapSizes(t)
      const size = sizes.find(s => s.id === input.sizeId) || (sizes.length === 1 ? sizes[0] : null)
      if (!size) throw new CheckError(`Which size of ${t.beerName}?`)
      const price = size.priceCents ?? typedPrice(input.priceCents, t.beerName)
      // The keg and the ounces this pour took, as they are NOW: stock costing reads them, not the tap as it is later.
      await tx.insert(barCheckItem).values({ checkId, tapId: t.id, stockItemId: t.stockItemId, stockQty: t.stockItemId ? String(size.oz) : null, name: t.beerName, size: sizes.length > 1 ? size.name : null, qty: qtyOf(input.qty), unitPriceCents: price, note: clean(input.note, 140), seat: seatOf(input.seat), toKitchen: false, addedById: actor.id, addedByName: actor.name, companyId })
    } else {
      const [row] = await tx.select({ item: barMenuItem, section: barMenuSection }).from(barMenuItem)
        .leftJoin(barMenuSection, eq(barMenuSection.id, barMenuItem.sectionId))
        .where(and(eq(barMenuItem.id, ref), eq(barMenuItem.companyId, companyId))).limit(1)
      if (!row || !row.item.isActive) throw new CheckError('That item is off the menu.')
      if (row.item.is86ed) throw new CheckError(`${row.item.name} is 86'd.`)
      if (row.section && !(await servingNow(tx, companyId))(row.section)) throw new CheckError(`${row.section.name} is not being served now (${windowWords(row.section)}).`)
      const sizes = sizesOf(row.item, row.section?.description)
      const size = sizes.find(s => s.id === input.sizeId) || (sizes.length === 1 ? sizes[0] : null)
      if (!size) throw new CheckError(`Which size of ${row.item.name}?`)
      // Open price: the item has no price on file yet, so the bartender types one.
      const base = size.priceCents ?? typedPrice(input.priceCents, row.item.name)
      // Add-ons and changes, priced from the item as it is now; their names ride on the note for the grill.
      const mods = pickModifiers(row.item, input.modifierIds)
      if (mods === 'unknown') throw new CheckError(`That add-on is not on ${row.item.name} any more.`)
      const price = base + mods.reduce((n, m) => n + m.priceCents, 0)
      const note = clean([modifierNote(mods), clean(input.note, 140)].filter(Boolean).join(' · '), 140)
      await tx.insert(barCheckItem).values({
        checkId, menuItemId: row.item.id, name: row.item.name, size: size.name === 'Regular' ? null : size.name,
        qty: qtyOf(input.qty), unitPriceCents: price, note, seat: seatOf(input.seat),
        toKitchen: row.item.toKitchen ?? (row.section?.kind !== 'drink'), addedById: actor.id, addedByName: actor.name, companyId,
      })
    }
    await tx.update(barCheck).set({ updatedAt: new Date() }).where(eq(barCheck.id, checkId))
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Change a held item (qty, note, seat). Sent items are the grill's now: void, don't edit. qty 0 takes it off. */
async function updateItem(actor: Actor, itemId: string, patch: { qty?: number; note?: string | null; seat?: number | null }): Promise<CheckView> {
  const companyId = actor.companyId
  const checkId = await db.transaction(async (tx: Tx) => {
    const [it] = await tx.select().from(barCheckItem).where(and(eq(barCheckItem.id, itemId), eq(barCheckItem.companyId, companyId))).limit(1)
    if (!it) throw new CheckError('That item is gone.', 404)
    await lockOpen(tx, companyId, it.checkId)
    if (it.state !== 'held') throw new CheckError('Already sent to the grill. Void it instead.', 409)
    const set: Record<string, unknown> = {}
    if (patch.qty !== undefined) {
      const q = Math.floor(Number(patch.qty))
      if (!Number.isFinite(q)) throw new CheckError('Check the quantity.')
      if (q < 1) { await tx.delete(barCheckItem).where(eq(barCheckItem.id, itemId)); return it.checkId }
      if (q > 50) throw new CheckError('Check the quantity.')
      set.qty = q
    }
    if (patch.note !== undefined) set.note = clean(patch.note, 140)
    if (patch.seat !== undefined) set.seat = seatOf(patch.seat)
    if (Object.keys(set).length) await tx.update(barCheckItem).set(set).where(eq(barCheckItem.id, itemId))
    return it.checkId
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Does voiding this item need a manager? Only food or drink already sent (a held item just comes off). */
async function itemNeedsManager(companyId: string, itemId: string): Promise<boolean> {
  const [it] = await db.select({ state: barCheckItem.state, kind: barCheckItem.kind, giftCardId: barCheckItem.giftCardId }).from(barCheckItem).where(and(eq(barCheckItem.id, itemId), eq(barCheckItem.companyId, companyId))).limit(1)
  if (it?.kind === 'giftcard' && !it.giftCardId) return false   // not a real card yet: nothing to protect
  if (it?.kind === 'reward') return false                        // taking a reward off only raises what is owed
  return it?.state === 'sent'
}

/** Take an item off the check. A held one is deleted; a sent one stays on the record, voided, with the reason. */
async function voidItem(actor: Actor, itemId: string, reason: string, byName: string): Promise<CheckView> {
  const companyId = actor.companyId
  let toldKitchen = false
  const checkId = await db.transaction(async (tx: Tx) => {
    const [it] = await tx.select().from(barCheckItem).where(and(eq(barCheckItem.id, itemId), eq(barCheckItem.companyId, companyId))).limit(1)
    if (!it) throw new CheckError('That item is gone.', 404)
    await lockOpen(tx, companyId, it.checkId)
    await refuseWhileOnReader(tx, companyId, it.checkId)
    if (it.state === 'void') throw new CheckError('Already voided.', 409)
    if (it.kind === 'reward') { await unredeemInTx(tx, companyId, it, byName); return it.checkId }
    if (it.state === 'held' || (it.kind === 'giftcard' && !it.giftCardId)) { await tx.delete(barCheckItem).where(eq(barCheckItem.id, itemId)); return it.checkId }
    const why = clean(reason, 80)
    if (!why) throw new CheckError('Give a reason for the void.')
    await tx.update(barCheckItem).set({ state: 'void', voidReason: why, voidedByName: byName }).where(eq(barCheckItem.id, itemId))
    const view = await getCheck(companyId, it.checkId, tx)
    // Voiding below what's already paid would owe the guest money: refuse (the transaction rolls the void back).
    if (view.totals.balanceCents < 0) throw new CheckError('That would take the check below what has been paid. Void a payment first.', 409)
    // Food already on the grill screen: tell the cook, on the ticket itself.
    if (it.toKitchen && it.ticketId) {
      toldKitchen = await noteVoidOnTicket(tx, companyId, it.ticketId, `VOID: ${it.qty} × ${it.name}${it.size ? ' (' + it.size.toLowerCase() + ')' : ''}`)
    }
    return it.checkId
  })
  if (toldKitchen) notifyKitchen(companyId)
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Fire held food to the grill as one ticket; held drinks just become sent. `onlyItemIds` = coursing (apps now). */
async function sendCheck(actor: Actor, checkId: string, onlyItemIds?: string[]): Promise<CheckView> {
  const companyId = actor.companyId
  const fired = await db.transaction(async (tx: Tx) => {
    // A kiosk order goes to the grill once it is PAID (closeIfPaid fires it then): not before, from the register.
    const c = await lockOpen(tx, companyId, checkId)
    if (c.kind === 'kiosk' && (await getCheck(companyId, checkId, tx)).totals.balanceCents > 0) throw new CheckError('A kiosk order goes to the grill once it is paid. Take the payment and it fires.', 409)
    return sendInTx(tx, companyId, checkId, actor.name, onlyItemIds)
  })
  if (fired) notifyKitchen(companyId)
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

async function sendInTx(tx: Tx, companyId: string, checkId: string, byName: string, onlyItemIds?: string[], quiet = false): Promise<boolean> {
  const c = await lockOpen(tx, companyId, checkId)
  let held = await tx.select().from(barCheckItem).where(and(eq(barCheckItem.checkId, checkId), eq(barCheckItem.companyId, companyId), eq(barCheckItem.state, 'held'))).orderBy(asc(barCheckItem.addedAt))
  if (onlyItemIds) held = held.filter((i: any) => onlyItemIds.includes(i.id))
  if (!held.length) { if (quiet) return false; throw new CheckError('Nothing new to send.', 409) }
  const food = held.filter((i: any) => i.toKitchen)
  let ticketId: string | null = null
  if (food.length) {
    const label = c.spot && c.spot !== c.label ? `${c.spot} · ${c.label}` : c.label
    const t = await fireTicket(tx, companyId, {
      label, source: c.kind === 'table' ? 'table' : c.kind === 'kiosk' ? 'kiosk' : c.kind === 'online' ? 'web' : 'bar', note: c.note, firedByName: byName, checkId,
      lines: food.map((i: any) => ({ menuItemId: i.menuItemId, name: i.name, variation: i.size, qty: i.qty, note: i.note, seat: i.seat })),
    })
    ticketId = t?.id || null
  }
  const now = new Date()
  const plain = held.filter((i: any) => !i.toKitchen || !ticketId).map((i: any) => i.id)
  if (plain.length) await tx.update(barCheckItem).set({ state: 'sent', sentAt: now }).where(inArray(barCheckItem.id, plain))
  if (ticketId) await tx.update(barCheckItem).set({ state: 'sent', sentAt: now, ticketId }).where(inArray(barCheckItem.id, food.map((i: any) => i.id)))
  await tx.update(barCheck).set({ updatedAt: now }).where(eq(barCheck.id, checkId))
  return !!ticketId
}

/**
 * Close the check when it is paid in full: send anything still held, freeze the totals at today's rate, issue the
 * gift cards sold on it, and earn its guest their points. `earn` is decided by the caller BEFORE the transaction
 * (loyaltyRunning reads outside it, and an outside read inside a transaction deadlocks a one-connection database).
 */
async function closeIfPaid(tx: Tx, companyId: string, checkId: string, actor: Actor, earn: boolean): Promise<boolean> {
  const view = await getCheck(companyId, checkId, tx)
  if (view.status !== 'open' || view.totals.balanceCents > 0 || view.totals.totalCents === 0) return false
  // Food still held on a paid check is food someone is waiting for: send it.
  const fired = view.items.some(i => i.state === 'held') ? await sendInTx(tx, companyId, checkId, actor.name, undefined, true) : false
  const t = view.totals
  await tx.update(barCheck).set({
    status: 'paid', closedAt: new Date(), closedById: actor.id || null, closedByName: actor.name, taxRateBps: view.taxRateBps,
    subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents, tipCents: t.tipCents, updatedAt: new Date(),
  }).where(eq(barCheck.id, checkId))
  // Gift cards sold on this check come to life now that they are paid for — in this same transaction, so a card
  // exists exactly when its sale does.
  for (const line of view.items.filter(i => i.kind === 'giftcard' && i.state !== 'void' && !i.giftCardId)) {
    const card = await issueCard(tx, companyId, { cents: line.unitPriceCents, soldVia: 'register', soldByName: actor.name, checkId, code: line.note || null })
    await tx.update(barCheckItem).set({ giftCardId: card.id, note: card.code }).where(eq(barCheckItem.id, line.id))
  }
  // A regular's points, once per check.
  if (earn && view.contactId) await earnForPaidCheck(tx, companyId, { id: view.id, number: view.number, contactId: view.contactId, items: view.items }, actor.name)
  return fired
}

async function addPayment(actor: Actor, checkId: string, input: { tender?: string; amountCents?: number; tipCents?: number; cashTenderedCents?: number | null; giftCardCode?: string | null }): Promise<CheckView & { changeCents: number | null; giftCard?: { code: string; balanceCents: number } | null }> {
  const companyId = actor.companyId
  if (input.tender === 'giftcard') return payWithGiftCard(actor, checkId, input)
  const tender = (TENDERS as readonly string[]).includes(String(input.tender)) ? String(input.tender) : null
  if (!tender) throw new CheckError('Cash or card?')
  let change: number | null = null
  const earn = await loyaltyRunning(companyId)
  const fired = await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    await refuseWhileOnReader(tx, companyId, checkId)
    const before = await getCheck(companyId, checkId, tx)
    if (before.totals.totalCents <= 0) throw new CheckError('Nothing on the check to pay for.')
    const amount = Math.round(Number(input.amountCents))
    if (!Number.isFinite(amount) || amount <= 0) throw new CheckError('Enter an amount.')
    if (amount > before.totals.balanceCents) throw new CheckError('That is more than the balance. For cash, enter what they handed you as cash tendered.')
    const tip = Math.max(0, Math.round(Number(input.tipCents || 0)))
    if (!Number.isFinite(tip) || tip > Math.max(10000, amount * 2)) throw new CheckError('That tip looks wrong. Check it.')
    let tendered: number | null = null
    if (tender === 'cash' && input.cashTenderedCents !== undefined && input.cashTenderedCents !== null && String(input.cashTenderedCents) !== '') {
      tendered = Math.round(Number(input.cashTenderedCents))
      change = Number.isFinite(tendered) ? changeDue(amount + tip, tendered) : null
      if (change === null) throw new CheckError('Not enough cash for that amount.')
    }
    await tx.insert(barCheckPayment).values({ checkId, tender, amountCents: amount, tipCents: tip, cashTenderedCents: tendered, changeCents: change, takenById: actor.id, takenByName: actor.name, companyId })
    return closeIfPaid(tx, companyId, checkId, actor, earn)
  })
  if (fired) notifyKitchen(companyId)
  const after = await getCheck(companyId, checkId)
  if (after.status !== 'open') await checkEnded(companyId, checkId)
  notifyRegister(companyId)
  return { ...after, changeCents: change }
}

/** Take what's owed (up to the card's balance) off a gift card. No tip off a gift card: it pays for the check. */
async function payWithGiftCard(actor: Actor, checkId: string, input: { amountCents?: number; tipCents?: number; giftCardCode?: string | null }) {
  const companyId = actor.companyId
  if (Math.round(Number(input.tipCents || 0)) > 0) throw new CheckError('Take the tip in cash or on a card; a gift card pays for the check.')
  let after: { code: string; balanceCents: number } | null = null
  let fired = false
  const earn = await loyaltyRunning(companyId)
  try {
    fired = await db.transaction(async (tx: Tx) => {
      await lockOpen(tx, companyId, checkId)
      await refuseWhileOnReader(tx, companyId, checkId)
      const card = await findCard(companyId, String(input.giftCardCode || ''), tx)
      if (!card) throw new CheckError('No gift card with that number.', 404)
      const before = await getCheck(companyId, checkId, tx)
      if (before.totals.balanceCents <= 0) throw new CheckError('Nothing left to pay on this check.')
      // A card paying for a card would just move money between cards; sell it for cash or card.
      if (before.items.some(i => i.kind === 'giftcard' && i.state !== 'void')) throw new CheckError('A gift card cannot pay for a gift card.')
      const asked = Math.round(Number(input.amountCents))
      const want = Math.min(Number.isFinite(asked) && asked > 0 ? asked : before.totals.balanceCents, before.totals.balanceCents)
      const [p] = await tx.insert(barCheckPayment).values({ checkId, tender: 'giftcard', amountCents: want, tipCents: 0, giftCardId: card.id, takenById: actor.id, takenByName: actor.name, companyId }).returning({ id: barCheckPayment.id })
      const taken = await spend(tx, companyId, card.id, want, { checkId, paymentId: p.id, byName: actor.name })
      if (taken !== want) await tx.update(barCheckPayment).set({ amountCents: taken }).where(eq(barCheckPayment.id, p.id))
      after = { code: card.code, balanceCents: card.balanceCents - taken }
      return closeIfPaid(tx, companyId, checkId, actor, earn)
    })
  } catch (e) {
    if (e instanceof GiftCardError) throw new CheckError(e.message, e.status)
    throw e
  }
  if (fired) notifyKitchen(companyId)
  const ended = await getCheck(companyId, checkId)
  if (ended.status !== 'open') await checkEnded(companyId, checkId)
  notifyRegister(companyId)
  return { ...ended, changeCents: null, giftCard: after }
}

/**
 * A card payment Stripe has CONFIRMED (crm/bar/barTerminal.ts, barOrders.ts), written onto an open check inside the
 * caller's transaction: the money is already taken, so it is recorded even if it now covers more than the balance
 * (nothing else could be paid while the reader held the check — refuseWhileOnReader). The provider's id is unique per
 * company, so the same PaymentIntent can never be written twice. `earn` is decided before the transaction, as above.
 */
async function recordCardInTx(tx: Tx, actor: Actor, checkId: string, p: { tender: 'card_terminal' | 'card_online'; amountCents: number; tipCents: number; providerPaymentId: string; stripeAccount: string | null }, earn: boolean): Promise<{ paymentId: string; fired: boolean }> {
  const companyId = actor.companyId
  await lockOpen(tx, companyId, checkId)
  const [row] = await tx.insert(barCheckPayment).values({
    checkId, tender: p.tender, amountCents: p.amountCents, tipCents: p.tipCents, providerPaymentId: p.providerPaymentId, stripeAccount: p.stripeAccount,
    takenById: actor.id || null, takenByName: actor.name, companyId,
  }).returning({ id: barCheckPayment.id })
  return { paymentId: row.id as string, fired: await closeIfPaid(tx, companyId, checkId, actor, earn) }
}

/**
 * A kiosk or website order as a check (barOrders.ts), inside the caller's transaction: its priced lines go on held, and
 * with a CONFIRMED payment the check closes and its food fires to the grill as one ticket (closeIfPaid) — only then.
 * Without one (the kiosk's pay at the counter) it is an open check on the register, and the food goes when it is paid.
 */
async function checkFromOrderInTx(tx: Tx, by: Actor, o: { kind: 'kiosk' | 'online'; label: string; spot: string | null; note: string | null; lines: OrderLine[] }, payment: { tender: 'card_terminal' | 'card_online'; amountCents: number; tipCents: number; providerPaymentId: string; stripeAccount: string | null } | null): Promise<{ checkId: string; number: number; fired: boolean }> {
  const companyId = by.companyId
  const number = await nextCheckNumber(tx, companyId)
  const [row] = await tx.insert(barCheck).values({ number, kind: o.kind, label: o.label.slice(0, 40), spot: o.spot, note: o.note, openedById: by.id || null, openedByName: by.name, companyId }).returning({ id: barCheck.id })
  for (const l of o.lines) {
    await tx.insert(barCheckItem).values({ checkId: row.id, menuItemId: l.menuItemId, name: l.name, size: l.size, qty: l.qty, unitPriceCents: l.unitPriceCents, note: l.note, toKitchen: l.toKitchen, addedById: by.id || null, addedByName: by.name, companyId })
  }
  const fired = payment ? (await recordCardInTx(tx, by, row.id, payment, false)).fired : false
  return { checkId: row.id as string, number, fired }
}

/**
 * Price one line of a guest's order from the menu as it is now: the item active and not 86'd, a size with a price on
 * file (a guest never types a price), the add-ons this item has. The kiosk and the website both order through this.
 */
async function priceOrderLine(tx: Tx, companyId: string, input: { menuItemId?: unknown; sizeId?: unknown; modifierIds?: unknown; qty?: unknown; note?: unknown }): Promise<OrderLine> {
  const [row] = await tx.select({ item: barMenuItem, section: barMenuSection }).from(barMenuItem)
    .leftJoin(barMenuSection, eq(barMenuSection.id, barMenuItem.sectionId))
    .where(and(eq(barMenuItem.id, String(input.menuItemId || '')), eq(barMenuItem.companyId, companyId))).limit(1)
  if (!row || !row.item.isActive || (row.section && !row.section.isActive)) throw new CheckError('Something in the order is off the menu now. Take it out and try again.', 409)
  if (row.item.is86ed) throw new CheckError(`Sorry, ${row.item.name} just sold out.`, 409)
  if (row.section && !(await servingNow(tx, companyId))(row.section)) throw new CheckError(`Sorry, ${row.section.name} is not being served right now.`, 409)
  const sizes = sizesOf(row.item, row.section?.description)
  const size = sizes.find(s => s.id === input.sizeId) || (sizes.length === 1 ? sizes[0] : null)
  if (!size) throw new CheckError(`Pick a size for ${row.item.name}.`)
  if (size.priceCents === null) throw new CheckError(`${row.item.name} is ordered at the counter.`, 409)
  const mods = pickModifiers(row.item, input.modifierIds)
  if (mods === 'unknown') throw new CheckError(`That add-on is not on ${row.item.name} any more.`, 409)
  const q = Math.floor(Number(input.qty ?? 1))
  if (!Number.isFinite(q) || q < 1 || q > 20) throw new CheckError('Check the quantity.')
  return {
    menuItemId: row.item.id, name: row.item.name, size: size.name === 'Regular' ? null : size.name, qty: q,
    unitPriceCents: size.priceCents + mods.reduce((n, m) => n + m.priceCents, 0),
    note: clean([modifierNote(mods), clean(input.note, 100)].filter(Boolean).join(' · '), 140),
    toKitchen: row.item.toKitchen ?? (row.section?.kind !== 'drink'),
  }
}

/** After a confirmed card payment: tell the grill (when food fired) and the registers. */
function afterCardPayment(companyId: string, fired: boolean): void {
  if (fired) notifyKitchen(companyId)
  notifyRegister(companyId)
}

/** Sell a gift card on this check. It is issued (and its number final) when the check is paid. */
async function addGiftCardLine(actor: Actor, checkId: string, input: { amountCents?: unknown; code?: unknown }): Promise<CheckView> {
  const companyId = actor.companyId
  const cents = Math.round(Number(input.amountCents))
  if (!validAmount(cents)) throw new CheckError(`A gift card is $${MIN_CARD_CENTS / 100} to $${MAX_CARD_CENTS / 100}.`)
  await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    let code: string | null = null
    if (input.code && String(input.code).trim()) {
      code = normalizeCode(String(input.code), await cardPrefix(companyId, tx))
      if (code.length < 6) throw new CheckError('That card number is too short.')
      if (await findCard(companyId, code, tx)) throw new CheckError('That card number is already in use.', 409)
    }
    await tx.insert(barCheckItem).values({ checkId, name: 'Gift card', qty: 1, unitPriceCents: cents, kind: 'giftcard', toKitchen: false, state: 'sent', sentAt: new Date(), note: code, addedById: actor.id, addedByName: actor.name, companyId })
    await tx.update(barCheck).set({ updatedAt: new Date() }).where(eq(barCheck.id, checkId))
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

async function voidPayment(actor: Actor, paymentId: string, reason: string, byName: string): Promise<CheckView> {
  const companyId = actor.companyId
  const checkId = await db.transaction(async (tx: Tx) => {
    const [p] = await tx.select().from(barCheckPayment).where(and(eq(barCheckPayment.id, paymentId), eq(barCheckPayment.companyId, companyId))).limit(1)
    if (!p) throw new CheckError('That payment is gone.', 404)
    await lockOpen(tx, companyId, p.checkId)
    if (p.voidedAt) throw new CheckError('Already voided.', 409)
    // Money Stripe took is on the guest's card: crossing it off here would not give it back. Refund gives it back.
    if (p.providerPaymentId && (p.tender === 'card_terminal' || p.tender === 'card_online')) throw new CheckError('That card payment went through Stripe. Use Refund to give it back to the card.', 409)
    const why = clean(reason, 80)
    if (!why) throw new CheckError('Give a reason.')
    await tx.update(barCheckPayment).set({ voidedAt: new Date(), voidReason: why, voidedByName: byName }).where(eq(barCheckPayment.id, paymentId))
    // Money that came off a gift card goes back on it.
    if (p.tender === 'giftcard' && p.giftCardId) await refundTo(tx, companyId, p.giftCardId, p.amountCents, { checkId: p.checkId, paymentId, byName, note: why })
    return p.checkId as string
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Split by item: the chosen items move to a new check for the same spot. */
async function splitItems(actor: Actor, checkId: string, itemIds: string[], label: string | null): Promise<{ from: CheckView; to: CheckView }> {
  const companyId = actor.companyId
  const toId = await db.transaction(async (tx: Tx) => splitInTx(tx, actor, checkId, itemIds, label))
  notifyRegister(companyId)
  return { from: await getCheck(companyId, checkId), to: await getCheck(companyId, toId) }
}

async function splitInTx(tx: Tx, actor: Actor, checkId: string, itemIds: string[], label: string | null): Promise<string> {
  const companyId = actor.companyId
  const c = await lockOpen(tx, companyId, checkId)
  await refuseWhileOnReader(tx, companyId, checkId)
  const all = await getCheck(companyId, checkId, tx)
  const wanted = new Set(itemIds.slice(0, 100).map(String))
  const movable = all.items.filter(i => wanted.has(i.id) && i.state !== 'void' && i.kind !== 'reward')   // a reward stays with the regular's check
  if (!movable.length) throw new CheckError('Pick what goes on the new check.')
  if (movable.length === all.items.filter(i => i.state !== 'void').length) throw new CheckError('That is everything. Leave it on this check.')
  const remaining = checkTotals(all.items.filter(i => !movable.some(m => m.id === i.id)), all.payments, all.taxRateBps)
  if (remaining.balanceCents < 0) throw new CheckError('This check already has payments that cover those items. Split before paying.', 409)
  const number = await nextCheckNumber(tx, companyId)
  const [n] = await tx.insert(barCheck).values({
    number, kind: c.kind, label: clean(label, 40) || `${c.label} (split)`, spot: c.spot, note: c.note,
    openedById: actor.id, openedByName: actor.name, splitFromId: c.id, contactId: null, companyId,
  }).returning({ id: barCheck.id })
  await tx.update(barCheckItem).set({ checkId: n.id }).where(and(eq(barCheckItem.companyId, companyId), inArray(barCheckItem.id, movable.map(i => i.id))))
  return n.id as string
}

/** Split by seat: every seat after the first goes to its own check ("Booth 2 · Seat 3"). Items with no seat stay. */
async function splitBySeat(actor: Actor, checkId: string): Promise<{ from: CheckView; created: CheckView[] }> {
  const companyId = actor.companyId
  const createdIds = await db.transaction(async (tx: Tx) => {
    const c = await lockOpen(tx, companyId, checkId)
    const items = await tx.select().from(barCheckItem).where(and(eq(barCheckItem.checkId, checkId), eq(barCheckItem.companyId, companyId), eq(barCheckItem.kind, 'item')))
    const live = items.filter((i: any) => i.state !== 'void')
    const seats = [...new Set<number>(live.map((i: any) => i.seat).filter((s: any): s is number => s !== null))].sort((a, b) => a - b)
    if (seats.length < 2) throw new CheckError('Put items on at least two seats first.')
    const ids: string[] = []
    for (const seat of seats.slice(1)) ids.push(await splitInTx(tx, actor, checkId, live.filter((i: any) => i.seat === seat).map((i: any) => i.id), `${c.spot || c.label} · Seat ${seat}`))
    return ids
  })
  notifyRegister(companyId)
  return { from: await getCheck(companyId, checkId), created: await Promise.all(createdIds.map(id => getCheck(companyId, id))) }
}

/** Does voiding this check need a manager? When anything on it has gone to the grill or the bar. */
async function checkNeedsManager(companyId: string, checkId: string): Promise<boolean> {
  const sent = await db.select({ id: barCheckItem.id }).from(barCheckItem).where(and(eq(barCheckItem.checkId, checkId), eq(barCheckItem.companyId, companyId), eq(barCheckItem.state, 'sent'))).limit(1)
  return sent.length > 0
}

/** Void a whole check: only with nothing paid on it. An empty check needs no reason. */
async function voidCheck(actor: Actor, checkId: string, reason: string, byName: string): Promise<CheckView> {
  const companyId = actor.companyId
  await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    await refuseWhileOnReader(tx, companyId, checkId)
    const view = await getCheck(companyId, checkId, tx)
    if (view.totals.paidCents > 0) throw new CheckError('Void its payments first.', 409)
    const why = clean(reason, 80)
    if (!why && view.items.length) throw new CheckError('Give a reason.')
    await tx.update(barCheck).set({ status: 'void', voidReason: why || 'empty', closedAt: new Date(), closedById: actor.id, closedByName: byName, updatedAt: new Date() }).where(eq(barCheck.id, checkId))
  })
  await checkEnded(companyId, checkId)
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Rename or move a check ("Mike" → "Booth 3"). */
async function renameCheck(actor: Actor, checkId: string, input: { label?: string | null; spot?: string | null; note?: string | null }): Promise<CheckView> {
  const companyId = actor.companyId
  await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (input.label !== undefined) { const l = clean(input.label, 40); if (!l) throw new CheckError('A check needs a name.'); set.label = l }
    if (input.spot !== undefined) set.spot = clean(input.spot, 40)
    if (input.note !== undefined) set.note = clean(input.note, 200)
    await tx.update(barCheck).set(set).where(eq(barCheck.id, checkId))
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Put a guest (a CRM contact of this company) on the check, or take them off with null. */
async function attachGuest(actor: Actor, checkId: string, contactId: string | null): Promise<CheckView> {
  const companyId = actor.companyId
  await db.transaction(async (tx: Tx) => {
    await lockOpen(tx, companyId, checkId)
    if (contactId) {
      const [g] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
      if (!g) throw new CheckError('That guest is gone.', 404)
    }
    // A reward on the check is the guest's: take it off before taking them (or swapping them) off.
    const [reward] = await tx.select({ id: barCheckItem.id }).from(barCheckItem).where(and(eq(barCheckItem.checkId, checkId), eq(barCheckItem.companyId, companyId), eq(barCheckItem.kind, 'reward'))).limit(1)
    if (reward) throw new CheckError('Take the reward off first.', 409)
    await tx.update(barCheck).set({ contactId, updatedAt: new Date() }).where(eq(barCheck.id, checkId))
  })
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

// ─── The Regulars at the register ────────────────────────────────────────────
/** Spend a reward on this check: a negative line worth what the engine says, and the points off the guest. One per check. */
async function redeemReward(actor: Actor, checkId: string, rewardId: string): Promise<CheckView> {
  const companyId = actor.companyId
  if (!(await loyaltyRunning(companyId))) throw new CheckError('The Regulars program is switched off.', 403)
  try {
    await db.transaction(async (tx: Tx) => {
      const c = await lockOpen(tx, companyId, checkId)
      if (!c.contactId) throw new CheckError('Put a regular on the check first.')
      const items = await tx.select().from(barCheckItem).where(and(eq(barCheckItem.checkId, checkId), eq(barCheckItem.companyId, companyId)))
      if (items.some((i: any) => i.kind === 'reward' && i.state !== 'void')) throw new CheckError('One reward per check.', 409)
      const [r] = await tx.select().from(loyaltyReward).where(and(eq(loyaltyReward.id, rewardId), eq(loyaltyReward.companyId, companyId))).limit(1)
      if (!r) throw new CheckError('That reward is gone.', 404)
      const m = await ensureMember(tx, companyId, c.contactId, actor.name)
      const [locked] = await tx.select().from(loyaltyMember).where(eq(loyaltyMember.id, m.id)).limit(1).for('update')
      const reward: Reward = { id: r.id, name: r.name, pointsCost: r.pointsCost, type: r.type as Reward['type'], value: r.valueCents, itemId: r.menuItemId, active: r.active }
      const basket = basketFor(items, r)
      const ok = canRedeem(reward, locked.pointsBalance, basket, BAR_WORDS)
      if (!ok.ok) throw new CheckError(ok.reason || 'That reward cannot be used on this check.')
      const off = rewardDiscountCents(reward, basket)
      const after = locked.pointsBalance - r.pointsCost
      await tx.insert(barCheckItem).values({ checkId, name: r.name, qty: 1, unitPriceCents: -off, kind: 'reward', toKitchen: false, state: 'sent', sentAt: new Date(), note: 'Regulars reward', addedById: actor.id, addedByName: actor.name, companyId })
      await tx.update(loyaltyMember).set({ pointsBalance: after, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(loyaltyMember.id, m.id))
      await tx.insert(loyaltyTransaction).values({ companyId, memberId: m.id, type: 'redeem', points: -r.pointsCost, balanceAfter: after, description: `${r.name} · check #${c.number}`, checkId, rewardId: r.id, createdBy: actor.name })
      await rewardUsedOnce(tx, r.id)
      await tx.update(barCheck).set({ updatedAt: new Date() }).where(eq(barCheck.id, checkId))
    })
  } catch (e) {
    if (e instanceof LoyaltyError) throw new CheckError(e.message, e.status)
    throw e
  }
  notifyRegister(companyId)
  return getCheck(companyId, checkId)
}

/** Take a reward off an open check: the line goes, the points come back (a reversal on the ledger). */
async function unredeemInTx(tx: Tx, companyId: string, line: typeof barCheckItem.$inferSelect, byName: string): Promise<void> {
  await tx.delete(barCheckItem).where(eq(barCheckItem.id, line.id))
  const txs = await tx.select().from(loyaltyTransaction).where(and(eq(loyaltyTransaction.companyId, companyId), eq(loyaltyTransaction.checkId, line.checkId))).orderBy(desc(loyaltyTransaction.createdAt))
  const spent = txs.find((t: any) => t.type === 'redeem')
  // Redeemed, then taken off, then redeemed again: only an un-reversed redeem is put back.
  const net = txs.filter((t: any) => t.type === 'redeem' || t.type === 'reversal').reduce((s: number, t: any) => s + t.points, 0)
  if (!spent || net >= 0) return
  const [locked] = await tx.select().from(loyaltyMember).where(eq(loyaltyMember.id, spent.memberId)).limit(1).for('update')
  const back = -spent.points
  await tx.update(loyaltyMember).set({ pointsBalance: locked.pointsBalance + back, updatedAt: new Date() }).where(eq(loyaltyMember.id, spent.memberId))
  await tx.insert(loyaltyTransaction).values({ companyId, memberId: spent.memberId, type: 'reversal', points: back, balanceAfter: locked.pointsBalance + back, description: 'Reward taken off the check', checkId: line.checkId, rewardId: spent.rewardId, createdBy: byName })
  if (spent.rewardId) await rewardUseTakenBack(tx, spent.rewardId)
}

return {
  notifyRegister, taxRateBps, getCheck, listOpen, listRecentClosed, menuForRegister, openCheck, addItem, updateItem, itemNeedsManager,
  voidItem, sendCheck, addPayment, addGiftCardLine, voidPayment, splitItems, splitBySeat, checkNeedsManager, voidCheck, renameCheck,
  attachGuest, redeemReward, recordCardInTx, afterCardPayment, checkFromOrderInTx, priceOrderLine, hooks, checkEnded,
}
}
export type BarRegister = ReturnType<typeof createBarRegister>
