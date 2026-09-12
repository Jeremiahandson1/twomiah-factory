// Week schedule — one page for every CRM: the week's jobs (drag a block to another day to reschedule,
// click to open), the CRM's online bookings, bookings from the connected premium website, and (RV)
// calendar appointments with a New Appointment form.
//
// Dates: a job's scheduledDate is a calendar date stored at UTC midnight — compare on its date portion,
// never through local time (fs / events / salon / RV drew jobs a day early). Bookings and appointments
// hold real instants and are placed in local time.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Calendar, Plus } from 'lucide-react'
import { Button, Modal, Field, inputCls, errMsg } from '../invoicing/ui'
import { resolveScheduleConfig } from './types'
import type { SchedulePageProps, ScheduleJob, ScheduleBooking, ScheduleEvent } from './types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekOf = (d: Date) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); return { start: s, end: e } }
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const jobCls = (status: string) => status === 'completed' ? 'bg-green-50 border-l-2 border-green-500 dark:bg-green-900/20' : status === 'in_progress' ? 'bg-blue-50 border-l-2 border-blue-500 dark:bg-blue-900/20' : status === 'cancelled' ? 'bg-gray-50 border-l-2 border-gray-300 opacity-60 dark:bg-slate-800' : 'bg-gray-50 border-l-2 border-gray-300 dark:bg-slate-800'

export function SchedulePage({ api, toast, config }: SchedulePageProps) {
  const cfg = resolveScheduleConfig(config)
  const navigate = useNavigate()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [jobs, setJobs] = useState<ScheduleJob[]>([])
  const [bookings, setBookings] = useState<ScheduleBooking[]>([])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [dragJob, setDragJob] = useState<ScheduleJob | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [newFor, setNewFor] = useState<Date | null>(null)

  const { start, end } = weekOf(currentDate)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d })

  const load = useCallback(async () => {
    setLoading(true)
    const from = start.toISOString(), to = end.toISOString()
    const [j, b, x, e] = await Promise.all([
      api.get('/api/jobs', { startDate: from, endDate: to, limit: 500 }).then((r: any) => r?.data || []).catch((err: unknown) => { toast.error(errMsg(err, 'Failed to load jobs')); return [] }),
      api.get('/api/booking', { from, to, limit: 500 }).then((r: any) => (r?.data || []).map((row: any): ScheduleBooking => ({ id: row.id, startAt: row.scheduledDate, status: row.status, customerName: row.customerName, serviceName: row.serviceName, customerAddress: row.customerAddress ?? null, source: 'crm' }))).catch(() => []),
      // Bookings taken on the connected premium website — empty when no site is connected.
      cfg.externalBookings ? api.get('/api/bookings/external', { from, to }).then((r: any) => (r?.bookings || []).map((row: any): ScheduleBooking => ({ ...row, source: 'website' }))).catch(() => []) : Promise.resolve([]),
      cfg.events ? api.get('/api/schedule-events', { from, to }).then((r: any) => r?.data || []).catch((err: unknown) => { toast.error(errMsg(err, 'Failed to load appointments')); return [] }) : Promise.resolve([]),
    ])
    setJobs(j); setBookings([...b, ...x]); setEvents(e)
    setLoading(false)
  }, [currentDate]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const jobsFor = (d: Date) => jobs.filter((j) => j.scheduledDate && String(j.scheduledDate).slice(0, 10) === localKey(d))
  const bookingsFor = (d: Date) => bookings.filter((b) => b.startAt && localKey(new Date(b.startAt)) === localKey(d) && b.status !== 'cancelled')
  const eventsFor = (d: Date) => events.filter((e) => e.start && localKey(new Date(e.start)) === localKey(d) && e.status !== 'cancelled')
  const isToday = (d: Date) => localKey(d) === localKey(new Date())
  const shift = (n: number) => { const d = new Date(currentDate); d.setDate(d.getDate() + n); setCurrentDate(d) }

  // Drop a job onto a day → reschedule it. Optimistic, then persist.
  const drop = async (day: Date) => {
    const job = dragJob; setDragJob(null); setDragOverKey(null)
    if (!job) return
    const target = localKey(day)
    if (String(job.scheduledDate || '').slice(0, 10) === target) return
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, scheduledDate: target } : j)))
    try { await api.put(`/api/jobs/${job.id}`, { scheduledDate: target }); toast.success(`Moved to ${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`) }
    catch (err) { toast.error(errMsg(err, 'Could not reschedule')) }
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule</h1>
          {cfg.dragDrop && <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">Drag a {cfg.jobLabel.toLowerCase()} to another day to reschedule it.</p>}
        </div>
        <div className="flex items-center gap-3">
          {cfg.events && <Button onClick={() => setNewFor(new Date())}><Plus className="w-4 h-4 inline mr-1" />New Appointment</Button>}
          <button type="button" onClick={() => shift(-7)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label="Previous week"><ChevronLeft className="w-5 h-5" /></button>
          <span className="font-medium text-gray-900 dark:text-slate-100">{start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <button type="button" onClick={() => shift(7)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label="Next week"><ChevronRight className="w-5 h-5" /></button>
          <button type="button" onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800">Today</button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs text-gray-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-300" />{cfg.jobLabel}</span>
        {bookings.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-300" />Booking</span>}
        {cfg.events && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-300" />Appointment</span>}
      </div>

      {loading ? (
        <div className="flex justify-center py-12" aria-busy="true"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {days.map((day, i) => {
            const key = localKey(day)
            return (
              <div
                key={key}
                data-day={key}
                onDragOver={cfg.dragDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(key) } : undefined}
                onDragLeave={cfg.dragDrop ? () => { if (dragOverKey === key) setDragOverKey(null) } : undefined}
                onDrop={cfg.dragDrop ? (e) => { e.preventDefault(); drop(day) } : undefined}
                className={`bg-white dark:bg-slate-900 rounded-lg shadow-sm overflow-hidden transition ${isToday(day) ? 'ring-2 ring-orange-500' : ''} ${dragOverKey === key ? 'ring-2 ring-blue-400 bg-blue-50/40' : ''}`}
              >
                <div className={`px-3 py-2 text-center border-b dark:border-slate-800 ${isToday(day) ? 'bg-orange-500 text-white' : 'bg-gray-50 dark:bg-slate-800/60 text-gray-900 dark:text-slate-100'}`}>
                  <p className="text-xs font-medium">{WEEKDAYS[i]}</p>
                  <p className="text-lg font-bold">{day.getDate()}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[200px]">
                  {jobsFor(day).map((job) => (
                    <div
                      key={job.id}
                      data-job-id={job.id}
                      draggable={cfg.dragDrop}
                      onDragStart={cfg.dragDrop ? (e) => { setDragJob(job); try { e.dataTransfer.setData('text/plain', job.id) } catch { /* older engines */ } e.dataTransfer.effectAllowed = 'move' } : undefined}
                      onDragEnd={cfg.dragDrop ? () => { setDragJob(null); setDragOverKey(null) } : undefined}
                      onClick={() => navigate(`/crm/jobs/${job.id}`)}
                      title={cfg.dragDrop ? 'Drag to reschedule · click to open' : 'Click to open'}
                      className={`p-2 rounded text-xs text-gray-900 dark:text-slate-100 ${cfg.dragDrop ? 'cursor-move' : 'cursor-pointer'} hover:shadow-sm ${jobCls(job.status)}`}
                    >
                      <p className="font-medium truncate">{job.title}</p>
                      {(job.scheduledTime || job.contact?.name) && <p className="text-gray-500 dark:text-slate-400 truncate">{[job.scheduledTime, job.contact?.name].filter(Boolean).join(' · ')}</p>}
                    </div>
                  ))}
                  {bookingsFor(day).map((b) => (
                    <div key={`${b.source}-${b.id}`} className="p-2 rounded text-xs bg-orange-50 border-l-2 border-orange-500 dark:bg-orange-900/20 text-gray-900 dark:text-slate-100" title={`${b.serviceName || 'Booking'} — ${b.customerName}${b.customerAddress ? ' @ ' + b.customerAddress : ''}`}>
                      <p className="font-medium truncate flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" />{b.customerName}</p>
                      <p className="text-gray-500 truncate dark:text-slate-400">{timeOf(b.startAt)}{b.serviceName ? ' · ' + b.serviceName : ''}</p>
                    </div>
                  ))}
                  {eventsFor(day).map((e) => (
                    <div key={e.id} className="p-2 rounded text-xs bg-indigo-50 border-l-2 border-indigo-500 dark:bg-indigo-900/20 text-gray-900 dark:text-slate-100" title={e.notes || e.title}>
                      <p className="font-medium truncate">{e.title}</p>
                      <p className="text-gray-500 truncate dark:text-slate-400">{e.allDay ? 'All day' : timeOf(e.start)}{e.type ? ' · ' + e.type.replace(/_/g, ' ') : ''}</p>
                    </div>
                  ))}
                  {cfg.events ? (
                    <button type="button" onClick={() => setNewFor(day)} className="w-full text-xs text-gray-400 hover:text-orange-500 py-1">+ Add</button>
                  ) : (
                    cfg.dragDrop && jobsFor(day).length === 0 && bookingsFor(day).length === 0 && <p className="text-[11px] text-gray-300 dark:text-slate-600 text-center pt-4 select-none">Drop a {cfg.jobLabel.toLowerCase()} here</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {cfg.events && newFor && <NewAppointment api={api} toast={toast} date={newFor} types={cfg.eventTypes} onClose={() => setNewFor(null)} onSaved={() => { setNewFor(null); load() }} />}
    </div>
  )
}

function NewAppointment({ api, toast, date, types, onClose, onSaved }: { api: SchedulePageProps['api']; toast: SchedulePageProps['toast']; date: Date; types: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: '', type: types[0]?.value || 'appointment', date: localKey(date), startTime: '09:00', endTime: '10:00', notes: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!form.title.trim()) { toast.error('A title is required'); return }
    const start = new Date(`${form.date}T${form.startTime}:00`), end = new Date(`${form.date}T${form.endTime}:00`)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) { toast.error('Enter a valid date and time'); return }
    if (end < start) { toast.error('End time cannot be before start time'); return }
    setSaving(true)
    try {
      await api.post('/api/schedule-events', { title: form.title.trim(), type: form.type, start: start.toISOString(), end: end.toISOString(), notes: form.notes || undefined })
      toast.success('Appointment created'); onSaved()
    } catch (err) { toast.error(errMsg(err, 'Failed to create appointment')) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="New Appointment" size="md">
      <div className="space-y-4">
        <Field label="Title *"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Test drive — John Smith" className={inputCls} /></Field>
        <Field label="Type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} /></Field>
          <Field label="Start"><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputCls} /></Field>
          <Field label="End"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default SchedulePage
