/**
 * Commissions — ONE page for every CRM that offers `commission_tracking` (crm, crm-fieldservice,
 * crm-landscaping, crm-basic). The template's pages/CommissionsPage.tsx hands it the api client, the toast and
 * the words its trade uses for the four "intended for" roles.
 *
 * What the copies could not do, and this can:
 *   · RECORD AN EARNING. There was no form: the only way a commission existed was a hand-made API call.
 *     Choose the person and a plan, and optionally the job and the invoice — the SERVER works the amount out
 *     from the plan (packages/tenant-backend/src/commissions), so what somebody is paid is the plan's figure,
 *     not a number typed in a browser.
 *   · SAY WHO. The list printed the first eight characters of a user id.
 *   · DISPUTE, EDIT, RETIRE AND BRING BACK A PLAN — the routes existed, the buttons did not.
 *
 * Kept from the copies: one ROLE_WORDS mapping read by both the dropdown and the card (T51), a retired plan
 * marked as retired (T41), and each control gated on the permission that actually guards it (T41: a read
 * permission must not gate a write control).
 */
import { useState, useEffect, useCallback } from 'react'
import { DollarSign, Plus, Check, AlertTriangle, Pencil } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { useConfirm, usePrompt } from '../ui/ConfirmProvider'
import { PageHeader, Button, Modal, Field, inputCls, money, instantDay, errMsg, StatusBadge } from '../invoicing/ui'

export interface CommissionsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: unknown) => Promise<any>
  put: (path: string, body?: unknown) => Promise<any>
  delete: (path: string) => Promise<any>
}
export interface CommissionsToast { success: (m: string) => void; error: (m: string) => void }
export interface CommissionsConfig {
  /** The four stored keys (technician, sales_rep, manager, all) in this trade's words. */
  roleWords: Record<string, string>
  /** Placeholder for a plan's name, e.g. "Standard sales plan". */
  planExample: string
}
export interface CommissionsPageProps { api: CommissionsApi; toast: CommissionsToast; config: CommissionsConfig }

const PLAN_TYPE_WORDS: Record<string, string> = {
  flat_rate: 'Flat rate per job',
  percent_of_invoice: '% of invoice (before tax)',
  percent_of_margin: '% of margin',
  tiered: 'Tiered',
}
const listOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])
const blankPlan = (role: string) => ({ name: '', planType: 'percent_of_invoice', flatRateAmount: '', percentRate: '10', appliesToRole: role })
const blankRecord = { userId: '', planId: '', invoiceId: '', jobId: '', baseAmount: '', commissionAmount: '', notes: '' }

export function CommissionsPage({ api, toast, config }: CommissionsPageProps) {
  const { can } = usePermissions()
  const confirm = useConfirm()
  const ask = usePrompt()
  // Absent then present beats shown then refused: `can`, not the optimistic useMayWrite. (T41)
  const mayReadPlans = can('commissions:read')
  const mayCreate = can('commissions:create')
  const mayUpdate = can('commissions:update')
  const mayRetire = can('commissions:delete')
  const roleKeys = Object.keys(config.roleWords)

  const [tab, setTab] = useState<'records' | 'plans'>('records')
  const [records, setRecords] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [planOpen, setPlanOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<any | null>(null)
  const [planForm, setPlanForm] = useState(blankPlan(roleKeys[0] || 'all'))

  const [recordOpen, setRecordOpen] = useState(false)
  const [recordForm, setRecordForm] = useState(blankRecord)
  const [people, setPeople] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])

  /**
   * The two loads are SEPARATE (T38): a person without commissions:read is still entitled to their own
   * earnings, so a refusal on the pay structure must not take their earnings with it.
   */
  const load = useCallback(async () => {
    try { setRecords(listOf(await api.get('/api/commissions'))) } catch (e) { toast.error(errMsg(e, 'Could not load commissions')) }
    if (mayReadPlans) {
      try { setPlans(listOf(await api.get('/api/commissions/plans'))) } catch (e) { toast.error(errMsg(e, 'Could not load commission plans')) }
    } else setPlans([])
    setLoading(false)
  }, [api, mayReadPlans])
  useEffect(() => { load() }, [load])

  // ── plans ──
  const openNewPlan = () => { setEditingPlan(null); setPlanForm(blankPlan(roleKeys[0] || 'all')); setPlanOpen(true) }
  const openEditPlan = (p: any) => {
    setEditingPlan(p)
    setPlanForm({ name: p.name || '', planType: p.planType, flatRateAmount: p.flatRateAmount ?? '', percentRate: p.percentRate ?? '', appliesToRole: p.appliesToRole || 'all' })
    setPlanOpen(true)
  }
  const savePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: Record<string, any> = { name: planForm.name, planType: planForm.planType, appliesToRole: planForm.appliesToRole }
    if (planForm.planType === 'flat_rate') body.flatRateAmount = Number(planForm.flatRateAmount || 0)
    else body.percentRate = Number(planForm.percentRate || 0)
    setBusy(true)
    try {
      if (editingPlan) await api.put(`/api/commissions/plans/${editingPlan.id}`, body)
      else await api.post('/api/commissions/plans', body)
      toast.success(editingPlan ? 'Plan saved' : 'Plan created')
      setPlanOpen(false)
      load()
    } catch (err) { toast.error(errMsg(err, 'The plan could not be saved')) } finally { setBusy(false) }
  }
  const retirePlan = async (p: any) => {
    if (!(await confirm(`Earnings already worked out under "${p.name}" keep pointing at it; it just stops being offered for new ones.`, { title: 'Retire this plan?', confirmText: 'Retire' }))) return
    try { await api.delete(`/api/commissions/plans/${p.id}`); toast.success('Plan retired'); load() } catch (err) { toast.error(errMsg(err, 'The plan could not be retired')) }
  }
  const restorePlan = async (p: any) => {
    try { await api.put(`/api/commissions/plans/${p.id}`, { isActive: true }); toast.success('Plan back in use'); load() } catch (err) { toast.error(errMsg(err, 'The plan could not be brought back')) }
  }

  // ── earnings ──
  const openRecord = async () => {
    setRecordForm(blankRecord)
    setRecordOpen(true)
    // Each list on its own: a refusal on one must not empty the others.
    try { setPeople(listOf(await api.get('/api/company/users')).filter((u: any) => u.isActive !== false)) } catch { setPeople([]) }
    try { setInvoices(listOf(await api.get('/api/invoices', { limit: 100 })).filter((i: any) => !['draft', 'void', 'voided', 'cancelled'].includes(String(i.status)))) } catch { setInvoices([]) }
    try { setJobs(listOf(await api.get('/api/jobs', { limit: 100 }))) } catch { setJobs([]) }
  }
  const plan = plans.find((p) => p.id === recordForm.planId)
  const needsBase = !!plan && plan.planType !== 'flat_rate' && (plan.planType === 'percent_of_margin' || !recordForm.invoiceId)
  const saveRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: Record<string, any> = { userId: recordForm.userId }
    if (recordForm.planId) body.planId = recordForm.planId
    if (recordForm.invoiceId) body.invoiceId = recordForm.invoiceId
    if (recordForm.jobId) body.jobId = recordForm.jobId
    if (recordForm.baseAmount !== '') body.baseAmount = Number(recordForm.baseAmount)
    if (!recordForm.planId) body.commissionAmount = Number(recordForm.commissionAmount || 0)
    if (recordForm.notes.trim()) body.notes = recordForm.notes.trim()
    setBusy(true)
    try {
      const created = await api.post('/api/commissions', body)
      toast.success(`Commission recorded: ${money(created?.commissionAmount)}`)
      setRecordOpen(false)
      load()
    } catch (err) { toast.error(errMsg(err, 'The commission could not be recorded')) } finally { setBusy(false) }
  }
  const act = async (row: any, action: 'approve' | 'mark-paid' | 'dispute') => {
    let body: Record<string, any> = {}
    if (action === 'dispute') {
      const notes = await ask('What is wrong with this commission? The note is kept on it.', { title: 'Dispute commission', confirmText: 'Dispute' })
      if (notes === null) return
      body = { notes }
    }
    try { await api.post(`/api/commissions/${row.id}/${action}`, body); load() } catch (err) { toast.error(errMsg(err, 'That could not be done')) }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading commissions…</div>

  const tabCls = (on: boolean) => `px-4 py-2 border-b-2 text-sm ${on ? 'border-orange-500 text-gray-900 font-semibold dark:text-slate-100' : 'border-transparent text-gray-600 dark:text-slate-400'}`

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Commissions"
        subtitle="How commission is worked out, and what has been earned"
        action={tab === 'plans'
          ? (mayCreate ? <Button onClick={openNewPlan}><Plus className="w-4 h-4" />New plan</Button> : null)
          : (mayCreate ? <Button onClick={openRecord}><Plus className="w-4 h-4" />Record commission</Button> : null)}
      />

      <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-slate-700" role="tablist">
        <button role="tab" aria-selected={tab === 'records'} onClick={() => setTab('records')} className={tabCls(tab === 'records')}>Earnings</button>
        {mayReadPlans && <button role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')} className={tabCls(tab === 'plans')}>Plans</button>}
      </div>

      {tab === 'records' ? (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200 dark:bg-slate-800 dark:border-slate-700">
              <tr className="text-left text-xs font-semibold uppercase text-gray-600 dark:text-slate-300">
                <th className="px-4 py-3">Person</th><th className="px-4 py-3">Worked out on</th><th className="px-4 py-3">Rate</th>
                <th className="px-4 py-3">Commission</th><th className="px-4 py-3">Earned</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-400">
                  {mayCreate ? 'No commissions yet. Record one when a job or invoice earns it.' : 'No commissions recorded for you yet.'}
                </td></tr>
              ) : records.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">{r.userName || 'Former team member'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{money(r.baseAmount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{r.rateApplied ? `${Number(r.rateApplied)}%` : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-slate-100">{money(r.commissionAmount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{instantDay(r.earnedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    {mayUpdate && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {(r.status === 'pending' || r.status === 'disputed') && <Button variant="secondary" className="!px-2 !py-1" onClick={() => act(r, 'approve')}><Check className="w-4 h-4" />Approve</Button>}
                        {r.status === 'approved' && <Button variant="success" className="!px-2 !py-1" onClick={() => act(r, 'mark-paid')}>Mark paid</Button>}
                        {(r.status === 'pending' || r.status === 'approved') && <Button variant="warn" className="!px-2 !py-1" onClick={() => act(r, 'dispute')}><AlertTriangle className="w-4 h-4" />Dispute</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.length === 0 ? (
            <div className="col-span-full bg-white border border-gray-200 rounded-lg p-12 text-center text-sm text-gray-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">No commission plans yet. Create one to start working out commissions.</div>
          ) : plans.map((p) => (
            <div key={p.id} className={`bg-white border rounded-lg p-5 dark:bg-slate-900 ${p.isActive === false ? 'border-dashed border-gray-300 dark:border-slate-600' : 'border-gray-200 dark:border-slate-700'}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-lg text-gray-900 dark:text-slate-100 flex items-center gap-2">
                  {p.name}
                  {p.isActive === false && <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200">Retired</span>}
                </h3>
                {mayUpdate && <button aria-label={`Edit ${p.name}`} onClick={() => openEditPlan(p)} className="p-1 rounded text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>}
              </div>
              <div className="text-sm text-gray-600 mb-3 dark:text-slate-400">
                {PLAN_TYPE_WORDS[p.planType] || p.planType} · for {config.roleWords[p.appliesToRole] || p.appliesToRole || config.roleWords.all}
                {p.isActive === false && ' · no longer offered for new earnings'}
              </div>
              <div className="text-sm text-gray-900 dark:text-slate-100">
                {p.planType === 'flat_rate' && <>{money(p.flatRateAmount)} per job</>}
                {(p.planType === 'percent_of_invoice' || p.planType === 'percent_of_margin') && <>{Number(p.percentRate || 0)}% of {p.planType === 'percent_of_invoice' ? 'the invoice before tax' : 'the margin'}</>}
                {p.planType === 'tiered' && <>Tiered: {(p.tiers || []).length} brackets</>}
              </div>
              {p.isActive === false
                ? (mayUpdate && <button onClick={() => restorePlan(p)} className="mt-3 text-sm text-gray-700 underline dark:text-slate-300">Bring back</button>)
                : (mayRetire && <button onClick={() => retirePlan(p)} className="mt-3 text-sm text-red-700 underline dark:text-red-300">Retire</button>)}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={planOpen} onClose={() => setPlanOpen(false)} title={editingPlan ? 'Edit commission plan' : 'New commission plan'}>
        <form onSubmit={savePlan} className="space-y-3">
          <Field label="Plan name"><input required placeholder={`e.g. ${config.planExample}`} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="How it is worked out">
              <select value={planForm.planType} onChange={(e) => setPlanForm({ ...planForm, planType: e.target.value })} className={inputCls} disabled={editingPlan?.planType === 'tiered'}>
                <option value="flat_rate">{PLAN_TYPE_WORDS.flat_rate}</option>
                <option value="percent_of_invoice">{PLAN_TYPE_WORDS.percent_of_invoice}</option>
                <option value="percent_of_margin">{PLAN_TYPE_WORDS.percent_of_margin}</option>
                {editingPlan?.planType === 'tiered' && <option value="tiered">{PLAN_TYPE_WORDS.tiered}</option>}
              </select>
            </Field>
            {/* "Intended for" is a note on the plan: a commission is recorded against a person, and nothing matches a plan to anyone by role. (T51) */}
            <Field label="Intended for">
              <select value={planForm.appliesToRole} onChange={(e) => setPlanForm({ ...planForm, appliesToRole: e.target.value })} className={inputCls}>
                {Object.entries(config.roleWords).map(([value, word]) => <option key={value} value={value}>{word}</option>)}
              </select>
            </Field>
          </div>
          {planForm.planType === 'flat_rate'
            ? <Field label="Amount per job ($)"><input type="number" min="0" step="0.01" required value={planForm.flatRateAmount} onChange={(e) => setPlanForm({ ...planForm, flatRateAmount: e.target.value })} className={inputCls} /></Field>
            : planForm.planType !== 'tiered' && <Field label="Rate (%)" hint="Between 0 and 100."><input type="number" min="0" max="100" step="0.1" required value={planForm.percentRate} onChange={(e) => setPlanForm({ ...planForm, percentRate: e.target.value })} className={inputCls} /></Field>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{editingPlan ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={recordOpen} onClose={() => setRecordOpen(false)} title="Record a commission">
        <form onSubmit={saveRecord} className="space-y-3">
          <Field label="Who earned it">
            <select required value={recordForm.userId} onChange={(e) => setRecordForm({ ...recordForm, userId: e.target.value })} className={inputCls}>
              <option value="">Choose a person…</option>
              {people.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</option>)}
            </select>
          </Field>
          <Field label="Plan" hint={plan ? `${PLAN_TYPE_WORDS[plan.planType] || plan.planType}. The amount is worked out from the plan when you save.` : 'No plan: enter the agreed amount yourself.'}>
            <select value={recordForm.planId} onChange={(e) => setRecordForm({ ...recordForm, planId: e.target.value })} className={inputCls}>
              <option value="">No plan — an agreed amount</option>
              {plans.filter((p) => p.isActive !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Invoice (optional)">
              <select value={recordForm.invoiceId} onChange={(e) => setRecordForm({ ...recordForm, invoiceId: e.target.value })} className={inputCls}>
                <option value="">None</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.number}{i.contact?.name ? ` — ${i.contact.name}` : ''} · {money(i.total)}</option>)}
              </select>
            </Field>
            <Field label="Job (optional)">
              <select value={recordForm.jobId} onChange={(e) => setRecordForm({ ...recordForm, jobId: e.target.value })} className={inputCls}>
                <option value="">None</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.number} — {j.title}</option>)}
              </select>
            </Field>
          </div>
          {needsBase && (
            <Field label={plan?.planType === 'percent_of_margin' ? 'Margin it is worked out on ($)' : 'Amount it is worked out on ($)'}>
              <input type="number" min="0" step="0.01" required value={recordForm.baseAmount} onChange={(e) => setRecordForm({ ...recordForm, baseAmount: e.target.value })} className={inputCls} />
            </Field>
          )}
          {!recordForm.planId && (
            <Field label="Commission amount ($)">
              <input type="number" min="0" step="0.01" required value={recordForm.commissionAmount} onChange={(e) => setRecordForm({ ...recordForm, commissionAmount: e.target.value })} className={inputCls} />
            </Field>
          )}
          <Field label="Notes (optional)"><textarea rows={2} value={recordForm.notes} onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })} className={inputCls} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}><DollarSign className="w-4 h-4" />Record</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
