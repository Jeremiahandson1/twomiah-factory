// What the table-driven report pages share (Plan Reports, Team Revenue): a report as columns and rows with links and drill-down,
// the column chooser, the CSV download, and saved reports (kept by name, emailed on a schedule). The server builds every table
// (server/crm/field/reportTables.ts); this only draws it.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, Columns3, Download, Mail, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { useConfirm, useMayWrite } from '../../shared'
import { money, card, th, td, tdNum, Loading, Empty } from './reportBits'

export type Kind = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent'
export interface Col { key: string; label: string; kind?: Kind; link?: 'contact' | 'agreement' | 'invoice' | 'job' | 'quote'; idKey?: string }
export type Row = Record<string, any> & { drill?: Record<string, Record<string, string>> }
export interface Table { tab: string; title: string; columns: Col[]; rows: Row[]; totals?: Row | null; note?: string; shown: string[] }

export const sel = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
export const btn = 'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const hourWords = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
export const day = (iso: string) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
export const stamp = (iso: string) => whenDateTime(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
export const queryOf = (p: Record<string, any>) => Object.entries(p).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`).join('&')

export function cellText(c: Col, v: unknown): string {
  if (v == null || v === '') return '—'
  switch (c.kind) {
    case 'money': return typeof v === 'number' ? money(v) : String(v)
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? day(String(v)) : String(v)
    case 'datetime': return stamp(String(v))
    case 'percent': return `${v}%`
    default: return String(v)
  }
}
export const numeric = (c: Col) => c.kind === 'money' || c.kind === 'number' || c.kind === 'percent'
const hrefOf = (c: Col, row: Row): string | null => {
  const id = c.idKey ? row[c.idKey] : null
  if (!id) return null
  switch (c.link) {
    case 'contact': return `/crm/contacts/${id}`
    case 'invoice': return `/crm/invoices/${id}`
    case 'agreement': return `/crm/agreements?open=${id}`
    case 'job': return `/crm/jobs/${id}`
    case 'quote': return `/crm/quotes/${id}`
    default: return null
  }
}

function Cell({ c, row, onDrill, quiet }: { c: Col; row: Row; onDrill: (to: Record<string, string>) => void; quiet?: boolean }) {
  const text = quiet && (row[c.key] == null || row[c.key] === '') ? '' : cellText(c, row[c.key])
  const href = c.link ? hrefOf(c, row) : null
  const to = row.drill?.[c.key]
  return (
    <td className={numeric(c) ? tdNum : td}>
      {href && text !== '—' ? <Link className="underline" to={href}>{text}</Link>
        : to && text !== '—' ? <button type="button" className="underline" onClick={() => onDrill(to)}>{text}</button>
        : text}
    </td>
  )
}

/** The report: its title and note, then the table with links and drill buttons, and the totals line. */
export function TableView({ table, error, waiting, onDrill, emptyText = 'Nothing matches these settings.' }: { table: Table | null; error: string; waiting?: string; onDrill: (to: Record<string, string>) => void; emptyText?: string }) {
  const cols = table ? table.columns.filter((c) => table.shown.includes(c.key)) : []
  return (
    <section className={card}>
      {waiting ? <Empty text={waiting} />
        : !table ? (error ? null : <Loading />)
        : (
          <>
            <p className="px-4 pt-4 text-sm font-medium text-gray-900 dark:text-slate-100">{table.title}</p>
            {table.note && <p className="px-4 pt-1 text-xs text-gray-600 dark:text-slate-300">{table.note}</p>}
            {table.rows.length === 0 ? <Empty text={emptyText} /> : (
              <div className="overflow-x-auto">
                <table className="mt-2 min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead><tr>{cols.map((c) => <th key={c.key} className={`${th} ${numeric(c) ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {table.rows.map((r, i) => <tr key={i}>{cols.map((c) => <Cell key={c.key} c={c} row={r} onDrill={onDrill} />)}</tr>)}
                  </tbody>
                  {table.totals && (
                    <tfoot><tr className="font-semibold">{cols.map((c) => <Cell key={c.key} c={c} row={table.totals!} onDrill={onDrill} quiet />)}</tr></tfoot>
                  )}
                </table>
              </div>
            )}
          </>
        )}
    </section>
  )
}

/** The "Columns" button's panel: tick the columns to show; the choice is kept in the view and saved with it. */
export function ColumnChooser({ table, chosen, onChange }: { table: Table; chosen: string[]; onChange: (keys: string[]) => void }) {
  return (
    <fieldset className={`${card} p-4`}>
      <legend className="px-1 text-sm font-medium text-gray-800 dark:text-slate-200">Columns to show</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {table.columns.map((c) => {
          const on = table.shown.includes(c.key)
          return (
            <label key={c.key} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
              <input type="checkbox" checked={on} onChange={() => {
                const now = on ? table.shown.filter((k) => k !== c.key) : table.columns.map((x) => x.key).filter((k) => k === c.key || table.shown.includes(k))
                onChange(now.length ? now : table.shown)
              }} />{c.label}
            </label>
          )
        })}
      </div>
      {chosen.length > 0 && <button type="button" className="mt-3 text-sm underline text-gray-800 dark:text-slate-200" onClick={() => onChange([])}>Back to the usual columns</button>}
    </fieldset>
  )
}
export function ColumnsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return <button type="button" className={btn} onClick={onClick} aria-expanded={open}><Columns3 className="h-4 w-4" aria-hidden />Columns</button>
}

/** A CSV download of the same table (the server builds it with the chosen columns). */
export function DownloadButton({ url, filename, disabled, onError }: { url: string; filename: string; disabled?: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true); onError('')
    try {
      const res = await api.raw(url)
      if (!res.ok) throw new Error('The download failed.')
      const href = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = href; a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href)
    } catch (e) { onError((e as Error).message || 'The download failed.') } finally { setBusy(false) }
  }
  return <button type="button" className={btn} onClick={go} disabled={busy || disabled}><Download className="h-4 w-4" aria-hidden />{busy ? 'Preparing…' : 'Download CSV'}</button>
}

export interface Schedule { frequency: 'weekly' | 'monthly'; weekday: number; dayOfMonth: number; hour: number; recipients: string[] }
export interface Saved { id: string; name: string; params: Record<string, any>; schedule: Schedule | null; lastSentAt: string | null }

/**
 * Saved reports: the view as it is now can be kept by name (and changed later), emailed to some people on a schedule, sent right
 * now, or deleted. `describe` says what a saved one is in a few words (its tab, the person it was cut by…).
 */
export function SavedReports({ base, params, disabled, describe, onOpen, onError }: {
  base: string; params: Record<string, any>; disabled?: boolean; describe: (p: Record<string, any>) => string
  onOpen: (p: Record<string, any>) => void; onError: (message: string) => void
}) {
  const confirm = useConfirm()
  // Both saved-report kinds (plan reports, team revenue: crm/field/planReportRoutes.ts, teamReportRoutes.ts) ask reports:read
  // on every route, reading and writing alike; the write controls are drawn only for a seat that holds it.
  const mayWrite = useMayWrite('reports:read')
  const [saved, setSaved] = useState<Saved[]>([])
  const [form, setForm] = useState<{ id: string | null; name: string; scheduled: boolean; schedule: Schedule; recipients: string } | null>(null)
  const [notice, setNotice] = useState('')
  const load = useCallback(() => { api.get(base).then((r: any) => setSaved((r?.data ?? r) as Saved[])).catch(() => undefined) }, [base])
  useEffect(load, [load])

  const openForm = (s?: Saved) => {
    const fresh: Schedule = { frequency: 'weekly', weekday: 1, dayOfMonth: 1, hour: 7, recipients: [] }
    setNotice(''); setForm({ id: s?.id ?? null, name: s?.name ?? '', scheduled: !!s?.schedule, schedule: s?.schedule ?? fresh, recipients: (s?.schedule?.recipients ?? []).join(', ') })
  }
  const submit = async () => {
    if (!form) return
    onError('')
    const recipients = form.recipients.split(/[,\s;]+/).filter(Boolean)
    const body = { name: form.name, params, schedule: form.scheduled ? { ...form.schedule, recipients } : null }
    try {
      if (form.id) await api.put(`${base}/${form.id}`, body); else await api.post(base, body)
      setNotice(form.id ? 'Report updated.' : 'Report saved.'); setForm(null); load()
    } catch (e) { onError((e as Error).message || 'The report could not be saved.') }
  }
  const sendNow = async (s: Saved) => {
    onError(''); setNotice('')
    try { await api.post(`${base}/${s.id}/send`, {}); setNotice(`“${s.name}” was emailed.`); load() } catch (e) { onError((e as Error).message || 'The report could not be sent.') }
  }
  const remove = async (s: Saved) => {
    if (!(await confirm(`“${s.name}” stops being sent and is removed from the list.`, { title: 'Delete this saved report?', confirmText: 'Delete report' }))) return
    try { await api.delete(base, s.id); load() } catch (e) { onError((e as Error).message || 'The report could not be deleted.') }
  }

  return (
    <>
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">{notice}</p>}
      {form && (
        <section className={`${card} space-y-4 p-4`} aria-label="Save report">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{form.id ? 'Change saved report' : 'Save this report'}</h2>
          <p className="text-sm text-gray-600 dark:text-slate-300">Keeps the tab, period, filters and columns as they are now. A period like “Last 30 days” is counted again each time it is opened or sent.</p>
          <label className="block text-sm text-gray-800 dark:text-slate-200">Name
            <input className={`${sel} mt-1 block w-full max-w-md`} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={form.scheduled} onChange={(e) => setForm({ ...form, scheduled: e.target.checked })} />Email it on a schedule</label>
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Saved reports</h2>
          {mayWrite && <button type="button" className={btn} onClick={() => openForm()} disabled={disabled}><Bookmark className="h-4 w-4" aria-hidden />Save this report</button>}
        </div>
        {saved.length === 0 ? <Empty text="Nothing saved yet. Set up a view above and choose “Save this report”." /> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <button type="button" className="text-sm font-medium underline text-gray-900 dark:text-slate-100" onClick={() => onOpen(s.params)}>{s.name}</button>
                  <p className="text-xs text-gray-600 dark:text-slate-300">
                    {describe(s.params)}
                    {s.schedule ? ` · emailed ${s.schedule.frequency === 'weekly' ? `every ${WEEKDAYS[s.schedule.weekday]}` : `on day ${s.schedule.dayOfMonth} of each month`} at ${hourWords(s.schedule.hour)} to ${s.schedule.recipients.join(', ')}` : ' · not scheduled'}
                    {s.lastSentAt ? ` · last sent ${stamp(s.lastSentAt)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {mayWrite && <button type="button" className={btn} onClick={() => openForm(s)}>Edit</button>}
                  {mayWrite && <button type="button" className={btn} onClick={() => sendNow(s)}><Mail className="h-4 w-4" aria-hidden />Send now</button>}
                  {mayWrite && <button type="button" className={btn} onClick={() => remove(s)} aria-label={`Delete ${s.name}`}><Trash2 className="h-4 w-4" aria-hidden /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
