// Online Booking — what customers can book, what they have booked, the settings and the embed code.
// One page for every CRM; the template passes its api client, toast and a small config.
import React, { useCallback, useEffect, useState } from 'react'
import { Calendar, Check, CheckCircle2, Clock, Copy, DollarSign, Plus, UserX, XCircle } from 'lucide-react'
import { Button, ConfirmModal, DataTable, Field, Modal, NavLink, PageHeader, StatusBadge, errMsg, inputCls, money } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { BookingSettingsTab } from './BookingSettingsTab'
import type { BookableServiceRow, BookingPageProps, BookingRow, BookingSettings } from './types'
import { resolveBookingConfig } from './types'

type Tab = 'bookings' | 'services' | 'settings' | 'embed'
const STATUS_FILTERS: Array<[string, string]> = [['', 'All statuses'], ['pending', 'Pending (deposit unpaid)'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']]
const DEPOSIT_CLS: Record<string, string> = { pending: 'text-amber-600 dark:text-amber-300', paid: 'text-green-600 dark:text-green-300', failed: 'text-red-600 dark:text-red-300', refunded: 'text-gray-500', expired: 'text-gray-500' }

const whenIn = (iso: string, tz?: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  try { return new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) } catch { return d.toLocaleString() }
}

export function BookingsPage({ api, toast, config }: BookingPageProps) {
  const cfg = resolveBookingConfig(config)
  const [tab, setTab] = useState<Tab>('bookings')
  const [rows, setRows] = useState<BookingRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState<BookableServiceRow[]>([])
  const [retired, setRetired] = useState(false)
  const [editing, setEditing] = useState<BookableServiceRow | null>(null)
  const [deleteSvc, setDeleteSvc] = useState<BookableServiceRow | null>(null)
  const [cancelRow, setCancelRow] = useState<BookingRow | null>(null)
  const [embed, setEmbed] = useState('')
  const [copied, setCopied] = useState(false)
  const [tz, setTz] = useState<string | undefined>(undefined)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/api/booking', { page, limit: 25, ...(statusFilter ? { status: statusFilter } : {}) })
      setRows(Array.isArray(r) ? r : r?.data || []); setPagination(r?.pagination || null)
    } catch (e) { toast.error(errMsg(e, 'Could not load bookings')) } finally { setLoading(false) }
  }, [api, page, statusFilter])
  const loadServices = useCallback(async () => {
    try { const r = await api.get('/api/booking/services'); setServices(Array.isArray(r) ? r : r?.data || []); setRetired(!Array.isArray(r) && !!r?.retired) }
    catch (e) { toast.error(errMsg(e, 'Could not load services')) }
  }, [api])

  useEffect(() => { loadBookings() }, [loadBookings])
  useEffect(() => { loadServices() }, [loadServices])
  useEffect(() => { api.get('/api/booking/settings').then((s: any) => setTz(s?.timezone)).catch(() => {}) }, [api])
  useEffect(() => {
    if (tab !== 'embed' || embed) return
    api.get('/api/booking/embed-code').then((r: any) => setEmbed(r?.embedCode || '')).catch(e => toast.error(errMsg(e, 'Could not load the embed code')))
  }, [tab, embed, api])

  const setStatus = async (row: BookingRow, status: string, done: string) => {
    try { await api.put(`/api/booking/${row.id}`, { status }); toast.success(done); loadBookings() }
    catch (e) { toast.error(errMsg(e, 'Could not update the booking')) }
  }
  const cancel = async () => {
    if (!cancelRow) return
    try { await api.delete(`/api/booking/${cancelRow.id}`); toast.success('Booking cancelled — the slot is open again'); setCancelRow(null); loadBookings() }
    catch (e) { toast.error(errMsg(e, 'Could not cancel the booking')) }
  }
  const saveService = async (form: BookableServiceRow) => {
    const payload = { name: form.name, description: form.description || '', durationMinutes: Number(form.durationMinutes || 60), price: Number(form.price || 0), depositRequired: !!form.depositRequired, depositAmount: Number(form.depositAmount || 0), active: form.active !== false }
    try {
      if (form.id) await api.put(`/api/booking/services/${form.id}`, payload); else await api.post('/api/booking/services', payload)
      toast.success('Service saved'); setEditing(null); loadServices()
    } catch (e) { toast.error(errMsg(e, 'Could not save service')) }
  }
  const removeService = async () => {
    if (!deleteSvc?.id) return
    try { await api.delete(`/api/booking/services/${deleteSvc.id}`); toast.success('Service removed'); setDeleteSvc(null); loadServices() }
    catch (e) { toast.error(errMsg(e, 'Could not delete service')) }
  }

  const calendarCell = (row: BookingRow) => {
    const cal = row.calendar
    if (!cal?.id) return <span className="text-gray-400">-</span>
    const label = cal.label || cfg.calendarLabel
    const path = cfg.calendarPath(cal.id)
    return (
      <span className="inline-flex items-center gap-2">
        {path ? <NavLink to={path} className="text-orange-600 hover:underline dark:text-orange-300">{label}</NavLink> : <span>{label}</span>}
        {cal.status && cal.status !== row.status && <span className="text-xs text-gray-400">({cal.status.replace(/_/g, ' ')})</span>}
      </span>
    )
  }

  const columns = [
    { key: 'customerName', label: 'Customer', render: (_: any, r: BookingRow) => <div><div className="font-medium">{r.customerName || '-'}</div><div className="text-xs text-gray-500 dark:text-slate-400">{r.customerEmail}{r.customerPhone ? ` · ${r.customerPhone}` : ''}</div></div> },
    { key: 'serviceName', label: 'Service', render: (v: any) => v || <span className="text-gray-400">No service</span> },
    { key: 'scheduledDate', label: 'When', render: (v: any) => whenIn(v, tz) },
    { key: 'status', label: 'Status', render: (v: any) => <StatusBadge status={v || 'pending'} /> },
    { key: 'depositStatus', label: 'Deposit', render: (v: any, r: BookingRow) => (v && v !== 'none' ? <span className={`text-xs ${DEPOSIT_CLS[v] || ''}`}>{money(r.depositAmount)} {v}</span> : <span className="text-gray-400">-</span>) },
    { key: 'calendar', label: cfg.calendarLabel, render: (_: any, r: BookingRow) => calendarCell(r) },
    { key: 'confirmationCode', label: 'Code', className: 'font-mono text-xs', render: (v: any) => v || '-' },
  ]

  return (
    <div>
      <PageHeader title="Online Booking" action={tab === 'services' && !retired ? <Button onClick={() => setEditing({ name: '', durationMinutes: 60, price: 0, depositRequired: false, depositAmount: 0, active: true })}><Plus className="w-4 h-4" /> New Service</Button> : undefined} />
      <p className="-mt-4 mb-6 text-gray-500 dark:text-slate-400">What customers can book, and what they have booked.</p>

      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800 mb-6">
        {([['bookings', 'Bookings'], ['services', 'Bookable Services'], ['settings', 'Settings'], ['embed', 'Embed Code']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-orange-500 text-orange-600 dark:text-orange-300' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>

      {tab === 'bookings' && (
        <>
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className={`${inputCls} w-auto`}>
              {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {tz && <span className="text-xs text-gray-500 dark:text-slate-400">Times shown in {tz.replace(/_/g, ' ')}</span>}
          </div>
          {!loading && rows.length === 0 && !statusFilter ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No online bookings yet.</p>
              <p className="text-sm text-gray-400 mt-1">Add a bookable service, then put the embed code on your website.</p>
            </div>
          ) : (
            <DataTable<BookingRow> data={rows} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No bookings match this filter." actions={[
              { label: 'Confirm', icon: CheckCircle2, onClick: r => setStatus(r, 'confirmed', 'Booking confirmed'), show: r => r.status === 'pending' },
              { label: 'Mark completed', icon: Check, onClick: r => setStatus(r, 'completed', 'Marked completed'), show: r => r.status === 'confirmed' },
              { label: 'No-show', icon: UserX, onClick: r => setStatus(r, 'no_show', 'Marked as a no-show'), show: r => r.status === 'confirmed' || r.status === 'pending' },
              { label: 'Cancel booking', icon: XCircle, className: 'text-red-600 dark:text-red-300', onClick: r => setCancelRow(r), show: r => r.status === 'pending' || r.status === 'confirmed' },
            ]} />
          )}
        </>
      )}

      {tab === 'services' && (
        <div className="space-y-3">
          {retired && cfg.serviceMenuPath && (
            <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-900 dark:bg-sky-900/30 dark:border-sky-800 dark:text-sky-100">
              Services offered online now come from the <NavLink to={cfg.serviceMenuPath} className="underline">Service Menu</NavLink> — tick <strong>Bookable online</strong> on a service there. The list below is retired and no longer offered to customers; delete it when convenient.
            </div>
          )}
          {!retired && cfg.serviceMenuPath && (
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300">
              Tip: tick <strong>Bookable online</strong> on a <NavLink to={cfg.serviceMenuPath} className="underline">Service Menu</NavLink> item to offer your real menu online (duration, price and rebooking rules included). Once one is flagged, this list is retired.
            </div>
          )}
          {services.length === 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center text-gray-500 dark:text-slate-400">No bookable services yet. Add one so customers have something to book.</div>
          )}
          {services.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-gray-900 dark:text-slate-100">{s.name}</div>
                {s.description && <div className="text-sm text-gray-500 dark:text-slate-400">{s.description}</div>}
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{s.durationMinutes} min</span>
                  <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{money(s.price)}</span>
                  <span className={s.depositRequired ? 'text-orange-600 dark:text-orange-300' : ''}>{s.depositRequired ? `Deposit ${money(s.depositAmount)}` : 'No deposit'}</span>
                  {s.active === false && <span className="text-red-500">Not bookable</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="secondary" onClick={() => setEditing(s)}>Edit</Button>
                <Button variant="danger" onClick={() => setDeleteSvc(s)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && <BookingSettingsTab api={api} toast={toast} config={config} onSaved={(s: BookingSettings) => setTz(s.timezone)} />}

      {tab === 'embed' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">Put booking on your website</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Paste this where you want the booking form to appear. If a service requires a deposit, the customer pays it before the slot is confirmed.</p>
          <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">{embed || 'Loading…'}</pre>
          <Button variant="secondary" className="mt-3" disabled={!embed} onClick={() => { navigator.clipboard?.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy embed code'}
          </Button>
        </div>
      )}

      {editing && <ServiceModal service={editing} onClose={() => setEditing(null)} onSave={saveService} />}
      <ConfirmModal isOpen={!!deleteSvc} onClose={() => setDeleteSvc(null)} onConfirm={removeService} title="Delete service" message={`Delete "${deleteSvc?.name}"? Customers can no longer book it. Existing bookings are kept.`} confirmText="Delete" />
      <ConfirmModal isOpen={!!cancelRow} onClose={() => setCancelRow(null)} onConfirm={cancel} title="Cancel booking" message={`Cancel ${cancelRow?.customerName || 'this booking'}'s booking${cancelRow ? ` on ${whenIn(cancelRow.scheduledDate, tz)}` : ''}? The ${cfg.calendarLabel.toLowerCase()} is cancelled too and the slot opens up again.`} confirmText="Cancel booking" />
    </div>
  )
}

function ServiceModal({ service, onClose, onSave }: { service: BookableServiceRow; onClose: () => void; onSave: (s: BookableServiceRow) => Promise<void> }) {
  const [form, setForm] = useState<BookableServiceRow>({ ...service })
  const [saving, setSaving] = useState(false)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await onSave(form) } finally { setSaving(false) } }
  const check = 'w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-orange-600 focus:ring-orange-500'
  return (
    <Modal isOpen onClose={onClose} title={form.id ? 'Edit service' : 'New bookable service'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input value={form.name} required onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
        <Field label="Description"><input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (minutes)"><input type="number" min={5} max={480} step={5} value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Price"><input type="number" min={0} step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.depositRequired} onChange={e => setForm({ ...form, depositRequired: e.target.checked })} className={check} /><span className="text-sm font-medium text-gray-700 dark:text-slate-200">Require a deposit to hold the slot</span></label>
          {form.depositRequired && (
            <div className="mt-3">
              <Field label="Deposit amount" hint="The booking stays pending until this is paid. Requires card payments to be set up.">
                <input type="number" min={0} step="0.01" value={form.depositAmount} onChange={e => setForm({ ...form, depositAmount: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} className={check} /><span className="text-sm text-gray-700 dark:text-slate-200">Bookable now</span></label>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}
