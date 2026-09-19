// Team roster — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/team routes.
// Before: three copies (typed / untyped / salon label). Login accounts shown as the fallback roster (`_source: 'user'`)
// used to get Edit/Delete actions that hit the team_member table and 404'd — they are read-only here with a pointer to
// Settings → Users.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Users } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { ROLE_LABELS } from '../shell/types'
import type { PeopleApi, PeopleToast, TeamConfig } from './types'

interface Member { id: string; name: string; email?: string | null; phone?: string | null; role?: string | null; department?: string | null; hourlyRate?: string | number | null; active: boolean; assignedJobs?: number; hasLogin?: boolean; _source?: 'user' }
const EMPTY = { name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' }

export function TeamPage({ api, toast, config }: { api: PeopleApi; toast: PeopleToast; config?: TeamConfig }) {
  const roleLabel = config?.roleLabel || 'Job Title / Trade'
  const rolePlaceholder = config?.rolePlaceholder || 'e.g. Lead Technician'
  const [data, setData] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Member | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await api.get('/api/team', { page, limit: 25 }); setData(res?.data || []); setPagination(res?.pagination || null) }
    catch (e) { toast.error(errMsg(e, 'Failed to load team')) }
    finally { setLoading(false) }
  }, [api, page])
  useEffect(() => { load() }, [load])

  const fromLogins = data.length > 0 && data.every((m) => m._source === 'user')

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError('Name is required'); return }
    if (form.hourlyRate !== '' && Number(form.hourlyRate) < 0) { setFormError('Hourly rate cannot be negative'); return }
    setSaving(true); setFormError('')
    try {
      const payload = { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, role: form.role.trim() || null, department: form.department.trim() || null, hourlyRate: form.hourlyRate === '' ? null : Number(form.hourlyRate) }
      // A login account is shown here on loan from the user table, under ITS id — so PUT /api/team/:id has
      // nothing to update and answered 404, which left the row menu doing nothing and six of seven people on
      // this tenant with no way to hold a pay rate. Saving one creates their roster card instead: the roster
      // is "the people you schedule and pay", the user row is the login, and the list matches the two by
      // email so they stop appearing twice. (Contractor T29 M2)
      if (editing && editing._source !== 'user') { await api.put(`/api/team/${editing.id}`, payload); toast.success('Team member updated') }
      else { await api.post('/api/team', payload); toast.success(editing ? `${payload.name} added to the roster` : 'Team member added') }
      setModalOpen(false); load()
    } catch (e) { setFormError(errMsg(e, 'Failed to save team member')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => {
    if (!toDelete) return
    try {
      // Say what it cost. Removing someone sets their jobs back to unassigned, which used to happen silently.
      const res: any = await api.delete('/api/team', toDelete.id)
      const freed = Number(res?.unassignedJobs || 0)
      toast.success(freed > 0 ? `Team member removed — ${freed} ${freed === 1 ? 'job is' : 'jobs are'} now unassigned` : 'Team member removed')
      setToDelete(null); load()
    }
    catch (e) { toast.error(errMsg(e, 'Failed to remove team member')) }
  }
  const openCreate = () => { setEditing(null); setForm(EMPTY); setFormError(''); setModalOpen(true) }
  // A login row's `role` is their PERMISSION role (owner, field), not a trade — so it is not carried into the
  // Job Title field, which would suggest "field" is what they do. Everything else comes across. (T29 M2)
  const openEdit = (m: Member) => { setEditing(m); setForm({ name: m.name || '', email: m.email || '', phone: m.phone || '', role: m._source === 'user' ? '' : (m.role || ''), department: m.department || '', hourlyRate: m.hourlyRate == null ? '' : String(m.hourlyRate) }); setFormError(''); setModalOpen(true) }

  const columns = [
    // The badge says "this person can sign in", so it follows the login — not which table the row came from.
    // Giving someone a roster card used to take their badge away while their login carried on working. (T30 N3)
    { key: 'name', label: 'Name', render: (v: any, row: Member) => <span className="font-medium">{v}{(row.hasLogin || row._source === 'user') && <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-400">login</span>}</span> },
    // Two different things share this column: a roster member's job title is free text they typed, but a login
    // account's is a permission role, and that was printing the stored slug — "field" and "user" on a page whose
    // own Settings › Users calls them Staff. ROLE_LABELS is the one vocabulary for that. (Contractor T14 M10)
    { key: 'role', label: roleLabel, render: (v: any, row: Member) => (row._source === 'user' ? ROLE_LABELS[String(v)] || v || '-' : v || '-') },
    { key: 'department', label: 'Department', render: (v: any) => v || '-' },
    { key: 'email', label: 'Email', render: (v: any) => v || '-' },
    { key: 'phone', label: 'Phone', render: (v: any) => v || '-' },
    // a rate is money: 28.5 is $28.50 an hour (T14 L2)
    { key: 'hourlyRate', label: 'Rate', render: (v: any) => (v != null && v !== '' && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}/hr` : '-') },
    { key: 'active', label: 'Status', render: (v: any) => (v ? <span className="text-green-600">Active</span> : <span className="text-gray-400">Inactive</span>) },
  ]
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div data-testid="team-page-shared">
      <PageHeader title="Team" subtitle="The people you schedule and pay. Login access is set under Settings → Users." action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Member</Button>} />
      {fromLogins && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <Users className="w-4 h-4 mt-0.5 shrink-0" />
          <span>No roster yet — these are your login users (read-only here, managed under Settings → Users). Add a member to start your own roster with roles, departments and rates.</span>
        </div>
      )}
      <DataTable<Member> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No team members yet."
        actions={[
          // Everyone can be edited — for a login account that means giving them a roster card, which is the
          // only place a pay rate, trade or department lives. Delete stays off those rows: removing a login
          // is Settings › Users' job, not this page's. (T29 M2)
          { label: 'Edit', icon: Edit, onClick: openEdit },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: (r) => r._source !== 'user' },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? (editing._source === 'user' ? 'Add to the roster' : 'Edit Member') : 'Add Member'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
          {editing?._source === 'user' && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              This person can sign in but has no roster card, which is where a trade, department and pay rate live. Saving creates one. Their login is unchanged, under Settings › Users.
            </p>
          )}
          <Field label="Name *"><input value={form.name} onChange={set('name')} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={roleLabel}><input placeholder={rolePlaceholder} value={form.role} onChange={set('role')} className={inputCls} /></Field>
            <Field label="Department"><input value={form.department} onChange={set('department')} className={inputCls} /></Field>
          </div>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></Field>
          <Field label="Phone"><input value={form.phone} onChange={set('phone')} className={inputCls} /></Field>
          <Field label="Hourly Rate"><input type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      {/* The warning belongs BEFORE the click, not in a toast afterwards: their jobs go back to unassigned. (T26 L2) */}
      <ConfirmModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Remove Member"
        message={`Remove ${toDelete?.name || 'this member'} from the roster?${
          Number(toDelete?.assignedJobs || 0) > 0
            ? ` ${toDelete!.assignedJobs} ${Number(toDelete!.assignedJobs) === 1 ? 'job assigned to them' : 'jobs assigned to them'} will be left unassigned.`
            : ''
        }`}
        confirmText="Remove"
      />
    </div>
  )
}
