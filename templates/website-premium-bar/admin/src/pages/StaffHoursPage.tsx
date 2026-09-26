// Staff hours — the time clock's side of the back office. Pay period by pay
// period: hours per person (regular and overtime, figured by workweek), tips,
// estimated wages and labor % of sales; fix a missed punch (the first times
// are kept, a reason is required); download the CSV for the payroll service.
// We report hours; the payroll service pays people and files the taxes.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from '../components/Field'

interface Person { pinId: string; name: string; clocksIn: boolean; isActive: boolean; hourlyCents: number | null; regular: number; overtime: number; total: number; shifts: number; openShifts: number; cashTipsCents: number; cardTipsCents: number; wagesCents: number | null; weeks: Array<{ week: string; regular: number; overtime: number }> }
interface Shift { id: string; pinId: string; name: string; startAt: string; endAt: string | null; inAt: string | null; outAt: string | null; originalStartAt: string | null; originalEndAt: string | null; editedBy: string | null; editNote: string | null; forgotten: boolean }
interface Sheet { start: string; end: string; tz: string; config: { weekStart: number; periodDays: 7 | 14; anchor: string }; people: Person[]; shifts: Shift[]; salesCents: number; wagesCents: number | null; laborPct: number | null; openShifts: number }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const money = (c: number | null) => (c === null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const hrs = (h: number) => h.toFixed(2)
const shift = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
// <input type="datetime-local"> works in the laptop's own time zone (the bar's, for the owner).
const toInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const fromInput = (v: string) => (v ? new Date(v).toISOString() : null)
type Msg = { ok: boolean; text: string } | null
const Note = ({ m }: { m: Msg }) => (m ? <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (m.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{m.text}</div> : null)

function SettingsCard({ sheet, onSaved }: { sheet: Sheet; onSaved: () => void }) {
  const [f, setF] = useState({ weekStart: sheet.config.weekStart, periodDays: sheet.config.periodDays, anchor: sheet.config.anchor })
  const [msg, setMsg] = useState<Msg>(null)
  const save = async () => { setMsg(null); try { await api.put('/api/admin/staff-hours/settings', f); setMsg({ ok: true, text: 'Saved.' }); onSaved() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  return (
    <details className="card card-padding mb-6">
      <summary className="cursor-pointer text-ink font-semibold">Workweek and pay periods</summary>
      <div className="mt-3">
        <Note m={msg} />
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label htmlFor="pp-ws">Workweek starts</Label><select id="pp-ws" className="input" value={f.weekStart} onChange={(e) => setF({ ...f, weekStart: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
          <div><Label htmlFor="pp-len">Pay period</Label><select id="pp-len" className="input" value={f.periodDays} onChange={(e) => setF({ ...f, periodDays: Number(e.target.value) as 7 | 14 })}><option value={7}>Every week</option><option value={14}>Every two weeks</option></select></div>
          <div><Label htmlFor="pp-an">A pay period that started on</Label><input id="pp-an" type="date" className="input" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value })} /></div>
        </div>
        <Hint>Wisconsin and federal law: time and a half for hours over 40 in the workweek, no daily overtime. Pick the same workweek your payroll service uses.</Hint>
        <button type="button" className="btn-primary btn-md mt-3" onClick={save}>Save</button>
      </div>
    </details>
  )
}

function ShiftEditor({ s, sheet, people, onClose, onSaved }: { s: Shift | null; sheet: Sheet; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ pinId: s?.pinId || people.find((p) => p.clocksIn)?.pinId || '', start: toInput(s?.startAt || null), end: toInput(s?.endAt || null), note: '' })
  const [msg, setMsg] = useState<Msg>(null)
  const save = async () => {
    setMsg(null)
    try {
      if (s) await api.patch(`/api/admin/staff-hours/shifts/${s.id}`, { startAt: fromInput(f.start), endAt: fromInput(f.end), note: f.note })
      else await api.post('/api/admin/staff-hours/shifts', { pinId: f.pinId, startAt: fromInput(f.start), endAt: fromInput(f.end), note: f.note })
      onSaved(); onClose()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const remove = async () => { setMsg(null); try { await api.post(`/api/admin/staff-hours/shifts/${s!.id}/void`, { note: f.note }); onSaved(); onClose() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  return (
    <aside className="card card-padding" aria-labelledby="sh-h">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div><h2 id="sh-h" className="text-xl text-ink">{s ? `${s.name}'s shift` : 'Add a shift nobody punched'}</h2>{s?.originalStartAt && <p className="text-xs text-muted">First punched {when(s.originalStartAt, sheet.tz)} to {when(s.originalEndAt, sheet.tz)}</p>}</div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <Note m={msg} />
      <div className="grid gap-3">
        {!s && <div><Label htmlFor="sh-who">Who</Label><select id="sh-who" className="input" value={f.pinId} onChange={(e) => setF({ ...f, pinId: e.target.value })}>{people.filter((p) => p.clocksIn).map((p) => <option key={p.pinId} value={p.pinId}>{p.name}</option>)}</select></div>}
        <div><Label htmlFor="sh-in">Clocked in</Label><input id="sh-in" type="datetime-local" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div><Label htmlFor="sh-out">Clocked out</Label><input id="sh-out" type="datetime-local" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div><Label htmlFor="sh-why">Why (kept on the record)</Label><input id="sh-why" className="input" placeholder="Forgot to clock out; left at 1:15" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" className="btn-primary btn-md" onClick={save}>Save</button>
        {s && <button type="button" className="btn-secondary btn-md text-red-700" onClick={remove}>Remove this shift</button>}
      </div>
    </aside>
  )
}

export function StaffHoursPage() {
  const [start, setStart] = useState<string>('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [open, setOpen] = useState<Shift | 'new' | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const load = (s = start) => api.get<Sheet>('/api/admin/staff-hours' + (s ? '?start=' + s : '')).then((r) => { setSheet(r); setStart(r.start) }).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load('') }, [])
  if (!sheet) return <div className="p-8 max-w-6xl mx-auto"><Note m={msg} />Loading…</div>
  const setPerson = async (p: Person, patch: Record<string, unknown>) => { setMsg(null); try { await api.patch(`/api/admin/staff-hours/people/${p.pinId}`, patch); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  const worked = sheet.people.filter((p) => p.total > 0)
  const totals = { reg: worked.reduce((n, p) => n + p.regular, 0), ot: worked.reduce((n, p) => n + p.overtime, 0) }
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl text-ink">Staff hours</h1>
          <p className="text-muted text-sm mt-1">Pay period {nice(sheet.start)} to {nice(shift(sheet.end, -1))}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button type="button" className="btn-secondary btn-md inline-flex items-center gap-1" onClick={() => load(shift(sheet.start, -sheet.config.periodDays))}><ChevronLeft className="w-4 h-4" />Previous</button>
          <button type="button" className="btn-secondary btn-md inline-flex items-center gap-1" onClick={() => load(sheet.end)}>Next<ChevronRight className="w-4 h-4" /></button>
          <a className="btn-primary btn-md inline-flex items-center gap-2" href={`/api/admin/staff-hours/export.csv?start=${sheet.start}`} download><Download className="w-4 h-4" />Payroll CSV</a>
        </div>
      </div>
      <SettingsCard sheet={sheet} onSaved={() => load(sheet.start)} />
      <Note m={msg} />
      {sheet.openShifts > 0 && <div className="text-sm rounded-lg px-3 py-2 mb-4 border text-amber-800 bg-amber-50 border-amber-200" role="status">{sheet.openShifts} shift{sheet.openShifts === 1 ? ' is' : 's are'} still open. Anyone who forgot to clock out: fix it below before exporting.</div>}
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        {[['Hours', `${hrs(totals.reg + totals.ot)}`, `${hrs(totals.ot)} overtime`], ['Est. wages', money(sheet.wagesCents), sheet.wagesCents === null ? 'set everyone’s rate to see this' : 'before taxes'], ['Food & drink sales', money(sheet.salesCents), 'checks paid this period'], ['Labor', sheet.laborPct === null ? '—' : sheet.laborPct.toFixed(1) + '%', 'of sales']].map(([a, b, cc]) => (
          <div key={a} className="card card-padding"><div className="text-xs text-muted uppercase tracking-wide">{a}</div><div className="text-2xl text-ink tabular-nums">{b}</div><div className="text-xs text-muted">{cc}</div></div>
        ))}
      </div>
      <section className="card overflow-x-auto mb-6" aria-labelledby="ppl-h">
        <h2 id="ppl-h" className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-muted">People</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Name</th><th className="p-3">Clocks in</th><th className="p-3">Rate ($/h)</th><th className="p-3 text-right">Regular</th><th className="p-3 text-right">Overtime</th><th className="p-3 text-right">Cash tips</th><th className="p-3 text-right">Card tips</th><th className="p-3 text-right">Est. wages</th></tr></thead>
          <tbody className="divide-y divide-line">
            {sheet.people.map((p) => (
              <tr key={p.pinId}>
                <td className="p-3 text-ink">{p.name}{p.openShifts > 0 && <span className="ml-2 text-xs text-amber-700 font-semibold">on the clock</span>}</td>
                <td className="p-3"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={p.clocksIn} onChange={(e) => setPerson(p, { clocksIn: e.target.checked })} /><span className="sr-only">{p.name} clocks in</span></label></td>
                <td className="p-3"><label className="sr-only" htmlFor={'rate' + p.pinId}>{p.name} hourly rate</label><input id={'rate' + p.pinId} className="input w-24" inputMode="decimal" defaultValue={p.hourlyCents === null ? '' : (p.hourlyCents / 100).toFixed(2)} onBlur={(e) => { const v = e.target.value.trim(); const c = v === '' ? null : Math.round(Number(v.replace(/[^\d.]/g, '')) * 100); if (c !== p.hourlyCents) setPerson(p, { hourlyCents: c }) }} /></td>
                <td className="p-3 text-right tabular-nums">{hrs(p.regular)}</td>
                <td className={'p-3 text-right tabular-nums ' + (p.overtime > 0 ? 'text-amber-700 font-semibold' : '')}>{hrs(p.overtime)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.cashTipsCents)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.cardTipsCents)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.wagesCents)}</td>
              </tr>
            ))}
            {!sheet.people.length && <tr><td colSpan={8} className="p-6 text-center text-muted">Nobody clocks in yet. Give each person their own PIN (Settings → Staff PINs), then tick "Clocks in" here.</td></tr>}
          </tbody>
        </table>
      </section>
      <div className={open ? 'grid lg:grid-cols-[1fr_400px] gap-4 items-start' : ''}>
        <section className="card overflow-x-auto" aria-labelledby="sh-list-h">
          <div className="flex justify-between items-center px-3 pt-3"><h2 id="sh-list-h" className="text-sm font-semibold uppercase tracking-wide text-muted">Shifts</h2><button type="button" className="btn-secondary btn-sm" onClick={() => setOpen('new')}>Add a missed shift</button></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Who</th><th className="p-3">In</th><th className="p-3">Out</th><th className="p-3 text-right">Hours</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {sheet.shifts.map((s) => {
                const h = ((s.endAt ? new Date(s.endAt).getTime() : Date.now()) - new Date(s.startAt).getTime()) / 3600000
                return (
                  <tr key={s.id} className={s.forgotten ? 'bg-amber-50' : ''}>
                    <td className="p-3 text-ink">{s.name}</td>
                    <td className="p-3">{when(s.startAt, sheet.tz)}</td>
                    <td className="p-3">{s.endAt ? when(s.endAt, sheet.tz) : <span className="text-amber-700 font-semibold">{s.forgotten ? 'forgot to clock out?' : 'still on'}</span>}</td>
                    <td className="p-3 text-right tabular-nums">{hrs(h)}</td>
                    <td className="p-3 text-right">{s.editNote && <span className="text-xs text-muted mr-2" title={`${s.editedBy}: ${s.editNote}`}>{s.inAt === 'Added by hand' ? 'added' : 'fixed'}</span>}<button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(s)}>Fix</button></td>
                  </tr>
                )
              })}
              {!sheet.shifts.length && <tr><td colSpan={5} className="p-6 text-center text-muted">No shifts in this period. People clock in on the register: Register → Clock.</td></tr>}
            </tbody>
          </table>
        </section>
        {open && <ShiftEditor key={open === 'new' ? 'new' : open.id} s={open === 'new' ? null : open} sheet={sheet} people={sheet.people} onClose={() => setOpen(null)} onSaved={() => load(sheet.start)} />}
      </div>
      <p className="text-xs text-muted mt-4">Tips are what each person took on checks paid in the period. Estimated wages are hours × rate, overtime at time and a half, before taxes; the payroll service does the real pay and the tax filings.</p>
    </div>
  )
}
