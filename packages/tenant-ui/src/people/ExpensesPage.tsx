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

interface Expense { id: string; date: string; category: string; vendor?: string | null; description: string; amount: string | number; billable: boolean; reimbursable?: boolean; reimbursed?: boolean; approved?: boolean; submittedById?: string | null; projectId?: string | null; jobId?: string | null; project?: { name: string } | null; job?: { title: string; number?: string } | null }
// The person's own day, not UTC's: toISOString() rolls over at UTC midnight, so west of Greenwich this
// pre-filled TOMORROW all evening. It is also the ceiling the date box is given — an expense is money already
// spent. (Contractor T30 L1, the same fix the timesheet got)
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0] }

export function ExpensesPage({ api, toast, config }: { api: PeopleApi; toast: PeopleToast; config?: ExpensesConfig }) {
  const auth = useAuth()
  const jobLabel = config?.jobLabel || 'Job'
  /**
   * The category list comes from the server that validates it. (Salon RR7 X1 — a HIGH.)
   *
   * This form used to offer whatever the template passed in `config.categories`, or the shared
   * contractor default when it passed nothing. The salon's backend accepts stock / retail / colour /
   * tools / rent and the form offered Materials / Equipment / Labor / Travel / Other, so pressing
   * Save on the form exactly as it opened answered 400 — and an expense stored as `tools` opened in
   * the Edit dialog reading "Materials", one Save away from being silently relabelled.
   *
   * GET /api/expenses/categories is the same list the create and update schemas check against, so
   * there is only one list and a vertical that customises it gets the screen for free. The
   * configured list stays as the fallback for a backend deployed before that route existed.
   */
  const [serverCategories, setServerCategories] = useState<Array<{ value: string; label: string }> | null>(null)
  const categories = serverCategories || config?.categories || DEFAULT_EXPENSE_CATEGORIES
  const showJobs = auth.hasFeature(config?.jobsFeature || 'jobs')
  const showProjects = auth.hasFeature(config?.projectsFeature || 'projects')
  const manager = isManagerRole(auth.user?.role)
  // Your own claim: the server refuses you approving or reimbursing it, so the action is not
  // offered. Rows written before the submitter column existed have none and stay open to a
  // manager. (Salon RR6 E1)
  const isMine = (r: Expense) => !!r.submittedById && String(r.submittedById) === String((auth.user as any)?.id ?? (auth.user as any)?.userId)
  // …but an owner or admin MAY approve their own, which is what the server says: OWN_APPROVAL_OK.
  // Hiding it from them too left a one-person salon — the owner is the only person there — with an
  // expense it could approve and no way to. (Salon RR7 X3)
  const ownApprovalOk = ['owner', 'admin'].includes(String(auth.user?.role || ''))
  const canApprove = (r: Expense) => manager && (ownApprovalOk || !isMine(r))
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
  // Asked once, not per page. A backend without the route (or a network blip) leaves
  // `serverCategories` null and the configured list stands — the form still works. (Salon RR7 X1)
  useEffect(() => {
    let cancelled = false
    api.get('/api/expenses/categories')
      .then((res: any) => {
        if (cancelled || !Array.isArray(res?.categories) || !res.categories.length) return
        setServerCategories(res.categories)
        // This runs at mount, with no dialog open: the blank form was built from the fallback list,
        // so if the server does not know that first value, correct it rather than letting the very
        // first Save answer 400.
        setForm((f) => (res.categories.some((c: any) => c.value === f.category) ? f : { ...f, category: res.categories[0].value }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

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
  /**
   * Approve a claim. (Salon RR6 N1 — a HIGH, and one I created.)
   *
   * The server was given the rule that an expense must be approved before it can be reimbursed,
   * and this screen was never given a way to approve. So Mark reimbursed answered 409 "Approve
   * this expense before reimbursing it" and there was no approve anywhere in the product — the
   * only route was POST /api/expenses/:id/approve by hand, which no salon owner is going to do.
   * A server rule with no screen to satisfy it is a module that cannot be used.
   */
  const approve = async (row: Expense) => {
    try { await api.post(`/api/expenses/${row.id}/approve`); toast.success('Expense approved'); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to approve expense')) }
  }

  const reimburse = async (row: Expense) => {
    try { await api.post(`/api/expenses/${row.id}/reimburse`); toast.success('Marked reimbursed'); load() }
    catch (e) { toast.error(errMsg(e, 'Failed to mark reimbursed')) }
  }
  const openCreate = () => { setEditing(null); setForm(empty()); setFormError(''); setModalOpen(true) }
  const openEdit = (item: Expense) => { setEditing(item); setForm({ date: String(item.date || '').slice(0, 10) || today(), category: item.category, vendor: item.vendor || '', description: item.description || '', amount: String(item.amount ?? ''), billable: !!item.billable, reimbursable: !!item.reimbursable, projectId: item.projectId || '', jobId: item.jobId || '' }); setFormError(''); setModalOpen(true) }
  // A value with no label is title-cased the way the server does it, so `dispensary_fee` reads
  // "Dispensary Fee" in the table instead of showing the raw id. (Salon RR7 X1)
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label || String(v || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  // What the picker offers. A stored value the server no longer lists — a category renamed after the
  // expense was recorded — is kept as an option while that row is open, so the dialog shows what is
  // actually on the record instead of reading as a neighbouring category. (Salon RR7 X1)
  const formCategories = editing && form.category && !categories.some((c) => c.value === form.category)
    ? [{ value: form.category, label: catLabel(form.category) }, ...categories]
    : categories

  const columns = [
    { key: 'date', label: 'Date', render: (v: any) => dateOnly(v) || '-' },
    { key: 'category', label: 'Category', render: (v: any) => catLabel(v) },
    { key: 'vendor', label: 'Vendor', render: (v: any) => v || '-' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', render: (v: any) => money(v) },
    ...(showJobs ? [{ key: 'job', label: jobLabel, render: (v: any) => v?.title || '-' }] : []),
    ...(showProjects ? [{ key: 'project', label: 'Project', render: (v: any) => v?.name || '-' }] : []),
    // Whether it can be passed on to the customer — the question an expense list exists to answer, and the
    // one column it did not have. The form has always asked it and the row has always carried it; only the
    // table was silent, so you had to open every row to find out. (Evergreen T12 L8)
    { key: 'billable', label: 'Billable', render: (v: any) => (v ? <span className="text-blue-700 dark:text-blue-300">Yes</span> : '-') },
    // Approval is now the step reimbursing depends on, so it has to be visible. Without this the
    // Approve action appears and disappears with no column explaining why. (Salon RR6 N1)
    { key: 'approved', label: 'Approved', render: (v: any) => (v ? <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Yes</span> : <span className="text-gray-500 dark:text-slate-400">No</span>) },
    { key: 'reimbursable', label: 'Reimburse', render: (v: any, row: Expense) => (row.reimbursed ? <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Done</span> : v ? <span className="text-amber-700 dark:text-amber-300">Pending</span> : '-') },
  ]
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div data-testid="expenses-page-shared">
      <PageHeader title="Expenses" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Expense</Button>} />
      <DataTable<Expense> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No expenses yet."
        actions={[
          // Approve really is FIRST now — it is the step reimbursing depends on, so it is what a
          // manager opening this menu is usually after. It sat below Edit while the comment said
          // otherwise. (Salon RR7 X4)
          //
          // Hidden on your own claim for a manager, because the server refuses that — a second
          // person does the checking — and offering an action that always 403s is the L11 mistake
          // in a new place. An owner or admin may approve their own, and is offered it. (RR6 N1/E1,
          // RR7 X3)
          { label: 'Approve', icon: CheckCircle, onClick: approve, show: (r) => canApprove(r) && !r.approved },
          // …and Mark reimbursed only once it IS approved, so the 409 is unreachable from here.
          { label: 'Mark reimbursed', icon: CheckCircle, onClick: reimburse, show: (r) => canApprove(r) && !!r.approved && !!r.reimbursable && !r.reimbursed },
          // Your own claim is yours to correct until somebody approves it; after that it is a
          // manager's. That is the server's rule, so it is this menu's rule.
          { label: 'Edit', icon: Edit, onClick: openEdit, show: (r) => manager || !r.approved },
          // Deleting a reimbursed expense is always 409 — the record of a payment stays put — so the
          // action is not offered at all. (Salon RR7 X4)
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: (r) => !r.reimbursed && (manager || !r.approved) },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Expense' : 'Add Expense'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><input type="date" max={today()} value={form.date} onChange={set('date')} className={inputCls} /></Field>
            <Field label="Category"><select value={form.category} onChange={set('category')} className={inputCls}>{formCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
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
