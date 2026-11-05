// Margin & turnover (item 10, finished in parity row 11; care_margin_reports): what each client earns the agency after the
// caregiver's pay, and how many caregivers the agency keeps.
//   GET /api/margin-reports/client-margin    (care-billing:read AND care-payroll:read)   per client, grouped by referral source / payer / department / branch
//   GET /api/margin-reports/visit-margin     per visit for a day or a month
//   GET /api/margin-reports/trend?by=        the chart;  GET /drill-down   total → branch → team → client
//   GET /api/margin-reports/compare          two periods side by side
//   GET /api/margin-reports/turnover         (care-hr:read)  turnover, who left (stored leaving date), hiring, reliability, payroll accuracy
//   every one takes the filters (?clientId&caregiverId&branchId&referralSourceId&payerId) and downloads with ?format=csv|pdf
//   server/crm/homecare/planning/marginReports.ts
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage, downloadFile, saveBlob } from '../lib/http'
import { formatAgencyDate, agencyToday } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'
import { LineChart, BarChart } from '../lib/Chart'

interface MarginRow {
  clientId: string; clientName: string; hours: number; hoursInvoiced: number; overtimeHours: number; rate: number | null
  billedCents: number | null; pay: number; mileage: number; costCents: number; marginCents: number | null; marginPercent: number | null
  branchName: string | null; department: string | null; referralSourceName: string | null; payerName: string | null
}
interface Group { id: string | null; name: string; clients: number; hours: number; billedCents: number; costCents: number; marginCents: number; marginPercent: number | null }
interface Totals { hours: number; hoursInvoiced: number; billedCents: number; costCents: number; marginCents: number; marginPercent: number | null; clientsWithoutRate: number }
interface MarginReply { clients: MarginRow[]; hoursWithoutClient: number; totals: Totals; byReferralSource: Group[]; byPayer: Group[]; byDepartment: Group[]; byBranch: Group[] }
interface VisitReply { visits: Array<{ id: string; date: string; clientName: string; caregiverName: string; hours: number; billedCents: number | null; payCents: number; marginCents: number | null; marginPercent: number | null }>; totals: { visits: number; hours: number; billedCents: number; payCents: number; travelPayCents: number; mileageCents: number; marginCents: number; visitsWithoutRate: number } }
interface TrendReply { by: 'week' | 'month'; points: Array<{ bucket: string; hours: number; billedCents: number; costCents: number; marginCents: number; marginPercent: number | null }> }
interface Node { id: string | null; name: string; hours: number; billedCents: number; costCents: number; marginCents: number; marginPercent: number | null; children?: Node[] }
interface CompareReply { current: { period: { start: string; end: string }; totals: Totals }; previous: { period: { start: string; end: string }; totals: Totals }; change: { billedCents: number; costCents: number; marginCents: number; hours: number }; clients: Array<{ clientId: string; clientName: string; current: MarginRow | null; previous: MarginRow | null; changeCents: number | null; hoursChange: number }> }
interface TurnoverReply {
  headcountStart: number; headcountEnd: number; hires: number; departures: number; turnoverPercent: number | null; retentionPercent: number | null
  hiresWith90Days: number; hiresKept90Days: number; ninetyDayRetentionPercent: number | null; averageTenureDaysOfDeparted: number | null; departuresWithoutLeavingDate: number
  departed: Array<{ caregiverId: string; name: string; hired: string; leftOn: string; exact: boolean; leftReason: string | null; tenureDays: number; branchName: string | null; team: string | null; managerName: string | null }>
  hiring: { applicants: number; applicantsHired: number; applicantToHireRatio: number | null; hiresWhoStarted: number; hireToFirstShiftDays: number | null; hiresNotYetStarted: number; hiringSpendCents: number; costPerHireCents: number | null }
  reliability: Array<{ caregiverId: string; name: string; absences: number; cancelledVisits: number; missedVisits: number }>
  payrollAccuracy: { reviewed: number; corrected: number; disputed: number; verified: number; accuracyPercent: number | null }
}
interface Lists { clients: { id: string; name: string }[]; caregivers: { id: string; name: string }[]; branches: { id: string; name: string }[]; referralSources: { id: string; name: string }[]; payers: { id: string; name: string }[] }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)
export const cents = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const dollarsShort = (v: number) => `$${(v / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const neg = (v: number | null) => (v !== null && v < 0 ? 'text-red-700 dark:text-red-300 font-semibold' : '')
type Tab = 'margin' | 'visits' | 'trend' | 'compare' | 'turnover'
const TH = 'px-3 py-2 text-left'

export default function MarginReports() {
  const billing = useMay('care-billing')
  const payroll = useMay('care-payroll')
  const hr = useMay('care-hr')
  const toast = useToast()
  const canMargin = billing.read && payroll.read
  const [tab, setTab] = useState<Tab>(canMargin ? 'margin' : 'turnover')
  const [end, setEnd] = useState(agencyToday())
  const [start, setStart] = useState(shift(agencyToday(), -29))
  const [cmpEnd, setCmpEnd] = useState(shift(agencyToday(), -30))
  const [cmpStart, setCmpStart] = useState(shift(agencyToday(), -59))
  const [f, setF] = useState({ clientId: '', caregiverId: '', branchId: '', referralSourceId: '', payerId: '' })
  const [lists, setLists] = useState<Lists | null>(null)
  const [by, setBy] = useState<'week' | 'month'>('week')
  const [grouping, setGrouping] = useState<'byReferralSource' | 'byPayer' | 'byDepartment' | 'byBranch'>('byReferralSource')
  const [margin, setMargin] = useState<MarginReply | null>(null)
  const [visits, setVisits] = useState<VisitReply | null>(null)
  const [trend, setTrend] = useState<TrendReply | null>(null)
  const [drill, setDrill] = useState<Node | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [compare, setCompare] = useState<CompareReply | null>(null)
  const [turnover, setTurnover] = useState<TurnoverReply | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  const query = useCallback(() => {
    const p = new URLSearchParams({ startDate: start, endDate: end })
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
    return p
  }, [start, end, f])

  useEffect(() => { if (canMargin) api.get('/api/margin-reports/filters').then((r) => setLists(r as Lists)).catch(() => setLists(null)) }, [canMargin])

  const load = useCallback(async () => {
    setLoading(true)
    const q = query()
    try {
      if (tab === 'margin' && canMargin) setMargin(await api.get(`/api/margin-reports/client-margin?${q}`) as MarginReply)
      if (tab === 'visits' && canMargin) setVisits(await api.get(`/api/margin-reports/visit-margin?${q}`) as VisitReply)
      if (tab === 'trend' && canMargin) {
        const [t, d] = await Promise.all([api.get(`/api/margin-reports/trend?${q}&by=${by}`), api.get(`/api/margin-reports/drill-down?${q}`)])
        setTrend(t as TrendReply); setDrill((d as any).total as Node)
      }
      if (tab === 'compare' && canMargin) setCompare(await api.get(`/api/margin-reports/compare?${q}&compareStart=${cmpStart}&compareEnd=${cmpEnd}`) as CompareReply)
      if (tab === 'turnover' && hr.read) setTurnover(await api.get(`/api/margin-reports/turnover?${q}`) as TurnoverReply)
    } catch (e) { toast.error(errorMessage(e, 'Could not load the report')) }
    finally { setLoading(false) }
  }, [tab, query, by, cmpStart, cmpEnd, canMargin, hr.read, toast])
  useEffect(() => { load() }, [load])

  const download = async (kind: 'client-margin' | 'visit-margin' | 'turnover', format: 'csv' | 'pdf') => {
    setDownloading(true)
    try {
      const { blob, fileName } = await downloadFile(`/api/margin-reports/${kind}?${query()}&format=${format}`)
      saveBlob(blob, fileName || `${kind}-${start}-to-${end}.${format}`)
    } catch (e) { toast.error(errorMessage(e, 'Could not download the report')) }
    finally { setDownloading(false) }
  }

  if (!canMargin && !hr.read) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to these reports.</div>
  const tabBtn = (id: Tab, label: string) => (
    <button key={id} type="button" className={`hc-btn hc-btn-sm ${tab === id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>
  )
  const select = (key: keyof typeof f, label: string, opts: { id: string; name: string }[] | undefined) => (
    <label className="text-sm">{label}<br />
      <select className={inp} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
        <option value="">All</option>
        {(opts ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  )
  const downloads = (kind: 'client-margin' | 'visit-margin' | 'turnover') => (
    <span className="flex gap-2">
      <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={downloading} onClick={() => download(kind, 'csv')}>Download CSV</button>
      <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={downloading} onClick={() => download(kind, 'pdf')}>Download PDF</button>
    </span>
  )
  const groupTable = (rows: Group[], what: string) => (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>{what}</th><th className={TH}>Clients</th><th className={TH}>Hours</th><th className={TH}>Billed (revenue)</th><th className={TH}>Cost</th><th className={TH}>Margin</th><th className={TH}>%</th></tr></thead>
        <tbody>{rows.map((g) => (
          <tr key={g.id ?? 'none'} className="border-t border-gray-100 dark:border-slate-700">
            <td className="px-3 py-2 font-semibold">{g.name}</td><td className="px-3">{g.clients}</td><td className="px-3">{g.hours}</td><td className="px-3">{cents(g.billedCents)}</td><td className="px-3">{cents(g.costCents)}</td><td className={`px-3 ${neg(g.marginCents)}`}>{cents(g.marginCents)}</td><td className="px-3">{pct(g.marginPercent)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
  const stat = (label: string, value: string) => (
    <div key={label} className="rounded-lg border p-3 border-gray-200 dark:border-slate-700"><div className="text-xs text-gray-600 dark:text-slate-400">{label}</div><div className="text-lg font-semibold">{value}</div></div>
  )
  const renderNode = (n: Node, depth: number, key: string) => {
    const kids = n.children ?? []
    const isOpen = open[key] ?? depth === 0
    return (
      <div key={key}>
        <div className="flex items-center gap-2 border-t border-gray-100 dark:border-slate-700 py-1.5 text-sm" style={{ paddingLeft: `${depth * 18 + 8}px` }}>
          {kids.length ? <button type="button" className="w-5 text-gray-600 dark:text-slate-400" aria-expanded={isOpen} aria-label={isOpen ? `Collapse ${n.name}` : `Expand ${n.name}`} onClick={() => setOpen({ ...open, [key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button> : <span className="w-5" />}
          <span className={`flex-1 ${depth < 3 ? 'font-semibold' : ''}`}>{n.name}</span>
          <span className="w-16 text-right">{n.hours} h</span><span className="w-24 text-right">{cents(n.billedCents)}</span><span className="w-24 text-right">{cents(n.costCents)}</span>
          <span className={`w-24 text-right ${neg(n.marginCents)}`}>{cents(n.marginCents)}</span><span className="w-12 text-right">{pct(n.marginPercent)}</span>
        </div>
        {isOpen && kids.map((k, i) => renderNode(k, depth + 1, `${key}/${k.id ?? i}`))}
      </div>
    )
  }

  return (
    <div className="p-4 max-w-6xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Margin &amp; turnover</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">What each client brings in after the caregiver&apos;s pay, and how many caregivers stay.</p>

      <div className="flex flex-wrap items-end gap-2 mb-3">
        {canMargin && tabBtn('margin', 'Client margin')}
        {canMargin && tabBtn('visits', 'Per visit')}
        {canMargin && tabBtn('trend', 'Trend & drill-down')}
        {canMargin && tabBtn('compare', 'Compare periods')}
        {hr.read && tabBtn('turnover', 'Turnover & hiring')}
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        {tab === 'compare' && <>
          <label className="text-sm">Compare from<br /><input type="date" className={inp} value={cmpStart} onChange={(e) => setCmpStart(e.target.value)} /></label>
          <label className="text-sm">Compare to<br /><input type="date" className={inp} value={cmpEnd} onChange={(e) => setCmpEnd(e.target.value)} /></label>
        </>}
        {tab !== 'turnover' && canMargin && <>
          {select('clientId', 'Client', lists?.clients)}
          {select('caregiverId', 'Caregiver', lists?.caregivers)}
          {select('referralSourceId', 'Referral source', lists?.referralSources)}
          {select('payerId', 'Payer', lists?.payers)}
        </>}
        {select('branchId', 'Branch', lists?.branches)}
        {tab === 'trend' && <label className="text-sm">By<br /><select className={inp} value={by} onChange={(e) => setBy(e.target.value as 'week' | 'month')}><option value="week">Week</option><option value="month">Month</option></select></label>}
      </div>

      {loading && <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>}

      {!loading && tab === 'margin' && margin && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-sm">
              <b>{cents(margin.totals.billedCents)}</b> billed · <b>{cents(margin.totals.costCents)}</b> caregiver cost · <b>{cents(margin.totals.marginCents)}</b> margin ({pct(margin.totals.marginPercent)}) over {margin.totals.hours} hours worked, {margin.totals.hoursInvoiced} hours invoiced
            </p>
            {downloads('client-margin')}
          </div>
          {margin.totals.clientsWithoutRate > 0 && <p className="text-sm mb-2 text-amber-800 dark:text-amber-300">{margin.totals.clientsWithoutRate} client(s) have no bill rate, so no margin is shown for them. Set a rate on the client or the payer.</p>}
          {margin.hoursWithoutClient > 0 && <p className="text-sm mb-2 text-gray-600 dark:text-slate-400">{margin.hoursWithoutClient} paid hours are not tied to a client and are left out of the table.</p>}
          {margin.clients.length === 0 ? (
            <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No paid visits in these dates.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Client</th><th className={TH}>Branch</th><th className={TH}>Payer</th><th className={TH}>Hours worked</th><th className={TH}>Hours invoiced</th><th className={TH}>Overtime hrs</th><th className={TH}>Bill rate</th><th className={TH}>Billed</th><th className={TH}>Cost</th><th className={TH}>Margin</th><th className={TH}>%</th></tr></thead>
                <tbody>
                  {margin.clients.map((r) => (
                    <tr key={r.clientId} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2 font-semibold">{r.clientName}</td>
                      <td className="px-3">{r.branchName ?? '—'}</td><td className="px-3">{r.payerName ?? (r.referralSourceName ? `Private pay (${r.referralSourceName})` : 'Private pay')}</td>
                      <td className="px-3">{r.hours}</td><td className="px-3">{r.hoursInvoiced}</td><td className="px-3">{r.overtimeHours}</td>
                      <td className="px-3">{r.rate === null ? 'None' : `$${r.rate.toFixed(2)}`}</td>
                      <td className="px-3">{cents(r.billedCents)}</td><td className="px-3">{cents(r.costCents)}</td>
                      <td className={`px-3 ${neg(r.marginCents)}`}>{cents(r.marginCents)}</td><td className="px-3">{pct(r.marginPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-5 mb-2">
            <h2 className="text-base font-semibold">Grouped by</h2>
            {([['byReferralSource', 'Referral source'], ['byPayer', 'Payer'], ['byDepartment', 'Department (care type)'], ['byBranch', 'Branch']] as const).map(([k, l]) => (
              <button key={k} type="button" className={`hc-btn hc-btn-sm ${grouping === k ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setGrouping(k)}>{l}</button>
            ))}
          </div>
          {margin[grouping].length > 0 && groupTable(margin[grouping], grouping === 'byReferralSource' ? 'Referral source' : grouping === 'byPayer' ? 'Payer' : grouping === 'byDepartment' ? 'Department' : 'Branch')}
          {grouping === 'byReferralSource' && margin.byReferralSource.length > 0 && <div className="mt-3"><BarChart title="Revenue by referral source" rows={margin.byReferralSource.map((g) => ({ label: g.name, value: g.billedCents, detail: `${g.clients} client(s)` }))} format={dollarsShort} /></div>}
          <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">Pay is the same figure payroll uses (overtime goes on the visits that went past 40 hours in a week). Paid travel time and double time are included when Pay rules are on. A department is the client&apos;s care type. Hours invoiced are what the invoices for these dates carry.</p>
        </>
      )}

      {!loading && tab === 'visits' && visits && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-sm"><b>{visits.totals.visits}</b> visits, {visits.totals.hours} hours · <b>{cents(visits.totals.billedCents)}</b> billed · <b>{cents(visits.totals.payCents)}</b> pay{visits.totals.travelPayCents ? ` · ${cents(visits.totals.travelPayCents)} paid travel` : ''}{visits.totals.mileageCents ? ` · ${cents(visits.totals.mileageCents)} mileage` : ''} · <b>{cents(visits.totals.marginCents)}</b> margin</p>
            {downloads('visit-margin')}
          </div>
          {visits.totals.visitsWithoutRate > 0 && <p className="text-sm mb-2 text-amber-800 dark:text-amber-300">{visits.totals.visitsWithoutRate} visit(s) are for a client with no bill rate.</p>}
          {visits.visits.length === 0 ? <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No paid visits in these dates.</div> : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Date</th><th className={TH}>Client</th><th className={TH}>Caregiver</th><th className={TH}>Hours</th><th className={TH}>Billed</th><th className={TH}>Pay</th><th className={TH}>Margin</th><th className={TH}>%</th></tr></thead>
                <tbody>{visits.visits.map((v) => (
                  <tr key={v.id} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="px-3 py-1.5">{formatAgencyDate(v.date)}</td><td className="px-3 font-semibold">{v.clientName}</td><td className="px-3">{v.caregiverName}</td><td className="px-3">{v.hours}</td>
                    <td className="px-3">{cents(v.billedCents)}</td><td className="px-3">{cents(v.payCents)}</td><td className={`px-3 ${neg(v.marginCents)}`}>{cents(v.marginCents)}</td><td className="px-3">{pct(v.marginPercent)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && tab === 'trend' && trend && (
        <>
          <LineChart title={`Billed, cost and margin by ${trend.by}`} labels={trend.points.map((p) => p.bucket)} format={dollarsShort}
            series={[{ name: 'Billed', values: trend.points.map((p) => p.billedCents) }, { name: 'Cost', values: trend.points.map((p) => p.costCents) }, { name: 'Margin', values: trend.points.map((p) => p.marginCents) }]} />
          {drill && (
            <div className="mt-5">
              <h2 className="text-base font-semibold mb-1">Drill down: agency → branch → team → client</h2>
              <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-2 pb-1">
                <div className="flex items-center gap-2 py-1.5 text-xs text-gray-600 dark:text-slate-400" style={{ paddingLeft: 8 }}><span className="w-5" /><span className="flex-1">Level</span><span className="w-16 text-right">Hours</span><span className="w-24 text-right">Billed</span><span className="w-24 text-right">Cost</span><span className="w-24 text-right">Margin</span><span className="w-12 text-right">%</span></div>
                {renderNode(drill, 0, 'total')}
              </div>
              <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">A branch is the client&apos;s; a team is the caregiver&apos;s (set on the caregiver&apos;s profile). Mileage sits under its branch with no team.</p>
            </div>
          )}
        </>
      )}

      {!loading && tab === 'compare' && compare && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {stat('Billed', `${cents(compare.current.totals.billedCents)} vs ${cents(compare.previous.totals.billedCents)}`)}
            {stat('Cost', `${cents(compare.current.totals.costCents)} vs ${cents(compare.previous.totals.costCents)}`)}
            {stat('Margin', `${cents(compare.current.totals.marginCents)} vs ${cents(compare.previous.totals.marginCents)}`)}
            {stat('Change in margin', `${compare.change.marginCents >= 0 ? '+' : ''}${cents(compare.change.marginCents)} · ${compare.change.hours >= 0 ? '+' : ''}${compare.change.hours} h`)}
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Client</th><th className={TH}>Hours {compare.current.period.start} – {compare.current.period.end}</th><th className={TH}>Margin</th><th className={TH}>Hours {compare.previous.period.start} – {compare.previous.period.end}</th><th className={TH}>Margin</th><th className={TH}>Change</th></tr></thead>
              <tbody>{compare.clients.map((r) => (
                <tr key={r.clientId} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-3 py-1.5 font-semibold">{r.clientName}</td>
                  <td className="px-3">{r.current ? r.current.hours : '—'}</td><td className={`px-3 ${neg(r.current?.marginCents ?? null)}`}>{cents(r.current?.marginCents)}</td>
                  <td className="px-3">{r.previous ? r.previous.hours : '—'}</td><td className={`px-3 ${neg(r.previous?.marginCents ?? null)}`}>{cents(r.previous?.marginCents)}</td>
                  <td className={`px-3 ${neg(r.changeCents)}`}>{r.changeCents === null ? '—' : `${r.changeCents >= 0 ? '+' : ''}${cents(r.changeCents)}`}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      {!loading && tab === 'turnover' && turnover && (
        <>
          <div className="flex justify-end mb-2">{downloads('turnover')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {stat('Caregivers at start', String(turnover.headcountStart))}{stat('Caregivers at end', String(turnover.headcountEnd))}
            {stat('Hired', String(turnover.hires))}{stat('Left', String(turnover.departures))}
            {stat('Turnover', pct(turnover.turnoverPercent))}{stat('Retention', pct(turnover.retentionPercent))}
            {stat('Kept 90 days', turnover.hiresWith90Days ? `${turnover.hiresKept90Days} of ${turnover.hiresWith90Days} (${pct(turnover.ninetyDayRetentionPercent)})` : '—')}
            {stat('Average stay of those who left', turnover.averageTenureDaysOfDeparted === null ? '—' : `${turnover.averageTenureDaysOfDeparted} days`)}
          </div>
          <h2 className="text-base font-semibold mb-1">Hiring</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {stat('Applicants', String(turnover.hiring.applicants))}
            {stat('Applicant to hire', turnover.hiring.applicantToHireRatio === null ? '—' : `${turnover.hiring.applicantToHireRatio} to 1 (${turnover.hiring.applicantsHired} hired)`)}
            {stat('Hire to first shift', turnover.hiring.hireToFirstShiftDays === null ? '—' : `${turnover.hiring.hireToFirstShiftDays} days (${turnover.hiring.hiresWhoStarted} started${turnover.hiring.hiresNotYetStarted ? `, ${turnover.hiring.hiresNotYetStarted} not yet` : ''})`)}
            {stat('Cost per hire', turnover.hiring.costPerHireCents === null ? (turnover.hiring.hiringSpendCents ? `${cents(turnover.hiring.hiringSpendCents)} spent, nobody hired` : '—') : cents(turnover.hiring.costPerHireCents))}
          </div>
          <h2 className="text-base font-semibold mb-1">Payroll accuracy</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {stat('Paid as recorded', pct(turnover.payrollAccuracy.accuracyPercent))}{stat('Shifts reviewed', String(turnover.payrollAccuracy.reviewed))}
            {stat('Corrected by the office', String(turnover.payrollAccuracy.corrected))}{stat('Pay periods disputed', `${turnover.payrollAccuracy.disputed} (${turnover.payrollAccuracy.verified} confirmed)`)}
          </div>
          {turnover.departed.length > 0 && (
            <>
              <h2 className="text-base font-semibold mb-1">Who left</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-4">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Hired</th><th className={TH}>Left on</th><th className={TH}>Reason</th><th className={TH}>Stayed</th><th className={TH}>Branch / team</th><th className={TH}>Manager</th></tr></thead>
                  <tbody>{turnover.departed.map((p) => (
                    <tr key={p.caregiverId} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-3 py-1.5 font-semibold">{p.name}</td><td className="px-3">{formatAgencyDate(p.hired)}</td>
                      <td className="px-3">{formatAgencyDate(p.leftOn)}{!p.exact && <span className="ml-1 text-xs text-gray-600 dark:text-slate-400">(last visit)</span>}</td>
                      <td className="px-3">{p.leftReason ?? '—'}</td><td className="px-3">{p.tenureDays} days</td><td className="px-3">{[p.branchName, p.team].filter(Boolean).join(' / ') || '—'}</td><td className="px-3">{p.managerName ?? '—'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>
          )}
          {turnover.reliability.length > 0 && (
            <>
              <h2 className="text-base font-semibold mb-1">Call-outs and missed visits</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-4">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Called out (absences)</th><th className={TH}>Visits cancelled by call-out</th><th className={TH}>Visits missed (no-show)</th></tr></thead>
                  <tbody>{turnover.reliability.map((r) => (
                    <tr key={r.caregiverId} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1.5 font-semibold">{r.name}</td><td className="px-3">{r.absences}</td><td className="px-3">{r.cancelledVisits}</td><td className="px-3">{r.missedVisits}</td></tr>))}</tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">
            A leaving date is stored on the caregiver&apos;s profile (deactivating a caregiver dates it today). {turnover.departuresWithoutLeavingDate > 0 ? `${turnover.departuresWithoutLeavingDate} of those who left have none yet, so their last visit stands in.` : 'Every departure here has one.'} Cost per hire counts expenses filed under hiring, recruiting, onboarding, background checks or job ads.
          </p>
        </>
      )}
    </div>
  )
}
