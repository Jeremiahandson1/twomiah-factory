/**
 * THE TRADE KIT — the phone's screens for salon, restaurant, bar, store and vet, written as DATA (pure: no React, no native
 * modules), so the screen engine draws them, tests/mobile holds every one to the standing rules, and the server tests run the very
 * same requests against a real tenant.
 *
 * Standing rules a spec cannot break (tests/mobile/trade-screens.test.ts reads every spec):
 *   · a spec names the permission its seat needs (`any`) — a seat without it never sees the screen;
 *   · an action names the permission the SERVER checks for the same call, and a risky one asks first (`confirm`);
 *   · no card taking, refunds, register, kiosk, gift cards or payment keys: no action's path may touch them (FORBIDDEN below);
 *   · the figures are the server's: a field whose value the server left out (money a seat may not see) is simply not drawn.
 */
import type { Req } from '../home/tiles'

export const FORBIDDEN = /(refund|charge|checkout|\/pos\b|register|kiosk|gift-?card|stripe|square|payment-?key|terminal|card-?reader)/i

/** Rows the lists loaded, by `spec:id` — a detail with no fetch of its own (the server has no single-row read) draws from here. */
export const rowCache = new Map<string, any>()
export interface Row { open?: { spec: string; id: string }; key: string; title: string; subtitle?: string; meta?: string; badge?: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
export interface Field { label: string; get: (d: any) => string | undefined | null; money?: boolean }
export interface Link { label: string; url: string; icon?: string }
export interface Section { /** tap to call / text / email */ links?: (d: any) => Link[]; title?: string; fields?: Field[]; /** a list inside the detail (lines of a menu, visits, vaccines …) */ rows?: (d: any) => Row[]; empty?: string }
export interface Input {
  id: string; label: string; kind?: 'text' | 'number' | 'multiline' | 'choice'; choices?: string[]; required?: boolean; initial?: (d: any) => string
  /** Choices the SERVER offers for this row (the carrier's rates): fetched when the sheet opens; the person picks a label, the call gets its value. */
  options?: { path: (d: any) => string; label: (r: any) => string; value: (r: any) => string; none: string }
}
export interface Action {
  id: string
  label: string
  icon?: string
  /** The permission the server checks for this call (one of them). */
  any: string[]
  /** Offer the action only when this holds for the row. */
  when?: (d: any) => boolean
  /** Ask first: a sheet with these words and a confirm button. */
  confirm?: { title: string; body: (d: any) => string; button: string }
  inputs?: Input[]
  /** DELETE only for taking a row off a list that is the business's own (a waitlist entry), and always with `confirm`. */
  request: (d: any, values: Record<string, string>) => { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: any }
  done: string
}
export interface Chip { id: string; label: string; query: Record<string, string> }
export interface ScreenSpec {
  id: string
  title: string
  any: string[]
  feature?: string
  /** The list. `{q}` in a query value is the search text. */
  list: Req
  rows: (r: any, ctx: { userId?: string }) => Row & { id: string }
  /** Where the rows are in the answer, when it is not `data` / a bare array (the bar's routes answer { stock: [...] }). */
  pick?: (body: any) => any[]
  /** One record, no list: the screen is the detail itself (Tonight). `detail.path` ignores the id. */
  single?: boolean
  chips?: Chip[]
  search?: { param: string; placeholder: string }
  empty: { title: string; body: string }
  detail?: {
    /** The request for one row; null: the list's own row is the record (it is kept in rowCache). */
    path: (id: string) => string | null
    /** More requests merged in as `d._also[key]` (a client chart's formulas). */
    also?: Record<string, (id: string) => string>
    title: (d: any) => string
    subtitle?: (d: any) => string | undefined
    badge?: (d: any) => string | undefined
    sections: Section[]
    actions?: Action[]
  }
  /** Actions on the list itself (e.g. "Start a count"). */
  actions?: Action[]
  /** A "+" in the header that opens a form screen of its own (an expense with its receipt photo), for a seat with `any`. */
  create?: { label: string; route: string; any: string[] }
}
/** A chip's day, worked out when the list loads (a chip's query is fixed data): {dayStart} / {dayEnd} are today's start and
 *  end on this phone's clock, {weekEnd} the end of the seventh day — as instants, the bookings list's from/to. */
export const fillDates = (query: Record<string, string>, now = new Date()): Record<string, string> => {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = (days: number) => new Date(start.getTime() + days * 86_400_000 - 1).toISOString()
  const values: Record<string, string> = { '{dayStart}': start.toISOString(), '{dayEnd}': end(1), '{weekEnd}': end(7) }
  return Object.fromEntries(Object.entries(query).map(([k, v]) => [k, values[v] ?? v]))
}
export const unwrap = (b: any) => (b && typeof b === 'object' && 'data' in b && !Array.isArray(b.data) && b.data && typeof b.data === 'object' ? b.data : b)
export const words = (s: unknown) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
export const money = (v: unknown) => (v == null || v === '' ? undefined : `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const dayTime = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
export const clock = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
export const dayOnly = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
export const join = (...p: Array<string | undefined | null | false>) => p.filter(Boolean).join(' · ') || undefined
export const mayUse = (s: { any: string[]; feature?: string }, can: (p: string) => boolean, has: (f: string) => boolean) =>
  (!s.any.length || s.any.some((p) => can(p))) && (!s.feature || has(s.feature))
/** A calendar day ('YYYY-MM-DD') in words, never through the viewer's time zone ("Fri, Nov 20"). */
export const calDay = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); if (!m) return undefined; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
/** '19:30' → '7:30 PM'. */
export const hhmm = (v: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '')); if (!m) return undefined; const h = +m[1]; return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }
