// Expenses — ONE page for every CRM that offers expense_tracking (vendored into each template as ../shared). Talks to
// the shared /api/expenses routes. Before: two copies — the crm-family one had no job picker and posted the amount as a
// string the backend refused; both silently dropped validation errors into a generic toast.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, CheckCircle } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg, dateOnly, money } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import type { PeopleApi, PeopleToast, ExpensesConfig } from './types'
import { DEFAULT_EXPENSE_CATEGORIES, isManagerRole } from './types'

interface Expense { id: string; date: string; category: string; vendor?: string | null; description: string; amount: string | number; billable: boolean; reimbursable?: boolean; reimbursed?: boolean; projectId?: string | null; jobId?: string | null; project?: { name: string } | null; job?: { title: string; number?: string } | null }
const today = () => new Date().toISOString().split('T')[0]

export function ExpensesPage({ api, toast, config }: { api: PeopleApi; toast: PeopleToast; config?: ExpensesConfig }) {
  const auth = useAuth()
  const jobLabel = config?.jobLabel || 'Job'
  const categories = config?.categories || DEFAULT_EXPENSE_CATEGORIES
  const showJobs = auth.hasFeature(config?.jobsFeature || 'jobs')
  const showProjects = auth.hasFeature(config?.projectsFeature || 'projects')
  const manager = isManagerRole(auth.user?.role)
  const empty = () => ({ date: today(), category: categories[0]?.value || 'other', vendor: '', description: '', amount: '', billable: false, reimbursable: false, projectId: '', jobId: '' })
  const [data, setData] = useState<Expense[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; number?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState(empty())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Expense | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, projRes, jobRes] = await Promise.all([
        api.get('/api/expenses', { page, limit: 25 }),
        showProjects ? api.get('/api/projects', { limit: 100 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        showJobs ? api.get('/api/jobs', { limit: 100 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ])
      setData(res?.data || []); setPagination(res?.pagination || null); setProjects(projRes?.data || []); setJobs(jobRes?.data || [])
    } catch (e) { toast.error(errMsg(e, 'Failed to load expenses')) }
    finally { setLoading(false) }
  }, [api, page, showJobs, showProjects])
  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!form.description.trim()) { setFormError('Description is required'); return }
    if (form.amount === '' || Number(form.amount) <= 0) { setFormError('Amount must be greater than 0'); return }
    setSaving(true); setFormError('')
    try {
      // Unselected pickers post '' which the API treats as a (non-existent) FK — send null instead.
      const payload = { date: form.date, category: form.category, vendor: form.vendor.trim() || null, description: form.description.trim(), amount: Number(form.amount), billable: form.billable, reimbursable: form.reimbursable, projectId: form.projectId || null, jobId: form.jobId || null }
      if (editing) { await api.put(`/api/expenses/${editing.id}`, payload); toast.success('Expense updated') }
      else { await api.post('/api/expenses', payload); toast.success('Expense added') }
      setModalOpen(false); load()
    } catch (e) { setFormError(errMsg(e, 'Failed to save expense')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => {
    if (!toDelete) return
    try { await api.delete('/api/expenses', toDelete.id); toast.success('Expense deleted'); setToDelete(null); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to delete expense')) }
  }
  const reimburse = async (row: Expense) => {
    try { await api.post(`/api/expenses/${row.id}/reimburse`); toast.success('Marked reimbursed'); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to mark reimbursed')) }
  }
  const openCreate = () => { setEditing(null); setForm(empty()); setFormError(''); setModalOpen(true) }
  const openEdit = (item: Expense) => { setEditing(item); setForm({ date: String(item.date || '').slice(0, 10) || today(), category: item.category, vendor: item.vendor || '', description: item.description || '', amount: String(item.amount ?? ''), billable: !!item.billable, reimbursable: !!item.reimbursable, projectId: item.projectId || '', jobId: item.jobId || '' }); setFormError(''); setModalOpen(true) }
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label || v

  const columns = [
    { key: 'date', label: 'Date', render: (v: any) => dateOnly(v) || '-' },
    { key: 'category', label: 'Category', render: (v: any) => catLabel(v) },
    { key: 'vendor', label: 'Vendor', render: (v: any) => v || '-' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', render: (v: any) => money(v) },
    ...(showJobs ? [{ key: 'job', label: jobLabel, render: (v: any) => v?.title || '-' }] : []),
    ...(showProjects ? [{ key: 'project', label: 'Project', render: (v: any) => v?.name || '-' }] : []),
    { key: 'reimbursable', label: 'Reimburse', render: (v: any, row: Expense) => (row.reimbursed ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Done</span> : v ? <span className="text-amber-600">Pending</span> : '-') },
  ]
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div data-testid="expenses-page-shared">
      <PageHeader title="Expenses" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Expense</Button>} />
      <DataTable<Expense> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No expenses yet."
        actions={[
          { label: 'Edit', icon: Edit, onClick: openEdit },
          { label: 'Mark reimbursed', icon: CheckCircle, onClick: reimburse, show: (r) => manager && !!r.reimbursable && !r.reimbursed },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600' },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Expense' : 'Add Expense'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><input type="date" value={form.date} onChange={set('date')} className={inputCls} /></Field>
            <Field label="Category"><select value={form.category} onChange={set('category')} className={inputCls}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          </div>
          <Field label="Vendor"><input value={form.vendor} onChange={set('vendor')} className={inputCls} /></Field>
          <Field label="Description *"><input value={form.description} onChange={set('description')} className={inputCls} /></Field>
          <Field label="Amount *"><input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} className={inputCls} /></Field>
          {showJobs && <Field label={jobLabel}><select value={form.jobId} onChange={set('jobId')} className={inputCls}><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number ? `${j.number} - ` : ''}{j.title}</option>)}</select></Field>}
          {showProjects && <Field label="Project"><select value={form.projectId} onChange={set('projectId')} className={inputCls}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} className="rounded" /> Billable to customer</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reimbursable} onChange={(e) => setForm({ ...form, reimbursable: e.target.checked })} className="rounded" /> Reimburse me</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} title="Delete Expense" message="Delete this expense?" confirmText="Delete" />
    </div>
  )
}
