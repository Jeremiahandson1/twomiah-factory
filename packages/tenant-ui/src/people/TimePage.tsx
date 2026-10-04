// Time tracking — ONE page for every CRM that offers time_tracking (vendored into each template as ../shared). Talks to
// the shared /api/time routes: log hours (or a start/end span), clock in / out (the registry sells "Clock in/out" — the
// backend had it, no routed page ever exposed it), managers approve. Before: two copies of a hours-only table, plus an
// unrouted TimesheetPage/TimeClock pair that called endpoints under a different mount.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Check, Play, Square, Clock } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg, dateOnly, money } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import type { PeopleApi, PeopleToast, TimeConfig } from './types'
import { isManagerRole } from './types'
import { useMayWrite } from '../auth/PermissionsContext'

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
  /**
   * WHO MAY PUT TIME ON THE CLOCK. (T42 — "Log Time and Clock In shown to viewer; all 403")
   *
   * Read off the routes these buttons call, not from a rank: POST /api/time, /clock-in and
   * /clock-out all ask `time:create`; PUT /:id and /:id/approve ask `time:update`. The field rung
   * holds both — logging and correcting your own hours is the whole point of the screen — and
   * `viewer` holds `time:read` only, which is the seat that was being shown three buttons that
   * could only 403.
   */
  const mayLog = useMayWrite('time:create')
  const mayCorrect = useMayWrite('time:update')
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
  /**
   * The pay run, for the panel below the sheet. (Salon RR9)
   *
   * Not loaded until asked: a pay period is a question with two dates in it, and guessing which
   * fortnight somebody means is worse than an empty panel with a Show button. Defaults to the last
   * two weeks up to today, which is the commonest answer.
   */
  const dayString = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]
  const [payFrom, setPayFrom] = useState(dayString(new Date(Date.now() - 13 * 86400000)))
  const [payTo, setPayTo] = useState(dayString(new Date()))
  const [payRun, setPayRun] = useState<any>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')
  const loadPayRun = async () => {
    setPayLoading(true); setPayError('')
    try {
      const res: any = await api.get('/api/payroll/summary', { startDate: payFrom, endDate: payTo })
      setPayRun(res && Array.isArray(res.users) ? res : { users: [] })
    } catch (e) { setPayError(errMsg(e, 'Could not work out the pay run')); setPayRun(null) }
    finally { setPayLoading(false) }
  }
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
  // The top of the tree may approve their own time — the server's carve-out, mirrored here. (RR6 N2)
  const ownApprovalOk = ['owner', 'admin'].includes(String(auth.user?.role || ''))
  const canEdit = (row: Entry) => mayCorrect && (manager || (row.userId === auth.user?.id && !row.approved))

  const columns = [
    { key: 'date', label: 'Date', render: (v: any) => dateOnly(v) || '-' },
    { key: 'user', label: 'User', render: (v: any) => (v ? `${v.firstName || ''} ${v.lastName || ''}`.trim() || '-' : '-') },
    ...(showJobs ? [{ key: 'job', label: jobLabel, render: (v: any) => v?.title || '-' }] : []),
    ...(showProjects ? [{ key: 'project', label: 'Project', render: (v: any) => v?.name || '-' }] : []),
    { key: 'hours', label: 'Hours', render: (v: any, row: Entry) => (row.clockIn && !row.clockOut ? <span className="text-amber-700 dark:text-amber-300">running</span> : Number(v || 0).toFixed(2)) },
    { key: 'description', label: 'Description', render: (v: any) => v || '-' },
    { key: 'billable', label: 'Billable', render: (v: any) => (v ? <span className="text-green-700 dark:text-green-400">Yes</span> : <span className="text-gray-500 dark:text-slate-400">No</span>) },
    { key: 'approved', label: 'Approved', render: (v: any) => (v ? <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Yes</span> : <span className="text-gray-500 dark:text-slate-400">No</span>) },
  ]
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div data-testid="time-page-shared">
      <PageHeader title="Time Tracking" subtitle={config?.subtitle || 'Clock in and out, or log hours by hand'} action={mayLog ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Log Time</Button> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Clock className="w-5 h-5 text-orange-500 dark:text-orange-300" />
        {active ? (
          <>
            <span className="text-sm text-gray-700 dark:text-slate-200">Clocked in since {new Date(active.clockIn as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{active.job?.title ? ` · ${active.job.title}` : active.project?.name ? ` · ${active.project.name}` : ''}</span>
            <span className="font-mono text-lg font-semibold text-gray-900 dark:text-slate-100">{fmtElapsed(now - new Date(active.clockIn as string).getTime())}</span>
            {mayLog && <Button variant="danger" onClick={clockOut} disabled={clockBusy}><Square className="w-4 h-4 mr-2 inline" />Clock Out</Button>}
          </>
        ) : (
          <>
            <span className="text-sm text-gray-700 dark:text-slate-200">Not clocked in</span>
            {mayLog && <Button onClick={clockIn} disabled={clockBusy}><Play className="w-4 h-4 mr-2 inline" />Clock In</Button>}
          </>
        )}
      </div>
      <DataTable<Entry> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No time entries yet."
        actions={[
          { label: 'Edit', icon: Edit, onClick: openEdit, show: canEdit },
          // Not on your OWN entry, unless you are the owner or admin — the server refuses that
          // ("approval is a second person checking the hours") and an action that can only ever
          // 403 is an item that never works. Owner and admin keep it: they have nobody above them
          // to ask, which is the same carve-out the server makes. (Salon RR6 N2)
          { label: 'Approve', icon: Check, onClick: approve, show: (r) => mayCorrect && manager && !r.approved && !(r.clockIn && !r.clockOut) && (ownApprovalOk || r.userId !== auth.user?.id) },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: canEdit },
        ]} />
      {/**
        * The pay run. (Salon RR9)
        *
        * /api/payroll/summary has existed in all five of these CRMs for a long time with NO SCREEN
        * anywhere — the guard's own note says the Time page was built so time entries could be
        * WRITTEN, and the report of them was never rendered. A shop could log hours and not see what
        * it owed anybody.
        *
        * It has to exist now regardless, because a deduction recovered from someone's pay has to be
        * visible on the pay run or the money gets recovered twice. `Earned` is hours × rate and is
        * never quietly adjusted; `Recovered` and `To pay` sit beside it.
        */}
      {manager && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Pay run</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">Approved and unapproved hours in the period, and anything being recovered from pay.</p>
            </div>
            {/* Two date pickers and a button: 421px of controls in a 324px column, measured at
                390px, and the page scrolled sideways by 64px. (T41 "Time date row 442px") */}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="From"><input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className={inputCls} /></Field>
              <Field label="To"><input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} className={inputCls} /></Field>
              <Button variant="secondary" onClick={loadPayRun} disabled={payLoading}>{payLoading ? 'Working…' : 'Show'}</Button>
            </div>
          </div>
          {payError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{payError}</p>}
          {payRun && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60">
                  <tr>
                    {['Person', 'Hours', 'Earned', 'Recovered', 'To pay', 'Still owed'].map((h, i) => (
                      <th key={h} className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-300 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {(payRun.users || []).map((u: any) => (
                    <tr key={u.user?.id || u.user?.name}>
                      <td className="px-3 py-2 text-gray-900 dark:text-slate-100">{u.user?.name || 'Unnamed'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-slate-200">{Number(u.totalHours || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-slate-200">{money(u.totalPay)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(u.deductions || 0) > 0 ? (
                          <span className="inline-flex flex-col leading-tight">
                            <span className="text-amber-700 dark:text-amber-300">−{money(u.deductions)}</span>
                            {/* What could not be taken out of this run — it stays on their balance, and
                                the shop has to get it another way. Saying nothing here is how "to pay"
                                used to go negative. */}
                            {Number(u.unrecovered || 0) > 0 && (
                              <span className="text-xs text-amber-700 dark:text-amber-300">{money(u.unrecovered)} could not come off this run</span>
                            )}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900 dark:text-slate-100">{money(u.netPay ?? u.totalPay)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(u.stillOwed || 0) > 0 ? <span className="text-amber-700 dark:text-amber-300">{money(u.stillOwed)}</span> : '-'}</td>
                    </tr>
                  ))}
                  {(payRun.users || []).length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 dark:text-slate-400">No hours logged in that period.</td></tr>
                  )}
                </tbody>
                {payRun.totals && (payRun.users || []).length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 dark:border-slate-700">
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">Total</td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-slate-200">{money(payRun.totals.pay)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(payRun.totals.deductions || 0) > 0 ? <span className="text-amber-700 dark:text-amber-300">−{money(payRun.totals.deductions)}</span> : '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-slate-100">{money(payRun.totals.net)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
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
