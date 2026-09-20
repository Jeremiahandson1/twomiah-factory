// Time tracking — ONE page for every CRM that offers time_tracking (vendored into each template as ../shared). Talks to
// the shared /api/time routes: log hours (or a start/end span), clock in / out (the registry sells "Clock in/out" — the
// backend had it, no routed page ever exposed it), managers approve. Before: two copies of a hours-only table, plus an
// unrouted TimesheetPage/TimeClock pair that called endpoints under a different mount.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Check, Play, Square, Clock } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg, dateOnly } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import type { PeopleApi, PeopleToast, TimeConfig } from './types'
import { isManagerRole } from './types'

interface Entry { id: string; date: string; hours: string | number; description?: string | null; billable: boolean; approved?: boolean; clockIn?: string | null; clockOut?: string | null; userId: string; projectId?: string | null; jobId?: string | null; user?: { firstName: string; lastName: string } | null; project?: { name: string } | null; job?: { title: string; number?: string } | null }
// The person's own date, not UTC's: toISOString() rolls over at UTC midnight, so west of Greenwich this pre-filled
// TOMORROW all evening, and it is also the ceiling the date box is given. (Contractor T29 L1)
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0] }
const fmtElapsed = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

export function TimePage({ api, toast, config }: { api: PeopleApi; toast: PeopleToast; config?: TimeConfig }) {
  const auth = useAuth()
  const jobLabel = config?.jobLabel || 'Job'
  const showJobs = auth.hasFeature(config?.jobsFeature || 'jobs')
  const showProjects = auth.hasFeature(config?.projectsFeature || 'projects')
  const manager = isManagerRole(auth.user?.role)
  const empty = () => ({ date: today(), mode: 'hours' as 'hours' | 'span', hours: '', startTime: '09:00', endTime: '17:00', breakMinutes: '0', description: '', billable: true, projectId: '', jobId: '' })
  const [data, setData] = useState<Entry[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; number?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [active, setActive] = useState<Entry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [clockBusy, setClockBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [form, setForm] = useState(empty())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, act, projRes, jobRes] = await Promise.all([
        api.get('/api/time', { page, limit: 25 }),
        api.get('/api/time/active').catch(() => null),
        showProjects ? api.get('/api/projects', { limit: 100 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        showJobs ? api.get('/api/jobs', { limit: 100 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ])
      setData(res?.data || []); setPagination(res?.pagination || null); setActive(act && act.id ? act : null); setProjects(projRes?.data || []); setJobs(jobRes?.data || [])
    } catch (e) { toast.error(errMsg(e, 'Failed to load time entries')) }
    finally { setLoading(false) }
  }, [api, page, showJobs, showProjects])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [active])

  const clockIn = async () => { setClockBusy(true); try { await api.post('/api/time/clock-in', {}); toast.success('Clocked in'); await load() } catch (e) { toast.error(errMsg(e, 'Failed to clock in')) } finally { setClockBusy(false) } }
  const clockOut = async () => { setClockBusy(true); try { const r = await api.post('/api/time/clock-out', {}); toast.success(r?.discarded ? (r.message || 'That clock-in was too short to record') : `Clocked out — ${Number(r?.hours || 0).toFixed(2)} h`); await load() } catch (e) { toast.error(errMsg(e, 'Failed to clock out')) } finally { setClockBusy(false) } }

  const handleSave = async () => {
    setFormError('')
    const payload: any = { date: form.date, description: form.description.trim() || null, billable: form.billable, projectId: form.projectId || null, jobId: form.jobId || null }
    if (form.mode === 'hours') {
      const h = Number(form.hours)
      if (!form.hours || !(h > 0)) { setFormError('Hours must be greater than 0'); return }
      if (h > 24) { setFormError('Hours cannot exceed 24 for one entry'); return }
      payload.hours = h
    } else {
      if (!form.startTime || !form.endTime) { setFormError('Enter a start and end time'); return }
      payload.startTime = form.startTime; payload.endTime = form.endTime; payload.breakMinutes = Number(form.breakMinutes) || 0
    }
    setSaving(true)
    try {
      if (editing) { await api.put(`/api/time/${editing.id}`, payload); toast.success('Time entry updated') }
      else { await api.post('/api/time', payload); toast.success('Time logged') }
      setModalOpen(false); load()
    } catch (e) { setFormError(errMsg(e, 'Failed to save time entry')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => {
    if (!toDelete) return
    try { await api.delete('/api/time', toDelete.id); toast.success('Time entry deleted'); setToDelete(null); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to delete time entry')) }
  }
  const approve = async (row: Entry) => { try { await api.post(`/api/time/${row.id}/approve`); toast.success('Approved'); load() } catch (e) { toast.error(errMsg(e, 'Failed to approve')) } }
  const openCreate = () => { setEditing(null); setForm(empty()); setFormError(''); setModalOpen(true) }
  const openEdit = (item: Entry) => { setEditing(item); setForm({ ...empty(), date: String(item.date || '').slice(0, 10) || today(), hours: String(item.hours ?? ''), description: item.description || '', billable: !!item.billable, projectId: item.projectId || '', jobId: item.jobId || '' }); setFormError(''); setModalOpen(true) }
  const canEdit = (row: Entry) => manager || (row.userId === auth.user?.id && !row.approved)

  const columns = [
    { key: 'date', label: 'Date', render: (v: any) => dateOnly(v) || '-' },
    { key: 'user', label: 'User', render: (v: any) => (v ? `${v.firstName || ''} ${v.lastName || ''}`.trim() || '-' : '-') },
    ...(showJobs ? [{ key: 'job', label: jobLabel, render: (v: any) => v?.title || '-' }] : []),
    ...(showProjects ? [{ key: 'project', label: 'Project', render: (v: any) => v?.name || '-' }] : []),
    { key: 'hours', label: 'Hours', render: (v: any, row: Entry) => (row.clockIn && !row.clockOut ? <span className="text-orange-600">running</span> : Number(v || 0).toFixed(2)) },
    { key: 'description', label: 'Description', render: (v: any) => v || '-' },
    { key: 'billable', label: 'Billable', render: (v: any) => (v ? <span className="text-green-600">Yes</span> : <span className="text-gray-500 dark:text-slate-400">No</span>) },
    { key: 'approved', label: 'Approved', render: (v: any) => (v ? <span className="text-green-600 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Yes</span> : <span className="text-gray-500 dark:text-slate-400">No</span>) },
  ]
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div data-testid="time-page-shared">
      <PageHeader title="Time Tracking" subtitle={config?.subtitle || 'Clock in and out, or log hours by hand'} action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Log Time</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Clock className="w-5 h-5 text-orange-500" />
        {active ? (
          <>
            <span className="text-sm text-gray-700 dark:text-slate-200">Clocked in since {new Date(active.clockIn as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{active.job?.title ? ` · ${active.job.title}` : active.project?.name ? ` · ${active.project.name}` : ''}</span>
            <span className="font-mono text-lg font-semibold text-gray-900 dark:text-slate-100">{fmtElapsed(now - new Date(active.clockIn as string).getTime())}</span>
            <Button variant="danger" onClick={clockOut} disabled={clockBusy}><Square className="w-4 h-4 mr-2 inline" />Clock Out</Button>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-700 dark:text-slate-200">Not clocked in</span>
            <Button onClick={clockIn} disabled={clockBusy}><Play className="w-4 h-4 mr-2 inline" />Clock In</Button>
          </>
        )}
      </div>
      <DataTable<Entry> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No time entries yet."
        actions={[
          { label: 'Edit', icon: Edit, onClick: openEdit, show: canEdit },
          { label: 'Approve', icon: Check, onClick: approve, show: (r) => manager && !r.approved && !(r.clockIn && !r.clockOut) },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: canEdit },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Time Entry' : 'Log Time'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
          <div className="grid grid-cols-2 gap-4">
            {/* Hours are worked before they are logged, so the picker stops at today — a mistyped year used to be
                accepted and then vanish from every dated report instead of reading wrong. (T29 L1) */}
            <Field label="Date"><input type="date" max={today()} value={form.date} onChange={set('date')} className={inputCls} /></Field>
            <Field label="Enter as"><select value={form.mode} onChange={set('mode')} className={inputCls}><option value="hours">Hours</option><option value="span">Start / end time</option></select></Field>
          </div>
          {form.mode === 'hours' ? (
            <Field label="Hours *"><input type="number" step="0.25" min="0.25" max="24" value={form.hours} onChange={set('hours')} className={inputCls} /></Field>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <Field label="Start"><input type="time" value={form.startTime} onChange={set('startTime')} className={inputCls} /></Field>
              <Field label="End"><input type="time" value={form.endTime} onChange={set('endTime')} className={inputCls} /></Field>
              <Field label="Break (min)"><input type="number" min="0" value={form.breakMinutes} onChange={set('breakMinutes')} className={inputCls} /></Field>
            </div>
          )}
          {showJobs && <Field label={jobLabel}><select value={form.jobId} onChange={set('jobId')} className={inputCls}><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number ? `${j.number} - ` : ''}{j.title}</option>)}</select></Field>}
          {showProjects && <Field label="Project"><select value={form.projectId} onChange={set('projectId')} className={inputCls}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          <Field label="Description"><textarea value={form.description} onChange={set('description')} rows={2} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} className="rounded" /> Billable</label>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} title="Delete Entry" message="Delete this time entry?" confirmText="Delete" />
    </div>
  )
}
