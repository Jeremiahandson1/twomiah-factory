// Home dashboard for the jobs-family CRMs (contractor, field service, landscaping): stat cards, today's
// board and three recent lists. Salon, vet, events and RV keep their own home screens.
import React, { useEffect, useState } from 'react'
import { Briefcase, DollarSign, FileText, FolderKanban, Receipt, Users } from 'lucide-react'
import { NavLink, StatusBadge, money } from '../invoicing/ui'
import type { JobsDashboardPageProps } from './types'
import { resolveJobsDashboardConfig } from './types'

interface Stats {
  contacts?: number
  projects?: { total?: number; byStatus?: Record<string, number> }
  jobs?: { total?: number; today?: number; byStatus?: Record<string, number>; todayByStatus?: Record<string, number>; dispatchedToday?: number; inProgressToday?: number; completedToday?: number }
  quotes?: { total?: number; pending?: number; approved?: number }
  invoices?: { outstanding?: number; outstandingValue?: number; overdue?: number; overdueValue?: number }
}
interface Activity {
  recentJobs?: Array<{ id: string; number?: string; title?: string; status?: string }>
  recentQuotes?: Array<{ id: string; number?: string; name?: string; status?: string; total?: string | number }>
  recentInvoices?: Array<{ id: string; number?: string; status?: string; total?: string | number; balance?: number }>
}

const COLORS: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
  green: 'bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-300',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300',
  red: 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
}
const panel = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800'
const muted = 'text-gray-500 dark:text-slate-400'

export function JobsDashboardPage({ api, user, company, config }: JobsDashboardPageProps) {
  const cfg = resolveJobsDashboardConfig(config)
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get('/api/dashboard/stats'), api.get('/api/dashboard/recent-activity')])
      .then(([s, a]) => { if (!cancelled) { setStats(s || {}); setActivity(a || {}) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error && e.message ? e.message : 'Could not load the dashboard') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>

  const single = cfg.jobsLabel.replace(/s$/, '')
  const cards: Array<{ label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; color: string; link: string }> = [
    { label: 'Contacts', value: stats?.contacts || 0, icon: Users, color: 'blue', link: '/crm/contacts' },
    ...(cfg.projects ? [{ label: 'Active projects', value: stats?.projects?.byStatus?.active || 0, icon: FolderKanban, color: 'green', link: '/crm/projects' }] : []),
    { label: `${cfg.jobsLabel} today`, value: stats?.jobs?.today || 0, icon: Briefcase, color: 'purple', link: cfg.jobsPath },
    { label: 'Pending quotes', value: stats?.quotes?.pending || 0, icon: FileText, color: 'orange', link: '/crm/quotes' },
    { label: 'Open invoices', value: stats?.invoices?.outstanding || 0, icon: Receipt, color: 'red', link: '/crm/invoices' },
    { label: 'Outstanding', value: money(stats?.invoices?.outstandingValue || 0), icon: DollarSign, color: 'emerald', link: '/crm/invoices' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome back{user?.firstName ? `, ${user.firstName}` : ''}!</h1>
        <p className={muted}>{company?.name ? `${company.name} dashboard` : 'Dashboard'}</p>
      </div>
      {error && <div className={`${panel} p-4 text-sm text-red-600 dark:text-red-300`}>{error}</div>}

      <div className={`grid grid-cols-2 md:grid-cols-3 ${cards.length === 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4`}>
        {cards.map(c => (
          <NavLink key={c.label} to={c.link} className={`${panel} p-4 hover:shadow-md transition-shadow block`}>
            <div className={`w-10 h-10 rounded-lg ${COLORS[c.color]} flex items-center justify-center mb-3`}><c.icon className="w-5 h-5" /></div>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{c.value}</p>
            <p className={`text-sm ${muted}`}>{c.label}</p>
          </NavLink>
        ))}
      </div>

      {cfg.todayBoard && (
        <div className={`${panel} p-6`}>
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-4">Today's board</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([['Scheduled', stats?.jobs?.today || 0, 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'], ['Dispatched', stats?.jobs?.dispatchedToday || 0, 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-300'], ['In progress', stats?.jobs?.inProgressToday || 0, 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300'], ['Completed today', stats?.jobs?.completedToday || 0, 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300']] as Array<[string, number, string]>).map(([label, value, cls]) => (
              <div key={label} className={`text-center p-3 rounded-lg ${cls}`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-gray-600 dark:text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <RecentList title={`Recent ${cfg.jobsLabel.toLowerCase()}`} link={cfg.jobsPath} empty={`No recent ${cfg.jobsLabel.toLowerCase()}`} rows={(activity?.recentJobs || []).map(j => ({ id: j.id, primary: j.title || 'Untitled', secondary: j.number || '—', status: j.status || 'pending', href: `${cfg.jobsPath}/${j.id}` }))} />
        <RecentList title="Recent quotes" link="/crm/quotes" empty="No recent quotes" rows={(activity?.recentQuotes || []).map(q => ({ id: q.id, primary: q.name || 'Untitled', secondary: `${q.number || '—'} · ${money(q.total || 0)}`, status: q.status || 'draft', href: `/crm/quotes/${q.id}` }))} />
        <RecentList title="Recent invoices" link="/crm/invoices" empty="No recent invoices" rows={(activity?.recentInvoices || []).map(inv => ({ id: inv.id, primary: inv.number || '—', secondary: `${money(inv.total || 0)}${Number(inv.balance || 0) > 0 ? ` · ${money(inv.balance)} due` : ''}`, status: inv.status || 'draft', href: `/crm/invoices/${inv.id}` }))} />
      </div>
    </div>
  )
}

function RecentList({ title, link, empty, rows }: { title: string; link: string; empty: string; rows: Array<{ id: string; primary: string; secondary: string; status: string; href: string }> }) {
  return (
    <div className={panel}>
      <div className="p-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
        <NavLink to={link} className="text-sm text-orange-500 hover:text-orange-600 dark:text-orange-300">View all</NavLink>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-800">
        {rows.length === 0 && <p className={`p-4 text-sm ${muted}`}>{empty}</p>}
        {rows.map(r => (
          <NavLink key={r.id} to={r.href} className="block p-4 hover:bg-gray-50 dark:hover:bg-slate-800/60">
            <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{r.primary}</p>
            <p className={`text-sm ${muted}`}>{r.secondary}</p>
            <div className="mt-1"><StatusBadge status={r.status} /></div>
          </NavLink>
        ))}
      </div>
    </div>
  )
}
