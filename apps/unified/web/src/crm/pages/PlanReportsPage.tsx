// Plan Reports (server crm/field/planReportRoutes.ts, /api/plan-reports): one table-driven page over eight views of the
// service plans — who sold them, which were made, the summary (active at the start and end, renewed, suspended, ended),
// the history of every change, what is coming due, what ended, recurring and collected revenue by month, and the payments
// behind it. Every view takes a period (or a custom range), filters, the columns you choose, and downloads as CSV; a
// number that has records behind it opens them; any view can be saved and mailed on a schedule.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, Columns3, Download, Mail, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { useConfirm } from '../../shared'
import { RangePicker, rangeParams, money, card, th, td, tdNum, Loading, Problem, Empty, type RangeValue } from './reportBits'

type Kind = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent'
interface Col { key: string; label: string; kind?: Kind; link?: 'contact' | 'agreement' | 'invoice' | 'job'; idKey?: string }
type Row = Record<string, any> & { drill?: Record<string, Record<string, string>> }
interface Table { tab: string; title: string; columns: Col[]; rows: Row[]; totals?: Row | null; note?: string; shown: string[] }
interface Filters { planNames: string[]; sellers: Array<{ id: string; name: string }>; customers: Array<{ id: string; name: string }> }
interface Schedule { frequency: 'weekly' | 'monthly'; weekday: number; dayOfMonth: number; hour: number; recipients: string[] }
interface Saved { id: string; name: string; params: Record<string, any>; schedule: Schedule | null; lastSentAt: string | null }

const TABS: Array<[string, string]> = [['sold', 'Sold by'], ['plans', 'Plans made'], ['summary', 'Summary'], ['events', 'History'], ['renewals', 'Coming due'], ['ended', 'Ended'], ['revenue', 'Revenue'], ['payments', 'Payments']]
const STATUSES: Array<[string, string]> = [['active', 'Active'], ['pending', 'Pending'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled'], ['expired', 'Expired']]
const EVENT_KINDS: Array<[string, string]> = [['created', 'Sold'], ['renewed', 'Renewed'], ['suspended', 'Suspended'], ['reactivated', 'Reactivated'], ['cancelled', 'Cancelled'], ['expired', 'Expired']]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hourWords = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
const FILTER_KEYS = ['planName', 'sellerId', 'contactId', 'status'] as const
const sel = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const btn = 'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

interface View {
  tab: string; range: RangeValue; planName: string; sellerId: string; contactId: string; status: string
  kind: string; measure: 'recurring' | 'collected'; month: string; days: 30 | 60; columns: string[]
}
const START: View = { tab: 'sold', range: { period: 'year', startDate: '', endDate: '' }, planName: '', sellerId: '', contactId: '', status: '', kind: '', measure: 'recurring', month: '', days: 30, columns: [] }

const day = (iso: string) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const monthWords = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

function cellText(c: Col, v: unknown): string {
  if (v == null || v === '') return '—'
  switch (c.kind) {
    case 'money': return typeof v === 'number' ? money(v) : String(v)
    case 'date': return day(String(v))
    case 'datetime': return stamp(String(v))
    case 'percent': return `${v}%`
    default: return String(v)
  }
}
const numeric = (c: Col) => c.kind === 'money' || c.kind === 'number' || c.kind === 'percent'
const hrefOf = (c: Col, row: Row): string | null => {
  const id = c.idKey ? row[c.idKey] : null
  if (!id) return null
  if (c.link === 'contact') return `/crm/contacts/${id}`
  if (c.link === 'invoice') return `/crm/invoices/${id}`
  if (c.link === 'agreement') return `/crm/agreements?open=${id}`
  if (c.link === 'job') return `/crm/jobs/${id}`
  return null
}

/** The settings the server stores and reads: only what is set, a custom range as two days, a named period by name. */
function paramsOf(v: View): Record<string, any> {
  const p: Record<string, any> = { tab: v.tab }
  if (v.tab === 'renewals') p.days = v.days
  else Object.assign(p, rangeParams(v.range))
  for (const k of FILTER_KEYS) if (v[k]) p[k] = v[k]
  if (v.tab === 'events' && v.kind) p.kind = v.kind
  if (v.tab === 'revenue') p.measure = v.measure
  if (v.tab === 'payments' && v.month) p.month = v.month
  if (v.columns.length) p.columns = v.columns
  return p
}
function viewOf(p: Record<string, any>): View {
  const named = !!p.period
  return {
    ...START, tab: p.tab || 'sold',
    range: named ? { period: p.period, startDate: '', endDate: '' } : (p.startDate || p.endDate) ? { period: 'custom', startDate: p.startDate || '', endDate: p.endDate || '' } : START.range,
    planName: p.planName || '', sellerId: p.sellerId || '', contactId: p.contactId || '', status: p.status || '', kind: p.kind || '',
    measure: p.measure || 'recurring', month: p.month || '', days: p.days === 60 ? 60 : 30, columns: Array.isArray(p.columns) ? p.columns : [],
  }
}
const queryOf = (p: Record<string, any>) => Object.entries(p).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`).join('&')

export default function PlanReportsPage() {
  const confirm = useConfirm()
  const [view, setView] = useState<View>(START)
  const [table, setTable] = useState<Table | null>(null)
  const [filters, setFilters] = useState<Filters>({ planNames: [], sellers: [], customers: [] })
  const [saved, setSaved] = useState<Saved[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickColumns, setPickColumns] = useState(false)
  const [form, setForm] = useState<{ id: string | null; name: string; scheduled: boolean; schedule: Schedule; recipients: string } | null>(null)
  const [notice, setNotice] = useState('')

  const params = useMemo(() => paramsOf(view), [view])
  const query = queryOf(params)
  const change = (patch: Partial<View>) => setView((v) => ({ ...v, ...patch }))
  const customIncomplete = view.tab !== 'renewals' && view.range.period === 'custom' && (!view.range.startDate || !view.range.endDate)

  useEffect(() => {
    api.get('/api/plan-reports/filters').then((r: any) => setFilters((r?.data ?? r) as Filters)).catch(() => undefined)
  }, [])
  const loadSaved = useCallback(() => { api.get('/api/plan-reports/saved').then((r: any) => setSaved((r?.data ?? r) as Saved[])).catch(() => undefined) }, [])
  useEffect(loadSaved, [loadSaved])

  useEffect(() => {
    if (customIncomplete) return
    let live = true
    setTable(null); setError('')
    api.get(`/api/plan-reports/table?${query}`)
      .then((r: any) => { if (live) setTable((r?.data ?? r) as Table) })
      .catch((e: Error) => { if (live) setError(e.message || 'The report could not be loaded.') })
    return () => { live = false }
  }, [query, customIncomplete])

  const download = async () => {
    setBusy(true); setError('')
    try {
      const res = await api.raw(`/api/plan-reports/table?${query}&format=csv`)
      if (!res.ok) throw new Error('The download failed.')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `plan-reports-${view.tab}.csv`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { setError((e as Error).message || 'The download failed.') } finally { setBusy(false) }
  }

  /** A number with records behind it: the same range, the filters the number carries. */
  const drill = (to: Record<string, string>) => {
    const next: Partial<View> = { columns: [], kind: '', month: '' }
    for (const [k, v] of Object.entries(to)) (next as any)[k] = v
    if (!('planName' in to)) next.planName = view.planName
    setView((v) => ({ ...v, ...next }))
  }

  const openForm = (s?: Saved) => {
    const base: Schedule = { frequency: 'weekly', weekday: 1, dayOfMonth: 1, hour: 7, recipients: [] }
    setForm({ id: s?.id ?? null, name: s?.name ?? '', scheduled: !!s?.schedule, schedule: s?.schedule ?? base, recipients: (s?.schedule?.recipients ?? []).join(', ') })
  }
  const submit = async () => {
    if (!form) return
    setError('')
    const recipients = form.recipients.split(/[,\s;]+/).filter(Boolean)
    const body = { name: form.name, params, schedule: form.scheduled ? { ...form.schedule, recipients } : null }
    try {
      if (form.id) await api.put(`/api/plan-reports/saved/${form.id}`, body); else await api.post('/api/plan-reports/saved', body)
      setForm(null); loadSaved(); setNotice(form.id ? 'Report updated.' : 'Report saved.')
    } catch (e) { setError((e as Error).message || 'The report could not be saved.') }
  }
  const sendNow = async (s: Saved) => {
    setError(''); setNotice('')
    try { await api.post(`/api/plan-reports/saved/${s.id}/send`, {}); setNotice(`“${s.name}” was emailed.`); loadSaved() } catch (e) { setError((e as Error).message || 'The report could not be sent.') }
  }
  const remove = async (s: Saved) => {
    if (!(await confirm(`“${s.name}” stops being sent and is removed from the list.`, { title: 'Delete this saved report?', confirmText: 'Delete report' }))) return
    try { await api.delete(`/api/plan-reports/saved/${s.id}`); loadSaved() } catch (e) { setError((e as Error).message || 'The report could not be deleted.') }
  }

  const cols = table ? table.columns.filter((c) => table.shown.includes(c.key)) : []
  const nameOf = (id: string, list: Array<{ id: string; name: string }>) => list.find((x) => x.id === id)?.name ?? id

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Plan Reports</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">Who sells your service plans, how many are active, what is coming up for renewal, what ended, and what the plans bring in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => setPickColumns((o) => !o)} aria-expanded={pickColumns}><Columns3 className="h-4 w-4" aria-hidden />Columns</button>
          <button type="button" className={btn} onClick={download} disabled={busy || customIncomplete}><Download className="h-4 w-4" aria-hidden />{busy ? 'Preparing…' : 'Download CSV'}</button>
          <button type="button" className={btn} onClick={() => openForm()} disabled={customIncomplete}><Bookmark className="h-4 w-4" aria-hidden />Save this report</button>
        </div>
      </div>

      <div role="tablist" aria-label="Plan reports" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={view.tab === id} onClick={() => setView((v) => ({ ...v, tab: id, columns: [], kind: '', month: '' }))}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${view.tab === id ? 'border-blue-700 text-blue-800 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-gray-700 dark:text-slate-300'}`}>{label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {view.tab === 'renewals'
          ? <div role="group" aria-label="Look ahead" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
              {([30, 60] as const).map((d) => <button key={d} type="button" aria-pressed={view.days === d} onClick={() => change({ days: d })} className={`px-3 py-1.5 ${view.days === d ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>Next {d} days</button>)}
            </div>
          : <RangePicker value={view.range} onChange={(range) => change({ range })} />}
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Plan
          <select className={sel} value={view.planName} onChange={(e) => change({ planName: e.target.value })}><option value="">All plans</option>{filters.planNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Sold by
          <select className={sel} value={view.sellerId} onChange={(e) => change({ sellerId: e.target.value })}><option value="">Anyone</option><option value="none">No one recorded</option>{filters.sellers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Customer
          <select className={sel} value={view.contactId} onChange={(e) => change({ contactId: e.target.value })}><option value="">All customers</option>{filters.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Status
          <select className={sel} value={view.status} onChange={(e) => change({ status: e.target.value })}><option value="">Any status</option>{STATUSES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        {view.tab === 'events' && (
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">What happened
            <select className={sel} value={view.kind} onChange={(e) => change({ kind: e.target.value })}><option value="">Everything</option>{EVENT_KINDS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        )}
        {view.tab === 'revenue' && (
          <div role="group" aria-label="Revenue measure" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
            {([['recurring', 'Recurring (billed)'], ['collected', 'Collected (paid)']] as const).map(([id, l]) => <button key={id} type="button" aria-pressed={view.measure === id} onClick={() => change({ measure: id })} className={`px-3 py-1.5 ${view.measure === id ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>{l}</button>)}
          </div>
        )}
        {view.tab === 'payments' && view.month && (
          <button type="button" className={btn} onClick={() => change({ month: '' })}>{monthWords(view.month)}<X className="h-4 w-4" aria-label="Show every month" /></button>
        )}
      </div>

      {pickColumns && table && (
        <fieldset className={`${card} p-4`}>
          <legend className="px-1 text-sm font-medium text-gray-800 dark:text-slate-200">Columns to show</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {table.columns.map((c) => {
              const on = table.shown.includes(c.key)
              return (
                <label key={c.key} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                  <input type="checkbox" checked={on} onChange={() => {
                    const now = on ? table.shown.filter((k) => k !== c.key) : table.columns.map((x) => x.key).filter((k) => k === c.key || table.shown.includes(k))
                    change({ columns: now.length ? now : table.shown })
                  }} />{c.label}
                </label>
              )
            })}
          </div>
          {view.columns.length > 0 && <button type="button" className="mt-3 text-sm underline text-gray-800 dark:text-slate-200" onClick={() => change({ columns: [] })}>Back to the usual columns</button>}
        </fieldset>
      )}

      {error && <Problem text={error} />}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">{notice}</p>}

      <section className={card}>
        {customIncomplete ? <Empty text="Choose a first and last day." />
          : !table ? (error ? null : <Loading />)
          : (
            <>
              <p className="px-4 pt-4 text-sm font-medium text-gray-900 dark:text-slate-100">{table.title}</p>
              {table.note && <p className="px-4 pt-1 text-xs text-gray-600 dark:text-slate-300">{table.note}</p>}
              {table.rows.length === 0 ? <Empty text="Nothing matches these settings." /> : (
                <div className="overflow-x-auto">
                  <table className="mt-2 min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                    <thead><tr>{cols.map((c) => <th key={c.key} className={`${th} ${numeric(c) ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {table.rows.map((r, i) => (
                        <tr key={i}>{cols.map((c) => <Cell key={c.key} c={c} row={r} onDrill={drill} />)}</tr>
                      ))}
                    </tbody>
                    {table.totals && <tfoot><tr className="font-semibold">{cols.map((c) => <td key={c.key} className={numeric(c) ? tdNum : td}>{cellText(c, table.totals![c.key]) === '—' ? '' : cellText(c, table.totals![c.key])}</td>)}</tr></tfoot>}
                  </table>
                </div>
              )}
            </>
          )}
      </section>

      {form && (
        <section className={`${card} space-y-4 p-4`} aria-label="Save report">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{form.id ? 'Change saved report' : 'Save this report'}</h2>
          <p className="text-sm text-gray-600 dark:text-slate-300">Saves the tab, period, filters and columns as they are now. A period like “Last 30 days” is counted again each time it is opened or sent.</p>
          <label className="block text-sm text-gray-800 dark:text-slate-200">Name
            <input className={`${sel} mt-1 block w-full max-w-md`} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={form.scheduled} onChange={(e) => setForm({ ...form, scheduled: e.target.checked })} />Email it to me and others on a schedule</label>
          {form.scheduled && (
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm text-gray-800 dark:text-slate-200">How often
                <select className={`${sel} mt-1 block`} value={form.schedule.frequency} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, frequency: e.target.value as Schedule['frequency'] } })}><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
              {form.schedule.frequency === 'weekly'
                ? <label className="text-sm text-gray-800 dark:text-slate-200">On
                    <select className={`${sel} mt-1 block`} value={form.schedule.weekday} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, weekday: Number(e.target.value) } })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select></label>
                : <label className="text-sm text-gray-800 dark:text-slate-200">On day
                    <select className={`${sel} mt-1 block`} value={form.schedule.dayOfMonth} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, dayOfMonth: Number(e.target.value) } })}>{Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
              <label className="text-sm text-gray-800 dark:text-slate-200">At
                <select className={`${sel} mt-1 block`} value={form.schedule.hour} onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, hour: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourWords(h)}</option>)}</select></label>
              <label className="min-w-[16rem] flex-1 text-sm text-gray-800 dark:text-slate-200">Send to (email addresses, separated by commas)
                <input className={`${sel} mt-1 block w-full`} value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} /></label>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" onClick={submit}>{form.id ? 'Save changes' : 'Save report'}</button>
            <button type="button" className={btn} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </section>
      )}

      <section className={card} aria-label="Saved reports">
        <h2 className="px-4 pt-4 text-lg font-semibold text-gray-900 dark:text-slate-100">Saved reports</h2>
        {saved.length === 0 ? <Empty text="Nothing saved yet. Set up a view above and choose “Save this report”." /> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <button type="button" className="text-sm font-medium underline text-gray-900 dark:text-slate-100" onClick={() => setView(viewOf(s.params))}>{s.name}</button>
                  <p className="text-xs text-gray-600 dark:text-slate-300">
                    {TABS.find(([id]) => id === s.params.tab)?.[1] ?? 'Report'}
                    {s.schedule ? ` · emailed ${s.schedule.frequency === 'weekly' ? `every ${WEEKDAYS[s.schedule.weekday]}` : `on day ${s.schedule.dayOfMonth} of each month`} at ${hourWords(s.schedule.hour)} to ${s.schedule.recipients.join(', ')}` : ' · not scheduled'}
                    {s.lastSentAt ? ` · last sent ${stamp(s.lastSentAt)}` : ''}
                    {s.params.sellerId && s.params.sellerId !== 'none' ? ` · sold by ${nameOf(s.params.sellerId, filters.sellers)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={btn} onClick={() => openForm(s)}>Edit</button>
                  <button type="button" className={btn} onClick={() => sendNow(s)}><Mail className="h-4 w-4" aria-hidden />Send now</button>
                  <button type="button" className={btn} onClick={() => remove(s)} aria-label={`Delete ${s.name}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-gray-600 dark:text-slate-300">Numbers that show an underline open the plans, invoices or customers behind them.</p>
    </div>
  )
}

function Cell({ c, row, onDrill }: { c: Col; row: Row; onDrill: (to: Record<string, string>) => void }) {
  const text = cellText(c, row[c.key])
  const cls = numeric(c) ? tdNum : td
  const href = c.link ? hrefOf(c, row) : null
  const to = row.drill?.[c.key]
  return (
    <td className={cls}>
      {href ? <Link className="underline" to={href}>{text}</Link>
        : to && text !== '—' ? <button type="button" className="underline" onClick={() => onDrill(to)}>{text}</button>
        : text}
    </td>
  )
}
