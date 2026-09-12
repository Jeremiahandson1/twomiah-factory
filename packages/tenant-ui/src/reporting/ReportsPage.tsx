// Reports & Analytics — one page for every CRM. The period picker drives every number on the page;
// balances (outstanding / overdue) are point-in-time and say so.
import React, { useEffect, useState } from 'react'
import { AlertCircle, Briefcase, Calendar, CheckCircle, DollarSign, FileText, Loader2, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { StatusBadge, dateOnly, inputCls, money } from '../invoicing/ui'
import type { ReportsPageProps } from './types'
import { resolveReportingConfig } from './types'

interface Summary {
  period: string
  revenue: { collected: number; invoiced: number; outstanding: number; overdue: number; overdueCount: number; collectionRate: number }
  jobs: { total: number; completed: number; completionRate: number; scheduled?: number; inProgress?: number; cancelled?: number; byStatus?: Record<string, number> }
  projects: { total: number; active: number; completed: number; totalValue: number }
  quotes: { total: number; approved: number; conversionRate: number }
  recentActivity: Array<{ type: 'invoice' | 'job' | 'quote'; number?: string; title?: string; status?: string; createdAt: string; total?: string | number }>
}
interface MonthRow { month: string; invoiced: number; collected: number }
interface CustomerRow { contact?: { name?: string; company?: string | null }; invoiceCount: number; total: number; collected?: number; invoiced?: number }
interface TeamRow { user?: { firstName?: string; lastName?: string }; jobsCompleted: number; hoursWorked: number }

const RANGES: Array<[string, string]> = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year']]
const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6'
const h3 = 'font-semibold text-gray-900 dark:text-slate-100 mb-4'
const muted = 'text-gray-500 dark:text-slate-400'
const compact = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : money(n))

export function ReportsPage({ api, config }: ReportsPageProps) {
  const cfg = resolveReportingConfig(config)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<Summary | null>(null)
  const [monthly, setMonthly] = useState<MonthRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [events, setEvents] = useState<any>(null)
  const [range, setRange] = useState('30')

  useEffect(() => {
    let cancelled = false
    const days = parseInt(range) || 30
    const endDate = new Date().toISOString().slice(0, 10)
    const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const q = { startDate, endDate }
    const months = ({ '7': 3, '30': 3, '90': 6, '365': 12 } as Record<string, number>)[range] || 6
    setLoading(true); setError('')
    Promise.all([
      api.get('/api/reports/dashboard', q),
      api.get('/api/reports/revenue/monthly', { months }),
      api.get('/api/reports/revenue/customers', { limit: 5, ...q }),
      cfg.team ? api.get('/api/reports/team', q).catch(() => []) : Promise.resolve([]),
      cfg.eventsPipeline ? api.get('/api/dashboard/stats').catch(() => null) : Promise.resolve(null),
    ]).then(([summary, m, c, tm, ev]) => {
      if (cancelled) return
      setData(summary || null); setMonthly(Array.isArray(m) ? m : []); setCustomers(Array.isArray(c) ? c : []); setTeam(Array.isArray(tm) ? tm : []); setEvents(ev)
    }).catch(e => { if (!cancelled) setError(e instanceof Error && e.message ? e.message : 'Could not load reports') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, range, cfg.team, cfg.eventsPipeline])

  const rangeLabel = RANGES.find(r => r[0] === range)?.[1] || `Last ${range} days`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports & Analytics</h1>
          <p className={muted}>{rangeLabel}</p>
        </div>
        <select value={range} onChange={e => setRange(e.target.value)} className={`${inputCls} w-auto`} aria-label="Period">
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading && <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}
      {!loading && (error || !data) && <div className={`${card} text-center text-red-600 dark:text-red-300`}>{error || 'Could not load reports'}</div>}

      {!loading && data && (() => {
        const revenue = data.revenue || { collected: 0, invoiced: 0, outstanding: 0, overdue: 0, overdueCount: 0, collectionRate: 0 }
        const jobs = data.jobs || { total: 0, completed: 0, completionRate: 0 }
        const projects = data.projects || { total: 0, active: 0, completed: 0, totalValue: 0 }
        const quotes = data.quotes || { total: 0, approved: 0, conversionRate: 0 }
        const showJobs = cfg.jobs && !cfg.eventsPipeline
        const chartsTwoUp = showJobs || cfg.eventsPipeline
        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric title="Revenue collected" value={money(revenue.collected)} subtitle={`${money(revenue.invoiced)} invoiced in this period`} icon={DollarSign} color="green" trend={revenue.collectionRate} trendLabel="collection rate" />
              <Metric title="Outstanding now" value={money(revenue.outstanding)} subtitle={`${money(revenue.overdue)} overdue · ${revenue.overdueCount} invoice${revenue.overdueCount === 1 ? '' : 's'}`} icon={AlertCircle} color="orange" alert={revenue.overdueCount > 0} />
              {cfg.eventsPipeline ? (
                <>
                  <Metric title="Confirmed events" value={events?.pipeline?.confirmed ?? 0} subtitle={`${money(events?.events?.bookedValue ?? 0)} booked ahead`} icon={CheckCircle} color="blue" />
                  <Metric title="Enquiries" value={events?.pipeline?.enquiry ?? 0} subtitle={`${events?.events?.upcoming30 ?? 0} events in the next 30 days`} icon={Calendar} color="purple" />
                </>
              ) : (
                <>
                  {showJobs && <Metric title={`${cfg.jobsLabel} completed`} value={jobs.completed} subtitle={`${jobs.total} ${cfg.jobsLabel.toLowerCase()} in this period`} icon={Briefcase} color="blue" trend={jobs.completionRate} trendLabel="completion rate" />}
                  {cfg.quotes && <Metric title="Quote conversion" value={`${quotes.conversionRate}%`} subtitle={`${quotes.approved} of ${quotes.total} approved`} icon={FileText} color="purple" />}
                </>
              )}
            </div>

            <div className={`grid grid-cols-1 ${chartsTwoUp ? 'lg:grid-cols-2' : ''} gap-6`}>
              <div className={card}><h3 className={h3}>Revenue trend</h3><RevenueChart data={monthly} /></div>
              {cfg.eventsPipeline && <div className={card}><h3 className={h3}>Events pipeline</h3><PipelineBar segments={[['enquiry', 'Enquiry', 'bg-blue-500'], ['tentative', 'Tentative', 'bg-yellow-500'], ['confirmed', 'Confirmed', 'bg-green-500'], ['completed', 'Completed', 'bg-teal-500'], ['lost', 'Lost', 'bg-gray-400'], ['cancelled', 'Cancelled', 'bg-gray-300']]} counts={events?.pipeline || {}} /></div>}
              {showJobs && <div className={card}><h3 className={h3}>{cfg.jobsLabel.replace(/s$/, '')} status</h3><PipelineBar segments={[['scheduled', 'Scheduled', 'bg-blue-500'], ['in_progress', 'In progress', 'bg-yellow-500'], ['completed', 'Completed', 'bg-green-500'], ['cancelled', 'Cancelled', 'bg-gray-400']]} counts={{ scheduled: jobs.scheduled ?? jobs.byStatus?.scheduled ?? 0, in_progress: jobs.inProgress ?? jobs.byStatus?.in_progress ?? 0, completed: jobs.completed, cancelled: jobs.cancelled ?? jobs.byStatus?.cancelled ?? 0 }} /></div>}
            </div>

            <div className={`grid grid-cols-1 ${cfg.team ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
              <div className={card}>
                <h3 className={h3}>Top customers</h3>
                <p className={`text-xs ${muted} -mt-3 mb-3`}>By amount paid in this period, net of refunds.</p>
                <div className="space-y-3">
                  {customers.length === 0 ? <p className={`text-sm ${muted}`}>No paid invoices in this period.</p> : customers.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-sm font-medium">{i + 1}</div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-gray-900 dark:text-slate-100 truncate">{c.contact?.name || 'Unknown'}</p>
                          <p className={`text-xs ${muted}`}>{c.invoiceCount} invoice{c.invoiceCount === 1 ? '' : 's'}{c.invoiced !== undefined ? ` · ${money(c.invoiced)} invoiced` : ''}</p>
                        </div>
                      </div>
                      <span className="font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap">{money(c.collected ?? c.total)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {cfg.team && (
                <div className={card}>
                  <h3 className={h3}>Team productivity</h3>
                  <div className="space-y-3">
                    {team.length === 0 ? <p className={`text-sm ${muted}`}>No time entries in this period.</p> : team.slice(0, 5).map((m, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center"><Users className="w-4 h-4 text-orange-600 dark:text-orange-300" /></div>
                          <div>
                            <p className="font-medium text-sm text-gray-900 dark:text-slate-100">{[m.user?.firstName, m.user?.lastName].filter(Boolean).join(' ') || 'Team member'}</p>
                            {showJobs && <p className={`text-xs ${muted}`}>{m.jobsCompleted} {cfg.jobsLabel.toLowerCase()} completed</p>}
                          </div>
                        </div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">{m.hoursWorked}h</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={card}>
                <h3 className={h3}>Recent activity</h3>
                <div className="space-y-3">
                  {(data.recentActivity || []).length === 0 && <p className={`text-sm ${muted}`}>Nothing yet.</p>}
                  {(data.recentActivity || []).filter(a => cfg.jobs || a.type !== 'job').filter(a => cfg.quotes || a.type !== 'quote').map((a, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${a.type === 'invoice' ? 'bg-green-100 dark:bg-green-900/40' : a.type === 'job' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-purple-100 dark:bg-purple-900/40'}`}>
                        {a.type === 'invoice' ? <DollarSign className="w-4 h-4 text-green-600 dark:text-green-300" /> : a.type === 'job' ? <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-300" /> : <FileText className="w-4 h-4 text-purple-600 dark:text-purple-300" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{a.type === 'invoice' ? `Invoice ${a.number || ''}` : a.type === 'job' ? (a.title || a.number || cfg.jobsLabel.replace(/s$/, '')) : `Quote ${a.number || ''}`}</p>
                        <p className={`text-xs ${muted}`}>{dateOnly(a.createdAt)}{a.total !== undefined && a.type !== 'job' ? ` · ${money(a.total)}` : ''}</p>
                      </div>
                      <StatusBadge status={a.status || 'draft'} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {cfg.projects && (
              <div className={card}>
                <h3 className={h3}>Project summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {([['Total projects', projects.total, ''], ['Active', projects.active, 'text-green-600 dark:text-green-300'], ['Completed', projects.completed, 'text-blue-600 dark:text-blue-300'], ['Total value', compact(projects.totalValue), 'text-orange-600 dark:text-orange-300']] as Array<[string, string | number, string]>).map(([label, value, cls]) => (
                    <div key={label} className="text-center p-4 rounded-lg bg-gray-50 dark:bg-slate-800/60">
                      <p className={`text-3xl font-bold ${cls || 'text-gray-900 dark:text-slate-100'}`}>{value}</p>
                      <p className={`text-sm ${muted}`}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}

function Metric({ title, value, subtitle, icon: Icon, color, trend, trendLabel, alert }: { title: string; value: string | number; subtitle: string; icon: React.ComponentType<{ className?: string }>; color: 'green' | 'orange' | 'blue' | 'purple'; trend?: number; trendLabel?: string; alert?: boolean }) {
  const colors = { green: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300', orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300', blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300', purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' }
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border p-5 ${alert ? 'border-orange-300 dark:border-orange-700' : 'border-gray-200 dark:border-slate-800'}`}>
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${colors[color]}`}><Icon className="w-5 h-5" /></div>
        {trend !== undefined && <div className={`flex items-center gap-1 text-sm ${trend >= 50 ? 'text-green-600 dark:text-green-300' : 'text-orange-600 dark:text-orange-300'}`}>{trend >= 50 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}<span>{trend}%</span></div>}
      </div>
      <div className="mt-3">
        <p className={`text-sm font-medium ${muted}`}>{title}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{value}</p>
        <p className={`text-sm ${muted}`}>{subtitle}</p>
        {trendLabel && <p className="text-xs text-gray-400 mt-1">{trendLabel}</p>}
      </div>
    </div>
  )
}

function RevenueChart({ data }: { data: MonthRow[] }) {
  if (!data.length) return <div className="h-48 flex items-center justify-center text-gray-400">No data</div>
  const max = Math.max(1, ...data.map(d => Math.max(d.invoiced, d.collected)))
  return (
    <div className="h-48">
      <div className="flex items-end justify-between h-40 gap-2">
        {data.map((m, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-1 items-end h-32">
              <div className="flex-1 bg-blue-200 dark:bg-blue-800 rounded-t" style={{ height: `${(m.invoiced / max) * 100}%` }} title={`Invoiced: ${money(m.invoiced)}`} />
              <div className="flex-1 bg-green-500 rounded-t" style={{ height: `${(m.collected / max) * 100}%` }} title={`Collected: ${money(m.collected)}`} />
            </div>
            {/* Parse at local noon so the month label never rolls into the previous month in western zones. */}
            <span className={`text-xs ${muted}`}>{new Date(m.month + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-200 dark:bg-blue-800 rounded" /><span className={`text-xs ${muted}`}>Invoiced</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded" /><span className={`text-xs ${muted}`}>Collected</span></div>
      </div>
    </div>
  )
}

function PipelineBar({ segments, counts }: { segments: Array<[string, string, string]>; counts: Record<string, number> }) {
  const total = segments.reduce((s, [k]) => s + (Number(counts[k]) || 0), 0) || 1
  return (
    <div className="space-y-4">
      <div className="h-4 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
        {segments.map(([k, label, cls]) => { const n = Number(counts[k]) || 0; const pct = (n / total) * 100; return pct > 0 ? <div key={k} className={`${cls} transition-all`} style={{ width: `${pct}%` }} title={`${label}: ${n}`} /> : null })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {segments.map(([k, label, cls]) => (
          <div key={k} className="flex items-center justify-between">
            <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded ${cls}`} /><span className="text-sm text-gray-600 dark:text-slate-400">{label}</span></div>
            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{Number(counts[k]) || 0}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
