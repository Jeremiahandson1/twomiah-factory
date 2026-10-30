// The owner's three questions at the top of the home screen, whatever the trade: what came in, what I am owed, who is
// waiting on me. Reads GET /api/dashboard-strip (apps/unified server/crm/dashboard/moneyStrip.ts), which sends each half
// only to a seat that may see it and only where the trade has it — so a half that is absent is simply not drawn, and a
// tile never prints a $0.00 for money the seat is not allowed to see.
import React, { useEffect, useState } from 'react'
import { Banknote, Hourglass, Inbox, AlertTriangle } from 'lucide-react'
import { NavLink, money } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'

interface Strip {
  money?: { cashInWeek: number; cashInMonth: number; owed: number; owedCount: number; overdue: number; overdueCount: number }
  leads?: { unanswered: number }
}
type Tile = 'cashWeek' | 'cashMonth' | 'owed' | 'overdue' | 'leads'

const tone: Record<string, string> = {
  green: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  red: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** `hide` leaves a tile out where the page already shows that figure itself (the jobs dashboard's Overdue). */
export function MoneyStrip({ api, hide = [] }: { api: { get: (url: string) => Promise<any> }; hide?: Tile[] }) {
  const { hasFeature } = useAuth()
  const [strip, setStrip] = useState<Strip | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading')

  useEffect(() => {
    let cancelled = false
    api.get('/api/dashboard-strip')
      .then((s: Strip) => { if (!cancelled) { setStrip(s || {}); setState('ready') } })
      .catch(() => { if (!cancelled) setState('none') }) // the strip is an extra: the page below it still works without it
    return () => { cancelled = true }
  }, [api])

  if (state === 'none') return null
  if (state === 'loading') {
    return (
      <div role="status" aria-busy="true" data-money-strip="loading">
        <p className="mb-2 text-sm font-medium text-gray-600 dark:text-slate-300">Loading your numbers…</p>
        <div className="animate-pulse grid grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-slate-800" />)}
        </div>
      </div>
    )
  }

  const m = strip?.money
  const tiles: Array<{ id: Tile; label: string; value: string; note?: string; icon: React.ComponentType<{ className?: string }>; color: string; to: string }> = []
  if (m) {
    tiles.push({ id: 'cashWeek', label: 'Cash in this week', value: money(m.cashInWeek), icon: Banknote, color: 'green', to: '/crm/invoices' })
    tiles.push({ id: 'cashMonth', label: 'Cash in this month', value: money(m.cashInMonth), icon: Banknote, color: 'emerald', to: '/crm/invoices' })
    tiles.push({ id: 'owed', label: 'Owed to you', value: money(m.owed), note: plural(m.owedCount, 'open invoice', 'open invoices'), icon: Hourglass, color: 'orange', to: '/crm/invoices' })
    tiles.push({ id: 'overdue', label: 'Past due', value: money(m.overdue), note: m.overdueCount ? plural(m.overdueCount, 'invoice', 'invoices') : 'Nothing late', icon: AlertTriangle, color: m.overdue > 0 ? 'red' : 'green', to: '/crm/invoices' })
  }
  if (strip?.leads) {
    const n = strip.leads.unanswered
    tiles.push({ id: 'leads', label: 'Leads waiting over a day', value: String(n), note: n ? 'Nobody has answered yet' : 'All answered', icon: Inbox, color: n > 0 ? 'blue' : 'green', to: hasFeature('lead_inbox') ? '/crm/leads' : '/crm/new-leads' })
  }
  const shown = tiles.filter((t) => !hide.includes(t.id))
  if (!shown.length) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-money-strip="ready">
      {shown.map((t) => (
        <NavLink key={t.id} to={t.to} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 hover:shadow-md transition-shadow block min-w-0">
          <div className={`w-9 h-9 rounded-lg ${tone[t.color]} flex items-center justify-center mb-2`}><t.icon className="w-5 h-5" /></div>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 truncate" data-tile={t.id}>{t.value}</p>
          <p className="text-sm text-gray-500 dark:text-slate-400">{t.label}</p>
          {t.note && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t.note}</p>}
        </NavLink>
      ))}
    </div>
  )
}
