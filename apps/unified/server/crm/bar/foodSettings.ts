// Food service's settings, one JSON column on the bar's settings row (bar_settings.food_service): the card reader's
// tipping and the Stripe Terminal location it hangs off, whether the register opens long tabs, the kiosk, online
// ordering (paused, lead time) and the business's DoorDash and Uber Eats store links. Read with every default filled
// in; written field by field, each value checked here (Register Settings, crm/pages/bar/FoodSettingsPage.tsx).
//
// Offline card payments are deliberately NOT a setting: Stripe's server-driven readers take a card only while the
// reader reaches Stripe. Stripe offers offline collection to apps built on its Terminal mobile SDKs, which this is not,
// so the Settings page says so plainly instead of offering a switch that would do nothing.
import { eq } from 'drizzle-orm'
import { barSettings } from '../../db/schema/index.ts'
import type { BarDb } from './db.ts'

export interface FoodSettings {
  terminal: {
    /** The reader asks the guest for a tip (Stripe Terminal on-reader tipping, set on the location's configuration). */
    tipping: boolean
    /** The Stripe Terminal location the readers are registered to, and the connected account it is on. */
    locationId: string | null
    locationAccount: string | null
    configurationId: string | null
    /** A card tab open longer than this is released by itself (parity row 14, Toast's pre-auth settings): 1 to 168 hours. */
    tabHoldHours: number
  }
  /** The register opens long tabs ("Mike's tab"). A bar's yes; a restaurant or a truck rings walk-ups and tables. */
  tabs: boolean
  kiosk: {
    /** With no card reader (or as well as one), the guest may order and pay at the counter. */
    payAtCounter: boolean
    /** Back to the welcome screen after this long untouched. */
    idleSeconds: number
    /** The kiosk asks for a table number as well as a name. */
    askTable: boolean
  }
  ordering: {
    /** Online orders stop at once (the website says so) until switched back on. */
    paused: boolean
    /** The soonest a pickup can be, from now. */
    leadMinutes: number
  }
  delivery: { doordashUrl: string | null; ubereatsUrl: string | null }
}

export class FoodSettingsError extends Error { constructor(message: string, public status = 400) { super(message) } }

export function foodDefaults(opts: { tabs?: boolean } = {}): FoodSettings {
  return {
    terminal: { tipping: false, locationId: null, locationAccount: null, configurationId: null, tabHoldHours: 24 },
    tabs: opts.tabs ?? true,
    kiosk: { payAtCounter: true, idleSeconds: 90, askTable: false },
    ordering: { paused: false, leadMinutes: 20 },
    delivery: { doordashUrl: null, ubereatsUrl: null },
  }
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const int = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d }
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The stored JSON, with every default filled in and anything malformed set back to its default. */
export function readFoodSettings(raw: unknown, defaults: FoodSettings): FoodSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as any
  const t = s.terminal || {}, k = s.kiosk || {}, o = s.ordering || {}, dl = s.delivery || {}
  return {
    terminal: {
      tipping: bool(t.tipping, defaults.terminal.tipping), locationId: strOrNull(t.locationId), locationAccount: strOrNull(t.locationAccount), configurationId: strOrNull(t.configurationId),
      tabHoldHours: int(t.tabHoldHours, defaults.terminal.tabHoldHours, 1, 168),
    },
    tabs: bool(s.tabs, defaults.tabs),
    kiosk: { payAtCounter: bool(k.payAtCounter, defaults.kiosk.payAtCounter), idleSeconds: int(k.idleSeconds, defaults.kiosk.idleSeconds, 30, 600), askTable: bool(k.askTable, defaults.kiosk.askTable) },
    ordering: { paused: bool(o.paused, defaults.ordering.paused), leadMinutes: int(o.leadMinutes, defaults.ordering.leadMinutes, 5, 240) },
    delivery: { doordashUrl: deliveryUrl('doordash', dl.doordashUrl) ?? null, ubereatsUrl: deliveryUrl('ubereats', dl.ubereatsUrl) ?? null },
  }
}

/** The domains each delivery company's store pages are on. DoorDash's own-site storefronts are order.online. */
const DELIVERY_HOSTS: Record<'doordash' | 'ubereats', string[]> = { doordash: ['doordash.com', 'order.online'], ubereats: ['ubereats.com'] }
export const DELIVERY_NAMES: Record<'doordash' | 'ubereats', string> = { doordash: 'DoorDash', ubereats: 'Uber Eats' }

/** A store link on that company's own domain (https, the domain or a subdomain of it), or null when it is not one. */
export function deliveryUrl(company: 'doordash' | 'ubereats', v: unknown): string | null {
  const s = strOrNull(v)
  if (!s || s.length > 500) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  return DELIVERY_HOSTS[company].some((d) => host === d || host.endsWith('.' + d)) ? u.toString() : null
}

/** What the owner may change from Register Settings (the Stripe ids are the terminal's to write, never typed). */
export function applyFoodPatch(cur: FoodSettings, b: Record<string, any>): FoodSettings {
  const next: FoodSettings = JSON.parse(JSON.stringify(cur))
  if (b.tabs !== undefined) { if (typeof b.tabs !== 'boolean') throw new FoodSettingsError('Tabs is on or off.'); next.tabs = b.tabs }
  // The tab window is the owner's to type; the rest of `terminal` (tipping, the Stripe ids) is the terminal's to write.
  if (b.terminal && typeof b.terminal === 'object' && b.terminal.tabHoldHours !== undefined) {
    const n = Math.round(Number(b.terminal.tabHoldHours))
    if (!Number.isFinite(n) || n < 1 || n > 168) throw new FoodSettingsError('A card tab is released by itself after 1 to 168 hours.')
    next.terminal.tabHoldHours = n
  }
  if (b.kiosk && typeof b.kiosk === 'object') {
    if (b.kiosk.payAtCounter !== undefined) next.kiosk.payAtCounter = !!b.kiosk.payAtCounter
    if (b.kiosk.askTable !== undefined) next.kiosk.askTable = !!b.kiosk.askTable
    if (b.kiosk.idleSeconds !== undefined) {
      const n = Math.round(Number(b.kiosk.idleSeconds))
      if (!Number.isFinite(n) || n < 30 || n > 600) throw new FoodSettingsError('The kiosk goes back to the start after 30 to 600 seconds.')
      next.kiosk.idleSeconds = n
    }
  }
  if (b.ordering && typeof b.ordering === 'object') {
    if (b.ordering.paused !== undefined) next.ordering.paused = !!b.ordering.paused
    if (b.ordering.leadMinutes !== undefined) {
      const n = Math.round(Number(b.ordering.leadMinutes))
      if (!Number.isFinite(n) || n < 5 || n > 240) throw new FoodSettingsError('The soonest pickup is 5 to 240 minutes away.')
      next.ordering.leadMinutes = n
    }
  }
  if (b.delivery && typeof b.delivery === 'object') {
    for (const k of ['doordash', 'ubereats'] as const) {
      const key = k === 'doordash' ? 'doordashUrl' : 'ubereatsUrl'
      if (b.delivery[key] === undefined) continue
      if (b.delivery[key] === null || String(b.delivery[key]).trim() === '') { next.delivery[key] = null; continue }
      const ok = deliveryUrl(k, b.delivery[key])
      if (!ok) throw new FoodSettingsError(`That is not ${k === 'ubereats' ? 'an' : 'a'} ${DELIVERY_NAMES[k]} link. Paste your store's address from ${DELIVERY_HOSTS[k][0]} (it starts with https://).`)
      next.delivery[key] = ok
    }
  }
  return next
}

export function createFoodSettings(db: BarDb, defaults: FoodSettings) {
  async function read(companyId: string, tx: any = db): Promise<FoodSettings> {
    const [row] = await tx.select({ foodService: barSettings.foodService }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    return readFoodSettings(row?.foodService, defaults)
  }
  async function write(companyId: string, next: FoodSettings): Promise<FoodSettings> {
    await db.insert(barSettings).values({ companyId, foodService: next })
      .onConflictDoUpdate({ target: barSettings.companyId, set: { foodService: next, updatedAt: new Date() } })
    return read(companyId)
  }
  return { read, write, defaults }
}
export type FoodSettingsStore = ReturnType<typeof createFoodSettings>
