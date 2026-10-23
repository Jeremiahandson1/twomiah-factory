// The schedule — one page for every CRM: a day, a week or a month of jobs (drag a job to another day, or in the
// day view to another hour, to reschedule; click to open), the CRM's online bookings, bookings from the connected premium website, and (RV)
// calendar appointments with a New Appointment form.
//
// Dates: a job's scheduledDate is a calendar date stored at UTC midnight — compare on its date portion,
// never through local time (fs / events / salon / RV drew jobs a day early). Bookings and appointments
// hold real instants and are placed in local time.
import { useState, useEffect, useCallback, type DragEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Calendar, Plus, Move, X } from 'lucide-react'
import { Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import { resolveScheduleConfig } from './types'
import { useMayWrite } from '../auth/PermissionsContext'
import { localDayKey } from '../time/day'
import type { SchedulePageProps, ScheduleJob, ScheduleBooking, ScheduleEvent } from './types'
import { whenTime, companyTodayKey, companyDayKey, companyMinutes, companyDayStart, companyMoment, companyHHMM } from '../time/companyClock'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// This page already asked for the day LOCALLY and was right; the Dispatch Board asked UTC and was not,
// which is how the two screens came to disagree about what "today" was. One definition now. (BUG-28)
const localKey = localDayKey
const weekOf = (d: Date) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); return { start: s, end: e } }
const timeOf = (iso: string) => whenTime(iso, { hour: 'numeric', minute: '2-digit' })
const jobCls = (status: string) => status === 'completed' ? 'bg-green-50 border-l-2 border-green-500 dark:bg-green-900/20' : status === 'in_progress' ? 'bg-blue-50 border-l-2 border-blue-500 dark:bg-blue-900/20' : status === 'cancelled' ? 'bg-gray-50 border-l-2 border-gray-300 opacity-60 dark:bg-slate-800' : 'bg-gray-50 border-l-2 border-gray-300 dark:bg-slate-800'

/**
 * DAY, WEEK AND MONTH. (live test 2026-10-22, landscaping and roofing: "week view only", "no calendar drag")
 *
 * One page, three spans over the same loaded work: the week as it always was, a month grid for the season, and a
 * day laid out by the hour. Dragging reschedules in every one of them, and each drop says what it changes:
 *   week / month   drop on a day   → the job moves to that day (its time stays)
 *   day            drop on an hour → the job keeps its day and starts at that hour; on "No time set", the time goes
 * Every move is PUT /api/jobs/:id — jobs:update, the same check and the same overlap refusal as the edit form — so a
 * clash is refused with the server's sentence and the board reloads.
 */
type View = 'day' | 'week' | 'month'
const VIEWS: Array<{ id: View; label: string }> = [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]
/** The hours the day view lays out; work outside them still shows, in the first or last row. */
const FIRST_HOUR = 6, LAST_HOUR = 20
const hourKey = (h: number) => `${String(h).padStart(2, '0')}:00`
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })
const dayStart = (d: Date) => { const s = new Date(d); s.setHours(0, 0, 0, 0); return s }
const dayEnd = (d: Date) => { const e = new Date(d); e.setHours(23, 59, 59, 999); return e }
/** The first and last day a view shows: the day, its week (Sunday to Saturday), or the whole weeks covering its month. */
function spanOf(view: View, d: Date): { start: Date; end: Date } {
  if (view === 'day') return { start: dayStart(d), end: dayEnd(d) }
  if (view === 'week') return weekOf(d)
  const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const start = new Date(first); start.setDate(start.getDate() - start.getDay())
  const end = new Date(last); end.setDate(end.getDate() + (6 - end.getDay()))
  return { start: dayStart(start), end: dayEnd(end) }
}
const VIEW_KEY = 'twomiah.schedule.view'
const savedView = (): View => { try { const v = localStorage.getItem(VIEW_KEY); return v === 'day' || v === 'month' ? v : 'week' } catch { return 'week' } }

export function SchedulePage({ api, toast, config }: SchedulePageProps) {
  const cfg = resolveScheduleConfig(config)
  /**
   * Each write asks the permission its route asks (T43 viewer round: RV Schedule offered "New Appointment" and "+ Add"
   * on every day to the read-only seat). Dropping a job on another day is PUT /api/jobs/:id — jobs:update — so the
   * drag goes with it; a seat without it clicks through to the job instead. Booking is schedule:create; opening an
   * appointment edits or cancels it — schedule:update. (T68)
   */
  // every hook unconditionally — the feature flags behind cfg.dragDrop arrive after the first render
  const mayMoveJobs = useMayWrite('jobs:update')
  const mayBook = useMayWrite('schedule:create')
  const mayEditEvent = useMayWrite('schedule:update')
  const dragDrop = cfg.dragDrop && mayMoveJobs
  const navigate = useNavigate()
  const [view, setViewState] = useState<View>(savedView)
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* a private window keeps the default */ } }
  // Today is the company's (time/companyClock.ts), as every report's is: a browser elsewhere opened the board on its own
  // day, a day off from the jobs it holds. Noon, so the calendar maths below never crosses a midnight.
  const companyToday = () => new Date(`${companyTodayKey()}T12:00:00`)
  const [currentDate, setCurrentDate] = useState(companyToday)
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [bookings, setBookings] = useState<ScheduleBooking[]>([])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [dragJob, setDragJob] = useState<ScheduleJob | null>(null)
  /**
   * MOVE BY TAP, for a phone. (2026-10-22: a phone has no HTML drag — touch never starts one.)
   * The card's Move button picks the job up; the next tap on a day (week, month) or an hour (day) puts it there, through
   * the same save as a drop. Cancel, or a tap on the picked job, puts it down. It works with a mouse just the same.
   */
  const [moving, setMoving] = useState<ScheduleJob | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [newFor, setNewFor] = useState<Date | null>(null)
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null)

  const { start, end } = spanOf(view, currentDate)
  const spanDays = Math.round((dayStart(end).getTime() - start.getTime()) / 86_400_000) + 1
  const days = Array.from({ length: spanDays }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d })

  const load = useCallback(async () => {
    setLoading(true)
    // Jobs store scheduledDate at UTC midnight, so a Sunday job sits at 00:00Z — but local Sunday
    // midnight is 05:00-06:00Z, so `start.toISOString()` began the window AFTER the job and dropped it
    // from both its own week and the week before (fs / salon Sunday service calls vanished). Begin the
    // fetch at UTC midnight of the span's first date to include those; `to` stays the local end so a
    // late-local booking (a real instant) is still fetched. Placement filters by local day.
    // Bookings and appointments are MOMENTS placed on the company's day (companyDayKey), so the window also runs from
    // the company's midnight on the first day to its midnight after the last: a browser on UTC ended the 22nd at 23:59Z
    // and never fetched an 8pm Honolulu booking (06:00Z on the 23rd), so the Day view left it out. (2026-10-23)
    const after = new Date(dayStart(end)); after.setDate(after.getDate() + 1)
    const markerFrom = localKey(start) + 'T00:00:00.000Z', zoneFrom = companyDayStart(localKey(start)).toISOString()
    const zoneTo = new Date(companyDayStart(localKey(after)).getTime() - 1).toISOString(), localTo = end.toISOString()
    const from = markerFrom < zoneFrom ? markerFrom : zoneFrom, to = localTo > zoneTo ? localTo : zoneTo
    const [j, b, x, e] = await Promise.all([
      api.get('/api/jobs', { startDate: from, endDate: to, limit: 500 }).then((r: any) => r?.data || []).catch((err: unknown) => { toast.error(errMsg(err, 'Failed to load jobs')); return [] }),
      cfg.loadBookings ? cfg.loadBookings(from, to).catch(() => []) : api.get('/api/booking', { from, to, limit: 500 }).then((r: any) => (r?.data || []).map((row: any): ScheduleBooking => ({ id: row.id, startAt: row.scheduledDate, status: row.status, customerName: row.customerName, serviceName: row.serviceName, customerAddress: row.customerAddress ?? null, calendarId: row.calendar?.id ?? null, source: 'crm' }))).catch(() => []),
      // Bookings taken on the connected premium website — empty when no site is connected.
      !cfg.loadBookings && cfg.externalBookings ? api.get('/api/bookings/external', { from, to }).then((r: any) => (r?.bookings || []).map((row: any): ScheduleBooking => ({ ...row, source: 'website' }))).catch(() => []) : Promise.resolve([]),
      cfg.events ? api.get('/api/schedule-events', { from, to }).then((r: any) => r?.data || []).catch((err: unknown) => { toast.error(errMsg(err, 'Failed to load appointments')); return [] }) : Promise.resolve([]),
    ])
    setJobs(j); setBookings([...b, ...x]); setEvents(e)
    setLoading(false)
  }, [currentDate, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  /**
   * A day column is a diary: it has to read down the clock.
   *
   * These lists were filtered but never sorted, so a column came out in whatever order the API returned —
   * creation order. Wednesday read 07:00, 10:30, 08:00, 09:30, 10:00, 09:00, which is not a schedule, it
   * is a pile. (Field Service T28 M3)
   *
   * Work with no time set goes last rather than first: an untimed call is something to place, not the
   * start of the day, and sorting it to the top would push the 07:00 down the column.
   */
  const MINUTES = (hhmm?: string | null) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER
  }
  const byTime = <T,>(at: (x: T) => string | null | undefined) => (a: T, b: T) => MINUTES(at(a)) - MINUTES(at(b))
  // A booking's or an appointment's time and day are the COMPANY's (time/companyClock.ts), like the jobs beside it: a
  // browser elsewhere put an 8pm Honolulu booking on the next day's column. (2026-10-22)
  const clockOf = (iso?: string | null) => { const m = companyMinutes(iso); return Number.isNaN(m) ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

  const jobsFor = (d: Date) => jobs
    .filter((j) => j.scheduledDate && String(j.scheduledDate).slice(0, 10) === localKey(d))
    .slice()
    .sort(byTime((j: any) => j.scheduledTime))
  // A booking that became a job is ALREADY on this day as that job, so drawing the booking too puts the
  // same visit on the board twice. It always did; it only became obvious once both chips carried the same
  // time (T22 H1), which is what made the duplication visible rather than looking like two bookings at
  // different hours. A booking with no calendar entry of its own — a website booking, or one still held
  // for a deposit — is still drawn. (Field service T23)
  const bookingsFor = (d: Date) => {
    const drawnAsJobs = new Set(jobsFor(d).map((j) => j.id))
    return bookings.filter((b) => b.startAt && companyDayKey(b.startAt) === localKey(d) && b.status !== 'cancelled'
      && !(b.calendarId && drawnAsJobs.has(b.calendarId)))
      .slice().sort(byTime((b: any) => clockOf(b.startAt)))
  }
  // Cancelled appointments stay on the calendar (greyed), the way cancelled jobs do — hiding them made
  // a cancel look like the record had vanished.
  const eventsFor = (d: Date) => events.filter((e) => e.start && companyDayKey(e.start) === localKey(d))
    .slice().sort(byTime((e: any) => clockOf(e.start)))
  const isToday = (d: Date) => localKey(d) === companyTodayKey()
  /** Back or forward one of whatever is showing: a day, a week, a month. */
  const step = (dir: 1 | -1) => {
    const d = new Date(currentDate)
    if (view === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir) } else d.setDate(d.getDate() + dir * (view === 'week' ? 7 : 1))
    setCurrentDate(d)
  }
  const openDay = (d: Date) => { setCurrentDate(d); setView('day') }

  /** A move, saved: optimistic, then the server's answer (a clash is refused with its reason), then the real board. */
  const move = async (job: ScheduleJob, change: { scheduledDate?: string; scheduledTime?: string }, said: string) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...change } : j)))
    try { await api.put(`/api/jobs/${job.id}`, change); toast.success(said) }
    catch (err) { toast.error(errMsg(err, 'Could not reschedule')) }
    load()
  }
  // Drop a job onto a day → it moves to that day (week and month).
  const dropOnDay = async (day: Date) => {
    const job = dragJob || moving; setDragJob(null); setDragOverKey(null); setMoving(null)
    if (!job) return
    const target = localKey(day)
    if (String(job.scheduledDate || '').slice(0, 10) === target) return
    await move(job, { scheduledDate: target }, `Moved to ${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)
  }
  // Drop a job onto an hour → it starts then, on the day showing (day view). '' takes its time off.
  const dropOnHour = async (hhmm: string) => {
    const job = dragJob || moving; setDragJob(null); setDragOverKey(null); setMoving(null)
    if (!job) return
    const day = localKey(currentDate)
    const sameDay = String(job.scheduledDate || '').slice(0, 10) === day
    if (sameDay && (job.scheduledTime || '') === hhmm) return
    await move(job, { ...(sameDay ? {} : { scheduledDate: day }), scheduledTime: hhmm }, hhmm ? `Moved to ${hourLabel(Number(hhmm.slice(0, 2)))}` : 'Time taken off — no time set')
  }
  const dropProps = (key: string, onDrop: () => void) => dragDrop ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(key) },
    onDragLeave: () => { if (dragOverKey === key) setDragOverKey(null) },
    onDrop: (e: DragEvent) => { e.preventDefault(); onDrop() },
    // A job picked up with Move lands where the next tap is.
    ...(moving ? { onClick: () => onDrop(), 'data-move-target': key } : {}),
  } : {}
  /** A day's own buttons (open the day, "+N more") put a picked-up job on that day instead of opening it. */
  const dayButton = (day: Date) => (e: MouseEvent) => { e.stopPropagation(); if (moving) dropOnDay(day); else openDay(day) }

  const jobCard = (job: ScheduleJob, compact = false) => (
    <div
      key={job.id}
      data-job-id={job.id}
      draggable={dragDrop}
      onDragStart={dragDrop ? (e) => { setDragJob(job); try { e.dataTransfer.setData('text/plain', job.id) } catch { /* older engines */ } e.dataTransfer.effectAllowed = 'move' } : undefined}
      onDragEnd={dragDrop ? () => { setDragJob(null); setDragOverKey(null) } : undefined}
      // While a job is picked up, a tap on a card is a tap on its day or hour (it bubbles to the target); the picked
      // job itself puts it down.
      onClick={(e) => { if (moving) { if (moving.id === job.id) { e.stopPropagation(); setMoving(null) } return } e.stopPropagation(); navigate(`/crm/jobs/${job.id}`) }}
      title={dragDrop ? 'Drag to reschedule · click to open' : 'Click to open'}
      className={`${compact ? 'px-1.5 py-0.5' : 'p-2'} rounded text-xs text-gray-900 dark:text-slate-100 ${dragDrop ? 'cursor-move' : 'cursor-pointer'} hover:shadow-sm ${jobCls(job.status)}`}
    >
      <div className="flex items-start gap-1">
        <p className="font-medium truncate flex-1 min-w-0">{compact && job.scheduledTime ? `${job.scheduledTime} ` : ''}{job.title}</p>
        {dragDrop && !moving && (
          <button type="button" aria-label={`Move ${job.title}`} title="Move — then tap a day or an hour" data-move-job={job.id}
            onClick={(e) => { e.stopPropagation(); setMoving(job) }}
            className={`shrink-0 rounded text-gray-600 hover:bg-white/70 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white ${compact ? 'p-0.5' : 'p-1 -m-0.5'}`}>
            <Move className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
        )}
        {moving?.id === job.id && <span className="shrink-0 rounded bg-orange-500 px-1 text-[10px] font-semibold text-white">Moving</span>}
      </div>
      {!compact && (job.scheduledTime || job.contact?.name) && <p className="text-gray-500 dark:text-slate-400 truncate">{[job.scheduledTime, job.contact?.name].filter(Boolean).join(' · ')}</p>}
    </div>
  )
  const bookingCard = (b: ScheduleBooking, compact = false) => (
    <div key={`${b.source}-${b.id}`} className={`${compact ? 'px-1.5 py-0.5' : 'p-2'} rounded text-xs bg-orange-100 border-l-4 border-orange-500 dark:bg-orange-900/30 text-gray-900 dark:text-slate-100`} title={`${b.serviceName || 'Booking'} — ${b.customerName}${b.customerAddress ? ' @ ' + b.customerAddress : ''}`}>
      {/*
        The word, not the colour.

        This chip has been given a brand tint, a thicker edge and its own icon across two
        rounds and still read as "the same as a service call" — because orange-* IS the
        tenant's brand, so the difference was a pale blue beside a pale grey on a chip two
        lines tall. Which shade reads as distinct depends on the hue the tenant picked,
        and that is not something to keep guessing at. A label says it at any hue, in
        either theme, and to someone who cannot separate those two pastels at all.
        (Field Service T29/T30 L5)
      */}
      <p className="font-medium truncate flex items-center gap-1">
        <Calendar className="w-3 h-3 shrink-0" />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">Booking</span>
        <span className="truncate">{b.customerName}</span>
      </p>
      {!compact && <p className="text-gray-600 truncate dark:text-slate-300">{timeOf(b.startAt)}{b.serviceName ? ' · ' + b.serviceName : ''}</p>}
    </div>
  )
  const eventCard = (e: ScheduleEvent, compact = false) => (
    <div key={e.id} onClick={mayEditEvent ? (ev) => { ev.stopPropagation(); setEditEvent(e) } : undefined} title={mayEditEvent ? 'Click to edit or cancel' : undefined} className={`${compact ? 'px-1.5 py-0.5' : 'p-2'} rounded text-xs ${mayEditEvent ? 'cursor-pointer hover:shadow-sm' : ''} ${e.status === 'cancelled' ? /* No opacity. The strikethrough already says "cancelled", so the dimming was doing redundant work
   and cost the label its readability: gray-500 on gray-50 at 60% renders 2.28:1, against 4.63:1 at
   full strength. State on text is carried by a token and a non-colour signal, never by opacity —
   opacity multiplies against whatever surface it lands on, which is exactly how a correct-looking
   palette renders wrong. WCAG exempts a DISABLED control; a cancelled booking is content. */
      'bg-gray-50 border-l-2 border-gray-300 text-gray-500 line-through dark:bg-slate-800 dark:text-slate-400' : 'bg-indigo-50 border-l-2 border-indigo-500 dark:bg-indigo-900/20 text-gray-900 dark:text-slate-100'}`}>
      <p className="font-medium truncate">{e.title}</p>
      {!compact && <p className="text-gray-500 truncate dark:text-slate-400">{e.allDay ? 'All day' : timeOf(e.start)}{e.type ? ' · ' + e.type.replace(/_/g, ' ') : ''}</p>}
    </div>
  )

  const title = view === 'day'
    ? currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'month'
      ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month'
  // Drag with a mouse; on a phone (no drag there) the Move button on a job, then a tap where it goes.
  const hint = view === 'day' ? `Drag a ${cfg.jobLabel.toLowerCase()} to another hour, or tap its Move button and then an hour, to change its time.` : `Drag a ${cfg.jobLabel.toLowerCase()} to another day, or tap its Move button and then a day, to reschedule it.`

  // ── Day: the hours down the page ─────────────────────────────────────────────────────────────────
  const dayBody = () => {
    const today = jobsFor(currentDate)
    const untimed = today.filter((j) => MINUTES(j.scheduledTime) === Number.MAX_SAFE_INTEGER)
    const inHour = (h: number) => today.filter((j) => {
      const m = MINUTES(j.scheduledTime); if (m === Number.MAX_SAFE_INTEGER) return false
      const jh = Math.floor(m / 60)
      return h === FIRST_HOUR ? jh <= FIRST_HOUR : h === LAST_HOUR ? jh >= LAST_HOUR : jh === h
    })
    const hourOf = (iso: string) => Math.floor(companyMinutes(iso) / 60)
    const inHourOther = <T,>(list: T[], at: (x: T) => string) => (h: number) => list.filter((x) => { const xh = hourOf(at(x)); return h === FIRST_HOUR ? xh <= FIRST_HOUR : h === LAST_HOUR ? xh >= LAST_HOUR : xh === h })
    const bookingsIn = inHourOther(bookingsFor(currentDate), (b) => b.startAt)
    const eventsIn = inHourOther(eventsFor(currentDate).filter((e) => !e.allDay), (e) => e.start)
    const allDay = eventsFor(currentDate).filter((e) => e.allDay)
    const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)
    return (
      <div className={`bg-white dark:bg-slate-900 rounded-lg shadow-sm overflow-hidden ${isToday(currentDate) ? 'ring-2 ring-orange-500' : ''}`} data-view="day" data-day={localKey(currentDate)}>
        <div data-hour="" {...dropProps('untimed', () => dropOnHour(''))} className={`flex gap-3 border-b dark:border-slate-800 p-2 transition ${dragOverKey === 'untimed' ? 'bg-orange-50/60 ring-2 ring-inset ring-orange-400' : ''}`}>
          <div className="w-16 shrink-0 text-xs font-medium text-gray-500 dark:text-slate-400 pt-1">No time set</div>
          <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 min-h-[36px]">
            {untimed.map((j) => jobCard(j))}
            {allDay.map((e) => eventCard(e))}
            {untimed.length === 0 && allDay.length === 0 && <p className="text-[11px] text-gray-500 dark:text-slate-400 self-center select-none">{moving ? 'Tap here to take its time off' : dragDrop ? `Drop a ${cfg.jobLabel.toLowerCase()} here to take its time off` : 'Nothing without a time'}</p>}
          </div>
        </div>
        {hours.map((h) => {
          const key = hourKey(h)
          const here = inHour(h), bk = bookingsIn(h), ev = eventsIn(h)
          return (
            <div key={key} data-hour={key} {...dropProps(key, () => dropOnHour(key))} className={`flex gap-3 border-b last:border-b-0 dark:border-slate-800 p-2 transition ${dragOverKey === key ? 'bg-orange-50/60 ring-2 ring-inset ring-orange-400' : ''}`}>
              <div className="w-16 shrink-0 text-xs font-medium text-gray-500 dark:text-slate-400 pt-1">{hourLabel(h)}</div>
              <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 min-h-[36px]">
                {here.map((j) => jobCard(j))}
                {bk.map((b) => bookingCard(b))}
                {ev.map((e) => eventCard(e))}
              </div>
            </div>
          )
        })}
        {cfg.events && mayBook && <div className="p-2 border-t dark:border-slate-800"><button type="button" onClick={() => setNewFor(currentDate)} className="w-full text-xs text-gray-500 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-200 py-1">+ Add</button></div>}
      </div>
    )
  }

  // ── Week: seven columns, as it always was ─────────────────────────────────────────────────────────
  const weekBody = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4" data-view="week">
      {days.map((day) => {
        const key = localKey(day)
        return (
          <div
            key={key}
            data-day={key}
            {...dropProps(key, () => dropOnDay(day))}
            className={`bg-white dark:bg-slate-900 rounded-lg shadow-sm overflow-hidden transition ${isToday(day) ? 'ring-2 ring-orange-500' : ''} ${dragOverKey === key ? 'ring-2 ring-orange-400 bg-orange-50/40' : ''}`}
          >
            <button type="button" onClick={dayButton(day)} title={moving ? 'Move it here' : 'Open this day'} className={`w-full px-3 py-2 text-center border-b dark:border-slate-800 ${isToday(day) ? 'bg-orange-500 text-white' : 'bg-gray-50 dark:bg-slate-800/60 text-gray-900 dark:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
              <p className="text-xs font-medium">{WEEKDAYS[day.getDay()]}</p>
              <p className="text-lg font-bold">{day.getDate()}</p>
            </button>
            <div className="p-2 space-y-2 min-h-[200px]">
              {jobsFor(day).map((j) => jobCard(j))}
              {bookingsFor(day).map((b) => bookingCard(b))}
              {eventsFor(day).map((e) => eventCard(e))}
              {cfg.events ? (
                mayBook && <button type="button" onClick={() => setNewFor(day)} className="w-full text-xs text-gray-500 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-200 py-1">+ Add</button>
              ) : (
                dragDrop && jobsFor(day).length === 0 && bookingsFor(day).length === 0 && <p className="text-[11px] text-gray-500 dark:text-slate-400 text-center pt-4 select-none">Drop a {cfg.jobLabel.toLowerCase()} here</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── Month: the weeks covering it, a few lines a day ───────────────────────────────────────────────
  const MONTH_LINES = 3
  const monthBody = () => (
    <div data-view="month">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => <p key={w} className="text-center text-xs font-medium text-gray-500 dark:text-slate-400">{w}</p>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = localKey(day)
          const inMonth = day.getMonth() === currentDate.getMonth()
          const items = [...jobsFor(day).map((j) => ({ k: 'j' as const, j })), ...bookingsFor(day).map((b) => ({ k: 'b' as const, b })), ...eventsFor(day).map((e) => ({ k: 'e' as const, e }))]
          const shown = items.slice(0, MONTH_LINES), more = items.length - shown.length
          return (
            <div
              key={key}
              data-day={key}
              {...dropProps(key, () => dropOnDay(day))}
              className={`min-h-[96px] rounded-md p-1 transition ${inMonth ? 'bg-white dark:bg-slate-900' : 'bg-gray-50 dark:bg-slate-900/40'} shadow-sm ${isToday(day) ? 'ring-2 ring-orange-500' : ''} ${dragOverKey === key ? 'ring-2 ring-orange-400 bg-orange-50/40' : ''}`}
            >
              <button type="button" onClick={dayButton(day)} title={moving ? 'Move it here' : 'Open this day'} className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${isToday(day) ? 'bg-orange-500 text-white' : inMonth ? 'text-gray-900 hover:bg-gray-100 dark:text-slate-100 dark:hover:bg-slate-800' : 'text-gray-500 dark:text-slate-400'}`}>{day.getDate()}</button>
              {/* Below md a cell is too narrow for titles: it says how many, and opens the day. */}
              {items.length > 0 && <button type="button" onClick={dayButton(day)} className="md:hidden block w-full rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-800 dark:bg-slate-800 dark:text-slate-200">{items.length}</button>}
              <div className="hidden md:block space-y-1">
                {shown.map((it) => it.k === 'j' ? jobCard(it.j, true) : it.k === 'b' ? bookingCard(it.b, true) : eventCard(it.e, true))}
                {more > 0 && <button type="button" onClick={dayButton(day)} className="w-full text-left text-[11px] font-medium text-gray-600 hover:underline dark:text-slate-300">+{more} more</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule</h1>
          {dragDrop && <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{hint}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {cfg.events && mayBook && <Button onClick={() => setNewFor(companyToday())}><Plus className="w-4 h-4 inline mr-1" />New Appointment</Button>}
          <div role="group" aria-label="Calendar view" className="inline-flex rounded-lg border border-gray-300 dark:border-slate-700 overflow-hidden">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className={`px-3 py-1.5 text-sm ${view === v.id ? 'bg-orange-500 text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>{v.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => step(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label={`Previous ${unit}`}><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-medium text-gray-900 dark:text-slate-100" data-testid="schedule-title">{title}</span>
          <button type="button" onClick={() => step(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label={`Next ${unit}`}><ChevronRight className="w-5 h-5" /></button>
          <button type="button" onClick={() => setCurrentDate(companyToday())} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800">Today</button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs text-gray-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-300 dark:bg-slate-700 dark:text-slate-100" />{cfg.jobLabel}</span>
        {bookings.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" />Booking</span>}
        {cfg.events && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-300" />Appointment</span>}
      </div>

      {moving && (
        <div role="status" data-testid="move-banner" className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900 shadow-sm dark:border-orange-500/50 dark:bg-orange-950/60 dark:text-orange-100">
          <span className="min-w-0"><span className="font-semibold">Moving “{moving.title}”</span> — tap {view === 'day' ? 'an hour' : 'a day'} to put it there{view === 'day' ? ' (or "No time set")' : ''}.</span>
          <button type="button" onClick={() => setMoving(null)} className="shrink-0 inline-flex items-center gap-1 rounded border border-orange-300 px-2 py-1 text-orange-900 hover:bg-orange-100 dark:border-orange-500/50 dark:text-orange-100 dark:hover:bg-orange-900/40"><X className="w-3.5 h-3.5" />Cancel</button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-12" aria-busy="true"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : view === 'day' ? dayBody() : view === 'month' ? monthBody() : weekBody()}

      {cfg.events && newFor && <AppointmentModal api={api} toast={toast} date={newFor} types={cfg.eventTypes} onClose={() => setNewFor(null)} onSaved={() => { setNewFor(null); load() }} />}
      {cfg.events && editEvent && <AppointmentModal api={api} toast={toast} date={new Date(editEvent.start)} event={editEvent} types={cfg.eventTypes} onClose={() => setEditEvent(null)} onSaved={() => { setEditEvent(null); load() }} />}
    </div>
  )
}

function AppointmentModal({ api, toast, date, event, types, onClose, onSaved }: { api: SchedulePageProps['api']; toast: SchedulePageProps['toast']; date: Date; event?: ScheduleEvent | null; types: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  // An appointment's day and hours are read and written on the COMPANY's clock, as the calendar places it (2026-10-23).
  const hhmm = (iso?: string | null, fallback = '09:00') => (iso && companyHHMM(iso)) || fallback
  const editing = !!event
  const [form, setForm] = useState({
    title: event?.title || '',
    type: event?.type || types[0]?.value || 'appointment',
    date: event?.start ? companyDayKey(event.start) : localKey(date),
    startTime: hhmm(event?.start, '09:00'),
    endTime: hhmm(event?.end, '10:00'),
    notes: event?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const submit = async () => {
    if (!form.title.trim()) { toast.error('A title is required'); return }
    const start = companyMoment(form.date, form.startTime), end = companyMoment(form.date, form.endTime)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) { toast.error('Enter a valid date and time'); return }
    if (end < start) { toast.error('End time cannot be before start time'); return }
    setSaving(true)
    try {
      const payload = { title: form.title.trim(), type: form.type, start: start.toISOString(), end: end.toISOString(), notes: form.notes || undefined }
      if (editing) { await api.put(`/api/schedule-events/${event!.id}`, payload); toast.success('Appointment updated') }
      else { await api.post('/api/schedule-events', payload); toast.success('Appointment created') }
      onSaved()
    } catch (err) { toast.error(errMsg(err, `Failed to ${editing ? 'update' : 'create'} appointment`)) } finally { setSaving(false) }
  }
  // Confirmation is a ConfirmModal, not window.confirm — the native dialog blocks the whole tab (a
  // headless/automated session can't dismiss it, so the cancel appeared to hang and never fired).
  const remove = async () => {
    if (!editing) return
    setDeleting(true)
    try { await api.delete(`/api/schedule-events/${event!.id}`); toast.success('Appointment cancelled'); setConfirmCancel(false); onSaved() }
    catch (err) { toast.error(errMsg(err, 'Failed to cancel appointment')) } finally { setDeleting(false) }
  }
  return (
    <>
    <Modal isOpen onClose={onClose} title={editing ? 'Edit Appointment' : 'New Appointment'} size="md">
      <div className="space-y-4">
        <Field label="Title *"><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Test drive — John Smith" className={inputCls} /></Field>
        <Field label="Type"><select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputCls}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputCls} /></Field>
          <Field label="Start"><input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} className={inputCls} /></Field>
          <Field label="End"><input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} className={inputCls} /></Field>
        </div>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className={inputCls} /></Field>
        <div className="flex justify-between gap-2 pt-2">
          <div>{editing && <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={deleting}>{deleting ? 'Cancelling…' : 'Cancel appointment'}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      </div>
    </Modal>
    <ConfirmModal isOpen={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={remove}
      title="Cancel appointment"
      message="This appointment will be marked cancelled and greyed out on the calendar — its record is kept, not deleted."
      confirmText="Cancel appointment" />
    </>
  )
}

export default SchedulePage
