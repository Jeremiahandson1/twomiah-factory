// Choosing a time on the staff side: the same free days and times customers are offered (/api/booking/availability),
// or — ticked on purpose — any date and time, for the favour or the emergency the hours don't cover. The site's
// staff form took any datetime with no check at all, so a desk booking could land on top of another.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageError } from '../shared'
import { dateWords } from './common'

export interface PickedTime { date: string; time: string; override: boolean }

export function TimePicker({ serviceId, exceptBookingId, value, onChange, zone }: {
  serviceId: string
  exceptBookingId?: string
  value: PickedTime | null
  onChange: (v: PickedTime | null) => void
  /** The business's zone name, shown so nobody reads the times as their own. */
  zone?: string
}) {
  const [dates, setDates] = useState<string[] | null>(null)
  const [date, setDate] = useState<string>('')
  const [times, setTimes] = useState<Array<{ time: string; label: string }> | null>(null)
  const [override, setOverride] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!serviceId || override) return
    setDates(null); setTimes(null); setDate(''); setError(null)
    api.get('/api/booking/availability', { serviceId })
      .then((r: { data: string[] }) => { setDates(r.data); if (r.data[0]) setDate(r.data[0]) })
      .catch((e: Error) => setError(e.message))
  }, [serviceId, override])

  useEffect(() => {
    if (!serviceId || !date || override) return
    setTimes(null)
    api.get('/api/booking/availability', { serviceId, date, except: exceptBookingId })
      .then((r: { data: Array<{ time: string; label: string }> }) => setTimes(r.data))
      .catch((e: Error) => setError(e.message))
  }, [serviceId, date, override, exceptBookingId])

  return (
    <div className="space-y-3">
      {!override && (
        <>
          <PageError message={error} />
          {dates === null && !error && <p className="text-sm text-muted">Finding free days…</p>}
          {dates?.length === 0 && <p className="text-sm text-muted">No free days in the booking window. Tick the box below to book outside the hours.</p>}
          {!!dates?.length && (
            <div>
              <label htmlFor="tp-date" className="label">Day</label>
              <select id="tp-date" className="input" value={date} onChange={(e) => { setDate(e.target.value); onChange(null) }}>
                {dates.map((d) => <option key={d} value={d}>{dateWords(d, { weekday: 'long', month: 'long', day: 'numeric' })}</option>)}
              </select>
            </div>
          )}
          {date && times === null && !error && <p className="text-sm text-muted">Finding free times…</p>}
          {times?.length === 0 && <p className="text-sm text-muted">Nothing free that day.</p>}
          {!!times?.length && (
            <div role="group" aria-label={`Free times${zone ? ` (${zone})` : ''}`}>
              <span className="label">Time{zone ? ` (${zone})` : ''}</span>
              <div className="flex flex-wrap gap-2">
                {times.map((t) => {
                  const on = value?.date === date && value?.time === t.time && !value.override
                  return (
                    <button key={t.time} type="button" aria-pressed={on} onClick={() => onChange({ date, time: t.time, override: false })}
                      className={on ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{t.label}</button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
      {override && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tp-odate" className="label">Day</label>
            <input id="tp-odate" type="date" className="input" value={value?.date || ''} onChange={(e) => onChange({ date: e.target.value, time: value?.time || '09:00', override: true })} />
          </div>
          <div>
            <label htmlFor="tp-otime" className="label">Time{zone ? ` (${zone})` : ''}</label>
            <input id="tp-otime" type="time" className="input" value={value?.time || ''} onChange={(e) => onChange({ date: value?.date || '', time: e.target.value, override: true })} />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={override} onChange={(e) => { setOverride(e.target.checked); onChange(null) }} />
        Book outside the hours (skip the free-time check)
      </label>
    </div>
  )
}
