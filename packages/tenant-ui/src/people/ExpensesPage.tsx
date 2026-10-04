// Expenses — ONE page for every CRM that offers expense_tracking (vendored into each template as ../shared). Talks to
// the shared /api/expenses routes. Before: two copies — the crm-family one had no job picker and posted the amount as a
// string the backend refused; both silently dropped validation errors into a generic toast.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, CheckCircle, Undo2 } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg, dateOnly, money } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import type { PeopleApi, PeopleToast, ExpensesConfig } from './types'
import { DEFAULT_EXPENSE_CATEGORIES, isManagerRole } from './types'
import { useMayWrite } from '../auth/PermissionsContext'

interface Expense { id: string; date: string; category: string; vendor?: string | null; description: string; amount: string | number; billable: boolean; reimbursable?: boolean; reimbursed?: boolean; approved?: boolean; submittedById?: string | null; submittedByName?: string | null; repaidAmount?: string | number | null; repaidReason?: string | null; projectId?: string | null; jobId?: string | null; project?: { name: string } | null; job?: { title: string; number?: string } | null }
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
  //
  // …and asked AGAIN when a form is about to be opened, if that first attempt came back with
  // nothing. One failed request — a cold start is enough — used to leave the fallback list in place
  // for the whole visit. (Salon RR8 Y2)
  const fetchCategories = useCallback(async () => {
    try {
      const res: any = await api.get('/api/expenses/categories')
      if (!Array.isArray(res?.categories) || !res.categories.length) return null
      setServerCategories(res.categories)
      return res.categories as Array<{ value: string; label: string }>
    } catch { return null }
  }, [api])
  useEffect(() => {
    let cancelled = false
    fetchCategories().then((list) => {
      // This runs at mount, with no dialog open: the blank form was built from the fallback list, so
      // if the server does not know that first value, correct it rather than letting the very first
      // Save answer 400.
      if (cancelled || !list) return
      setForm((f) => (list.some((c) => c.value === f.category) ? f : { ...f, category: list[0].value }))
    })
    return () => { cancelled = true }
  }, [fetchCategories])

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
  /**
   * Record money handed back on a claim that was paid too much. (Salon RR8/X6)
   *
   * The refusal on a reimbursed expense used to end with "this sheet cannot record a repayment yet —
   * settle it outside the expense sheet". This is the door that sentence now points at, and the
   * reason it can: a rule with no screen to satisfy it is a module that cannot be used, which is
   * exactly the mistake RR6 N1 caught me making.
   *
   * The amount is never rewritten. The claim keeps the figure it was paid at, and the row carries
   * what came back beside it.
   */
  const [repayFor, setRepayFor] = useState<Expense | null>(null)
  // `settled` is the whole question the dialog exists to ask: has the money come back, or does the
  // person still owe it? One control, because from the manager's side it is one event — "this claim
  // was paid too much" — and two outcomes. Offering "Record repayment" and "Record over-payment" as
  // separate menu items made the reader choose between two things that sound the same. (Salon RR9)
  const [repayForm, setRepayForm] = useState({ amount: '', reason: '', settled: true })
  const [repayError, setRepayError] = useState('')
  const [repaying, setRepaying] = useState(false)
  const repaid = (r: Expense) => Number(r.repaidAmount || 0)
  const outstanding = (r: Expense) => Math.round((Number(r.amount || 0) - repaid(r)) * 100) / 100
  const openRepayment = (row: Expense) => {
    setRepayFor(row)
    // Pre-filled with everything still outstanding, because correcting the whole thing is the common
    // case and typing it again is just a chance to typo it.
    setRepayForm({ amount: String(outstanding(row) || ''), reason: '', settled: true })
    setRepayError('')
  }
  const saveRepayment = async () => {
    if (!repayFor) return
    if (repayForm.amount === '' || Number(repayForm.amount) <= 0) { setRepayError('The over-payment has to be more than 0'); return }
    if (!repayForm.reason.trim()) { setRepayError('Say what happened — the sheet has to explain itself later'); return }
    setRepaying(true); setRepayError('')
    try {
      // Money in hand records the repayment; money still owed raises it against the person, which
      // is the balance the salon can then chase, offset or take off a pay run.
      const path = repayForm.settled ? 'repayment' : 'overpayment'
      await api.post(`/api/expenses/${repayFor.id}/${path}`, { amount: Number(repayForm.amount), reason: repayForm.reason.trim() })
      toast.success(repayForm.settled ? 'Repayment recorded' : 'Recorded as owed')
      setRepayFor(null); load(); loadOwed()
    } catch (e) { setRepayError(errMsg(e, 'Failed to record the correction')) }
    finally { setRepaying(false) }
  }

  /**
   * What staff owe the business, and settling it. (Salon RR9)
   *
   * The panel below the sheet is the answer to "who owes us anything?", which nothing in the product
   * could answer before: an over-payment could only be recorded at the moment the money arrived, so
   * the weeks in between existed nowhere.
   */
  const [owed, setOwed] = useState<{ total: number; people: any[]; payrollDeductionsAllowed?: boolean } | null>(null)
  const loadOwed = useCallback(async () => {
    try {
      const res: any = await api.get('/api/expenses/owed')
      setOwed(res && Array.isArray(res.people) ? res : null)
    } catch { setOwed(null) } // an older backend has no such route; the panel simply does not appear
  }, [api])
  useEffect(() => { loadOwed() }, [loadOwed])

  const [settleFor, setSettleFor] = useState<any>(null)
  const [settleForm, setSettleForm] = useState({ amount: '', reason: '', via: 'cash', againstExpenseId: '', authorisation: '' })
  const [settleError, setSettleError] = useState('')
  const [settling, setSettling] = useState(false)
  const openSettle = (person: any) => {
    setSettleFor(person)
    setSettleForm({ amount: String(person.owed || ''), reason: '', via: 'cash', againstExpenseId: '', authorisation: '' })
    setSettleError('')
  }
  /** Their approved, unpaid claims — the only ones an offset can come off. */
  const offsettable = (person: any) => data.filter((r) => String(r.submittedById || '') === String(person?.userId)
    && !!r.approved && !!r.reimbursable && !r.reimbursed)
  const saveSettle = async () => {
    if (!settleFor) return
    if (settleForm.amount === '' || Number(settleForm.amount) <= 0) { setSettleError('A settlement has to be more than 0'); return }
    if (!settleForm.reason.trim()) { setSettleError('Say how this was settled — the balance has to explain itself later'); return }
    if (settleForm.via === 'offset' && !settleForm.againstExpenseId) { setSettleError('Choose which claim of theirs it comes off'); return }
    if (settleForm.via === 'payroll' && !settleForm.authorisation.trim()) { setSettleError('Record who authorised the deduction and where that authorisation is kept'); return }
    setSettling(true); setSettleError('')
    try {
      await api.post(`/api/expenses/owed/${settleFor.userId}/settle`, {
        amount: Number(settleForm.amount), reason: settleForm.reason.trim(), via: settleForm.via,
        ...(settleForm.via === 'offset' ? { againstExpenseId: settleForm.againstExpenseId } : {}),
        ...(settleForm.via === 'payroll' ? { authorisation: settleForm.authorisation.trim() } : {}),
      })
      toast.success('Settled')
      setSettleFor(null); loadOwed(); load()
    } catch (e) { setSettleError(errMsg(e, 'Failed to settle')) }
    finally { setSettling(false) }
  }
  // Opening a form is the moment the list matters, so a first attempt that failed is retried here.
  // It does not block the dialog: the fallback list opens now and the picker corrects itself the
  // moment the answer arrives. (Salon RR8 Y2)
  // `correctValue` is false when a row is being EDITED: the dialog must keep showing the category
  // that is on the record, even one the server no longer lists. Correcting it there would be the X1
  // relabelling bug wearing a different hat.
  const refreshCategories = (correctValue: boolean) => {
    if (serverCategories) return
    fetchCategories().then((list) => {
      if (!list || !correctValue) return
      setForm((f) => (list.some((c) => c.value === f.category) ? f : { ...f, category: list[0].value }))
    })
  }
  const openCreate = () => { setEditing(null); setForm(empty()); setFormError(''); setModalOpen(true); refreshCategories(true) }
  const openEdit = (item: Expense) => { setEditing(item); setForm({ date: String(item.date || '').slice(0, 10) || today(), category: item.category, vendor: item.vendor || '', description: item.description || '', amount: String(item.amount ?? ''), billable: !!item.billable, reimbursable: !!item.reimbursable, projectId: item.projectId || '', jobId: item.jobId || '' }); setFormError(''); setModalOpen(true); refreshCategories(false) }
  // A value with no label is title-cased the way the server does it, so `dispensary_fee` reads
  // "Dispensary Fee" in the table instead of showing the raw id. (Salon RR7 X1)
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label || String(v || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  // What the picker offers. A stored value the server no longer lists — a category renamed after the
  // expense was recorded — is kept as an option while that row is open, so the dialog shows what is
  // actually on the record instead of reading as a neighbouring category. (Salon RR7 X1)
  const formCategories = editing && form.category && !categories.some((c) => c.value === form.category)
    ? [{ value: form.category, label: catLabel(form.category) }, ...categories]
    : categories

  /**
   * "me" only where it IS me. (T41 salon: "'Reimburse me' when a manager edits someone else's
   * expense".) Creating a claim is always your own, so that keeps the short form; editing uses the
   * row's own submitter, and falls back to a neutral phrase for a row written before the submitter
   * column existed, where there genuinely is nobody to name.
   */
  const reimburseLabel = !editing || isMine(editing)
    ? 'Reimburse me'
    : editing.submittedByName
      ? `Reimburse ${editing.submittedByName}`
      : 'Reimburse whoever claimed it'

  const columns = [
    { key: 'date', label: 'Date', render: (v: any) => dateOnly(v) || '-' },
    { key: 'category', label: 'Category', render: (v: any) => catLabel(v) },
    { key: 'vendor', label: 'Vendor', render: (v: any) => v || '-' },
    { key: 'description', label: 'Description' },
    // What was claimed, and — when some of it came back — what it cost in the end. Showing only the
    // net would hide a payment that really happened; showing only the claim is the figure that sent
    // people to the amount field to rewrite it. Both, with the claim first. (Salon RR8/X6)
    {
      key: 'amount',
      label: 'Amount',
      render: (v: any, row: Expense) => (repaid(row) > 0 ? (
        <span className="inline-flex flex-col leading-tight">
          <span>{money(v)}</span>
          <span className="text-xs text-amber-700 dark:text-amber-300">{money(repaid(row))} back · {money(outstanding(row))} net</span>
        </span>
      ) : money(v)),
    },
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

  /**
   * Claiming, approving and deleting are three permissions, and the screen asks all three. (T42)
   *
   * Read off the routes: POST /api/expenses asks `expenses:create`; /:id/approve, /:id/reimburse,
   * /owed/:id/settle and PUT /:id ask `expenses:update`; DELETE asks `expenses:delete`. The field
   * rung holds all three — correcting your own claim is a rule this page already encodes — and
   * `viewer` holds `expenses:read` alone, which is the seat being offered every one of them.
   *
   * These AND with the existing row rules rather than replacing them: "your own claim until somebody
   * approves it" is the server's rule and still applies on top of the permission.
   */
  const mayClaim = useMayWrite('expenses:create')
  const maySettle = useMayWrite('expenses:update')
  const mayRemove = useMayWrite('expenses:delete')

  return (
    <div data-testid="expenses-page-shared">
      <PageHeader title="Expenses" action={mayClaim ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Expense</Button> : undefined} />
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
          { label: 'Approve', icon: CheckCircle, onClick: approve, show: (r) => maySettle && canApprove(r) && !r.approved },
          // …and Mark reimbursed only once it IS approved, so the 409 is unreachable from here.
          { label: 'Mark reimbursed', icon: CheckCircle, onClick: reimburse, show: (r) => maySettle && canApprove(r) && !!r.approved && !!r.reimbursable && !r.reimbursed },
          // The door the "too much was paid" refusal points at. Only on a row where money actually
          // went out, and only while some of it is still unaccounted for. (Salon RR8/X6, RR9)
          { label: 'Correct an over-payment', icon: Undo2, onClick: openRepayment, show: (r) => maySettle && manager && !!r.reimbursed && outstanding(r) > 0 },
          // Your own claim is yours to correct until somebody approves it; after that it is a
          // manager's. That is the server's rule, so it is this menu's rule.
          { label: 'Edit', icon: Edit, onClick: openEdit, show: (r) => maySettle && (manager || !r.approved) },
          // Deleting a reimbursed expense is always 409 — the record of a payment stays put — so the
          // action is not offered at all. (Salon RR7 X4)
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: (r) => mayRemove && !r.reimbursed && (manager || !r.approved) },
        ]} />
      {/* Whose pocket the money comes back to. See the note on the checkbox below. (T41) */}
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
            {/*
              "REIMBURSE ME" IS WRONG WHEN IT IS NOT YOUR CLAIM. (T41)

              A manager correcting a stylist's expense was asked whether to "Reimburse me" about
              money that would be paid to the stylist — the one box on this form that decides
              whether cash leaves the till, labelled for the wrong person. The claim's own submitter
              now names it (the row carries submittedByName), and it still says "me" where that is
              the truth: creating a claim, or editing your own.
            */}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reimbursable} onChange={(e) => setForm({ ...form, reimbursable: e.target.checked })} className="rounded" /> {reimburseLabel}</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      {/* Who owes the business anything, and settling it. (Salon RR9)
          Hidden entirely when nobody owes anything, which is the normal state of a shop — a panel
          that is always there saying "nothing owed" trains people to stop reading it. */}
      {owed && owed.people.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-amber-900 dark:text-amber-200">
              {manager ? 'Owed to the business' : 'What you owe'}
            </h2>
            <p className="text-sm text-amber-900 dark:text-amber-200">{money(owed.total)} in total</p>
          </div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            An over-payment on a claim that has been paid out. The claim keeps the figure it was paid at; this is what is still to come back.
          </p>
          <ul className="mt-3 space-y-2">
            {owed.people.map((p: any) => (
              <li key={p.userId} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{p.name || (manager ? 'A team member' : 'You')}</p>
                  {/* The balance explaining itself — the newest movement, in words. */}
                  {p.history?.[0]?.reason && <p className="truncate text-xs text-gray-500 dark:text-slate-400">{p.history[0].reason}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-medium tabular-nums text-gray-900 dark:text-slate-100">{money(p.owed)}</span>
                  {manager && maySettle && <Button variant="secondary" onClick={() => openSettle(p)}>Settle</Button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A claim that was paid too much: the money is either back, or owed. (Salon RR8/X6, RR9) */}
      <Modal isOpen={!!repayFor} onClose={() => setRepayFor(null)} title="Correct an over-payment" size="sm">
        <div className="space-y-4">
          {repayError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{repayError}</div>}
          {repayFor && (
            <p className="text-sm text-gray-600 dark:text-slate-300">
              {repayFor.description ? `"${repayFor.description}" was` : 'This expense was'} reimbursed for{' '}
              <span className="font-medium text-gray-900 dark:text-slate-100">{money(repayFor.amount)}</span>
              {repaid(repayFor) > 0 && <> , with {money(repaid(repayFor))} already back</>}.
              {' '}The payment stays on the record; this is the correction against it.
            </p>
          )}
          <Field label="Amount over-paid *">
            <input type="number" min="0.01" step="0.01" max={repayFor ? outstanding(repayFor) : undefined}
              value={repayForm.amount} onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })} className={inputCls} />
          </Field>
          {/* The whole question: is the money back, or owed? */}
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-200">
              <input type="radio" name="repay-settled" checked={repayForm.settled} onChange={() => setRepayForm({ ...repayForm, settled: true })} className="mt-1" />
              <span><span className="font-medium">They have paid it back</span><br /><span className="text-xs text-gray-500 dark:text-slate-400">Records the money as returned against this claim.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-200">
              <input type="radio" name="repay-settled" checked={!repayForm.settled} onChange={() => setRepayForm({ ...repayForm, settled: false })} className="mt-1" />
              <span><span className="font-medium">They still owe it</span><br /><span className="text-xs text-gray-500 dark:text-slate-400">Puts it on their balance, to settle in cash, off their next claim, or off their pay.</span></span>
            </label>
          </div>
          <Field label="What happened *">
            <input value={repayForm.reason} onChange={(e) => setRepayForm({ ...repayForm, reason: e.target.value })}
              placeholder="e.g. overpaid by $10 — wrong figure on the receipt" className={inputCls} />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setRepayFor(null)}>Cancel</Button>
          <Button onClick={saveRepayment} disabled={repaying}>{repaying ? 'Saving...' : repayForm.settled ? 'Record repayment' : 'Record as owed'}</Button>
        </div>
      </Modal>

      {/* Settling what somebody owes: cash, off a claim, off their pay, or written off. (Salon RR9) */}
      <Modal isOpen={!!settleFor} onClose={() => setSettleFor(null)} title="Settle what they owe" size="sm">
        <div className="space-y-4">
          {settleError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{settleError}</div>}
          {settleFor && (
            <p className="text-sm text-gray-600 dark:text-slate-300">
              <span className="font-medium text-gray-900 dark:text-slate-100">{settleFor.name || 'This person'}</span> owes{' '}
              <span className="font-medium text-gray-900 dark:text-slate-100">{money(settleFor.owed)}</span>.
            </p>
          )}
          <Field label="Amount *">
            <input type="number" min="0.01" step="0.01" max={settleFor?.owed} value={settleForm.amount}
              onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} className={inputCls} />
          </Field>
          <Field label="How *">
            <select value={settleForm.via} onChange={(e) => setSettleForm({ ...settleForm, via: e.target.value })} className={inputCls}>
              <option value="cash">They paid it back</option>
              <option value="offset">Take it off one of their claims</option>
              <option value="payroll" disabled={!owed?.payrollDeductionsAllowed}>
                Take it off their pay{owed?.payrollDeductionsAllowed ? '' : ' — switched off in Settings'}
              </option>
              <option value="write_off">Write it off</option>
            </select>
          </Field>
          {settleForm.via === 'offset' && (
            <Field label="Which claim *">
              <select value={settleForm.againstExpenseId} onChange={(e) => setSettleForm({ ...settleForm, againstExpenseId: e.target.value })} className={inputCls}>
                <option value="">Choose a claim</option>
                {offsettable(settleFor).map((r) => <option key={r.id} value={r.id}>{money(r.amount)} — {r.description}</option>)}
              </select>
              {/* An offset needs an approved, unpaid claim of theirs. If there is none, say so rather
                  than showing an empty picker. */}
              {offsettable(settleFor).length === 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">They have no approved, unpaid claim to take it off.</p>
              )}
            </Field>
          )}
          {settleForm.via === 'payroll' && (
            <Field label="Authorised by *">
              <input value={settleForm.authorisation} onChange={(e) => setSettleForm({ ...settleForm, authorisation: e.target.value })}
                placeholder="who agreed it, and where the signed authorisation is kept" className={inputCls} />
            </Field>
          )}
          <Field label="Note *">
            <input value={settleForm.reason} onChange={(e) => setSettleForm({ ...settleForm, reason: e.target.value })}
              placeholder="e.g. returned in cash at close" className={inputCls} />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setSettleFor(null)}>Cancel</Button>
          <Button onClick={saveSettle} disabled={settling}>{settling ? 'Saving...' : 'Settle'}</Button>
        </div>
      </Modal>
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} title="Delete Expense" message="Delete this expense?" confirmText="Delete" />
    </div>
  )
}
