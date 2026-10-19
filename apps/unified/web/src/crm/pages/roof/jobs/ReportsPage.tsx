// Moved from templates/crm-roof/frontend/src/pages/roofing/ReportsPage.tsx — roofing's reports, at /crm/reports.
//
// Changes from the template:
//   · the money tiles and panels (Avg Job Value, Pipeline Value, Pipeline Value by Stage, Revenue by Sales Rep, Revenue
//     by Crew) are summed in the browser from the job list, so each is shown only to a seat that holds every
//     permission the figures it reads sit under — the same permissions the server strips them by (jobs/jobMoney.ts):
//     a job's value is finalRevenue, then estimatedValue, then RCV, so invoices:read (finalRevenue, RCV) AND
//     quotes:read (estimatedValue — roofing's estimatedRevenue sat under invoices:read, the CRM's estimatedValue under
//     quotes:read). With either missing the fallback would print a different figure, not an empty one. The template
//     read the list's `moneyWithheld` signal, which the unified list doesn't carry (RULEBOOK §3). None of these tiles
//     reads a cost, so margin:read gates nothing here;
//   · Invoiced / Collected / Outstanding are GET /api/invoices/stats (`totalAmount`, `paidAmount`, `outstanding`), asked
//     only of a seat holding what that route asks (invoices:read and revenue:read); the template's
//     /api/invoices/summary is gone;
//   · rep names from GET /api/company/users (the template's /api/users), asked of a seat the server answers
//     (team:read or users:read); crews are GET /api/crews' { data }; the stages are the server's (./model.ts).
import { useState, useEffect, useCallback } from 'react'
import { BarChart3, TrendingUp, DollarSign, Users, Briefcase } from 'lucide-react'
import { api } from '../../../../api'
import { useKnownPermission, usePermissions, useToast } from '../../../../shared'
import { displayName } from '../lib/user'
import { PIPELINE_STATUSES, TERMINAL_STATUSES, rowsOf } from './model'
import type { Crew, Person, RoofJob } from './model'

/** The chart's shorter labels for the pipeline stages. */
const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  inspection_scheduled: 'Inspection Sched.',
  inspected: 'Inspected',
  measurement_ordered: 'Measurement',
  proposal_sent: 'Proposal Sent',
  signed: 'Signed',
  material_ordered: 'Material Ordered',
  in_production: 'In Production',
  final_inspection: 'Final Inspection',
  invoiced: 'Invoiced',
  collected: 'Collected',
}

const TYPE_COLORS: Record<string, string> = {
  insurance: '#f97316',
  retail: '#3b82f6',
  commercial: '#6b7280',
  new_construction: '#22c55e',
  emergency: '#ef4444',
}

/** GET /api/invoices/stats — the parts this page shows. */
interface InvoiceStats { totalAmount: number; paidAmount: number; outstanding: number }

/**
 * The label colour for a bar, chosen from the bar's own brightness (M5): white on a dark bar, near-black on a light
 * one. Same relative-luminance formula as WCAG.
 */
function labelOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const onWhite = 1.05 / (L + 0.05)
  const onBlack = (L + 0.05) / 0.05
  // #0f172a is slate-900, the dark text this product already uses
  return onBlack >= onWhite ? '#0f172a' : '#ffffff'
}

/**
 * Whether the bar can carry its label at 4.5:1 with the better of white and slate-900; when it can't, the label goes
 * BESIDE the bar, the treatment a short bar already gets. (T41)
 */
function labelFitsOnBar(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return true
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const DARK_INK_L = 0.2126 * lin(0x0f / 255) + 0.7152 * lin(0x17 / 255) + 0.0722 * lin(0x2a / 255)
  const onWhite = 1.05 / (L + 0.05)
  const onDark = (L + 0.05) / (DARK_INK_L + 0.05)
  return Math.max(onWhite, onDark) >= 4.5
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-36 text-gray-600 truncate text-right dark:text-slate-400">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden dark:bg-slate-800">
        <div className="h-full rounded-full flex items-center px-2" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}>
          {pct > 15 && labelFitsOnBar(color) && <span className="text-xs font-medium" style={{ color: labelOn(color) }}>${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
        </div>
      </div>
      {(pct <= 15 || !labelFitsOnBar(color)) && <span className="text-xs text-gray-500 w-20 dark:text-slate-400">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
    </div>
  )
}

export default function ReportsPage() {
  const toast = useToast()

  const [jobs, setJobs] = useState<RoofJob[]>([])
  const [users, setUsers] = useState<Person[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(true)
  // invoiced / collected / outstanding, computed by the server from invoices (H3)
  const [money, setMoney] = useState<InvoiceStats | null>(null)

  // Reports needs every job to compute pipeline totals: page through at 500 a page, so any job count is covered.
  const fetchAllJobs = async () => {
    const all: RoofJob[] = []
    for (let page = 1; ; page++) {
      const d = await api.get('/api/jobs', { limit: 500, page }) as { data?: RoofJob[]; pagination?: { pages?: number } }
      const rows = rowsOf<RoofJob>(d)
      all.push(...rows)
      const pages = d?.pagination?.pages ?? 1
      if (page >= pages || rows.length === 0) break
    }
    return all
  }

  // Each asked only once the permission list is known (null until then), and only of a seat the server answers. (T64)
  const { known, can } = usePermissions()
  const maySeeRoster: boolean | null = known ? (can('team:read') || can('users:read')) : null
  // GET /api/invoices/stats asks invoices:read and revenue:read.
  const maySeeInvoiceStats: boolean | null = known ? (can('invoices:read') && can('revenue:read')) : null
  // A job's value reads fields under invoices:read and quotes:read (see the header); hidden until both are known yes.
  const maySeeInvoices = useKnownPermission('invoices:read')
  const maySeeQuotes = useKnownPermission('quotes:read')
  const maySeeJobValue = maySeeInvoices === true && maySeeQuotes === true

  const load = useCallback(async () => {
    try {
      const [allJobs, usersRes, crewsRes, stats] = await Promise.all([
        fetchAllJobs(),
        maySeeRoster ? api.get('/api/company/users') : Promise.resolve([]),
        api.get('/api/crews'),
        // H3: the money, as opposed to what the pipeline is thought to be worth
        maySeeInvoiceStats ? (api.get('/api/invoices/stats') as Promise<InvoiceStats>).catch(() => null) : Promise.resolve(null),
      ])
      setMoney(stats)
      setJobs(allJobs)
      setUsers(rowsOf<Person>(usersRes))
      setCrews(rowsOf<Crew>(crewsRes))
    } catch {
      toast.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [maySeeRoster, maySeeInvoiceStats]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  // The job's value — finalRevenue, then the estimate, then RCV.
  const jobValue = (j: RoofJob) => Number(j.finalRevenue ?? j.estimatedValue ?? j.rcv ?? 0)

  // Pipeline value by stage
  const pipelineByStage: Record<string, number> = {}
  const pipelineCountByStage: Record<string, number> = {}
  jobs.forEach((j) => {
    const stage = j.status || 'lead'
    pipelineByStage[stage] = (pipelineByStage[stage] || 0) + jobValue(j)
    pipelineCountByStage[stage] = (pipelineCountByStage[stage] || 0) + 1
  })
  const maxPipelineValue = Math.max(...Object.values(pipelineByStage), 1)

  // The chart draws a row per PIPELINE stage; a lost or cancelled job is in the headline count and in no bar, so the
  // chart says what it covers and what it leaves out. (T41)
  const inPipeline = jobs.filter((j) => (PIPELINE_STATUSES as readonly string[]).includes(j.status || 'lead')).length
  const terminalCounts = TERMINAL_STATUSES
    .map((s) => ({ label: s, n: pipelineCountByStage[s] || 0 }))
    .filter((x) => x.n > 0)
  // Anything that is neither a pipeline stage nor a known terminal status — counted, so it can never silently vanish.
  const unaccounted = jobs.length - inPipeline - terminalCounts.reduce((s, x) => s + x.n, 0)

  // Jobs by type
  const jobsByType: Record<string, number> = {}
  jobs.forEach((j) => {
    const type = j.jobType || 'retail'
    jobsByType[type] = (jobsByType[type] || 0) + 1
  })

  // Close rate
  const proposalsSent = jobs.filter((j) => ['proposal_sent', 'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected'].includes(j.status)).length
  const signed = jobs.filter((j) => ['signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected'].includes(j.status)).length
  const closeRate = proposalsSent > 0 ? ((signed / proposalsSent) * 100).toFixed(1) : '0'

  // Average job value
  const jobsWithValue = jobs.filter((j) => jobValue(j) > 0)
  const avgJobValue = jobsWithValue.length > 0
    ? jobsWithValue.reduce((s, j) => s + jobValue(j), 0) / jobsWithValue.length
    : 0

  // Revenue by sales rep
  const repMap: Record<string, string> = {}
  users.forEach((u) => (repMap[u.id] = displayName(u)))
  const revByRep: Record<string, number> = {}
  jobs.forEach((j) => {
    if (j.assignedSalesRepId) {
      const name = repMap[j.assignedSalesRepId] || 'Unknown'
      revByRep[name] = (revByRep[name] || 0) + jobValue(j)
    }
  })
  const maxRepRev = Math.max(...Object.values(revByRep), 1)

  // Revenue by crew
  const crewMap: Record<string, string> = {}
  crews.forEach((c) => (crewMap[c.id] = c.name))
  const revByCrew: Record<string, number> = {}
  jobs.forEach((j) => {
    if (j.assignedCrewId) {
      const name = crewMap[j.assignedCrewId] || 'Unknown'
      revByCrew[name] = (revByCrew[name] || 0) + jobValue(j)
    }
  })
  const maxCrewRev = Math.max(...Object.values(revByCrew), 1)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 dark:text-slate-100">Reports</h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center dark:bg-blue-950/40">
                <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <span className="text-sm text-gray-500 dark:text-slate-400">Total Jobs</span>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{jobs.length}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center dark:bg-green-950/40">
                <TrendingUp className="w-5 h-5 text-green-700 dark:text-green-300" />
              </div>
              <span className="text-sm text-gray-500 dark:text-slate-400">Close Rate</span>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{closeRate}%</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{signed} signed / {proposalsSent} proposed</p>
          </div>

          {/* Both summed from the job rows: absent, not $0, for a seat the figures are withheld from. (T42) */}
          {maySeeJobValue && (
            <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center dark:bg-purple-950/40">
                  <DollarSign className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                </div>
                <span className="text-sm text-gray-500 dark:text-slate-400">Avg Job Value</span>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">
                ${avgJobValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          )}

          {maySeeJobValue && (
            <div className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center dark:bg-orange-950/40">
                  <BarChart3 className="w-5 h-5 text-orange-600 dark:text-orange-200" />
                </div>
                {/* H3: what the pipeline is thought to be worth, not money that exists; the money is its own row below. */}
                <span className="text-sm text-gray-500 dark:text-slate-400">Pipeline Value</span>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">
                ${jobs.reduce((s, j) => s + jobValue(j), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">estimated value of all jobs</p>
            </div>
          )}
        </div>

        {/* The money, from invoices rather than estimates (H3) */}
        {money && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {([
              ['Invoiced', Number(money.totalAmount) || 0, 'billed to customers', 'text-gray-900 dark:text-slate-100'],
              ['Collected', Number(money.paidAmount) || 0, 'payments received', 'text-green-700 dark:text-green-300'],
              ['Outstanding', Number(money.outstanding) || 0, 'still owed', 'text-amber-700 dark:text-amber-300'],
            ] as Array<[string, number, string, string]>).map(([label, value, hint, tone]) => (
              <div key={label} className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
                <span className="text-sm text-gray-500 dark:text-slate-400">{label}</span>
                <p className={`text-3xl font-bold mt-2 ${tone}`}>
                  ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{hint}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pipeline Value by Stage — the bars are money, so they go with the tiles. (T42) */}
          {maySeeJobValue && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Pipeline Value by Stage</h2>
              {/* What the bars below add up to, and what they leave out. (T41) */}
              <p className="text-xs text-gray-500 mb-4 mt-1 dark:text-slate-400">
                {`${inPipeline} of ${jobs.length} job${jobs.length === 1 ? '' : 's'} in the pipeline`}
                {terminalCounts.length > 0 && ` · ${terminalCounts.map((x) => `${x.n} ${x.label}`).join(', ')}, which carry no pipeline value`}
                {unaccounted > 0 && ` · ${unaccounted} at a status this chart does not know`}
              </p>
              <div className="space-y-2">
                {PIPELINE_STATUSES.map((stage) => (
                  <div key={stage}>
                    <Bar
                      label={`${STAGE_LABELS[stage]} (${pipelineCountByStage[stage] || 0})`}
                      value={pipelineByStage[stage] || 0}
                      max={maxPipelineValue}
                      color="#3b82f6"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jobs by Type */}
          <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 dark:text-slate-100">Jobs by Type</h2>
            <div className="space-y-3">
              {Object.entries(jobsByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const pct = jobs.length > 0 ? ((count / jobs.length) * 100).toFixed(1) : '0'
                  const color = TYPE_COLORS[type] || '#6b7280'
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
                      <span className="text-sm text-gray-700 capitalize flex-1 dark:text-slate-200">{type.replace('_', ' ')}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{count}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-400 w-12 text-right">{pct}%</span>
                      <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden dark:bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  )
                })}
              {Object.keys(jobsByType).length === 0 && (
                <p className="text-sm text-gray-500 dark:text-slate-400">No data</p>
              )}
            </div>
          </div>

          {/* Revenue by Sales Rep / by Crew — what the per-job money is aggregated into, so they go with it. (T42) */}
          {maySeeJobValue && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Users className="w-4 h-4 text-gray-400" /> Revenue by Sales Rep
              </h2>
              <div className="space-y-2">
                {Object.entries(revByRep)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, value]) => (
                    <Bar key={name} label={name} value={value} max={maxRepRev} color="#8b5cf6" />
                  ))}
                {Object.keys(revByRep).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-slate-400">No data — assign sales reps to jobs</p>
                )}
              </div>
            </div>
          )}

          {maySeeJobValue && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Users className="w-4 h-4 text-gray-400" /> Revenue by Crew
              </h2>
              <div className="space-y-2">
                {Object.entries(revByCrew)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, value]) => (
                    <Bar key={name} label={name} value={value} max={maxCrewRev} color="#f59e0b" />
                  ))}
                {Object.keys(revByCrew).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-slate-400">No data — assign crews to jobs</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
