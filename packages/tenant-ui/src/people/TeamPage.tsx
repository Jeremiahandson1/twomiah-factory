// Team roster — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/team routes.
// Before: three copies (typed / untyped / salon label). Login accounts shown as the fallback roster (`_source: 'user'`)
// used to get Edit/Delete actions that hit the team_member table and 404'd — they are read-only here with a pointer to
// Settings → Users.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Users } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import type { PeopleApi, PeopleToast, TeamConfig } from './types'

interface Member { id: string; name: string; email?: string | null; phone?: string | null; role?: string | null; department?: string | null; hourlyRate?: string | number | null; active: boolean; _source?: 'user' }
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
      if (editing) { await api.put(`/api/team/${editing.id}`, payload); toast.success('Team member updated') }
      else { await api.post('/api/team', payload); toast.success('Team member added') }
      setModalOpen(false); load()
    } catch (e) { setFormError(errMsg(e, 'Failed to save team member')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => {
    if (!toDelete) return
    try { await api.delete('/api/team', toDelete.id); toast.success('Team member removed'); setToDelete(null); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to remove team member')) }
  }
  const openCreate = () => { setEditing(null); setForm(EMPTY); setFormError(''); setModalOpen(true) }
  const openEdit = (m: Member) => { setEditing(m); setForm({ name: m.name || '', email: m.email || '', phone: m.phone || '', role: m.role || '', department: m.department || '', hourlyRate: m.hourlyRate == null ? '' : String(m.hourlyRate) }); setFormError(''); setModalOpen(true) }

  const columns = [
    { key: 'name', label: 'Name', render: (v: any, row: Member) => <span className="font-medium">{v}{row._source === 'user' && <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">login</span>}</span> },
    { key: 'role', label: roleLabel, render: (v: any) => v || '-' },
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
          { label: 'Edit', icon: Edit, onClick: openEdit, show: (r) => r._source !== 'user' },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: (r) => r._source !== 'user' },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Member' : 'Add Member'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
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
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} title="Remove Member" message={`Remove ${toDelete?.name || 'this member'} from the roster?`} confirmText="Remove" />
    </div>
  )
}
