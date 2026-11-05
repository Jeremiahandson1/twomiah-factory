// Find a time (Jobber's "Find a Time"): the open slots for a job of this length, for the person picked or anyone, inside
// their shifts, around booked jobs and the drive between them — GET /api/availability/find (the unified app's
// server/data/techAvailability.ts findOpenSlots). Picking a slot fills the job form's day, time and person; the save
// then runs the same checks under the server's lock, so a slot taken in the meantime is still refused there.
import { useEffect, useState } from 'react'
import { CalendarSearch } from 'lucide-react'
import { Button, Modal, Field, inputCls, errMsg } from '../invoicing/ui'
import type { JobsApi, JobsToast } from './types'

export interface FoundSlot { date: string; startsAt: string; endsAt: string; personId: string; kind: 'user' | 'member'; name: string; shift: 'regular' | 'on_call'; driveBeforeMinutes: number | null; driveAfterMinutes: number | null }
interface FoundPerson { personId: string; name: string; source: 'shifts' | 'business_hours' | 'none' }
export interface FindTimePick { date: string; time: string; personId: string }

const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}` }
const dayWords = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function FindTime({ api, toast, durationMinutes, personId, people, address, from, onPick, onClose }: {
  api: JobsApi; toast: JobsToast
  /** How long the job is (the form's estimated hours); an hour when unknown. */
  durationMinutes: number
  /** The person on the form, or '' for anyone. */
  personId: string
  people: Array<{ id: string; name: string }>
  /** Where the job is, for the drive from the job before and to the one after. */
  address?: string | null
  /** The first day to look at (the form's day, else today). */
  from?: string | null
  onPick: (pick: FindTimePick) => void
  onClose: () => void
}) {
  const [who, setWho] = useState(personId)
  const [start, setStart] = useState(from || todayKey())
  const [days, setDays] = useState(7)
  const [minutes, setMinutes] = useState(Math.max(15, Math.round(durationMinutes / 15) * 15))
  const [slots, setSlots] = useState<FoundSlot[] | null>(null)
  const [found, setFound] = useState<FoundPerson[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    const params: Record<string, string | number> = { from: start, days, duration: minutes, limit: 120 }
    if (who) params.personIds = who
    if (address && address.trim()) params.address = address.trim()
    api.get('/api/availability/find', params)
      .then((r: any) => { if (live) { setSlots(r?.slots || []); setFound(r?.people || []) } })
      .catch((e: unknown) => { if (live) { toast.error(errMsg(e, 'No times could be found')); setSlots([]) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [who, start, days, minutes, address]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = new Map<string, FoundSlot[]>()
  for (const s of slots || []) byDay.set(s.date, [...(byDay.get(s.date) || []), s])
  const notSetUp = found.filter((p) => p.source === 'none')

  return (
    <Modal isOpen onClose={onClose} title="Find a time" size="lg">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Who"><select value={who} onChange={(e) => setWho(e.target.value)} className={inputCls} data-testid="find-who"><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="From"><input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="Days"><select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>{[1, 3, 7, 14].map((n) => <option key={n} value={n}>{n === 1 ? 'Just that day' : `${n} days`}</option>)}</select></Field>
        <Field label="Length"><select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={inputCls}>{[15, 30, 45, 60, 90, 120, 180, 240, 480].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}</select></Field>
      </div>
      {address && address.trim() && <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">Allowing for the drive to {address.trim()} from the job before and to the job after.</p>}
      {notSetUp.length > 0 && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200" data-testid="find-not-set-up">No shifts and no business hours for {notSetUp.map((p) => p.name).join(', ')} — set them on Hours &amp; Time Off (or the company's hours in Settings) to find their times.</p>}
      <div className="mt-3 max-h-[50vh] overflow-y-auto" data-testid="find-slots" aria-busy={loading}>
        {loading && !slots ? <p className="py-6 text-center text-sm text-gray-600 dark:text-slate-400">Looking…</p>
          : !byDay.size ? <p className="py-6 text-center text-sm text-gray-600 dark:text-slate-400">No open time in those days. Try more days, a shorter length, or someone else.</p>
          : [...byDay.entries()].map(([date, list]) => (
            <div key={date} className="mb-3">
              <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-slate-100">{dayWords(date)}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => (
                  <button key={`${s.personId}-${s.startsAt}`} type="button" data-slot={`${s.date} ${s.startsAt} ${s.personId}`}
                    onClick={() => onPick({ date: s.date, time: s.startsAt, personId: s.personId })}
                    title={`${s.name}: ${clock(s.startsAt)}–${clock(s.endsAt)}${s.shift === 'on_call' ? ', on call' : ''}${s.driveBeforeMinutes ? `, ${s.driveBeforeMinutes} min drive from the job before` : ''}${s.driveAfterMinutes ? `, ${s.driveAfterMinutes} min drive to the job after` : ''}`}
                    className={`rounded-lg border px-2 py-1 text-xs ${s.shift === 'on_call' ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'}`}>
                    <span className="font-medium">{clock(s.startsAt)}</span>{!who && <span className="text-gray-600 dark:text-slate-300"> · {s.name}</span>}{s.shift === 'on_call' && <span> · on call</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600 dark:text-slate-400"><CalendarSearch className="mr-1 inline h-3.5 w-3.5" />Inside each person's shifts (or the business's hours), around their booked jobs. On-call slots are marked.</p>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
