// Reports: dashboards, a report builder, the daily manager report, workforce analytics, caregiver performance and scheduled report
// emails (parity row 12, care_report_builder). server/crm/homecare/planning/reportBuilder.ts (/api/report-builder).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, downloadFile, saveBlob, rows } from '../lib/http'
import { agencyToday, formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'
import { LineChart, BarChart } from '../lib/Chart'
import { cents } from './MarginReports'

type Tab = 'dashboards' | 'builder' | 'daily' | 'workforce' | 'performance' | 'schedules'
interface Field { key: string; label: string; type: string; group: string; payroll?: boolean }
interface Rule { op: string; label: string; types: string[]; needsValue: boolean }
interface Filter { field: string; op: string; value?: string }
interface Definition { name: string; description?: string | null; columns: string[]; filters: Filter[]; sortBy?: string | null; sortDir?: 'asc' | 'desc' | null; groupBy?: string | null }
interface Saved extends Definition { id: string; copiedFromId?: string | null }
interface Run { period: { start: string; end: string }; rows: Record<string, any>[]; count: number; sums: Record<string, number>; groups: { key: string | null; label: string; rows: number; sums: Record<string, number> }[] | null; columns: { key: string; label: string; type: string }[] }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const TH = 'px-3 py-2 text-left'
const card = 'rounded-lg border p-3 border-gray-200 dark:border-slate-700'
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const dollarsShort = (v: number) => `$${(v / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const cellText = (v: unknown, type: string) => (v === null || v === undefined || v === '' ? '—' : type === 'cents' ? cents(Number(v)) : type === 'bool' ? (v ? 'Yes' : 'No') : type === 'date' ? formatAgencyDate(String(v)) : String(v))
const Stat = ({ label, value }: { label: string; value: string }) => <div className={card}><div className="text-xs text-gray-600 dark:text-slate-400">{label}</div><div className="text-lg font-semibold">{value}</div></div>
const Empty = ({ text }: { text: string }) => <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">{text}</div>

export default function ReportBuilder() {
  const billing = useMay('care-billing'), payroll = useMay('care-payroll'), hr = useMay('care-hr')
  const [tab, setTab] = useState<Tab>('dashboards')
  if (!billing.read && !hr.read) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to these reports.</div>
  const tabs: [Tab, string, boolean][] = [
    ['dashboards', 'Dashboards', billing.read || hr.read], ['builder', 'Report builder', billing.read], ['daily', 'Daily manager report', billing.read],
    ['workforce', 'Workforce', hr.read], ['performance', 'Caregiver performance', hr.read], ['schedules', 'Scheduled emails', billing.update],
  ]
  return (
    <div className="p-4 max-w-6xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Reports &amp; dashboards</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">Dashboards, your own reports over every visit, the daily manager report, workforce and performance, and reports emailed on a schedule.</p>
      <div className="flex flex-wrap gap-2 mb-4">{tabs.filter((t) => t[2]).map(([id, label]) => <button key={id} type="button" className={`hc-btn hc-btn-sm ${tab === id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'dashboards' && <Dashboards canMoney={billing.read && payroll.read} canHr={hr.read} canManage={billing.update} />}
      {tab === 'builder' && <Builder canManage={billing.update} />}
      {tab === 'daily' && <DailyManager />}
      {tab === 'workforce' && <Workforce />}
      {tab === 'performance' && <Performance />}
      {tab === 'schedules' && <Schedules />}
    </div>
  )
}

function useRange(days = 30) {
  const [end, setEnd] = useState(agencyToday())
  const [start, setStart] = useState(shift(agencyToday(), -(days - 1)))
  const q = `startDate=${start}&endDate=${end}`
  const picker = (
    <>
      <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
    </>
  )
  return { start, end, q, picker }
}
function useDownload() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const go = async (path: string, fallback: string) => {
    setBusy(true)
    try { const { blob, fileName } = await downloadFile(path); saveBlob(blob, fileName || fallback) } catch (e) { toast.error(errorMessage(e, 'Could not download the report')) } finally { setBusy(false) }
  }
  const buttons = (path: string, base: string) => (
    <span className="flex gap-2">
      <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={busy} onClick={() => go(`${path}${path.includes('?') ? '&' : '?'}format=csv`, `${base}.csv`)}>Download CSV</button>
      <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={busy} onClick={() => go(`${path}${path.includes('?') ? '&' : '?'}format=pdf`, `${base}.pdf`)}>Download PDF</button>
    </span>
  )
  return { buttons }
}

// ── Dashboards ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function GroupBars({ title, groups }: { title: string; groups: any[] }) {
  return <BarChart title={title} rows={(groups ?? []).map((g: any) => ({ label: g.name, value: g.marginCents, detail: `billed ${cents(g.billedCents)}, ${g.clients} client(s)` }))} format={dollarsShort} emptyText="No paid visits in this window." />
}
function Dashboards({ canMoney, canHr, canManage }: { canMoney: boolean; canHr: boolean; canManage: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [which, setWhich] = useState<string>(canMoney ? 'financial' : canHr ? 'caregivers' : 'authorizations')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<any>(null)
  const [customs, setCustoms] = useState<any[]>([])
  const [tiles, setTiles] = useState<{ kind: string; label: string }[]>([])
  const [editing, setEditing] = useState<{ id?: string; name: string; tiles: { kind: string; title?: string; days?: number; by?: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const loadCustoms = useCallback(async () => { try { setCustoms(rows(await api.get('/api/report-builder/dashboards/custom'))) } catch { setCustoms([]) } }, [])
  useEffect(() => { loadCustoms(); api.get('/api/report-builder/tiles').then((r: any) => setTiles(r.tiles ?? [])).catch(() => setTiles([])) }, [loadCustoms])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (which === 'financial') setData(await api.get(`/api/report-builder/dashboards/financial?days=${days}`))
      else if (which === 'authorizations') setData(await api.get('/api/report-builder/dashboards/authorizations'))
      else if (which === 'caregivers') setData(await api.get(`/api/report-builder/dashboards/caregivers?days=${days}`))
      else setData(await api.get(`/api/report-builder/dashboards/custom/${which}/data`))
    } catch (e) { toast.error(errorMessage(e, 'Could not load the dashboard')); setData(null) }
    finally { setLoading(false) }
  }, [which, days, toast])
  useEffect(() => { load() }, [load])
  const saveCustom = async () => {
    if (!editing) return
    try {
      if (editing.id) await api.put(`/api/report-builder/dashboards/custom/${editing.id}`, { name: editing.name, tiles: editing.tiles })
      else { const r: any = await api.post('/api/report-builder/dashboards/custom', { name: editing.name, tiles: editing.tiles }); setWhich(r.id) }
      toast.success('Dashboard saved'); setEditing(null); await loadCustoms(); load()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the dashboard')) }
  }
  const removeCustom = async (id: string, name: string) => {
    if (!(await confirm(`Delete the dashboard "${name}"? Its tiles are not kept.`, { title: 'Delete dashboard', confirmText: 'Delete', danger: true }))) return
    try { await api.delete(`/api/report-builder/dashboards/custom/${id}`); setWhich(canMoney ? 'financial' : 'caregivers'); loadCustoms() } catch (e) { toast.error(errorMessage(e, 'Could not delete it')) }
  }
  const btn = (id: string, label: string) => <button key={id} type="button" className={`hc-btn hc-btn-sm ${which === id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setWhich(id)}>{label}</button>
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        {canMoney && btn('financial', 'Financial')}{btn('authorizations', 'Authorization utilisation')}{canHr && btn('caregivers', 'Caregivers')}
        {customs.map((c) => btn(c.id, c.name))}
        {canManage && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditing({ name: '', tiles: [{ kind: 'margin_total' }] })}>+ New dashboard</button>}
        <label className="text-sm ml-auto">Window<br /><select className={inp} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 14, 30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></label>
      </div>
      {editing && (
        <div className={`${card} mb-4`}>
          <h2 className="font-semibold mb-2">{editing.id ? 'Edit dashboard' : 'New dashboard'}</h2>
          <label className="text-sm block mb-2">Name<br /><input className={inp} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          {editing.tiles.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
              <label className="text-sm">Tile<br /><select className={inp} value={t.kind} onChange={(e) => setEditing({ ...editing, tiles: editing.tiles.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>{tiles.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
              <label className="text-sm">Title (optional)<br /><input className={inp} value={t.title ?? ''} onChange={(e) => setEditing({ ...editing, tiles: editing.tiles.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} /></label>
              <label className="text-sm">Days<br /><input type="number" min={1} max={400} className={`${inp} w-20`} value={t.days ?? 30} onChange={(e) => setEditing({ ...editing, tiles: editing.tiles.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)) })} /></label>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditing({ ...editing, tiles: editing.tiles.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditing({ ...editing, tiles: [...editing.tiles, { kind: 'margin_by_branch' }] })}>+ Add tile</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={saveCustom}>Save</button>
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {loading && <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>}
      {!loading && data && which === 'financial' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Billed" value={cents(data.totals.billedCents)} /><Stat label="Caregiver cost" value={cents(data.totals.costCents)} /><Stat label="Margin" value={`${cents(data.totals.marginCents)} (${pct(data.totals.marginPercent)})`} />
            <Stat label="Owed now" value={`${cents(data.receivables.currentCents + data.receivables.overCents + data.receivables.over30Cents)} · ${cents(data.receivables.over30Cents)} over 30 days`} />
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <LineChart title="Margin trend (weekly, last 12 weeks)" labels={data.trend.map((p: any) => p.bucket)} format={dollarsShort} series={[{ name: 'Billed', values: data.trend.map((p: any) => p.billedCents) }, { name: 'Cost', values: data.trend.map((p: any) => p.costCents) }, { name: 'Margin', values: data.trend.map((p: any) => p.marginCents) }]} />
            <LineChart title="Invoiced, collected and payroll by month" labels={data.months.map((m: any) => m.month)} format={dollarsShort} series={[{ name: 'Invoiced', values: data.months.map((m: any) => m.invoicedCents) }, { name: 'Collected', values: data.months.map((m: any) => m.collectedCents) }, { name: 'Payroll', values: data.months.map((m: any) => m.payrollCents) }]} />
            <GroupBars title="Profit margin by branch (location)" groups={data.byBranch} /><GroupBars title="Profit margin by referral source" groups={data.byReferralSource} />
            <GroupBars title="Profit margin by payer" groups={data.byPayer} /><GroupBars title="Profit margin by department (care type)" groups={data.byDepartment} />
          </div>
        </>
      )}
      {!loading && data && which === 'authorizations' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Stat label="Active authorizations" value={String(data.summary.active)} /><Stat label="Running out early" value={String(data.summary.runningOutEarly)} /><Stat label="Under-used" value={String(data.summary.underUsed)} /><Stat label="Ending in 30 days" value={String(data.summary.endingIn30Days)} /><Stat label="Over 80% used" value={String(data.summary.over80Percent)} />
          </div>
          {data.authorizations.length === 0 ? <Empty text="No active authorizations." /> : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Client</th><th className={TH}>Payer</th><th className={TH}>Authorization</th><th className={TH}>Units</th><th className={TH}>Used</th><th className={TH}>Expected by now</th><th className={TH}>Ends</th><th className={TH}>Pace</th></tr></thead>
                <tbody>{data.authorizations.map((a: any) => <tr key={a.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1.5 font-semibold">{a.clientName}</td><td className="px-3">{a.payerName ?? '—'}</td><td className="px-3">{a.authNumber ?? '—'}{a.procedureCode ? ` · ${a.procedureCode}` : ''}</td><td className="px-3">{a.authorizedUnits} {a.unitType}</td><td className="px-3">{a.usedUnits} ({pct(a.usedPercent)})</td><td className="px-3">{pct(a.expectedPercent)}</td><td className="px-3">{formatAgencyDate(a.endDate)} ({a.daysLeft} days)</td><td className={`px-3 ${a.pace === 'Running out early' ? 'text-red-700 dark:text-red-300 font-semibold' : ''}`}>{a.pace}</td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
      {!loading && data && which === 'caregivers' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Caregivers" value={String(data.headcount)} /><Stat label="Turnover (90 days)" value={`${pct(data.turnover90Days.turnoverPercent)} · ${data.turnover90Days.hires} hired, ${data.turnover90Days.departures} left`} />
            <Stat label="On time" value={pct(data.performance.averageOnTimePercent)} /><Stat label="Underused" value={`${data.workforce.underused} of ${data.workforce.caregivers}`} />
            <Stat label="Visits missed" value={String(data.performance.visitsMissed)} /><Stat label="Cancelled by caregivers" value={String(data.workforce.cancelledByCaregiver)} />
            {data.retention && !data.retention.withheld && <><Stat label="Satisfaction (latest)" value={data.retention.latestAverage === null ? '—' : `${data.retention.latestAverage} / 5`} /><Stat label="At-risk caregivers" value={String(data.retention.atRisk)} /></>}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <LineChart title="Cancellations by week" labels={data.cancellationTrend.map((p: any) => p.week)} series={[{ name: 'By caregiver', values: data.cancellationTrend.map((p: any) => p.byCaregiver) }, { name: 'By client', values: data.cancellationTrend.map((p: any) => p.byClient) }]} emptyText="No cancellations in this window." />
            <BarChart title="Lowest on-time share" rows={data.performance.lowestOnTime.map((c: any) => ({ label: c.name, value: c.onTimePercent, detail: `${c.lateClockIns} late` }))} format={(v) => `${v}%`} max={100} emptyText="No matched visits yet." />
          </div>
          {data.underused.length > 0 && <div className="mt-4"><h3 className="font-semibold mb-1">Underused caregivers</h3><ul className="text-sm list-disc ml-5">{data.underused.map((c: any) => <li key={c.caregiverId}>{c.name}: {c.hoursPerWeek} h a week, wants {c.hoursWanted ?? '—'}, will do up to {c.maxHoursPerWeek ?? '—'}</li>)}</ul></div>}
        </>
      )}
      {!loading && data && data.tiles && (
        <>
          {canManage && <div className="flex gap-2 mb-3"><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { const c = customs.find((x) => x.id === which); if (c) setEditing({ id: c.id, name: c.name, tiles: c.tiles }) }}>Edit</button><button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => removeCustom(data.id, data.name)}>Delete</button></div>}
          <div className="grid md:grid-cols-2 gap-4">{data.tiles.map((t: any, i: number) => <CustomTile key={i} tile={t} />)}</div>
        </>
      )}
    </>
  )
}
function CustomTile({ tile: t }: { tile: any }) {
  if (t.withheld) return <div className={card}><div className="font-semibold">{t.title}</div><div className="text-sm text-gray-600 dark:text-slate-400">{t.withheld === 'permission' ? 'You do not have access to this tile.' : t.withheld === 'feature' ? 'This tile needs a feature that is not on.' : 'Unknown tile.'}</div></div>
  switch (t.kind) {
    case 'margin_total': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{cents(t.totals.billedCents)} billed · {cents(t.totals.costCents)} cost · <b>{cents(t.totals.marginCents)}</b> margin ({pct(t.totals.marginPercent)})</div></div>
    case 'margin_by_branch': case 'margin_by_referral_source': case 'margin_by_payer': return <div className={card}><GroupBars title={t.title} groups={t.groups} /></div>
    case 'margin_trend': return <div className={card}><LineChart title={t.title} labels={t.points.map((p: any) => p.bucket)} format={dollarsShort} series={[{ name: 'Billed', values: t.points.map((p: any) => p.billedCents) }, { name: 'Cost', values: t.points.map((p: any) => p.costCents) }, { name: 'Margin', values: t.points.map((p: any) => p.marginCents) }]} /></div>
    case 'invoiced_by_month': return <div className={card}><LineChart title={t.title} labels={t.months.map((m: any) => m.month)} format={dollarsShort} series={[{ name: 'Invoiced', values: t.months.map((m: any) => m.invoicedCents) }, { name: 'Collected', values: t.months.map((m: any) => m.collectedCents) }, { name: 'Payroll', values: t.months.map((m: any) => m.payrollCents) }]} /></div>
    case 'receivables': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{cents(t.receivables.currentCents)} not yet due · {cents(t.receivables.overCents)} up to 30 days late · <b>{cents(t.receivables.over30Cents)}</b> over 30 days · {t.receivables.openInvoices} open invoices</div></div>
    case 'authorization_summary': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{t.summary.active} active · {t.summary.runningOutEarly} running out early · {t.summary.underUsed} under-used · {t.summary.endingIn30Days} ending in 30 days</div></div>
    case 'turnover': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{t.headcountEnd} caregivers · {t.hires} hired, {t.departures} left · turnover {pct(t.turnoverPercent)} · kept 90 days {pct(t.ninetyDayRetentionPercent)}</div></div>
    case 'workforce': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{t.summary.hoursWorked} hours · {t.summary.underused} underused · {t.summary.overloaded} over their most hours</div>{t.underused.length > 0 && <ul className="text-sm list-disc ml-5 mt-1">{t.underused.map((c: any) => <li key={c.caregiverId}>{c.name}: {c.hoursPerWeek} h a week (wants {c.hoursWanted ?? '—'})</li>)}</ul>}</div>
    case 'cancellation_trend': return <div className={card}><LineChart title={t.title} labels={t.points.map((p: any) => p.week)} series={[{ name: 'By caregiver', values: t.points.map((p: any) => p.byCaregiver) }, { name: 'By client', values: t.points.map((p: any) => p.byClient) }]} emptyText="No cancellations." /></div>
    case 'performance_summary': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{t.totals.visitsCompleted} completed · {t.totals.visitsMissed} missed · {t.totals.visitsCancelled} cancelled · {t.totals.lateClockIns} late clock-ins</div></div>
    case 'daily_manager': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">{t.visits.scheduled} scheduled · {t.visits.completed} done · {t.visits.inProgress} in progress · {t.visits.missed} missed · {t.visits.cancelled} cancelled · {t.visits.lateClockIns} late · {t.attention.openShiftsUnfilled} open shifts unfilled</div></div>
    case 'retention': return <div className={card}><div className="font-semibold mb-1">{t.title}</div><div className="text-sm">Satisfaction {t.latestAverage === null || t.latestAverage === undefined ? '—' : `${t.latestAverage} / 5`} · {t.atRisk ?? 0} at-risk caregiver(s)</div></div>
    default: return <div className={card}>{t.title}</div>
  }
}

// ── Report builder ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function Builder({ canManage }: { canManage: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { q, picker, start, end } = useRange(30)
  const dl = useDownload()
  const [fields, setFields] = useState<Field[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [library, setLibrary] = useState<(Definition & { key: string })[]>([])
  const [saved, setSaved] = useState<Saved[]>([])
  const [def, setDef] = useState<Definition>({ name: 'New report', columns: ['date', 'clientName', 'caregiverName', 'clockedMinutes'], filters: [], sortBy: 'date', sortDir: 'asc', groupBy: null })
  const [savedId, setSavedId] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [running, setRunning] = useState(false)
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const loadSaved = useCallback(async () => { try { setSaved(rows(await api.get('/api/report-builder/reports'))) } catch { setSaved([]) } }, [])
  useEffect(() => {
    api.get('/api/report-builder/fields').then((r: any) => { setFields(r.fields); setRules(r.rules); setLibrary(r.library) }).catch((e) => toast.error(errorMessage(e, 'Could not load the fields')))
    loadSaved()
  }, [loadSaved, toast])
  const doRun = async () => {
    setRunning(true)
    try { setRun(await api.post(`/api/report-builder/run?${q}`, { definition: def, startDate: start, endDate: end }) as Run) } catch (e) { toast.error(errorMessage(e, 'Could not run the report')) } finally { setRunning(false) }
  }
  const save = async () => {
    try {
      if (savedId) await api.put(`/api/report-builder/reports/${savedId}`, def)
      else { const r: any = await api.post('/api/report-builder/reports', def); setSavedId(r.id) }
      toast.success('Report saved'); loadSaved()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the report')) }
  }
  const openSaved = (s: Saved) => { setSavedId(s.id); setDef({ name: s.name, description: s.description, columns: s.columns, filters: s.filters, sortBy: s.sortBy, sortDir: s.sortDir, groupBy: s.groupBy }); setRun(null) }
  const copy = async (body: { id?: string; libraryKey?: string }) => {
    try { const r: any = await api.post('/api/report-builder/reports/copy', body); toast.success(`Copied as "${r.name}"`); await loadSaved(); openSaved(r) } catch (e) { toast.error(errorMessage(e, 'Could not copy it')) }
  }
  const remove = async (s: Saved) => {
    if (!(await confirm(`Delete the report "${s.name}"? A scheduled email that sends it stops with it.`, { title: 'Delete report', confirmText: 'Delete', danger: true }))) return
    try { await api.delete(`/api/report-builder/reports/${s.id}`); if (savedId === s.id) setSavedId(null); loadSaved() } catch (e) { toast.error(errorMessage(e, 'Could not delete it')) }
  }
  const setFilter = (i: number, patch: Partial<Filter>) => setDef({ ...def, filters: def.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const groups = [...new Set(fields.map((f) => f.group))]
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <div>
        <h3 className="font-semibold mb-1">Standard library</h3>
        <ul className="text-sm mb-3">{library.map((l) => <li key={l.key} className="flex items-center justify-between gap-2 py-1 border-t border-gray-100 dark:border-slate-700"><span title={l.description ?? ''}>{l.name}</span>{canManage ? <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => copy({ libraryKey: l.key })}>Copy</button> : <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setSavedId(null); setDef({ ...l }); setRun(null) }}>Open</button>}</li>)}</ul>
        <h3 className="font-semibold mb-1">Your saved reports</h3>
        {saved.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">None yet. Copy one from the library or save the one you build.</p> : (
          <ul className="text-sm">{saved.map((s) => <li key={s.id} className={`flex items-center justify-between gap-2 py-1 border-t border-gray-100 dark:border-slate-700 ${savedId === s.id ? 'font-semibold' : ''}`}><button type="button" className="text-left underline" onClick={() => openSaved(s)}>{s.name}</button>{canManage && <span className="flex gap-1"><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => copy({ id: s.id })}>Copy</button><button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => remove(s)}>Delete</button></span>}</li>)}</ul>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-sm">Report name<br /><input className={inp} value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} /></label>
          {picker}
          <button type="button" className="hc-btn hc-btn-sm hc-btn-primary" disabled={running} onClick={doRun}>Run</button>
          {canManage && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={save}>{savedId ? 'Save changes' : 'Save as new'}</button>}
          {canManage && savedId && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setSavedId(null); setDef({ ...def, name: `${def.name} (copy)` }) }}>Save as a copy…</button>}
          {savedId && dl.buttons(`/api/report-builder/reports/${savedId}/run?${q}`, def.name)}
        </div>
        <div className={`${card} mb-3`}>
          <div className="font-semibold mb-1">Columns</div>
          {groups.map((g) => <div key={g} className="flex flex-wrap gap-x-3 gap-y-1 mb-1 text-sm"><span className="w-20 text-gray-600 dark:text-slate-400">{g}</span>{fields.filter((f) => f.group === g).map((f) => <label key={f.key} className="flex items-center gap-1"><input type="checkbox" checked={def.columns.includes(f.key)} onChange={(e) => setDef({ ...def, columns: e.target.checked ? [...def.columns, f.key] : def.columns.filter((k) => k !== f.key) })} />{f.label}</label>)}</div>)}
        </div>
        <div className={`${card} mb-3`}>
          <div className="font-semibold mb-1">Filters</div>
          {def.filters.map((f, i) => {
            const field = byKey.get(f.field)
            const ops = rules.filter((r) => !field || r.types.includes(field.type))
            const rule = ops.find((r) => r.op === f.op)
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
                <select className={inp} value={f.field} onChange={(e) => setFilter(i, { field: e.target.value, op: 'is' })}>{fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                <select className={inp} value={f.op} onChange={(e) => setFilter(i, { op: e.target.value })}>{ops.map((r) => <option key={r.op} value={r.op}>{r.label}</option>)}</select>
                {rule?.needsValue !== false && (field?.type === 'bool' ? <select className={inp} value={String(f.value ?? 'true')} onChange={(e) => setFilter(i, { value: e.target.value })}><option value="true">Yes</option><option value="false">No</option></select>
                  : <input className={inp} type={field?.type === 'date' ? 'date' : field?.type === 'time' ? 'time' : ['number', 'cents', 'minutes'].includes(field?.type ?? '') ? 'number' : 'text'} value={f.value ?? ''} onChange={(e) => setFilter(i, { value: e.target.value })} placeholder={field?.type === 'cents' ? 'dollars' : ''} />)}
                <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setDef({ ...def, filters: def.filters.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            )
          })}
          <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setDef({ ...def, filters: [...def.filters, { field: 'clientName', op: 'contains', value: '' }] })}>+ Add filter</button>
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-sm">Sort by<br /><select className={inp} value={def.sortBy ?? ''} onChange={(e) => setDef({ ...def, sortBy: e.target.value || null })}><option value="">None</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          <label className="text-sm">Order<br /><select className={inp} value={def.sortDir ?? 'asc'} onChange={(e) => setDef({ ...def, sortDir: e.target.value as 'asc' | 'desc' })}><option value="asc">Lowest first</option><option value="desc">Highest first</option></select></label>
          <label className="text-sm">Group by<br /><select className={inp} value={def.groupBy ?? ''} onChange={(e) => setDef({ ...def, groupBy: e.target.value || null })}><option value="">None</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
        </div>
        {run && (
          <>
            <p className="text-sm mb-2"><b>{run.count}</b> visit(s) {formatAgencyDate(run.period.start)} – {formatAgencyDate(run.period.end)}{Object.entries(run.sums).map(([k, v]) => <span key={k}> · {byKey.get(k)?.label ?? k}: {cellText(v, byKey.get(k)?.type ?? 'number')}</span>)}</p>
            {run.groups && <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-3"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>{byKey.get(def.groupBy ?? '')?.label ?? 'Group'}</th><th className={TH}>Visits</th>{Object.keys(run.sums).map((k) => <th key={k} className={TH}>{byKey.get(k)?.label ?? k}</th>)}</tr></thead><tbody>{run.groups.map((g) => <tr key={g.key ?? 'none'} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{g.label}</td><td className="px-3">{g.rows}</td>{Object.keys(run.sums).map((k) => <td key={k} className="px-3">{cellText(g.sums[k], byKey.get(k)?.type ?? 'number')}</td>)}</tr>)}</tbody></table></div>}
            {run.rows.length === 0 ? <Empty text="No visits match." /> : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800">{run.columns.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}</tr></thead>
                <tbody>{run.rows.slice(0, 500).map((r) => <tr key={r.visitId} className="border-t border-gray-100 dark:border-slate-700">{run.columns.map((c) => <td key={c.key} className="px-3 py-1">{cellText(r[c.key], c.type)}</td>)}</tr>)}</tbody></table>
                {run.rows.length > 500 && <p className="text-xs p-2 text-gray-600 dark:text-slate-400">Showing the first 500 of {run.rows.length}; the download has them all.</p>}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Daily manager report ─────────────────────────────────────────────────────────────────────────────────────────────────────
function DailyManager() {
  const toast = useToast()
  const dl = useDownload()
  const [date, setDate] = useState(agencyToday())
  const [r, setR] = useState<any>(null)
  useEffect(() => { api.get(`/api/report-builder/daily-manager?date=${date}`).then(setR).catch((e) => { toast.error(errorMessage(e, 'Could not load the day')); setR(null) }) }, [date, toast])
  if (!r) return <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const v = r.visits, a = r.attention
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3"><label className="text-sm">Day<br /><input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>{dl.buttons(`/api/report-builder/daily-manager?date=${date}`, `daily-manager-${date}`)}</div>
      <h3 className="font-semibold mb-1">Visits</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Scheduled" value={`${v.scheduled} (${v.scheduledHours} h${v.unassigned ? `, ${v.unassigned} unassigned` : ''})`} /><Stat label="Completed" value={String(v.completed)} /><Stat label="In progress" value={String(v.inProgress)} /><Stat label="Hours clocked" value={String(v.clockedHours)} />
        <Stat label="Late clock-ins" value={String(v.lateClockIns)} /><Stat label="Missed (no-show)" value={`${v.missed}${v.missedStillOpen ? ` (${v.missedStillOpen} open)` : ''}`} /><Stat label="Cancelled" value={`${v.cancelled}${v.caregiverCallouts ? ` (${v.caregiverCallouts} call-outs)` : ''}`} /><Stat label="Never clocked" value={String(v.notClocked)} />
      </div>
      <h3 className="font-semibold mb-1">Needs attention</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Open shifts unfilled" value={String(a.openShiftsUnfilled)} /><Stat label="Incidents" value={String(a.incidents)} /><Stat label="New applicants" value={String(a.newApplicants)} /><Stat label="Family requests open" value={String(a.familyRequestsOpen)} />
        <Stat label="Punches awaiting approval" value={String(a.punchesAwaitingApproval)} /><Stat label="Authorizations ending in 14 days" value={String(a.authorizationsEndingIn14Days)} /><Stat label="Credentials expiring in 14 days" value={String(a.credentialsExpiringIn14Days)} />
      </div>
      {r.money && <><h3 className="font-semibold mb-1">Money</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"><Stat label="Billed" value={cents(r.money.billedCents)} /><Stat label="Caregiver pay" value={cents(r.money.payCents)} /><Stat label="Margin" value={cents(r.money.marginCents)} /><Stat label="Paid visits" value={`${r.money.visits}${r.money.visitsWithoutRate ? ` (${r.money.visitsWithoutRate} without a rate)` : ''}`} /></div></>}
      {r.notClocked.length > 0 && <><h3 className="font-semibold mb-1">Scheduled but never clocked</h3><div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Start</th><th className={TH}>End</th><th className={TH}>Caregiver</th><th className={TH}>Client</th></tr></thead><tbody>{r.notClocked.map((x: any) => <tr key={x.scheduleId + x.start} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1">{x.start}</td><td className="px-3">{x.end}</td><td className="px-3">{x.caregiverName}</td><td className="px-3">{x.clientName}</td></tr>)}</tbody></table></div></>}
    </>
  )
}

// ── Workforce ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function Workforce() {
  const toast = useToast()
  const dl = useDownload()
  const { q, picker } = useRange(28)
  const [r, setR] = useState<any>(null)
  useEffect(() => { api.get(`/api/report-builder/workforce?${q}`).then(setR).catch((e) => { toast.error(errorMessage(e, 'Could not load the workforce report')); setR(null) }) }, [q, toast])
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">{picker}{dl.buttons(`/api/report-builder/workforce?${q}`, 'workforce')}</div>
      {!r ? <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4"><Stat label="Caregivers" value={String(r.summary.caregivers)} /><Stat label="Hours worked" value={String(r.summary.hoursWorked)} /><Stat label="Underused" value={String(r.summary.underused)} /><Stat label="Over their most hours" value={String(r.summary.overloaded)} /><Stat label="Visits cancelled" value={`${r.summary.cancelled} (${r.summary.cancelledByCaregiver} by caregivers)`} /></div>
          <div className="mb-4"><LineChart title="Cancellations by week" labels={r.cancellationTrend.map((p: any) => p.week)} series={[{ name: 'By caregiver', values: r.cancellationTrend.map((p: any) => p.byCaregiver) }, { name: 'By client', values: r.cancellationTrend.map((p: any) => p.byClient) }]} emptyText="No cancellations in this window." /></div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Branch / team</th><th className={TH}>Hours worked</th><th className={TH}>A week</th><th className={TH}>Wants</th><th className={TH}>Most</th><th className={TH}>Utilisation</th><th className={TH}>Status</th><th className={TH}>Call-outs</th><th className={TH}>Missed</th></tr></thead>
            <tbody>{r.caregivers.map((c: any) => <tr key={c.caregiverId} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{c.name}</td><td className="px-3">{[c.branchName, c.team].filter(Boolean).join(' / ') || '—'}</td><td className="px-3">{c.hoursWorked}</td><td className="px-3">{c.hoursPerWeek}</td><td className="px-3">{c.hoursWanted ?? '—'}</td><td className="px-3">{c.maxHoursPerWeek ?? '—'}</td><td className="px-3">{pct(c.utilisationPercent)}</td><td className={`px-3 ${c.underused || c.overloaded ? 'text-amber-800 dark:text-amber-300 font-semibold' : ''}`}>{c.status}</td><td className="px-3">{c.callouts}</td><td className="px-3">{c.missedVisits}</td></tr>)}</tbody></table></div>
          <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">Underused: a quarter or more under the hours they asked for (or under half their most hours when they named none). Hours wanted and the most hours come from the caregiver's availability.</p>
        </>
      )}
    </>
  )
}

// ── Caregiver performance ────────────────────────────────────────────────────────────────────────────────────────────────────
function Performance() {
  const toast = useToast()
  const dl = useDownload()
  const { q, picker } = useRange(30)
  const [r, setR] = useState<any>(null)
  useEffect(() => { api.get(`/api/report-builder/performance?${q}`).then(setR).catch((e) => { toast.error(errorMessage(e, 'Could not load the performance report')); setR(null) }) }, [q, toast])
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">{picker}{dl.buttons(`/api/report-builder/performance?${q}`, 'caregiver-performance')}</div>
      {!r ? <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div> : r.caregivers.length === 0 ? <Empty text="No visits in this window." /> : (
        <>
          <p className="text-sm mb-2">{r.totals.visitsCompleted} visits completed · {r.totals.visitsMissed} missed · {r.totals.visitsCancelled} cancelled by a call-out · {r.totals.lateClockIns} late clock-ins (more than {r.graceMinutes} minutes)</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Caregiver</th><th className={TH}>Scheduled</th><th className={TH}>Completed</th><th className={TH}>Missed</th><th className={TH}>Cancelled</th><th className={TH}>Late in</th><th className={TH}>Late out</th><th className={TH}>On time</th><th className={TH}>ADLs done</th><th className={TH}>Forms done</th><th className={TH}>Signed</th><th className={TH}>Client rating</th><th className={TH}>Hours</th></tr></thead>
            <tbody>{r.caregivers.map((c: any) => <tr key={c.caregiverId} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{c.name}</td><td className="px-3">{c.visitsScheduled}</td><td className="px-3">{c.visitsCompleted}</td><td className={`px-3 ${c.visitsMissed ? 'text-red-700 dark:text-red-300 font-semibold' : ''}`}>{c.visitsMissed}</td><td className="px-3">{c.visitsCancelled}</td><td className="px-3">{c.lateClockIns}</td><td className="px-3">{c.lateClockOuts}</td><td className="px-3">{pct(c.onTimePercent)}</td><td className="px-3">{c.adlCompletionPercent === null ? '—' : `${pct(c.adlCompletionPercent)} (${c.tasksDone} of ${c.tasksDone + c.tasksSkipped})`}</td><td className="px-3">{c.formCompletionPercent === null ? '—' : `${pct(c.formCompletionPercent)} (${c.formsDone} of ${c.formsDone + c.formsMissed})`}</td><td className="px-3">{pct(c.signedPercent)}</td><td className="px-3">{c.averageRating === null ? '—' : `${c.averageRating} / 5 (${c.ratings})`}</td><td className="px-3">{c.hoursWorked}</td></tr>)}</tbody></table></div>
        </>
      )}
    </>
  )
}

// ── Scheduled report emails ──────────────────────────────────────────────────────────────────────────────────────────────────
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function Schedules() {
  const toast = useToast()
  const confirm = useConfirm()
  const [kinds, setKinds] = useState<{ kind: string; label: string }[]>([])
  const [list, setList] = useState<any[]>([])
  const [saved, setSaved] = useState<Saved[]>([])
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [deliveries, setDeliveries] = useState<any[]>([])
  const blank = { name: '', reportKind: 'client_margin', reportId: '', format: 'csv', cadence: 'weekly', dayOfWeek: 1, dayOfMonth: 1, hour: 6, windowDays: 7, recipients: [] as string[] }
  const [form, setForm] = useState<any>(null)
  const load = useCallback(async () => {
    try {
      const r: any = await api.get('/api/report-builder/schedules'); setKinds(r.kinds); setList(r.schedules)
      setSaved(rows(await api.get('/api/report-builder/reports')))
      setDeliveries(rows(await api.get('/api/report-builder/deliveries')))
      setStaff(rows<any>(await api.get('/api/users/admins', { limit: 200 })).map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() })))
    } catch (e) { toast.error(errorMessage(e, 'Could not load the schedules')) }
  }, [toast])
  useEffect(() => { load() }, [load])
  const save = async () => {
    try {
      if (form.id) await api.put(`/api/report-builder/schedules/${form.id}`, form); else await api.post('/api/report-builder/schedules', form)
      toast.success('Schedule saved'); setForm(null); load()
    } catch (e) { toast.error(errorMessage(e, 'Could not save the schedule')) }
  }
  const act = async (s: any, what: 'send' | 'toggle' | 'delete') => {
    try {
      if (what === 'send') { const r: any = await api.post(`/api/report-builder/schedules/${s.id}/send-now`, {}); toast.success(r.sentTo?.length ? `Sent to ${r.sentTo.join(', ')}` : 'Stored; no recipient has an email address') }
      if (what === 'toggle') await api.patch(`/api/report-builder/schedules/${s.id}/active`, { isActive: !s.isActive })
      if (what === 'delete') { if (!(await confirm(`Delete the scheduled report "${s.name}"? Nothing more will be sent.`, { title: 'Delete schedule', confirmText: 'Delete', danger: true }))) return; await api.delete(`/api/report-builder/schedules/${s.id}`) }
      load()
    } catch (e) { toast.error(errorMessage(e, 'That did not work')) }
  }
  return (
    <>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">A scheduled report is built at the hour you pick on the agency&apos;s clock, stored encrypted, and the people you name get an email with a link that opens after they sign in. The report itself is never attached to the mail; the link works for 14 days.</p>
      <button type="button" className="hc-btn hc-btn-sm hc-btn-primary mb-3" onClick={() => setForm({ ...blank })}>+ New scheduled report</button>
      {form && (
        <div className={`${card} mb-4`}>
          <div className="grid md:grid-cols-3 gap-3">
            <label className="text-sm">Name<br /><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-sm">Report<br /><select className={inp} value={form.reportKind} onChange={(e) => setForm({ ...form, reportKind: e.target.value })}>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
            {form.reportKind === 'saved' && <label className="text-sm">Which saved report<br /><select className={inp} value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })}><option value="">Pick one</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            <label className="text-sm">File<br /><select className={inp} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option value="csv">CSV (spreadsheet)</option><option value="pdf">PDF</option></select></label>
            <label className="text-sm">How often<br /><select className={inp} value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value, windowDays: e.target.value === 'daily' ? 1 : e.target.value === 'weekly' ? 7 : 30 })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
            {form.cadence === 'weekly' && <label className="text-sm">Weekday<br /><select className={inp} value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
            {form.cadence === 'monthly' && <label className="text-sm">Day of the month<br /><input type="number" min={1} max={28} className={inp} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} /></label>}
            <label className="text-sm">Hour (agency clock)<br /><input type="number" min={0} max={23} className={inp} value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} /></label>
            {form.reportKind !== 'daily_manager' && <label className="text-sm">Covers the last … days<br /><input type="number" min={1} max={400} className={inp} value={form.windowDays} onChange={(e) => setForm({ ...form, windowDays: Number(e.target.value) })} /></label>}
          </div>
          <div className="text-sm mt-2 mb-1">Send to</div>
          <div className="flex flex-wrap gap-3 text-sm mb-3">{staff.map((u) => <label key={u.id} className="flex items-center gap-1"><input type="checkbox" checked={form.recipients.includes(u.id)} onChange={(e) => setForm({ ...form, recipients: e.target.checked ? [...form.recipients, u.id] : form.recipients.filter((x: string) => x !== u.id) })} />{u.name}</label>)}</div>
          <div className="flex gap-2"><button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={save}>Save</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
      {list.length === 0 ? <Empty text="No scheduled reports yet." /> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mb-4"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>Name</th><th className={TH}>Report</th><th className={TH}>When</th><th className={TH}>To</th><th className={TH}>Next</th><th className={TH}>Last sent</th><th className={TH}></th></tr></thead>
          <tbody>{list.map((s) => <tr key={s.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1 font-semibold">{s.name}{!s.isActive && <span className="ml-1 text-xs text-gray-600 dark:text-slate-400">(paused)</span>}</td><td className="px-3">{s.kindLabel} ({s.format.toUpperCase()})</td><td className="px-3">{s.cadenceLabel}</td><td className="px-3">{(s.recipients as string[]).map((id) => staff.find((u) => u.id === id)?.name ?? '?').join(', ')}</td><td className="px-3">{s.nextRunOn ? formatAgencyDate(s.nextRunOn) : '—'}</td><td className="px-3">{s.lastRunOn ? formatAgencyDate(s.lastRunOn) : 'Never'}</td>
            <td className="px-3 whitespace-nowrap"><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => setForm({ ...s, reportId: s.reportId ?? '' })}>Edit</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => act(s, 'send')}>Send now</button><button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => act(s, 'toggle')}>{s.isActive ? 'Pause' : 'Resume'}</button><button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => act(s, 'delete')}>Delete</button></td></tr>)}</tbody></table></div>
      )}
      <h3 className="font-semibold mb-1">Sent</h3>
      {deliveries.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">Nothing sent yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr className="bg-gray-50 dark:bg-slate-800"><th className={TH}>When</th><th className={TH}>Report</th><th className={TH}>Period</th><th className={TH}>Emailed to</th><th className={TH}>Opened</th><th className={TH}>Link until</th><th className={TH}></th></tr></thead>
          <tbody>{deliveries.map((x) => <tr key={x.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-3 py-1">{formatAgencyDateTime(x.createdAt)}</td><td className="px-3 font-semibold">{x.name}</td><td className="px-3">{x.periodStart ? `${formatAgencyDate(x.periodStart)} – ${formatAgencyDate(x.periodEnd)}` : '—'}</td><td className="px-3">{(x.sentTo as string[]).join(', ') || 'Nobody (no email on file)'}</td><td className="px-3">{x.downloads} time(s)</td><td className="px-3">{formatAgencyDate(x.expiresAt)}</td><td className="px-3"><DeliveryLink id={x.id} fileName={x.fileName} /></td></tr>)}</tbody></table></div>
      )}
    </>
  )
}
function DeliveryLink({ id, fileName }: { id: string; fileName: string }) {
  const toast = useToast()
  return <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={async () => { try { const { blob } = await downloadFile(`/api/report-builder/deliveries/${id}`); saveBlob(blob, fileName) } catch (e) { toast.error(errorMessage(e, 'Could not open it')) } }}>Open</button>
}

/** /crm/report-builder/deliveries/:id — the page an emailed link lands on: downloads the report for a signed-in recipient. */
export function ReportDelivery() {
  const { id = '' } = useParams()
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; message: string }>({ status: 'loading', message: 'Opening your report…' })
  useEffect(() => {
    downloadFile(`/api/report-builder/deliveries/${id}`).then(({ blob, fileName }) => { saveBlob(blob, fileName || 'report'); setState({ status: 'done', message: `Your report ${fileName ? `(${fileName}) ` : ''}has been downloaded.` }) })
      .catch((e) => setState({ status: 'error', message: errorMessage(e, 'This report could not be opened.') }))
  }, [id])
  return <div className="p-6 max-w-xl mx-auto text-gray-900 dark:text-slate-100"><h1 className="text-xl font-bold mb-2">Scheduled report</h1><p className={`text-sm ${state.status === 'error' ? 'text-red-700 dark:text-red-300' : ''}`}>{state.message}</p></div>
}
