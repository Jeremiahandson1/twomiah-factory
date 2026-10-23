// Moved from templates/crm-homecare/frontend/src/components/admin/DragDropScheduler.tsx (its component was SchedulerGrid).
//
// The Schedule Hub's weekly grid: caregivers × the seven days, recurring support, exception-aware rendering, drag and
// drop, and scope-based edit / delete (this occurrence / this & following / all).
//
// Server:
//   GET    /api/caregivers, /api/clients — list replies (hr/caregivers.ts, clients/clients.ts)
//   GET    /api/schedules-all — a list reply of schedule rows, each with `exceptions` (scheduling/schedulesAll.ts)
//   POST   /api/schedules-enhanced — the row with { effectiveDateClamped, effectiveDate, authWarnings }; 409 code 'duplicate'
//   PUT    /api/schedules-all/:id { scope, editDate, caregiverId, clientId, startTime, endTime, notes, isTraining,
//          overnight, dayOfWeek, date, frequency, anchorDate } — the row
//   DELETE /api/schedules/:id?scope=this|following|all|purge&date&deletePair (scheduling/schedules.ts)
//   POST   /api/schedules/:id/suspend { scope, fromDate? } — { suspended, scope, fromDate, … }; /resume { scope } — { resumed, … }
//   POST   /api/schedule-exceptions { scheduleId, exceptionDate, exceptionType } (scheduling/scheduleExceptions.ts)
//   POST   /api/emergency/client-unavailable { scheduleId, date, reason, note } (clients/emergency.ts)
import { Fragment, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { getTodayCT } from '../lib/timezone'
import { isBiweeklyOn } from '../lib/biweekly'
import { CLIENT_UNAVAILABLE_REASONS } from '../lib/cancelReasons'
import { endsBeforeStart, shiftTimesError } from '../lib/shiftTimes'
import { toLocalYMD, parseLocalDate, formatDate } from '../lib/date'
import MakeShiftAvailableModal from './MakeShiftAvailableModal'
import { useMay } from '../lib/useMay'
import { C, CHIP_FILLS, FILL, dialog, overlay, tint } from './theme'
import { fullName, isRecurringRow, type Caregiver, type Client, type SavedReply, type ScheduleRow } from './types'
import { money } from '@twomiah/tenant-ui/src/money'

/** A shift as the grid draws it on one day: the row, with that day's exception applied. */
interface CellShift extends ScheduleRow {
  _isOneTime?: boolean
  _isModified?: boolean
  _exceptionId?: string
}

// THE colour of a client, for the shift chips AND the legend. The legend once coloured by list position while the
// chips coloured by sorted id, so Pat's legend swatch was Sam's chip colour. White text sits on these (700 shades).
function clientColor(clientId: string, clientMap: Record<string, Client>): string {
  const ids = Object.keys(clientMap).sort()
  return CHIP_FILLS[Math.max(0, ids.indexOf(clientId)) % CHIP_FILLS.length]
}

// The week on screen survives a save, a reload and a trip to another tab: the grid used to drop back to the current
// week (and, while it reloaded, to the left-hand Sunday column) after every save. Per-viewer convenience only, so a
// failed storage read just means "this week".
const WEEK_KEY = 'hc.scheduleGrid.weekOf'
function initialWeekOf(): Date {
  try {
    const saved = sessionStorage.getItem(WEEK_KEY)
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
      const [y, m, d] = saved.split('-').map(Number)
      return getWeekStart(new Date(y, m - 1, d))
    }
  } catch { /* storage blocked — fall through */ }
  return getWeekStart(new Date())
}
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeToMinutes(t: string): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Hours between two HH:MM times, wrapping past midnight (e.g. 13:00→12:00 = 23h).
function shiftHours(start: string, end: string): number {
  if (!start || !end) return 0
  let mins = timeToMinutes(end) - timeToMinutes(start)
  if (mins <= 0) mins += 24 * 60
  return mins / 60
}

function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function getWeekStart(date: Date | string): Date {
  const d = parseLocalDate(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = parseLocalDate(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface NewShiftForm {
  clientId: string; startTime: string; endTime: string; notes: string
  isSplit: boolean; split2Start: string; split2End: string
  scheduleType: 'one-time' | 'recurring'
  frequency: 'weekly' | 'biweekly'
  selectedDays: number[]
  startDate: string
  endDate: string
  isTraining: boolean
  overnight: boolean
}
interface EditShiftForm { caregiverId: string; clientId: string; startTime: string; endTime: string; notes: string; isTraining: boolean; overnight: boolean }
type Scope = 'this' | 'following' | 'all'
interface DropTarget { shift: CellShift; fromDate: string; toCaregiverId: string; toDate: string; toDayIndex: number }

const blankNewShift = (dayIndex: number, startDate: string): NewShiftForm => ({
  clientId: '', startTime: '09:00', endTime: '13:00', notes: '',
  isSplit: false, split2Start: '16:00', split2End: '20:00',
  scheduleType: 'one-time', frequency: 'weekly',
  selectedDays: [dayIndex],
  startDate,
  endDate: '',
  isTraining: false,
  overnight: false,
})

export default function DragDropScheduler({ onScheduleChange }: { onScheduleChange?: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  // Each write is the care-schedule verb its route asks (scheduling/*.ts); client-unavailable is evv:create (clients/emergency.ts).
  const may = useMay('care-schedule')
  const mayEvv = useMay('evv')
  const mayOpenShift = may.update || may.delete || mayEvv.create
  const [weekOf, setWeekOfState] = useState<Date>(initialWeekOf)
  const setWeekOf = (d: Date) => { setWeekOfState(d); try { sessionStorage.setItem(WEEK_KEY, localYmd(d)) } catch { /* convenience only */ } }
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  // Only the FIRST load replaces the grid with "Loading…". A reload after a save keeps the grid (and its scroll
  // position) on screen; unmounting it is what scrolled the view back to Sunday.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [mobileDay, setMobileDay] = useState(new Date().getDay())

  // ── Create ──
  const [newShift, setNewShift] = useState<{ caregiverId: string; dayIndex: number } | null>(null)
  const [newShiftForm, setNewShiftForm] = useState<NewShiftForm>(blankNewShift(0, ''))
  const [splitError, setSplitError] = useState('')

  // ── Edit ──
  const [editShift, setEditShift] = useState<CellShift | null>(null)
  const [editShiftForm, setEditShiftForm] = useState<EditShiftForm>({ caregiverId: '', clientId: '', startTime: '', endTime: '', notes: '', isTraining: false, overnight: false })
  const [editScope, setEditScope] = useState<Scope>('all')
  const [editDate, setEditDate] = useState('')

  // Suspend / resume service (schedules.suspended_from). Same endpoints the create-panel edit box uses — this modal is
  // the one people actually reach from the grid.
  const [suspendBusy, setSuspendBusy] = useState(false)
  const [suspendFrom, setSuspendFrom] = useState('')

  // "Move to Available Shifts" — offer this one visit to chosen caregivers.
  const [offerShift, setOfferShift] = useState<{ shift: CellShift; date: string } | null>(null)

  // ── Delete scope ──
  const [deleteConfirm, setDeleteConfirm] = useState<{ shift: CellShift; date: string } | null>(null)
  const [unavailForm, setUnavailForm] = useState<{ reason: string; note: string } | null>(null) // "client unavailable" sub-step

  // ── Drag & drop ──
  const [dragShift, setDragShift] = useState<{ shift: CellShift; fromDate: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [dropScope, setDropScope] = useState<Scope>('this')
  const [dragOverKey, setDragOverKey] = useState<string | null>(null) // `${caregiverId}:${dayIndex}` for hover highlight

  const clientMap: Record<string, Client> = Object.fromEntries(clients.map((c) => [c.id, c]))

  // Every caregiver and client, not the lists' first page of 50: a 51st caregiver had no row on the grid.
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cgs, cls, schs] = await Promise.all([
        listAll('/api/caregivers'),
        listAll('/api/clients'),
        api.get('/api/schedules-all'),
      ])
      setCaregivers(rows<Caregiver>(cgs))
      setClients(rows<Client>(cls))
      setSchedules(rows<ScheduleRow>(schs))
    } catch {
      toast.error('Failed to load schedule data')
    } finally {
      setLoading(false)
      setHasLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const weekDates = getWeekDates(weekOf)
  const weekDateStrs = weekDates.map(localYmd)
  const todayStr = getTodayCT()
  const todayIdx = weekDateStrs.indexOf(todayStr)

  // ═══ OCCURRENCES — exception-aware ═══

  function getShiftsForCell(caregiverId: string, dayIndex: number): CellShift[] {
    const dateStr = weekDateStrs[dayIndex]
    const results: CellShift[] = []

    schedules.forEach((s) => {
      // One-off shift
      if (s.date) {
        if (s.caregiverId !== caregiverId) return
        if (s.date.slice(0, 10) === dateStr) {
          // Suspended (service paused / caregiver removed pending investigation): the server engine drops one-time
          // rows on/after suspendedFrom too — match it.
          if (s.suspendedFrom && dateStr >= s.suspendedFrom.slice(0, 10)) return
          // One-time rows can be cancelled via exception (client unavailable) — match the server engine.
          const exc = (s.exceptions || []).find((e) => (e.exceptionDate || '').slice(0, 10) === dateStr)
          if (!(exc && exc.exceptionType === 'cancelled')) results.push({ ...s, _isOneTime: true })
        }
        return
      }

      // Recurring shift
      if (isRecurringRow(s)) {
        if (Number(s.dayOfWeek) !== dayIndex) return

        // Respect the start boundary, compared as calendar days.
        const startsOn = toLocalYMD(s.effectiveDate || s.anchorDate || s.createdAt)
        if (startsOn && dateStr < startsOn) return
        // Respect endDate (a calendar day).
        if (s.endDate && dateStr > s.endDate.slice(0, 10)) return
        // Suspended service: hide occurrences on/after the suspend date (matches the server).
        if (s.suspendedFrom && dateStr >= s.suspendedFrom.slice(0, 10)) return
        // Bi-weekly: the shared whole-day parity rule (lib/biweekly), the one payroll uses.
        if (s.frequency === 'biweekly' && s.anchorDate && !isBiweeklyOn(dateStr, s.anchorDate)) return

        const exc = (s.exceptions || []).find((e) => (e.exceptionDate || '').slice(0, 10) === dateStr)
        if (exc && exc.exceptionType === 'cancelled') return // a cancelled occurrence

        // Route to the effective caregiver for this date (an exception's override wins)
        const effectiveCaregiverId = (exc && exc.overrideCaregiverId) || s.caregiverId
        if (effectiveCaregiverId !== caregiverId) return

        if (exc && exc.exceptionType === 'modified') {
          results.push({
            ...s,
            caregiverId: effectiveCaregiverId,
            startTime: exc.overrideStartTime || s.startTime,
            endTime: exc.overrideEndTime || s.endTime,
            clientId: exc.overrideClientId || s.clientId,
            notes: exc.overrideNotes !== null && exc.overrideNotes !== undefined ? exc.overrideNotes : s.notes,
            _isModified: true,
            _exceptionId: exc.id,
          })
          return
        }
        results.push(s)
      }
    })

    return results.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  }

  function weeklyHours(caregiverId: string): number {
    let total = 0
    for (let d = 0; d < 7; d++) getShiftsForCell(caregiverId, d).forEach((s) => { total += shiftHours(s.startTime, s.endTime) })
    return total
  }

  function prevWeek() { const d = parseLocalDate(weekOf); d.setDate(d.getDate() - 7); setWeekOf(d) }
  function nextWeek() { const d = parseLocalDate(weekOf); d.setDate(d.getDate() + 7); setWeekOf(d) }
  function goToday() { setWeekOf(getWeekStart(new Date())) }

  // ═══ CREATE ═══

  function handleCellClick(caregiverId: string, dayIndex: number) {
    if (saving) return
    setNewShift({ caregiverId, dayIndex })
    setNewShiftForm(blankNewShift(dayIndex, weekDateStrs[dayIndex]))
    setSplitError('')
  }

  function validateSplitTimes(form: NewShiftForm): boolean {
    if (!form.isSplit) { setSplitError(''); return true }
    if (form.split2Start <= form.endTime) { setSplitError('Shift 2 must start after Shift 1 ends'); return false }
    if (form.split2End <= form.split2Start) { setSplitError('Shift 2 end must be after Shift 2 start'); return false }
    setSplitError('')
    return true
  }

  function toggleDay(dayIdx: number) {
    setNewShiftForm((f) => ({
      ...f,
      selectedDays: f.selectedDays.includes(dayIdx) ? f.selectedDays.filter((d) => d !== dayIdx) : [...f.selectedDays, dayIdx].sort((a, b) => a - b),
    }))
  }

  async function handleCreateShift() {
    if (!newShift) return
    if (!newShiftForm.clientId) { toast.error('Select a client'); return }
    const timesError = shiftTimesError(newShiftForm.startTime, newShiftForm.endTime, newShiftForm.overnight)
    if (timesError) { toast.error(timesError); return }
    if (!validateSplitTimes(newShiftForm)) return
    const overnight = endsBeforeStart(newShiftForm.startTime, newShiftForm.endTime) && newShiftForm.overnight

    setSaving(true)
    try {
      if (newShiftForm.scheduleType === 'recurring') {
        const days = newShiftForm.selectedDays
        if (days.length === 0) { toast.error('Select at least one day'); return }

        // Bi-weekly anchor = the start date as typed; the server aligns it to each selected weekday.
        const anchorStr = newShiftForm.startDate || todayStr

        let created = 0, dup = 0, failed = 0
        let clampedTo: string | null = null
        let firstFailure: string | null = null, authWarning: string | null = null
        for (const dayOfWeek of days) {
          const payload: Record<string, unknown> = {
            caregiverId: newShift.caregiverId,
            clientId: newShiftForm.clientId,
            scheduleType: 'recurring',
            dayOfWeek,
            date: null,
            startTime: newShiftForm.startTime,
            endTime: newShiftForm.endTime,
            notes: newShiftForm.notes,
            frequency: newShiftForm.frequency,
            effectiveDate: newShiftForm.startDate || todayStr,
            anchorDate: newShiftForm.frequency === 'biweekly' ? anchorStr : null,
            endDate: newShiftForm.endDate || null,
            isTraining: newShiftForm.isTraining,
            overnight,
          }
          if (newShiftForm.isSplit) payload.splitShift = { startTime: newShiftForm.split2Start, endTime: newShiftForm.split2End }
          try {
            const body = await api.post('/api/schedules-enhanced', payload) as SavedReply
            if (body.effectiveDateClamped) clampedTo = body.effectiveDate || null
            if (body.authWarnings?.length) authWarning = body.authWarnings[0]
            created++
          } catch (err) {
            // 409 = the duplicate guard refused an identical active shift. Anything else keeps the server's sentence:
            // a rejected shift used to read as "nothing happened".
            if ((err as { status?: number }).status === 409) dup++
            else { failed++; if (!firstFailure) firstFailure = errorMessage(err) }
          }
        }

        const baseMsg = `Created ${created} recurring schedule${created !== 1 ? 's' : ''}${dup ? ` — ${dup} already scheduled` : ''}${failed ? ` — ${failed} failed: ${firstFailure}` : ''}`
        if (failed > 0) toast.error(baseMsg)
        else if (clampedTo) toast.warning(`${baseMsg} — recurring shifts can't start in the past, so it begins ${formatDate(clampedTo, { weekday: 'short', month: 'short', day: 'numeric' })}.`)
        else toast.success(baseMsg)
        if (authWarning) toast.warning(`⚠️ ${authWarning}`)
      } else {
        const payload: Record<string, unknown> = {
          caregiverId: newShift.caregiverId,
          clientId: newShiftForm.clientId,
          scheduleType: 'one-time',
          date: weekDateStrs[newShift.dayIndex],
          startTime: newShiftForm.startTime,
          endTime: newShiftForm.endTime,
          notes: newShiftForm.notes,
          isTraining: newShiftForm.isTraining,
          overnight,
        }
        if (newShiftForm.isSplit) payload.splitShift = { startTime: newShiftForm.split2Start, endTime: newShiftForm.split2End }
        await api.post('/api/schedules-enhanced', payload)
        toast.success(newShiftForm.isSplit ? 'Split shift created' : 'Shift created')
      }

      setNewShift(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to create shift'))
    } finally {
      setSaving(false)
    }
  }

  // ═══ DELETE — scope-aware ═══

  // Client refused / not home / hospital / cancelled ahead: the visit is cancelled with a REASON so billing review lists
  // it as "not billed — client unavailable" instead of it silently disappearing. One-time and recurring rows alike.
  async function handleClientUnavailable() {
    if (!deleteConfirm || !unavailForm) return
    const { shift, date } = deleteConfirm
    const occDate = date || (shift.date ? String(shift.date).slice(0, 10) : null)
    if (!occDate) { toast.error('Could not determine the visit date — reopen the shift from its day cell.'); return }
    if (!unavailForm.reason) { toast.error('Pick a reason'); return }
    if (unavailForm.reason === 'other' && !(unavailForm.note || '').trim()) { toast.error('Add a note for "Other"'); return }
    setSaving(true)
    try {
      await api.post('/api/emergency/client-unavailable', { scheduleId: shift.id, date: occDate, reason: unavailForm.reason, note: unavailForm.note || null })
      toast.success('Visit marked client-unavailable — it will not be billed')
      setDeleteConfirm(null); setUnavailForm(null); setEditShift(null)
      await loadAll()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'))
    } finally { setSaving(false) }
  }

  async function handleDeleteShift(scope: Scope | 'purge') {
    if (!deleteConfirm) return
    const { shift, date } = deleteConfirm
    const isSplit = shift.isSplitShift
    const isRecurring = isRecurringRow(shift)

    // 'this' / 'following' need a concrete date. Without one the server can't scope the delete — never let it
    // silently become a wipe-all.
    if ((scope === 'this' || scope === 'following') && (!isRecurring || !date)) {
      toast.error('Could not determine the occurrence date — delete cancelled. Reopen the shift from its day cell and try again.')
      return
    }

    setSaving(true)
    try {
      // Every branch checks the answer: a refused delete must not toast "Shift deleted" (Run 3).
      const del = (query: string) => api.delete(`/api/schedules/${shift.id}?${query}`)
      if (isRecurring && scope === 'this') {
        await del(`scope=this&date=${date}`)
        toast.success('This occurrence cancelled')
      } else if (isRecurring && scope === 'following') {
        await del(`scope=following&date=${date}`)
        toast.success('Future occurrences removed')
      } else if (scope === 'purge') {
        // Explicit full erase — past and future. Deliberate, confirmed.
        await del(isSplit ? 'scope=purge&deletePair=true' : 'scope=purge')
        toast.success('Schedule and its history removed')
      } else {
        // scope=all — a recurring pattern ends as of today and KEEPS every past occurrence; a one-time shift is deleted.
        await del(isSplit ? 'scope=all&deletePair=true' : 'scope=all')
        toast.success(isSplit ? 'Split shift pair deleted' : (isRecurring ? 'Ended going forward — past occurrences kept' : 'Shift deleted'))
      }

      setDeleteConfirm(null)
      setEditShift(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'))
    } finally {
      setSaving(false)
    }
  }

  // ═══ EDIT — scope-aware ═══

  function openEditShift(s: CellShift, cellDate: string) {
    setEditShift(s)
    setEditDate(cellDate || '')
    // Default to "This date only": the narrowest change. A wider change is chosen by name, and the Save button spells
    // out which weeks it will touch (Run 3).
    setEditScope('this')
    // Clear a date typed for a previously opened shift so it can't leak into this one.
    setSuspendFrom('')
    setEditShiftForm({
      caregiverId: s.caregiverId || '',
      clientId: s.clientId || '',
      startTime: s.startTime ? s.startTime.slice(0, 5) : '09:00',
      endTime: s.endTime ? s.endTime.slice(0, 5) : '13:00',
      notes: s.notes || '',
      isTraining: !!s.isTraining,
      // A shift already saved as running past midnight opens as overnight.
      overnight: endsBeforeStart(s.startTime, s.endTime),
    })
  }

  async function handleSaveShift() {
    if (!editShift) return
    if (!editShiftForm.clientId) { toast.error('Select a client'); return }
    const timesError = shiftTimesError(editShiftForm.startTime, editShiftForm.endTime, editShiftForm.overnight)
    if (timesError) { toast.error(timesError); return }
    setSaving(true)
    try {
      const isRecurring = isRecurringRow(editShift)
      // ONE atomic call: the server splits / overrides / reassigns in one transaction and answers the live row.
      await api.put(`/api/schedules-all/${editShift.id}`, {
        scope: isRecurring ? editScope : undefined,
        editDate: isRecurring ? editDate : undefined,
        caregiverId: editShiftForm.caregiverId || undefined,
        clientId: editShiftForm.clientId,
        startTime: editShiftForm.startTime,
        endTime: editShiftForm.endTime,
        notes: editShiftForm.notes,
        isTraining: editShiftForm.isTraining,
        overnight: endsBeforeStart(editShiftForm.startTime, editShiftForm.endTime) && !!editShiftForm.overnight,
        dayOfWeek: editShift.dayOfWeek,
        date: editShift.date ? editShift.date.slice(0, 10) : null,
        frequency: editShift.frequency || 'weekly',
        anchorDate: editShift.anchorDate || null,
      })

      const when = editDate ? formatDate(editDate, { weekday: 'short', month: 'short', day: 'numeric' }) : 'this shift'
      if (!isRecurring) toast.success('Shift updated')
      else if (editScope === 'this') toast.success(`Changed ${when} only`)
      else if (editScope === 'following') toast.success(`Changed from ${when} onward`)
      else toast.success('Changed every occurrence, including past weeks')

      setEditShift(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  // ═══ SUSPEND / RESUME SERVICE ═══
  // Pause a client's visits without deleting the schedule: the occurrence engine skips dates on/after suspendedFrom, so
  // billing, payroll, reminders and no-show all stop — past visits stay. scope 'this' = this weekday, 'client' = all.

  async function handleSuspendService(scope: 'this' | 'client') {
    if (!editShift) return
    setSuspendBusy(true)
    try {
      const body: Record<string, string> = { scope }
      if (suspendFrom) body.fromDate = suspendFrom // else the server defaults to the agency's today
      const data = await api.post(`/api/schedules/${editShift.id}/suspend`, body) as { suspended: number; fromDate: string }
      const cl = clientMap[editShift.clientId]
      const who = scope === 'client'
        ? `all of ${cl ? fullName(cl) : 'this client'}'s days`
        : `${DAY_FULL[Number(editShift.dayOfWeek)]}s`
      toast.success(`Suspended ${who} from ${data.fromDate} (${data.suspended} shift${data.suspended !== 1 ? 's' : ''})`)
      setEditShift(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Suspend failed'))
    } finally {
      setSuspendBusy(false)
    }
  }

  async function handleResumeService(scope: 'this' | 'client') {
    if (!editShift) return
    setSuspendBusy(true)
    try {
      const data = await api.post(`/api/schedules/${editShift.id}/resume`, { scope }) as { resumed: number }
      toast.success(`Service resumed (${data.resumed} shift${data.resumed !== 1 ? 's' : ''})`)
      setEditShift(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Resume failed'))
    } finally {
      setSuspendBusy(false)
    }
  }

  // ═══ DRAG & DROP — confirm the move ═══
  // A move keeps the shift's own times, so a shift that already runs past midnight is sent as overnight (the server
  // refuses an end before the start otherwise).
  async function handleConfirmDrop() {
    if (!dropTarget) return
    const { shift, fromDate, toCaregiverId, toDate, toDayIndex } = dropTarget
    const isRecurring = isRecurringRow(shift)
    const caregiverChanged = shift.caregiverId !== toCaregiverId
    const dayChanged = isRecurring ? Number(shift.dayOfWeek) !== toDayIndex : !!shift.date && shift.date.slice(0, 10) !== toDate
    const overnight = endsBeforeStart(shift.startTime, shift.endTime)

    setSaving(true)
    try {
      if (isRecurring && dropScope === 'this') {
        // Cancel the original occurrence, create a one-off at the new spot
        try {
          await api.post('/api/schedule-exceptions', { scheduleId: shift.id, exceptionDate: fromDate, exceptionType: 'cancelled' })
        } catch (e) { throw new Error(errorMessage(e, 'Could not cancel original occurrence')) }
        try {
          await api.post('/api/schedules-enhanced', {
            caregiverId: toCaregiverId, clientId: shift.clientId, scheduleType: 'one-time', date: toDate,
            startTime: shift.startTime, endTime: shift.endTime, overnight, notes: shift.notes,
          })
        } catch (e) { throw new Error(errorMessage(e, 'Could not create new occurrence')) }
        toast.success('Occurrence moved')
      } else if (isRecurring && dropScope === 'following') {
        // End the current pattern the day before fromDate, then a new pattern from toDate. Both halves are checked, and
        // a failure names what state the schedule is now in (silent schedule loss otherwise).
        try {
          await api.delete(`/api/schedules/${shift.id}?scope=following&date=${fromDate}`)
        } catch (e) { throw new Error(errorMessage(e, 'Could not end the existing pattern — nothing was changed')) }
        try {
          await api.post('/api/schedules-enhanced', {
            caregiverId: toCaregiverId, clientId: shift.clientId, scheduleType: 'recurring', dayOfWeek: toDayIndex, date: null,
            startTime: shift.startTime, endTime: shift.endTime, overnight, notes: shift.notes,
            frequency: shift.frequency || 'weekly', effectiveDate: toDate, anchorDate: shift.anchorDate || null,
          })
        } catch (e) {
          throw new Error(`${errorMessage(e, 'Request failed')} — the old pattern was already ended, so this shift now has NO recurring schedule. Re-create it.`)
        }
        toast.success('Moved from this date forward')
      } else if (isRecurring) {
        // scope 'all' — the day and/or caregiver on EVERY occurrence, past included, in one call on the same row.
        try {
          await api.put(`/api/schedules-all/${shift.id}`, {
            scope: 'all', caregiverId: caregiverChanged ? toCaregiverId : undefined, clientId: shift.clientId,
            startTime: shift.startTime, endTime: shift.endTime, overnight, notes: shift.notes,
            dayOfWeek: toDayIndex, date: null, frequency: shift.frequency || 'weekly', anchorDate: shift.anchorDate || null,
          })
        } catch (e) { throw new Error(errorMessage(e, 'Could not move the shift')) }
        toast.success('Moved every occurrence, including past weeks')
      } else {
        // One-time shift — a single occurrence, so day and caregiver move together in one call.
        if (dayChanged || caregiverChanged) {
          try {
            await api.put(`/api/schedules-all/${shift.id}`, {
              caregiverId: caregiverChanged ? toCaregiverId : undefined, clientId: shift.clientId,
              startTime: shift.startTime, endTime: shift.endTime, overnight, notes: shift.notes,
              dayOfWeek: null, date: toDate, frequency: shift.frequency || 'weekly', anchorDate: shift.anchorDate || null,
            })
          } catch (e) { throw new Error(errorMessage(e, 'Could not move the shift')) }
        }
        toast.success('Shift moved')
      }

      setDropTarget(null)
      await loadAll()
      onScheduleChange?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Move failed'))
    } finally {
      setSaving(false)
    }
  }

  // ═══ RENDER HELPERS ═══

  function getSplitPartner(shift: CellShift, cellShifts: CellShift[]): CellShift | null {
    if (!shift.isSplitShift || !shift.splitShiftGroupId) return null
    return cellShifts.find((s) => s.id !== shift.id && s.splitShiftGroupId === shift.splitShiftGroupId) || null
  }

  function renderShiftBlock(s: CellShift, dayIndex: number, cellShifts: CellShift[]) {
    const client = clientMap[s.clientId]
    const color = clientColor(s.clientId, clientMap)
    const durH = shiftHours(s.startTime, s.endTime).toFixed(2)
    const isSplit = s.isSplitShift && s.splitSegment
    const partner = isSplit ? getSplitPartner(s, cellShifts) : null
    const showConnector = isSplit && s.splitSegment === 2 && partner
    const isModified = s._isModified
    const rate = client?.privatePayRate != null && client.privatePayRate !== '' ? parseFloat(String(client.privatePayRate)) : null

    return (
      <Fragment key={s.id + '-' + weekDateStrs[dayIndex]}>
        {showConnector && <div style={{ borderLeft: `2px dashed ${color}`, height: 8, marginLeft: 12, opacity: 0.5 }} />}
        <div
          draggable={may.update}
          onDragStart={(e) => {
            e.stopPropagation()
            setDragShift({ shift: s, fromDate: weekDateStrs[dayIndex] })
            try { e.dataTransfer.setData('text/plain', s.id) } catch { /* some browsers refuse */ }
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => { setDragShift(null); setDragOverKey(null) }}
          onClick={(e) => { e.stopPropagation(); if (mayOpenShift) openEditShift(s, weekDateStrs[dayIndex]) }}
          style={{
            background: isModified ? `repeating-linear-gradient(135deg, ${color}, ${color} 4px, ${color}dd 4px, ${color}dd 8px)` : color,
            color: '#fff', borderRadius: 5, padding: '3px 6px',
            marginBottom: isSplit && s.splitSegment === 1 ? 0 : 3,
            fontSize: 11, fontWeight: 600, cursor: 'grab', userSelect: 'none',
            boxShadow: `0 1px 3px ${C.shadow}`,
            borderLeft: isSplit ? '3px solid rgba(255,255,255,0.5)' : undefined,
            opacity: dragShift && dragShift.shift.id === s.id && dragShift.fromDate === weekDateStrs[dayIndex] ? 0.4 : 1,
          }}
        >
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
            {client ? fullName(client) : 'Unknown'}
            {isSplit && <span style={{ fontSize: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 3, padding: '1px 3px' }}>Split {s.splitSegment}/2</span>}
            {s.isTraining && <span title="Training shift — not billed to client" style={{ fontSize: 8, background: FILL.amber, color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 700, letterSpacing: 0.5, outline: '1px solid rgba(255,255,255,0.6)' }}>TRAIN</span>}
            {isModified && <span style={{ fontSize: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 3, padding: '1px 3px' }}>edited</span>}
          </div>
          <div style={{ fontSize: 10 }}>
            {formatTime(s.startTime)}-{formatTime(s.endTime)} ({durH}h)
            {!s.date && !s._isOneTime && <span style={{ marginLeft: 4 }}>&#8635;</span>}
          </div>
          {/* Care type + payer rate hint — helps catch wrong-rate scheduling. */}
          {client && (client.careTypeName || client.referralSourceName || rate) && (
            <div style={{ fontSize: 9, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={`${client.careTypeName || 'No care type'} · ${client.referralSourceName || (client.isPrivatePay ? 'Private Pay' : '—')}${rate ? ` · ${money(rate)}/hr` : ''}`}>
              {client.careTypeName && <span>{client.careTypeName}</span>}
              {client.careTypeName && (client.referralSourceName || rate) && <span> · </span>}
              {client.referralSourceName
                ? <span>{client.referralSourceName}</span>
                : client.isPrivatePay
                  ? <span>Private{rate ? ` ${money(rate, 0)}` : ''}</span>
                  : null}
            </div>
          )}
        </div>
      </Fragment>
    )
  }

  if (loading && !hasLoaded) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: C.muted }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>&#128197;</div>
        Loading schedule...
      </div>
    </div>
  )

  const blue = tint('blue'), violet = tint('violet'), amber = tint('amber'), red = tint('red'), green = tint('green')
  const scopeTones: Record<Scope, ReturnType<typeof tint>> = { this: blue, following: violet, all: amber }

  return (
    <div style={{ background: C.ground }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={prevWeek} style={navBtn} aria-label="Previous week">&#8249;</button>
          <button onClick={goToday} style={{ ...navBtn, padding: '6px 14px', fontSize: 13 }}>Today</button>
          <button onClick={nextWeek} style={navBtn} aria-label="Next week">&#8250;</button>
        </div>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.ink, flex: 1 }}>
          {formatDate(weekDates[0], { month: 'short', day: 'numeric' })}
          {' – '}
          {formatDate(weekDates[6], { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>Click any cell to add a shift</span>
      </div>

      {/* Mobile day picker */}
      {isMobile && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '8px 12px', overflowX: 'auto', display: 'flex', gap: 6 }}>
          {weekDates.map((d, i) => (
            <button key={i} onClick={() => setMobileDay(i)} style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: 'none',
              background: mobileDay === i ? C.brandFill : i === todayIdx ? C.todayBg : C.subtle,
              color: mobileDay === i ? '#fff' : i === todayIdx ? C.todayInk : C.ink,
              fontWeight: mobileDay === i ? 700 : 500, fontSize: 13, cursor: 'pointer',
            }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{DAY_NAMES[i]}</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{d.getDate()}</div>
            </button>
          ))}
        </div>
      )}

      {/* Mobile day view */}
      {isMobile && (
        <div style={{ padding: '0.75rem' }}>
          {caregivers.length === 0 && <div style={{ textAlign: 'center', padding: '40px 20px', color: C.muted }}>No caregivers found.</div>}
          {caregivers.map((cg) => {
            const shifts = getShiftsForCell(cg.id, mobileDay)
            return (
              <div key={cg.id} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, marginBottom: '0.75rem', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: C.hover, borderBottom: `1px solid ${C.subtle}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{cg.firstName} {cg.lastName}</div>
                    <div style={{ fontSize: 11, color: C.inkSoft }}>{weeklyHours(cg.id).toFixed(2)}h this week</div>
                  </div>
                  {may.create && <button onClick={() => handleCellClick(cg.id, mobileDay)} style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', background: C.brandFill, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>+ Shift</button>}
                </div>
                {shifts.length === 0 ? (
                  <div style={{ padding: '12px 14px', color: C.muted, fontSize: 13 }}>No shifts</div>
                ) : (
                  shifts.map((s) => {
                    const cl = clientMap[s.clientId]
                    const color = clientColor(s.clientId, clientMap)
                    const durH = shiftHours(s.startTime, s.endTime).toFixed(2)
                    const isSplit = s.isSplitShift && s.splitSegment
                    return (
                      <div key={s.id} onClick={() => { if (mayOpenShift) openEditShift(s, weekDateStrs[mobileDay]) }} style={{
                        padding: '10px 14px', borderLeft: `4px solid ${color}`, borderBottom: `1px solid ${C.subtle}`, cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {cl ? fullName(cl) : 'Unknown'}
                            {isSplit && <span style={{ fontSize: 10, color: '#fff', background: color, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>Split {s.splitSegment}/2</span>}
                          </div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{formatTime(s.startTime)} &ndash; {formatTime(s.endTime)} &middot; {durH}h</div>
                        </div>
                        <span style={{ fontSize: 12, color: C.muted }}>&#9998;</span>
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop grid */}
      {!isMobile && <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', background: C.surface, borderBottom: `2px solid ${C.line}`, position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: C.muted }}>CAREGIVER</div>
            {weekDates.map((d, i) => (
              <div key={i} style={{ padding: '10px 8px', textAlign: 'center', borderLeft: `1px solid ${C.subtle}`, background: i === todayIdx ? C.todayBg : 'transparent' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: i === todayIdx ? C.todayInk : C.inkSoft, textTransform: 'uppercase', letterSpacing: 1 }}>{DAY_NAMES[i]}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: i === todayIdx ? C.todayInk : C.ink }}>{d.getDate()}</div>
              </div>
            ))}
          </div>

          {caregivers.length === 0 && <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted }}>No caregivers found.</div>}

          {caregivers.map((cg) => {
            const hrs = weeklyHours(cg.id)
            const hrsText = hrs.toFixed(2)
            // The caregiver's own weekly cap (caregiver_availability). The template read a field its list never sent,
            // so every caregiver showed 40.
            const maxHrs = Number(cg.availability?.maxHoursPerWeek ?? 40)
            const pct = maxHrs > 0 ? hrs / maxHrs : 0
            const isOver = hrs > 40
            const isFull = pct >= 1 && !isOver
            const hoursTone = isOver ? red : isFull ? amber : pct < 0.5 ? blue : green
            const barFill = isOver ? '#EF4444' : isFull ? '#D97706' : pct < 0.5 ? '#0891B2' : '#059669'
            return (
              <div key={cg.id} style={{ display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', borderBottom: `1px solid ${C.subtle}`, background: C.surface, minHeight: 72 }}>
                <div style={{ padding: '10px 14px', borderRight: `1px solid ${C.subtle}`, background: C.hover }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cg.firstName} {cg.lastName}</div>
                  <div style={{ fontSize: 11, color: hoursTone.ink, fontWeight: (isOver || isFull) ? 700 : 500, marginTop: 2 }}
                    title={`${hrsText}h scheduled of ${maxHrs}h max — ${Math.round(pct * 100)}% capacity`}>
                    {hrsText}h / {maxHrs}h
                    {isOver ? ' ⚠️ OT' : isFull ? ' full' : ''}
                  </div>
                  <div style={{ marginTop: 4, height: 3, background: C.line, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct, 1.5) * 100 / 1.5}%`, height: '100%', background: barFill, transition: 'width 0.2s' }} />
                  </div>
                </div>
                {weekDates.map((_, dayIndex) => {
                  const shifts = getShiftsForCell(cg.id, dayIndex)
                  const isToday = dayIndex === todayIdx
                  const cellKey = `${cg.id}:${dayIndex}`
                  const isDragOver = dragOverKey === cellKey
                  const bgBase = isToday ? C.todayBg : 'transparent'
                  return (
                    <div
                      key={dayIndex}
                      onClick={may.create ? () => handleCellClick(cg.id, dayIndex) : undefined}
                      onDragOver={(e) => {
                        if (!dragShift) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragOverKey !== cellKey) setDragOverKey(cellKey)
                      }}
                      onDragLeave={() => { if (dragOverKey === cellKey) setDragOverKey(null) }}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragOverKey(null)
                        if (!dragShift) return
                        const toDate = weekDateStrs[dayIndex]
                        if (dragShift.shift.caregiverId === cg.id && dragShift.fromDate === toDate) { setDragShift(null); return }
                        setDropTarget({ shift: dragShift.shift, fromDate: dragShift.fromDate, toCaregiverId: cg.id, toDate, toDayIndex: dayIndex })
                        // Narrowest scope by default — moving ONE occurrence must not silently rewrite every week.
                        setDropScope('this')
                        setDragShift(null)
                      }}
                      style={{
                        borderLeft: `1px solid ${C.subtle}`, padding: '5px 4px', minHeight: 72,
                        background: isDragOver ? C.dropBg : bgBase,
                        boxShadow: isDragOver ? `inset 0 0 0 2px ${C.dropRing}` : undefined,
                        cursor: 'pointer', transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { if (!dragShift) e.currentTarget.style.background = isToday ? 'var(--sc-blue-line)' : C.hover }}
                      onMouseLeave={(e) => { if (!dragShift) e.currentTarget.style.background = bgBase }}
                    >
                      {shifts.map((s) => renderShiftBlock(s, dayIndex, shifts))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>}

      {/* Client legend */}
      {clients.length > 0 && (
        <div style={{ padding: '12px 20px', background: C.surface, borderTop: `1px solid ${C.line}`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Clients:</span>
          {clients.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.ink }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: clientColor(c.id, clientMap) }} />
              {c.firstName} {c.lastName}
            </div>
          ))}
        </div>
      )}

      {/* ═══ CREATE SHIFT ═══ */}
      {newShift && (
        <Modal title={`New Shift — ${formatDate(weekDates[newShift.dayIndex], { weekday: 'long', month: 'long', day: 'numeric' })}`} onClose={() => setNewShift(null)}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {([{ key: 'one-time', label: 'One-time' }, { key: 'recurring', label: 'Recurring' }] as const).map((opt) => {
              const on = newShiftForm.scheduleType === opt.key
              return (
                <button key={opt.key} type="button" onClick={() => setNewShiftForm((f) => ({ ...f, scheduleType: opt.key }))} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: '2px solid', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  borderColor: on ? blue.ink : C.line, background: on ? blue.bg : C.surface, color: on ? blue.ink : C.muted,
                }}>{opt.label}</button>
              )
            })}
          </div>

          {newShiftForm.scheduleType === 'recurring' && (
            <div style={{ background: blue.bg, border: `1px solid ${blue.line}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: blue.ink, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recurring Pattern</div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {DAY_NAMES.map((name, idx) => {
                  const on = newShiftForm.selectedDays.includes(idx)
                  return (
                    <button key={idx} type="button" onClick={() => toggleDay(idx)} style={{
                      flex: 1, padding: '6px 0', borderRadius: 6, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: 11,
                      borderColor: on ? FILL.blue : C.line, background: on ? FILL.blue : C.surface, color: on ? '#fff' : C.inkSoft,
                    }}>{name}</button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button type="button" onClick={() => setNewShiftForm((f) => ({ ...f, selectedDays: [1, 2, 3, 4, 5] }))} style={linkBtn(blue.ink)}>Weekdays</button>
                <button type="button" onClick={() => setNewShiftForm((f) => ({ ...f, selectedDays: [0, 1, 2, 3, 4, 5, 6] }))} style={linkBtn(blue.ink)}>Every day</button>
                <button type="button" onClick={() => setNewShiftForm((f) => ({ ...f, selectedDays: [] }))} style={linkBtn(C.inkSoft)}>Clear</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                {([{ key: 'weekly', label: 'Weekly' }, { key: 'biweekly', label: 'Every 2 weeks' }] as const).map((opt) => {
                  const on = newShiftForm.frequency === opt.key
                  return (
                    <button key={opt.key} type="button" onClick={() => setNewShiftForm((f) => ({ ...f, frequency: opt.key }))} style={{
                      padding: '6px 8px', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                      borderColor: on ? blue.ink : C.line, background: on ? C.surface : C.surface, color: on ? blue.ink : C.inkSoft,
                      boxShadow: on ? `inset 0 0 0 1px ${blue.ink}` : undefined,
                    }}>{opt.label}</button>
                  )
                })}
              </div>
              {/* "Ends" is not sent: the create takes no end date (nor did the template's). */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Starts">
                  <input type="date" value={newShiftForm.startDate} onChange={(e) => setNewShiftForm((f) => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Ends (optional)">
                  <input type="date" value={newShiftForm.endDate} onChange={(e) => setNewShiftForm((f) => ({ ...f, endDate: e.target.value }))} style={inputStyle} min={newShiftForm.startDate || undefined} />
                </Field>
              </div>
            </div>
          )}

          <Field label="Client">
            <select value={newShiftForm.clientId} onChange={(e) => setNewShiftForm((f) => ({ ...f, clientId: e.target.value }))} style={inputStyle}>
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </Field>

          <div style={{ marginTop: 12 }}>
            {newShiftForm.isSplit && <div style={{ fontSize: 11, fontWeight: 700, color: blue.ink, marginBottom: 4 }}>SHIFT 1</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Start">
                <input type="time" value={newShiftForm.startTime} onChange={(e) => { const f = { ...newShiftForm, startTime: e.target.value }; setNewShiftForm(f); validateSplitTimes(f) }} style={inputStyle} />
              </Field>
              <Field label="End">
                <input type="time" value={newShiftForm.endTime} onChange={(e) => { const f = { ...newShiftForm, endTime: e.target.value }; setNewShiftForm(f); validateSplitTimes(f) }} style={inputStyle} />
              </Field>
            </div>
          </div>

          <OvernightCheck start={newShiftForm.startTime} end={newShiftForm.endTime} checked={newShiftForm.overnight}
            onChange={(v) => setNewShiftForm((f) => ({ ...f, overnight: v }))} />

          <div style={{ marginTop: 14 }}>
            <Toggle
              on={newShiftForm.isSplit}
              onToggle={() => {
                const next = { ...newShiftForm, isSplit: !newShiftForm.isSplit }
                if (!next.isSplit) { next.split2Start = '16:00'; next.split2End = '20:00' }
                setNewShiftForm(next); validateSplitTimes(next)
              }}
              label="Split Shift"
              subLabel={newShiftForm.isSplit ? 'Two segments, same day' : null}
            />
          </div>

          {newShiftForm.isSplit && (
            <>
              <div style={{ borderTop: `1px dashed ${C.line}`, margin: '14px 0 10px', position: 'relative' }}>
                <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', background: C.surface, padding: '0 8px', fontSize: 10, color: C.muted, fontWeight: 700 }}>BREAK</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: blue.ink, marginBottom: 4 }}>SHIFT 2</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Start">
                  <input type="time" value={newShiftForm.split2Start} onChange={(e) => { const f = { ...newShiftForm, split2Start: e.target.value }; setNewShiftForm(f); validateSplitTimes(f) }} style={inputStyle} />
                </Field>
                <Field label="End">
                  <input type="time" value={newShiftForm.split2End} onChange={(e) => { const f = { ...newShiftForm, split2End: e.target.value }; setNewShiftForm(f); validateSplitTimes(f) }} style={inputStyle} />
                </Field>
              </div>
              {splitError && <div style={{ color: red.ink, fontSize: 12, marginTop: 6, fontWeight: 600 }}>{splitError}</div>}
            </>
          )}

          <Field label="Notes (optional)" style={{ marginTop: 12 }}>
            <input type="text" value={newShiftForm.notes} onChange={(e) => setNewShiftForm((f) => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Any notes..." />
          </Field>

          <TrainingCheck checked={newShiftForm.isTraining} onChange={(v) => setNewShiftForm((f) => ({ ...f, isTraining: v }))}
            hint="Use this for a trainee shadowing another caregiver. The caregiver still gets paid through payroll; the client is not double-billed." />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setNewShift(null)} style={cancelBtn}>Cancel</button>
            <button onClick={handleCreateShift} disabled={saving || (newShiftForm.isSplit && !!splitError)} style={{
              ...primaryBtn, opacity: (saving || (newShiftForm.isSplit && !!splitError)) ? 0.6 : 1,
            }}>
              {saving ? 'Creating...'
                : newShiftForm.scheduleType === 'recurring'
                  ? `Create Recurring (${newShiftForm.selectedDays.length} day${newShiftForm.selectedDays.length !== 1 ? 's' : ''})`
                  : newShiftForm.isSplit ? 'Create Split Shift' : 'Create Shift'}
            </button>
          </div>
        </Modal>
      )}

      {/* ═══ EDIT SHIFT ═══ */}
      {editShift && (() => {
        const durH = shiftHours(editShiftForm.startTime, editShiftForm.endTime).toFixed(2)
        const isRecurring = isRecurringRow(editShift)
        const isSplit = editShift.isSplitShift
        const dateLabel = editDate ? formatDate(editDate, { month: 'short', day: 'numeric' }) : ''
        const dow = Number(editShift.dayOfWeek)

        return (
          <Modal title={isSplit ? `Edit Shift (Split ${editShift.splitSegment}/2)` : 'Edit Shift'} onClose={() => setEditShift(null)}>
            {isSplit && (
              <div style={{ marginBottom: 12, fontSize: 12, color: blue.ink, background: blue.bg, padding: '8px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>&#128279;</span>
                This is segment {editShift.splitSegment} of a split shift.
              </div>
            )}

            {isRecurring && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Apply changes to:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    { key: 'this', icon: '📅', label: `This date only${dateLabel ? ` (${dateLabel})` : ''}` },
                    { key: 'following', icon: '➡️', label: 'This & all following' },
                    { key: 'all', icon: '↻', label: 'All occurrences' },
                  ] as const).map((opt) => <ScopeButton key={opt.key} on={editScope === opt.key} tone={scopeTones[opt.key]} onClick={() => setEditScope(opt.key)}>{opt.icon} {opt.label}</ScopeButton>)}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: C.inkSoft, background: C.subtle, padding: '6px 10px', borderRadius: 6 }}>
                  {{
                    this: 'Only this single occurrence is changed. The recurring pattern stays the same.',
                    following: 'Changes apply from this date forward. Earlier occurrences stay the same.',
                    all: 'Changes apply to every instance of this recurring shift.',
                  }[editScope]}
                </div>
              </div>
            )}

            <Field label="Caregiver">
              <select value={editShiftForm.caregiverId} onChange={(e) => setEditShiftForm((f) => ({ ...f, caregiverId: e.target.value }))} style={inputStyle}>
                <option value="">Select caregiver...</option>
                {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
              </select>
              {editShiftForm.caregiverId && editShiftForm.caregiverId !== editShift.caregiverId && (
                <div style={{ marginTop: 4, fontSize: 11, color: violet.ink, fontWeight: 600 }}>
                  &#8635; Reassigning from {(() => {
                    const cg = caregivers.find((c) => c.id === editShift.caregiverId)
                    return cg ? fullName(cg) : 'original caregiver'
                  })()}
                </div>
              )}
            </Field>
            <Field label="Client" style={{ marginTop: 10 }}>
              <select value={editShiftForm.clientId} onChange={(e) => setEditShiftForm((f) => ({ ...f, clientId: e.target.value }))} style={inputStyle}>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <Field label="Start Time">
                <input type="time" value={editShiftForm.startTime} onChange={(e) => setEditShiftForm((f) => ({ ...f, startTime: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="End Time">
                <input type="time" value={editShiftForm.endTime} onChange={(e) => setEditShiftForm((f) => ({ ...f, endTime: e.target.value }))} style={inputStyle} />
              </Field>
            </div>
            {editShiftForm.startTime && editShiftForm.endTime && (
              <div style={{ textAlign: 'center', fontSize: 12, color: C.inkSoft, margin: '6px 0 2px', background: C.subtle, borderRadius: 6, padding: '4px 0' }}>
                {formatTime(editShiftForm.startTime)} &ndash; {formatTime(editShiftForm.endTime)} &middot; <strong>{durH}h</strong>
              </div>
            )}
            <OvernightCheck start={editShiftForm.startTime} end={editShiftForm.endTime} checked={editShiftForm.overnight}
              onChange={(v) => setEditShiftForm((f) => ({ ...f, overnight: v }))} />
            <Field label="Notes (optional)" style={{ marginTop: 10 }}>
              <input type="text" value={editShiftForm.notes} onChange={(e) => setEditShiftForm((f) => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="Any notes..." />
            </Field>
            <TrainingCheck checked={editShiftForm.isTraining} onChange={(v) => setEditShiftForm((f) => ({ ...f, isTraining: v }))}
              hint="Trainee shadow shift — paid through payroll, excluded from invoices." marginTop={10} />

            {/* Suspend / resume service — pause visits without deleting the schedule */}
            {may.update && isRecurring && (() => {
              const suspendedFrom = editShift.suspendedFrom ? editShift.suspendedFrom.slice(0, 10) : null
              const clientName = (() => { const cl = clientMap[editShift.clientId]; return cl ? fullName(cl) : 'this client' })()
              return (
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: suspendedFrom ? amber.bg : C.subtle, border: '1px solid', borderColor: suspendedFrom ? amber.line : C.line }}>
                  {suspendedFrom ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 13, color: amber.ink, marginBottom: 8 }}>
                        &#9208; Service suspended from {formatDate(suspendedFrom, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={suspendBusy} onClick={() => handleResumeService('this')} style={{ ...cancelBtn, flex: 1, minWidth: 130 }}>
                          &#9654; Resume {DAY_FULL[dow]}s
                        </button>
                        <button type="button" disabled={suspendBusy} onClick={() => handleResumeService('client')} style={{ ...cancelBtn, flex: 1, minWidth: 130 }}>
                          &#9654; Resume all {clientName}&rsquo;s days
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 8 }}>Suspend service</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: C.inkSoft }}>Starting</span>
                        <input type="date" value={suspendFrom} onChange={(e) => setSuspendFrom(e.target.value)}
                          style={{ padding: '5px 8px', borderRadius: 6, border: `1px solid ${C.line}`, fontSize: 13 }} />
                        <span style={{ fontSize: 11, color: C.inkSoft }}>{suspendFrom ? '' : '(today)'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={suspendBusy} onClick={() => handleSuspendService('this')} style={{ ...cancelBtn, flex: 1, minWidth: 130 }}>
                          &#9208; Just {DAY_FULL[dow]}s
                        </button>
                        <button type="button" disabled={suspendBusy} onClick={() => handleSuspendService('client')}
                          style={{ ...cancelBtn, flex: 1, minWidth: 130, color: amber.ink, borderColor: amber.line }}>
                          &#9208; All {clientName}&rsquo;s days
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 6 }}>
                        Pauses visits from that date on. Nothing is deleted &mdash; past visits stay, and you can resume anytime.
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {may.create && may.update && editDate && (
              <button type="button" disabled={saving}
                onClick={() => { setOfferShift({ shift: editShift, date: editDate }); setEditShift(null) }}
                style={{ ...cancelBtn, width: '100%', marginTop: 12, color: amber.ink, borderColor: amber.line, background: amber.bg, fontWeight: 700 }}>
                &#128203; Move to Available Shifts ({dateLabel} only)
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              {(may.delete || mayEvv.create) && <button onClick={() => setDeleteConfirm({ shift: editShift, date: editDate })} disabled={saving} style={{ ...cancelBtn, color: red.ink, borderColor: red.line }}>
                {saving ? '...' : 'Delete'}
              </button>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditShift(null)} style={cancelBtn}>Cancel</button>
                {may.update && <button onClick={handleSaveShift} disabled={saving} style={primaryBtn}>
                  {/* Say exactly what will change, so a scope left on the wrong option is visible before saving. */}
                  {saving ? 'Saving...'
                    : !isRecurring ? 'Save Changes'
                      : editScope === 'this' ? `Save — ${dateLabel || 'this date'} only`
                        : editScope === 'following' ? `Save — ${dateLabel || 'this date'} & every week after`
                          : 'Save — every week (past too)'}
                </button>}
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ═══ MOVE TO AVAILABLE SHIFTS ═══ */}
      {offerShift && (
        <MakeShiftAvailableModal
          schedule={offerShift.shift}
          date={offerShift.date}
          clientName={(() => { const c = clientMap[offerShift.shift.clientId]; return c ? fullName(c) : '' })()}
          caregiverName={(() => { const c = caregivers.find((x) => x.id === offerShift.shift.caregiverId); return c ? fullName(c) : '' })()}
          onClose={() => setOfferShift(null)}
          onDone={({ notified, texted, warning }) => {
            if (warning) toast.error(warning)
            else toast.success(`Posted to Available Shifts — ${notified} caregiver${notified === 1 ? '' : 's'} can accept it${texted ? `, ${texted} texted` : ''}`)
          }}
        />
      )}

      {/* ═══ DROP CONFIRM ═══ */}
      {dropTarget && (() => {
        const { shift, fromDate, toCaregiverId, toDate } = dropTarget
        const isRecurring = isRecurringRow(shift)
        const fromCg = caregivers.find((c) => c.id === shift.caregiverId)
        const toCg = caregivers.find((c) => c.id === toCaregiverId)
        const fromLabel = fromDate ? formatDate(fromDate, { weekday: 'short', month: 'short', day: 'numeric' }) : ''
        const toLabel = formatDate(toDate, { weekday: 'long', month: 'short', day: 'numeric' })
        const client = clientMap[shift.clientId]
        const mayMove = !isRecurring || dropScope === 'all' ? may.update : dropScope === 'this' ? may.update && may.create : may.delete && may.create

        return (
          <Modal title="Move Shift?" onClose={() => setDropTarget(null)}>
            <div style={{ fontSize: 13, color: C.ink, marginBottom: 12, background: C.subtle, padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ fontWeight: 700 }}>{client ? fullName(client) : 'Unknown client'}</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{formatTime(shift.startTime)}&ndash;{formatTime(shift.endTime)}</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 6 }}>
                <strong>{fromCg ? fullName(fromCg) : 'Unknown'}</strong>{fromLabel ? ` · ${fromLabel}` : ''}
                {' '}&rarr;{' '}
                <strong>{toCg ? fullName(toCg) : 'Unknown'}</strong> · {toLabel}
              </div>
            </div>

            {isRecurring && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Apply to:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    { key: 'this', icon: '📅', label: `This date only (${fromLabel})` },
                    { key: 'following', icon: '➡️', label: 'This & all following' },
                    { key: 'all', icon: '↻', label: 'All occurrences' },
                  ] as const).map((opt) => <ScopeButton key={opt.key} on={dropScope === opt.key} tone={scopeTones[opt.key]} onClick={() => setDropScope(opt.key)}>{opt.icon} {opt.label}</ScopeButton>)}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: C.inkSoft, background: C.subtle, padding: '6px 10px', borderRadius: 6 }}>
                  {{
                    this: 'Only this single occurrence moves. The recurring pattern stays the same.',
                    following: 'Moves this occurrence and all future ones. Earlier occurrences stay.',
                    all: 'The entire recurring pattern moves to the new caregiver and day.',
                  }[dropScope]}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDropTarget(null)} disabled={saving} style={cancelBtn}>Cancel</button>
              <button onClick={handleConfirmDrop} disabled={saving || !mayMove} style={primaryBtn}>{saving ? 'Moving...' : 'Move'}</button>
            </div>
          </Modal>
        )
      })()}

      {/* ═══ DELETE SCOPE ═══ */}
      {deleteConfirm && (() => {
        const { shift, date } = deleteConfirm
        const isRecurring = isRecurringRow(shift)
        const isSplit = shift.isSplitShift
        const occDate = date || (shift.date ? String(shift.date).slice(0, 10) : null)
        const dateLabel = occDate ? formatDate(occDate, { weekday: 'short', month: 'short', day: 'numeric' }) : ''

        // Sub-step: the CLIENT is why the visit isn't happening. Records a reason so the billing review lists the day
        // as "not billed" instead of it vanishing.
        if (unavailForm) {
          return (
            <Modal title="Client refused / not available" onClose={() => { setUnavailForm(null); setDeleteConfirm(null) }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: C.ink }}>
                {dateLabel} · {shift.startTime?.slice(0, 5)}–{shift.endTime?.slice(0, 5)}. This one visit is cancelled and
                <strong> will not be billed or paid</strong>. {isRecurring ? 'Every other occurrence continues.' : ''}
              </p>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Reason *</label>
              <select value={unavailForm.reason} onChange={(e) => setUnavailForm({ ...unavailForm, reason: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, marginBottom: 10 }}>
                <option value="">Pick a reason…</option>
                {CLIENT_UNAVAILABLE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Note {unavailForm.reason === 'other' ? '*' : '(optional)'}</label>
              <textarea value={unavailForm.note} onChange={(e) => setUnavailForm({ ...unavailForm, note: e.target.value })} rows={3} maxLength={500}
                placeholder="Who called, what they said, anything billing should know"
                style={{ ...inputStyle, fontSize: 13, marginBottom: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setUnavailForm(null)} style={cancelBtn} disabled={saving}>Back</button>
                <button onClick={handleClientUnavailable} disabled={saving || !unavailForm.reason} style={{ ...primaryBtn, background: '#B91C1C' }}>
                  {saving ? 'Saving...' : 'Mark client unavailable'}
                </button>
              </div>
            </Modal>
          )
        }

        const unavailOption = mayEvv.create && (
          <button onClick={() => setUnavailForm({ reason: '', note: '' })} disabled={saving || !occDate} style={{
            padding: '12px 16px', borderRadius: 8, border: `1px solid ${red.line}`, cursor: 'pointer', background: red.bg, textAlign: 'left', fontSize: 13, color: C.ink,
          }}>
            <div style={{ fontWeight: 700, color: red.ink }}>🚫 Client refused / not available ({dateLabel})</div>
            <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>Cancel this one visit with a reason. It won't be billed or paid, and shows as "not billed" in the invoice review.</div>
          </button>
        )

        if (!isRecurring) {
          return (
            <Modal title="Delete Shift" onClose={() => setDeleteConfirm(null)}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>{unavailOption}</div>
              {may.delete && <p style={{ margin: '0 0 16px', fontSize: 14, color: C.ink }}>
                {isSplit ? 'Or delete both segments of this split shift?' : 'Or delete this shift entirely?'}
              </p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setDeleteConfirm(null)} style={cancelBtn}>Cancel</button>
                {may.delete && <button onClick={() => handleDeleteShift('all')} disabled={saving} style={{ ...primaryBtn, background: FILL.red }}>
                  {saving ? 'Deleting...' : 'Delete'}
                </button>}
              </div>
            </Modal>
          )
        }

        const option: CSSProperties = { padding: '12px 16px', borderRadius: 8, border: `1px solid ${C.line}`, cursor: 'pointer', background: C.surface, textAlign: 'left', fontSize: 13, color: C.ink }
        return (
          <Modal title="Delete Recurring Shift" onClose={() => setDeleteConfirm(null)}>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: C.ink }}>
              This is a recurring shift ({shift.frequency === 'biweekly' ? 'every 2 weeks' : 'weekly'} on {DAY_FULL[Number(shift.dayOfWeek)]}).
              What would you like to delete?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unavailOption}
              {may.delete && <button onClick={() => handleDeleteShift('this')} disabled={saving} style={option}>
                <div style={{ fontWeight: 700 }}>This occurrence only ({dateLabel})</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Cancel just this one date. All other occurrences continue.</div>
              </button>}
              {may.delete && <button onClick={() => handleDeleteShift('following')} disabled={saving} style={option}>
                <div style={{ fontWeight: 700 }}>This & all following</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>End the recurring pattern starting from {dateLabel}. Past occurrences stay.</div>
              </button>}
              {may.delete && <button onClick={() => handleDeleteShift('all')} disabled={saving} style={option}>
                <div style={{ fontWeight: 700 }}>Stop going forward</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>End this schedule as of today. All past (already-worked) occurrences are kept.</div>
              </button>}
              {may.delete && <button
                onClick={async () => {
                  const ok = await confirm('ERASE the ENTIRE schedule, including every PAST occurrence and its worked history?\n\nThis is rarely what you want — use it only for a schedule created by mistake. Past occurrences will disappear from view.',
                    { title: 'Erase entire schedule', confirmText: 'Erase it', danger: true })
                  if (ok) handleDeleteShift('purge')
                }}
                disabled={saving}
                style={{ ...option, border: `1px solid ${red.line}`, background: red.bg }}>
                <div style={{ fontWeight: 700, color: red.ink }}>Erase entire schedule (incl. past history)</div>
                <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>Removes past + future. Only for a schedule created by mistake.</div>
              </button>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setDeleteConfirm(null)} style={cancelBtn}>Cancel</button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={overlay(1000)} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...dialog, maxWidth: 460 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.muted, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  )
}

function ScopeButton({ on, tone, onClick, children }: { on: boolean; tone: ReturnType<typeof tint>; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '8px 12px', borderRadius: 8, border: '2px solid', cursor: 'pointer', fontWeight: 600, fontSize: 13, textAlign: 'left',
      borderColor: on ? tone.ink : C.line, background: on ? tone.bg : C.surface, color: on ? tone.ink : C.muted,
    }}>{children}</button>
  )
}

function Toggle({ on, onToggle, label, subLabel }: { on: boolean; onToggle: () => void; label: string; subLabel: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.ink }}>
        <div onClick={onToggle} role="switch" aria-checked={on} style={{
          width: 36, height: 20, borderRadius: 10, position: 'relative', cursor: 'pointer', background: on ? FILL.blue : C.line, transition: 'background 0.2s',
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
            left: on ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
        {label}
      </label>
      {subLabel && <span style={{ fontSize: 11, color: C.muted }}>{subLabel}</span>}
    </div>
  )
}

// Shown only when the end time is earlier than the start: the office says, by ticking it, that the shift really ends the
// next day. Unticked, the save is refused (lib/shiftTimes.ts).
function OvernightCheck({ start, end, checked, onChange }: { start: string; end: string; checked: boolean; onChange: (v: boolean) => void }) {
  if (!endsBeforeStart(start, end)) return null
  const amber = tint('amber')
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 6, background: amber.bg, border: `1px solid ${amber.line}`, color: amber.ink, fontSize: 12, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span><strong>Overnight shift</strong> &mdash; it ends the next day at {formatTime(end)}. Leave this unticked if the end time is a mistake.</span>
    </label>
  )
}

function TrainingCheck({ checked, onChange, hint, marginTop = 12 }: { checked: boolean; onChange: (v: boolean) => void; hint: string; marginTop?: number }) {
  const amber = tint('amber')
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop, padding: '10px 12px', borderRadius: 8, background: checked ? amber.bg : C.subtle, border: '1px solid', borderColor: checked ? amber.line : C.line, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: checked ? amber.ink : C.ink }}>Training shift (don't bill client)</div>
        <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{hint}</div>
      </div>
    </label>
  )
}

function Field({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  )
}

const linkBtn = (color: string): CSSProperties => ({ fontSize: 11, color, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' })
const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }
const primaryBtn: CSSProperties = { background: FILL.blue, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
const cancelBtn: CSSProperties = { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 7, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }
const navBtn: CSSProperties = { background: C.subtle, border: `1px solid ${C.line}`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 15, color: C.ink, fontWeight: 600 }
