// Primitives the shared invoicing pages render with. Self-contained and theme-aware (light + dark via
// the `dark` class), so the pages look and behave the same in every CRM regardless of what that
// template's own DataTable/Modal do.
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, ChevronLeft, ChevronRight, X } from 'lucide-react'

// ---------------------------------------------------------------- formatting
export const money = (n: unknown) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return '$0.00'
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '-$' : '$') + s
}
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** A date-only value ("2026-09-20" or an ISO midnight) shown as the calendar day it names, not the viewer's UTC offset. */
export const dateOnly = (v: unknown) => {
  if (!v) return '-'
  const s = String(v)
  const day = s.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}/.test(day)) return s
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString()
}
export const dateTime = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : '-')
/**
 * The calendar day an INSTANT falls on, read on the reader's own clock.
 *
 * dateOnly() above takes the first ten characters, which is right for a value that names a day —
 * a due date, an issue date — and wrong for a timestamp, because those ten characters are the UTC day.
 * A document uploaded at 20:18 on the 19th is stored 2026-09-20T01:18Z and was listed as 9/20/2026:
 * the date shown was a day the salon had not reached yet. Anything with a time in it belongs here.
 * (Salon T23)
 */
export const instantDay = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString() : '-')
/** Calendar-day comparison for "past due": the due day has to be over in the viewer's zone. */
export const isPastDay = (v: unknown) => {
  if (!v) return false
  const day = String(v).slice(0, 10)
  const [y, m, d] = day.split('-').map(Number)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return end.getTime() < Date.now()
}
/** Same rule as the server: tax on the post-discount amount, discount clamped, whole cents. */
export const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) => {
  const subtotal = round2(items.reduce((s, i) => s + Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.unitPrice) || 0), 0))
  const effectiveDiscount = round2(Math.min(Math.max(0, Number(discount) || 0), subtotal))
  const taxable = Math.max(0, subtotal - effectiveDiscount)
  const taxAmount = round2(taxable * (Math.max(0, Number(taxRate) || 0) / 100))
  return { subtotal, effectiveDiscount, taxAmount, total: round2(subtotal - effectiveDiscount + taxAmount), discountTooBig: Number(discount) > subtotal + 0.005 }
}
/**
 * What the server will refuse, in the server's words (invoicing lineItemSchema / invoiceSchema), so the
 * form can say it before sending and never send it. A negative is shown as typed and named — it is
 * never quietly turned into a positive amount.
 */
export const moneyInputError = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number): string | null => {
  // EVERY problem, not just the first. This used to return on the first match, and the tax rate is
  // checked before the discount — so a form holding a 150% tax rate AND a discount of −999 reported only
  // the tax rate, and the discount was silent until the first was fixed. Fixing a form one hidden error
  // at a time is the complaint. (Field Service T26 L3)
  const problems: string[] = []
  const add = (m: string) => { if (!problems.includes(m)) problems.push(m) }
  for (const li of items) {
    if (Number(li.quantity) < 0) add('Quantity cannot be negative')
    if (Number(li.quantity) === 0) add('Quantity must be more than zero')
    if (Number(li.unitPrice) < 0) add('Price cannot be negative')
  }
  if (Number(taxRate) < 0 || Number(taxRate) > 100) add('Tax rate must be between 0 and 100')
  if (Number(discount) < 0) add('Discount cannot be negative')
  return problems.length ? problems.join(' · ') : null
}
/**
 * What a refund does to THIS invoice's balance — the two halves of the refund model (invoicing/money.ts
 * invoiceBalance), said before the owner records one. A fully paid sale stays paid and a refund never
 * reopens a balance; a part-paid invoice owes the refunded amount again (a returned deposit reopens
 * what is still due). The old one-size sentence read as "re-billing" on a part-paid invoice (events T15 B2).
 */
export const refundEffectNote = (total: unknown, amountPaid: unknown): string => {
  const fullyPaid = Number(amountPaid || 0) >= (Number(total) || 0) - 0.005
  return fullyPaid
    ? 'This sale is paid in full: the refund is recorded on its own line and never reopens a balance.'
    : 'This invoice is part-paid: the refunded amount is owed again, so the balance due goes up by what you refund. To lower what the client owes without returning money, use Apply credit on the invoice instead.'
}
/**
 * The balance due after a credit of `credit` (taken off the price, before tax — the same field as the
 * discount) — mirrors applyInvoiceCredit + invoiceBalance on the server, so the modal shows the result
 * before it is applied.
 */
export const balanceAfterCredit = (inv: { lineItems?: { quantity: any; unitPrice: any }[]; taxRate?: any; discount?: any; amountPaid?: any; amountRefunded?: any }, credit: number) => {
  const lines = (inv.lineItems || []).map((li) => ({ quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
  const total = calcTotals(lines, Number(inv.taxRate) || 0, round2((Number(inv.discount) || 0) + (Number(credit) || 0))).total
  const paid = Number(inv.amountPaid || 0), refunded = Number(inv.amountRefunded || 0)
  if (total > 0 && refunded >= total - 0.005) return 0
  if (paid >= total - 0.005) return 0
  return round2(Math.max(0, total - (paid - refunded)))
}
export const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/**
 * A number field that keeps what the user is typing. A controlled <input type="number"> whose value is
 * rewritten on every keystroke turns "-" into "0" and "-50" into "050" — the #140 clamp did exactly that
 * (T15 M6). The text stays the user's; the value is reported only when the text is a finite number
 * (blank reports 0), and a bad value is refused at save time by moneyInputError, never rewritten.
 */
export function NumberInput({ value, onValue, ...rest }: { value: number; onValue: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(String(value))
  const reported = useRef(value)
  // A change from outside (form reset, an edit opened) replaces the text; the user's own edits never do.
  useEffect(() => { if (value !== reported.current) { reported.current = value; setText(String(value)) } }, [value])
  return (
    <input
      type="number"
      {...rest}
      value={text}
      onChange={e => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') { reported.current = 0; onValue(0); return }
        const n = Number(t)
        if (Number.isFinite(n)) { reported.current = n; onValue(n) }
      }}
    />
  )
}

/** Authenticated file download (PDFs). A plain <a href> would hit the API without the bearer token. */
export async function downloadFile(path: string, filename: string) {
  let token = ''
  try { token = localStorage.getItem('accessToken') || localStorage.getItem('token') || '' } catch { /* no storage */ }
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body?.error || `Could not download (${res.status})`) }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ---------------------------------------------------------------- badges + buttons
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  viewed: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  refunded: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  void: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  declined: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  expired: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  // online booking
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  no_show: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  // jobs
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  dispatched: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  en_route: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  on_hold: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  // contact types
  lead: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  client: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  customer: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  subcontractor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  vendor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
}
// `status` picks the colour and is the default text; `label` overrides the text where the vertical calls the
// same value something else — a clinic's "client" is an Owner. (T24 M11)
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>{(label || status).replace(/_/g, ' ')}</span>
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'warn'
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-orange-500 text-white hover:bg-orange-600',
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50',
  success: 'bg-green-500 text-white hover:bg-green-600',
  warn: 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50',
}
export function Button({ variant = 'primary', className = '', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return <button {...rest} className={`px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${BTN[variant]} ${className}`}>{children}</button>
}

/**
 * In-app link. Uses the router's navigate() rather than react-router's <Link> component: the vendored
 * copy of this package type-checks against the template's own @types/react, and a component imported
 * from a second react-router install fails JSX typing (TS2786) while a hook does not.
 */
export function NavLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  return <a href={to} className={className} onClick={e => { if (e.metaKey || e.ctrlKey || e.button !== 0) return; e.preventDefault(); navigate(to) }}>{children}</a>
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------- form controls
// The look of a control, minus the two things callers routinely try to override. Width and padding are NOT
// part of the skin, because appending a Tailwind utility cannot beat one already on the element: the sheet
// emits .w-auto before .w-full and .py-1.5 before .py-2, so the later rule wins whatever order the class
// names are written in. `${inputCls} w-auto` therefore rendered FULL width — which squeezed the search box
// sitting beside it down to 54px (vet T12 M1, every CRM) — and `${inputCls} py-1.5` was quietly ignored.
// Compose a control from the variants below instead of appending a width or a padding to one.
const controlSkin = 'border rounded-lg bg-white text-gray-900 border-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:placeholder-slate-500'
/** Fills its column — the usual form field. */
export const inputCls = `w-full px-3 py-2 ${controlSkin}`
/** Sizes to its content: a filter or dropdown standing next to something else. */
export const selectCls = `w-auto px-3 py-2 ${controlSkin}`
/** Content-sized and tighter, for a dense inline row. */
export const controlCompactCls = `w-auto px-3 py-1.5 ${controlSkin}`
/** No width of its own, for a caller that sets one (a narrow number stepper). */
export const controlNoWidthCls = `px-3 py-2 ${controlSkin}`
export const labelCls = 'block text-sm font-medium mb-1 text-gray-700 dark:text-slate-300'
export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return <div><label className={labelCls}>{label}</label>{children}{hint && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{hint}</p>}</div>
}

// ---------------------------------------------------------------- modal
export function Modal({ isOpen, onClose, title, children, size = 'md' }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey) }
  }, [isOpen, onClose])
  if (!isOpen) return null
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={`relative w-full ${width} bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl`}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-slate-200" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = true }: { isOpen: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; message: string; confirmText?: string; danger?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-700 dark:text-slate-300">{message}</p>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }}>{confirmText}</Button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- table
// title: what a truncated cell shows on hover. A plain column needs nothing — the cell text IS the value —
// but a column that renders its own markup must say, because what it displays may not be the raw field.
export interface Column<T> { key: string; label: string; className?: string; render?: (value: any, row: T) => React.ReactNode; title?: (row: T) => string | undefined }
export interface RowAction<T> { label: string; icon?: React.ComponentType<{ className?: string }>; onClick: (row: T) => void; className?: string; show?: (row: T) => boolean }
export interface Pagination { page: number; limit: number; total: number; pages: number }

export function DataTable<T extends { id: string }>({ data, columns, loading, pagination, onPageChange, onRowClick, actions = [], emptyMessage = 'Nothing here yet.' }: {
  data: T[]; columns: Column<T>[]; loading?: boolean; pagination?: Pagination | null; onPageChange?: (p: number) => void; onRowClick?: (row: T) => void; actions?: RowAction<T>[]; emptyMessage?: string
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; anchor: HTMLElement } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    // The menu is position:fixed, so it must close when its anchor moves — i.e. when the document or a
    // scroll container ABOVE the anchor scrolls. Scroll events from unrelated elements (a search input
    // scrolling its own text back on blur, another panel) must not close it.
    const onScroll = (e: Event) => { const t = e.target as Node | Document; if (t !== document && !(t as Node).contains?.(menu.anchor)) return; setMenu(null) }
    document.addEventListener('mousedown', close); window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [menu])
  const menuRow = menu ? data.find(r => r.id === menu.id) : undefined
  const visible = menuRow ? actions.filter(a => !a.show || a.show(menuRow)) : []
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr>
              {columns.map(c => <th key={c.key} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 ${c.className || ''}`}>{c.label}</th>)}
              {actions.length > 0 && <th className="w-12" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {loading && <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-500 dark:text-slate-400">Loading…</td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-500 dark:text-slate-400">{emptyMessage}</td></tr>}
            {!loading && data.map(row => (
              <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`text-gray-900 dark:text-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800' : ''}`}>
                {/* Bound cell content so one pathological value (e.g. a 300-char contact name) neither
                    stretches its column off-screen nor wraps the row to twice the height of every other
                    row — it ellipsises at the cap, with the full value on hover and on the detail page.
                    [&_p]:truncate reaches the stacked name/company lines the column renderers produce;
                    the wrapper itself handles plain text and links. Normal content is far under the cap,
                    so ordinary tables look exactly as before. (Vet T12 M2) */}
                {columns.map(c => {
                  const raw = (row as any)[c.key]
                  const full = c.title ? c.title(row)
                    : !c.render && (typeof raw === 'string' || typeof raw === 'number') ? String(raw)
                    : undefined
                  return (
                    <td key={c.key} className={`px-4 py-3 ${c.className || ''}`}>
                      <div title={full} className="max-w-[480px] truncate [&_p]:truncate">{c.render ? c.render(raw, row) : String(raw ?? '-')}</div>
                    </td>
                  )
                })}
                {actions.length > 0 && (
                  <td className="px-2 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button aria-label="Row actions" aria-haspopup="menu" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu(menu?.id === row.id ? null : { id: row.id, x: r.right, y: r.bottom, anchor: e.currentTarget as HTMLElement }) }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-slate-200 dark:hover:bg-slate-800"><MoreVertical className="w-4 h-4" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {menu && menuRow && visible.length > 0 && (
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: menu.y + 4, left: Math.max(8, menu.x - 192) }} className="z-50 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl py-1">
          {visible.map(a => <button key={a.label} role="menuitem" onClick={() => { setMenu(null); a.onClick(menuRow) }} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 ${a.className || ''}`}>{a.icon && <a.icon className="w-4 h-4" />}{a.label}</button>)}
        </div>
      )}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-800 text-sm text-gray-600 dark:text-slate-400">
          <span>Page {pagination.page} of {pagination.pages} · {pagination.total} total</span>
          <div className="flex gap-2">
            <button disabled={pagination.page <= 1} onClick={() => onPageChange?.(pagination.page - 1)} className="p-1.5 rounded border border-gray-300 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={pagination.page >= pagination.pages} onClick={() => onPageChange?.(pagination.page + 1)} className="p-1.5 rounded border border-gray-300 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- line item editor (shared by invoices + quotes)
export function LineItemsEditor({ items, onChange }: { items: { description: string; quantity: number; unitPrice: number }[]; onChange: (items: { description: string; quantity: number; unitPrice: number }[]) => void }) {
  const update = (i: number, patch: Partial<{ description: string; quantity: number; unitPrice: number }>) => onChange(items.map((li, idx) => (idx === i ? { ...li, ...patch } : li)))
  const lineError = moneyInputError(items, 0, 0)
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-x-auto">
      {/*
        A money field has a width below which it stops being usable, and w-24 / w-36 are hints, not
        floors: inside `w-full` on a phone the columns compressed until Qty and Unit Price were 31-36px —
        wide enough to show two characters of a price someone is trying to check. `overflow-hidden` meant
        the row had nowhere to go, so it crushed instead of scrolling. The table now has a minimum width
        and this frame scrolls sideways when it will not fit: desktop unchanged, and a phone gets a table
        it can push around rather than boxes it cannot type in. (Field Service T30, phone width)
      */}
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-300"><tr><th className="px-3 py-2 text-left text-xs font-medium">Description</th><th className="px-3 py-2 text-left text-xs font-medium w-24">Qty</th><th className="px-3 py-2 text-left text-xs font-medium w-36">Unit Price</th><th className="px-3 py-2 text-right text-xs font-medium w-32">Total</th><th className="w-10" /></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
          {items.map((li, i) => (
            <tr key={i}>
              <td className="px-3 py-2"><input value={li.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" className={inputCls} /></td>
              <td className="px-3 py-2"><NumberInput min="0" step="0.01" aria-label="Quantity" value={li.quantity} onValue={n => update(i, { quantity: n })} className={inputCls} /></td>
              <td className="px-3 py-2"><NumberInput min="0" step="0.01" aria-label="Unit price" value={li.unitPrice} onValue={n => update(i, { unitPrice: n })} className={inputCls} /></td>
              <td className="px-3 py-2 text-right text-gray-900 dark:text-slate-100">{money(round2((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0)))}</td>
              <td className="px-1"><button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="p-1 text-red-500 hover:text-red-700" aria-label="Remove line"><X className="w-4 h-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {lineError && <p role="alert" className="px-3 py-1 text-xs text-red-600 dark:text-red-300 border-t border-gray-200 dark:border-slate-700">{lineError}</p>}
      <div className="p-2 border-t border-gray-200 dark:border-slate-700"><button type="button" onClick={() => onChange([...items, { description: '', quantity: 1, unitPrice: 0 }])} className="text-sm text-orange-600 hover:text-orange-700 dark:hover:text-orange-200">+ Add line</button></div>
    </div>
  )
}

/**
 * The running total for a document being edited.
 *
 * When the figures it was given cannot make a document, it stops quoting them. A tax rate of 150 is
 * refused by the server (taxRate is 0-100), and this box went on presenting a $100 line as "Tax (150%)
 * $150.00 / Total $250.00" with the warning underneath — a total nobody can ever save, printed in the
 * same bold as a real one, which is a worse answer than no answer. The warning is the only thing worth
 * reading at that point, so the money reads "—" until the input is something the document could be made
 * from. (Field Service T26 L4)
 */
export function TotalsBox({ subtotal, discount, taxRate, taxAmount, total, warning }: { subtotal: number; discount: number; taxRate: number; taxAmount: number; total: number; warning?: string }) {
  const show = (n: number) => (warning ? '—' : money(n))
  return (
    <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-4 text-sm text-right space-y-1 text-gray-800 dark:text-slate-200">
      <p>Subtotal <span className="font-medium ml-2">{show(subtotal)}</span></p>
      {discount > 0 && <p>Discount <span className="font-medium ml-2">{warning ? '—' : `-${money(discount)}`}</span></p>}
      <p>Tax ({taxRate}%) <span className="font-medium ml-2">{show(taxAmount)}</span></p>
      <p className="text-lg font-bold">Total <span className="ml-2">{show(total)}</span></p>
      {warning && <p className="text-xs text-red-600 dark:text-red-300 text-right">{warning}</p>}
    </div>
  )
}

export const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'other', label: 'Other' },
]
