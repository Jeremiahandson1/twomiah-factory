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
export const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

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
export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>{status.replace(/_/g, ' ')}</span>
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
export const inputCls = 'w-full px-3 py-2 border rounded-lg bg-white text-gray-900 border-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:placeholder-slate-500'
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
export interface Column<T> { key: string; label: string; className?: string; render?: (value: any, row: T) => React.ReactNode }
export interface RowAction<T> { label: string; icon?: React.ComponentType<{ className?: string }>; onClick: (row: T) => void; className?: string; show?: (row: T) => boolean }
export interface Pagination { page: number; limit: number; total: number; pages: number }

export function DataTable<T extends { id: string }>({ data, columns, loading, pagination, onPageChange, onRowClick, actions = [], emptyMessage = 'Nothing here yet.' }: {
  data: T[]; columns: Column<T>[]; loading?: boolean; pagination?: Pagination | null; onPageChange?: (p: number) => void; onRowClick?: (row: T) => void; actions?: RowAction<T>[]; emptyMessage?: string
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    const onScroll = () => setMenu(null)
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
            {loading && <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>}
            {!loading && data.length === 0 && <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-500 dark:text-slate-400">{emptyMessage}</td></tr>}
            {!loading && data.map(row => (
              <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`text-gray-900 dark:text-slate-100 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800' : ''}`}>
                {columns.map(c => <td key={c.key} className={`px-4 py-3 ${c.className || ''}`}>{c.render ? c.render((row as any)[c.key], row) : String((row as any)[c.key] ?? '-')}</td>)}
                {actions.length > 0 && (
                  <td className="px-2 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button aria-label="Row actions" aria-haspopup="menu" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu(menu?.id === row.id ? null : { id: row.id, x: r.right, y: r.bottom }) }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-slate-200 dark:hover:bg-slate-800"><MoreVertical className="w-4 h-4" /></button>
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
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-300"><tr><th className="px-3 py-2 text-left text-xs font-medium">Description</th><th className="px-3 py-2 text-left text-xs font-medium w-24">Qty</th><th className="px-3 py-2 text-left text-xs font-medium w-36">Unit Price</th><th className="px-3 py-2 text-right text-xs font-medium w-32">Total</th><th className="w-10" /></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
          {items.map((li, i) => (
            <tr key={i}>
              <td className="px-3 py-2"><input value={li.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" className={inputCls} /></td>
              <td className="px-3 py-2"><input type="number" min="0" step="0.01" value={li.quantity} onChange={e => update(i, { quantity: Number(e.target.value) })} className={inputCls} /></td>
              <td className="px-3 py-2"><input type="number" min="0" step="0.01" value={li.unitPrice} onChange={e => update(i, { unitPrice: Number(e.target.value) })} className={inputCls} /></td>
              <td className="px-3 py-2 text-right text-gray-900 dark:text-slate-100">{money(round2((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0)))}</td>
              <td className="px-1"><button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="p-1 text-red-500 hover:text-red-700" aria-label="Remove line"><X className="w-4 h-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-2 border-t border-gray-200 dark:border-slate-700"><button type="button" onClick={() => onChange([...items, { description: '', quantity: 1, unitPrice: 0 }])} className="text-sm text-orange-600 hover:text-orange-700">+ Add line</button></div>
    </div>
  )
}

export function TotalsBox({ subtotal, discount, taxRate, taxAmount, total, warning }: { subtotal: number; discount: number; taxRate: number; taxAmount: number; total: number; warning?: string }) {
  return (
    <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-4 text-sm text-right space-y-1 text-gray-800 dark:text-slate-200">
      <p>Subtotal <span className="font-medium ml-2">{money(subtotal)}</span></p>
      {discount > 0 && <p>Discount <span className="font-medium ml-2">-{money(discount)}</span></p>}
      <p>Tax ({taxRate}%) <span className="font-medium ml-2">{money(taxAmount)}</span></p>
      <p className="text-lg font-bold">Total <span className="ml-2">{money(total)}</span></p>
      {warning && <p className="text-xs text-red-600 dark:text-red-300 text-right">{warning}</p>}
    </div>
  )
}

export const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'other', label: 'Other' },
]
