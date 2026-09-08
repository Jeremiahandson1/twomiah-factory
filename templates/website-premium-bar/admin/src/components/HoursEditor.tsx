// Weekly hours editor for a bar: bar hours and kitchen hours are separate,
// each day is a list of open/close ranges (empty = closed), plus holiday
// overrides. Produces the lib/hours HoursConfig shape that settings.hours
// stores and the Tonight Board / JSON-LD / console read.
import { Plus, X, Copy } from 'lucide-react'
import { Label, Hint } from './Field'

export interface TimeRange { open: string; close: string }
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export type WeeklyHours = Partial<Record<DayKey, TimeRange[]>>
export interface DateOverride { date: string; label?: string; bar?: TimeRange[] | null; kitchen?: TimeRange[] | null }
export interface HoursConfig { timezone?: string; bar: WeeklyHours; kitchen: WeeklyHours; holidays?: DateOverride[] }

const DAYS: Array<[DayKey, string]> = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]
const DEFAULT_RANGE: TimeRange = { open: '11:00', close: '22:00' }
export const EMPTY_HOURS: HoursConfig = { timezone: 'America/Chicago', bar: {}, kitchen: {}, holidays: [] }

function RangeRow({ ranges, onChange, addLabel = 'Set hours' }: { ranges: TimeRange[]; onChange: (r: TimeRange[]) => void; addLabel?: string }) {
  const set = (i: number, patch: Partial<TimeRange>) => onChange(ranges.map((r, j) => j === i ? { ...r, ...patch } : r))
  const remove = (i: number) => onChange(ranges.filter((_, j) => j !== i))
  const add = () => onChange([...ranges, ranges.length ? { open: ranges[ranges.length - 1].close, close: '23:59' } : DEFAULT_RANGE])
  if (ranges.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">Closed</span>
        <button type="button" onClick={add} className="btn-secondary btn-sm inline-flex items-center gap-1"><Plus className="w-3 h-3" />{addLabel}</button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ranges.map((r, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <input type="time" className="input w-auto" value={r.open} onChange={(e) => set(i, { open: e.target.value })} aria-label="Opens" />
          <span className="text-muted text-sm">to</span>
          <input type="time" className="input w-auto" value={r.close} onChange={(e) => set(i, { close: e.target.value })} aria-label="Closes" />
          <button type="button" onClick={() => remove(i)} className="btn-secondary btn-sm" aria-label="Remove this range"><X className="w-3 h-3" /></button>
        </span>
      ))}
      <button type="button" onClick={add} className="btn-secondary btn-sm inline-flex items-center gap-1" title="Add a second block (e.g. lunch and dinner)"><Plus className="w-3 h-3" />Split</button>
    </div>
  )
}

function WeekEditor({ title, hint, week, onChange, extra }: { title: string; hint: string; week: WeeklyHours; onChange: (w: WeeklyHours) => void; extra?: React.ReactNode }) {
  const setDay = (d: DayKey, ranges: TimeRange[]) => onChange({ ...week, [d]: ranges })
  const copyDown = (from: DayKey) => {
    const src = week[from] || []
    const idx = DAYS.findIndex(([k]) => k === from)
    const next = { ...week }
    for (const [k] of DAYS.slice(idx + 1)) next[k] = src.map((r) => ({ ...r }))
    onChange(next)
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base text-ink">{title}</h3>
          <Hint>{hint}</Hint>
        </div>
        {extra}
      </div>
      <div className="divide-y divide-line border border-line rounded-lg">
        {DAYS.map(([k, name]) => (
          <div key={k} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 px-3 py-2">
            <span className="text-sm text-ink">{name}</span>
            <RangeRow ranges={week[k] || []} onChange={(r) => setDay(k, r)} />
            {k !== 'sun' && (week[k] || []).length > 0 ? (
              <button type="button" onClick={() => copyDown(k)} className="text-xs text-muted hover:text-ink" title="Use these hours for the rest of the week">copy ↓</button>
            ) : <span />}
          </div>
        ))}
      </div>
    </div>
  )
}

function HolidayEditor({ holidays, onChange }: { holidays: DateOverride[]; onChange: (h: DateOverride[]) => void }) {
  const set = (i: number, patch: Partial<DateOverride>) => onChange(holidays.map((h, j) => j === i ? { ...h, ...patch } : h))
  const remove = (i: number) => onChange(holidays.filter((_, j) => j !== i))
  const add = () => onChange([...holidays, { date: '', label: '', bar: null, kitchen: null }])
  const mode = (v: TimeRange[] | null | undefined) => v === undefined ? 'regular' : v === null || v.length === 0 ? 'closed' : 'special'
  const setMode = (i: number, dept: 'bar' | 'kitchen', m: string) => {
    const h = holidays[i]
    const next: DateOverride = { ...h }
    if (m === 'regular') delete next[dept]
    else if (m === 'closed') next[dept] = null
    else next[dept] = [DEFAULT_RANGE]
    onChange(holidays.map((x, j) => j === i ? next : x))
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base text-ink">Holidays &amp; one-off days</h3>
          <Hint>Closed on Christmas, open early for a game, a private party that closes the bar. Each date can be closed, regular, or special hours, per department. Past dates can be deleted any time.</Hint>
        </div>
        <button type="button" onClick={add} className="btn-secondary btn-sm inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add date</button>
      </div>
      {holidays.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      <div className="space-y-3">
        {holidays.map((h, i) => (
          <div key={i} className="border border-line rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className="input w-auto" value={h.date} onChange={(e) => set(i, { date: e.target.value })} aria-label="Date" />
              <input type="text" className="input flex-1 min-w-[160px]" placeholder="Label (Christmas Day, Packers home opener…)" value={h.label || ''} onChange={(e) => set(i, { label: e.target.value })} />
              <button type="button" onClick={() => remove(i)} className="btn-secondary btn-sm" aria-label="Remove date"><X className="w-3 h-3" /></button>
            </div>
            {(['bar', 'kitchen'] as const).map((dept) => (
              <div key={dept} className="grid grid-cols-[110px_auto_1fr] items-center gap-3">
                <span className="text-sm text-ink capitalize">{dept}</span>
                <select className="input w-auto" value={mode(h[dept])} onChange={(e) => setMode(i, dept, e.target.value)} aria-label={dept + ' on this date'}>
                  <option value="closed">Closed</option>
                  <option value="regular">Regular hours</option>
                  <option value="special">Special hours</option>
                </select>
                {mode(h[dept]) === 'special' ? <RangeRow ranges={h[dept] || []} onChange={(r) => set(i, { [dept]: r })} /> : <span />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function HoursEditor({ value, onChange }: { value: HoursConfig | null | undefined; onChange: (v: HoursConfig) => void }) {
  const hours: HoursConfig = value && typeof value === 'object' && 'bar' in value ? value : EMPTY_HOURS
  const copyBarToKitchen = () => onChange({ ...hours, kitchen: Object.fromEntries(Object.entries(hours.bar).map(([k, v]) => [k, (v || []).map((r) => ({ ...r }))])) })
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="f-timezone">Time zone</Label>
          <select id="f-timezone" className="input" value={hours.timezone || 'America/Chicago'} onChange={(e) => onChange({ ...hours, timezone: e.target.value })}>
            {['America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <Hint>Wisconsin is Central. Daylight-saving changes are handled for you.</Hint>
        </div>
      </div>
      <WeekEditor title="Bar hours" hint="When the door is open and the taps pour. A close after midnight (e.g. 02:00) is understood as the next morning." week={hours.bar} onChange={(bar) => onChange({ ...hours, bar })} />
      <WeekEditor
        title="Kitchen hours"
        hint="When food is served. The board shows kitchen and bar separately, so a late bar with an early kitchen reads right."
        week={hours.kitchen}
        onChange={(kitchen) => onChange({ ...hours, kitchen })}
        extra={<button type="button" onClick={copyBarToKitchen} className="btn-secondary btn-sm inline-flex items-center gap-1"><Copy className="w-3 h-3" />Same as bar</button>}
      />
      <HolidayEditor holidays={hours.holidays || []} onChange={(holidays) => onChange({ ...hours, holidays })} />
    </div>
  )
}
