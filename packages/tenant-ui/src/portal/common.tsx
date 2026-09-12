// Small pieces every portal page shares.
import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { dateOnly } from '../invoicing/ui'

/** Date-only values (due dates, scheduled dates) rendered without the UTC-midnight day shift. */
export const formatDate = (v: unknown): string => { if (!v) return ''; const s = dateOnly(v); return s === '-' ? '' : s }
export const money = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const moneyShort = (n: unknown) => `$${Number(n || 0).toLocaleString()}`

/** Hook-based link (react-router's <Link> does not type-check from the vendored package). */
export function PLink({ to, className, children, onClick }: { to: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  const navigate = useNavigate()
  return (
    <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.button !== 0) return; e.preventDefault(); onClick?.(); navigate(to) }}>
      {children}
    </a>
  )
}

/** Top-nav tab with an active state. `end` = exact match (the dashboard). */
export function PortalTab({ to, end, icon: Icon, label }: { to: string; end?: boolean; icon: React.ComponentType<{ className?: string }>; label: string }) {
  const { pathname } = useLocation()
  const active = end ? pathname === to || pathname === to + '/' : pathname === to || pathname.startsWith(to + '/')
  return (
    <PLink to={to} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${active ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 dark:text-slate-400 dark:hover:text-slate-100'}`}>
      <Icon className="w-4 h-4" />
      {label}
    </PLink>
  )
}

export function Spinner({ className = 'py-12' }: { className?: string }) {
  return <div className={`flex items-center justify-center ${className}`}><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-gray-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Empty({ icon: Icon, text, children }: { icon: React.ComponentType<{ className?: string }>; text: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center dark:bg-slate-900 dark:border-slate-700">
      <Icon className="w-12 h-12 text-gray-300 mx-auto mb-4 dark:text-slate-600" />
      <p className="text-gray-500 dark:text-slate-400">{text}</p>
      {children}
    </div>
  )
}

export function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export const card = 'bg-white rounded-xl border border-gray-200 dark:bg-slate-900 dark:border-slate-700'
export const pill = (cls: string) => `inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`
export const btnPrimary = 'inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnSecondary = 'inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'
export const btnSuccess = 'inline-flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors'
export const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100'
export const labelCls = 'block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200'

/** Modal shell used by the sign / respond / revise dialogs. */
export function PortalModal({ title, subtitle, onClose, children }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-slate-100">{title}</h2>
          {subtitle && <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}
