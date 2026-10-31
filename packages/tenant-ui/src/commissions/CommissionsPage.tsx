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
 *   · VOID AND REASSIGN AN EARNING (contractor live re-test 3, 2026-10-24: a $165 commission read "Former team member"
 *     with no way to put it right). Void keeps the row, marked void with the reason; Reassign moves it to the person who
 *     earned it. Both commissions:update, both in the audit log, neither on a paid commission (a correction is a new
 *     record).
 *
 * Kept from the copies: one ROLE_WORDS mapping read by both the dropdown and the card (T51), a retired plan
 * marked as retired (T41), and each control gated on the permission that actually guards it (T41: a read
 * permission must not gate a write control).
 */
import { useState, useEffect, useCallback } from 'react'
import { DollarSign, Plus, Check, AlertTriangle, Pencil, Printer, Zap, Ban, UserCog } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { useConfirm, usePrompt } from '../ui/ConfirmProvider'
import { PageHeader, Button, Modal, Field, inputCls, money, instantDay, errMsg, StatusBadge } from '../invoicing/ui'
import { companyTodayKey } from '../time/companyClock'

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
  /**
   * A trade that pays the job's SELLER once the whole job is paid (roofing): offers that choice on a plan — margin plans
   * included, since the server works their margin out — and says so on the card. Absent: the three choices every trade has.
   */
  salesRepAutoEarn?: boolean
  /** The plan types in this trade's words (roofing: "% of the contract", "% of gross profit"); absent ones keep the default. */
  planTypeWords?: Partial<Record<'flat_rate' | 'percent_of_invoice' | 'percent_of_margin' | 'tiered', string>>
  /** What the percentage is of, on a plan's card: { percent_of_invoice: 'the contract before tax', percent_of_margin: 'the job’s gross profit' }. */
  planBaseWords?: Partial<Record<'percent_of_invoice' | 'percent_of_margin', string>>
}
export interface CommissionsPageProps { api: CommissionsApi; toast: CommissionsToast; config: CommissionsConfig }

const PLAN_TYPE_WORDS: Record<string, string> = {
  flat_rate: 'Flat rate per job',
  percent_of_invoice: '% of invoice (before tax)',
  percent_of_margin: '% of margin',
  tiered: 'Tiered',
}
const listOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])
const blankPlan = (role: string) => ({ name: '', planType: 'percent_of_invoice', flatRateAmount: '', percentRate: '10', appliesToRole: role, autoEarn: 'none', userIds: [] as string[] })
/** The people a plan names (commission_plan.user_ids) — empty when it names nobody. */
const namedOn = (p: any): string[] => (Array.isArray(p?.userIds) ? p.userIds.map(String) : [])
/** The server's planPaysPerson (tenant-backend commissions.ts): a plan that names people pays them only; one that names
 *  nobody pays anyone not named on another current plan. */
export const paysPerson = (plan: any, userId: string, all: any[]) => {
  const named = namedOn(plan)
  if (named.length) return named.includes(userId)
  return !all.some((p) => p.id !== plan.id && p.isActive !== false && namedOn(p).includes(userId))
}
const personName = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Former team member'
/** Who a plan pays by itself when an invoice is paid in full — the server's COMMISSION_AUTO_EARN. */
const AUTO_WORDS: Record<string, string> = {
  none: 'No — record each one by hand',
  job_assignee: "Yes — the person assigned the job",
  job_creator: 'Yes — the person who booked the job',
}
/** Offered only where the config says the trade pays the job's seller (CommissionsConfig.salesRepAutoEarn). */
const SALES_REP_AUTO_WORDS: Record<string, string> = { job_sales_rep: "Yes — the job\u2019s sales rep, when the whole job is paid" }
const SOURCE_WORDS: Record<string, string> = { auto: 'Automatic', reversal: 'Taken back', manual: 'Recorded' }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
const blankRecord = { userId: '', planId: '', invoiceId: '', jobId: '', baseAmount: '', commissionAmount: '', notes: '' }
/** Where a commission can still be voided or moved to another person: not yet paid out, and not already cancelled. */
const OPEN = ['pending', 'approved', 'disputed']

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
  const planWords = { ...PLAN_TYPE_WORDS, ...(config.planTypeWords || {}) } as Record<string, string>
  const baseWords = { percent_of_invoice: 'the invoice before tax', percent_of_margin: 'the margin', ...(config.planBaseWords || {}) } as Record<string, string>
  const salesRepAuto = !!config.salesRepAutoEarn
  /** A margin plan is recorded by hand — unless the trade pays the seller, whose margin the server works out. */
  const autoFor = (planType: string, autoEarn: string) => (planType === 'percent_of_margin' && !(salesRepAuto && autoEarn === 'job_sales_rep') ? 'none' : autoEarn)
  const autoChoices = (planType: string): Record<string, string> =>
    planType === 'percent_of_margin'
      ? (salesRepAuto ? { none: AUTO_WORDS.none, ...SALES_REP_AUTO_WORDS } : { none: AUTO_WORDS.none })
      : { ...AUTO_WORDS, ...(salesRepAuto ? SALES_REP_AUTO_WORDS : {}) }

  const [tab, setTab] = useState<'records' | 'plans' | 'statements'>('records')
  const [stmtWho, setStmtWho] = useState('')
  const [stmtFrom, setStmtFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })
  const [stmtTo, setStmtTo] = useState(() => companyTodayKey())
  const [statement, setStatement] = useState<any | null>(null)
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
  // Reassign: the commission being moved, and to whom.
  const [moving, setMoving] = useState<any | null>(null)
  const [moveTo, setMoveTo] = useState('')

  /**
   * The two loads are SEPARATE (T38): a person without commissions:read is still entitled to their own
   * earnings, so a refusal on the pay structure must not take their earnings with it.
   */
  const load = useCallback(async () => {
    try { setRecords(listOf(await api.get('/api/commissions'))) } catch (e) { toast.error(errMsg(e, 'Could not load commissions')) }
    if (mayReadPlans) {
      try { setPlans(listOf(await api.get('/api/commissions/plans'))) } catch (e) { toast.error(errMsg(e, 'Could not load commission plans')) }
      // Names for the people each plan pays (and the forms' lists).
      try { setPeople(listOf(await api.get('/api/company/users'))) } catch { /* the cards fall back to "Former team member" */ }
    } else setPlans([])
    setLoading(false)
  }, [api, mayReadPlans])
  useEffect(() => { load() }, [load])

  // ── plans ──
  // The people a plan can name: the team's logins (switched-off ones only where a plan already names them).
  const loadPeople = async () => { try { setPeople(listOf(await api.get('/api/company/users'))) } catch { setPeople([]) } }
  const openNewPlan = () => { setEditingPlan(null); setPlanForm(blankPlan(roleKeys[0] || 'all')); setPlanOpen(true); loadPeople() }
  const openEditPlan = (p: any) => {
    setEditingPlan(p)
    setPlanForm({ name: p.name || '', planType: p.planType, flatRateAmount: p.flatRateAmount ?? '', percentRate: p.percentRate ?? '', appliesToRole: p.appliesToRole || 'all', autoEarn: p.autoEarn || 'none', userIds: namedOn(p) })
    setPlanOpen(true)
    loadPeople()
  }
  const togglePerson = (id: string) => setPlanForm((prev) => ({ ...prev, userIds: prev.userIds.includes(id) ? prev.userIds.filter((x) => x !== id) : [...prev.userIds, id] }))
  const savePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: Record<string, any> = { name: planForm.name, planType: planForm.planType, appliesToRole: planForm.appliesToRole, autoEarn: autoFor(planForm.planType, planForm.autoEarn), userIds: planForm.userIds }
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
    try { setPeople(listOf(await api.get('/api/company/users'))) } catch { setPeople([]) }
    try { setInvoices(listOf(await api.get('/api/invoices', { limit: 100 })).filter((i: any) => !['draft', 'void', 'voided', 'cancelled'].includes(String(i.status)))) } catch { setInvoices([]) }
    try { setJobs(listOf(await api.get('/api/jobs', { limit: 100 }))) } catch { setJobs([]) }
  }
  const plan = plans.find((p) => p.id === recordForm.planId)
  /** The plans that can pay the chosen person (all of them before anyone is chosen). */
  const plansFor = (userId: string) => plans.filter((p) => p.isActive !== false && (!userId || paysPerson(p, userId, plans)))
  /** Choosing who earned it brings the plan made for them — the one plan that names them — when none is chosen yet. */
  const pickEarner = (userId: string) => setRecordForm((prev) => {
    const theirs = plans.filter((p) => p.isActive !== false && namedOn(p).includes(userId))
    const keep = prev.planId && plansFor(userId).some((p) => p.id === prev.planId)
    return { ...prev, userId, planId: keep ? prev.planId : theirs.length === 1 ? theirs[0].id : '' }
  })
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

  /** Void: kept, marked void with the reason (asked in the app's own box), out of every total. */
  const voidRecord = async (row: any) => {
    const reason = await ask(`Why is this ${money(row.commissionAmount)} commission void? The reason is kept on it.`, { title: 'Void commission', confirmText: 'Void', placeholder: 'e.g. Recorded twice' })
    if (reason === null) return
    if (!reason.trim()) { toast.error('Say why it is void — the reason is kept on the record.'); return }
    try { await api.post(`/api/commissions/${row.id}/void`, { reason: reason.trim() }); toast.success('Commission voided'); load() } catch (err) { toast.error(errMsg(err, 'The commission could not be voided')) }
  }
  const openMove = async (row: any) => {
    setMoving(row)
    setMoveTo('')
    if (!people.length) { try { setPeople(listOf(await api.get('/api/company/users'))) } catch { setPeople([]) } }
  }
  const saveMove = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!moving || !moveTo) return
    setBusy(true)
    try {
      await api.post(`/api/commissions/${moving.id}/reassign`, { userId: moveTo })
      toast.success(`Commission moved to ${personName(people.find((u) => u.id === moveTo))}`)
      setMoving(null)
      load()
    } catch (err) { toast.error(errMsg(err, 'The commission could not be moved')) } finally { setBusy(false) }
  }

  const loadStatement = async () => {
    if (mayReadPlans && !people.length) { try { setPeople(listOf(await api.get('/api/company/users')).filter((u: any) => u.isActive !== false)) } catch { setPeople([]) } }
    try { setStatement(await api.get('/api/commissions/statement', { userId: stmtWho || undefined, from: stmtFrom || undefined, to: stmtTo || undefined })) }
    catch (err) { setStatement(null); toast.error(errMsg(err, 'Could not load the statement')) }
  }
  /** A clean page for the printer: the statement only, no sidebar. Opened inside the click so it is not blocked. */
  const printStatement = () => {
    if (!statement) return
    const w = window.open('', '_blank')
    if (!w) { toast.error('Allow pop-ups for this site to print the statement'); return }
    const rows = statement.lines.map((l: any) => `<tr><td>${esc(instantDay(l.earnedAt))}</td><td>${esc(SOURCE_WORDS[l.source] || l.source)}</td><td>${esc(l.notes || '')}</td><td class="n">${esc(money(l.baseAmount))}</td><td class="n">${esc(money(l.commissionAmount))}</td><td>${esc(l.status)}</td></tr>`).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Commission statement — ${esc(statement.person.name)}</title><style>body{font:14px system-ui,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#444}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}td.n,th.n{text-align:right}tfoot td{font-weight:600}</style></head><body><h1>Commission statement — ${esc(statement.person.name)}</h1><p>${esc(statement.from || 'From the start')} to ${esc(statement.to || 'today')}</p><table><thead><tr><th>Earned</th><th>How</th><th>Note</th><th class="n">Worked out on</th><th class="n">Commission</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No commissions in this period.</td></tr>'}</tbody><tfoot><tr><td colspan="4">Paid</td><td class="n">${esc(money(statement.totals.paid))}</td><td></td></tr><tr><td colspan="4">Approved, not yet paid</td><td class="n">${esc(money(statement.totals.approved))}</td><td></td></tr><tr><td colspan="4">Pending approval</td><td class="n">${esc(money(statement.totals.pending))}</td><td></td></tr><tr><td colspan="4">Owed</td><td class="n">${esc(money(statement.totals.owed))}</td><td></td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading commissions…</div>

  // A render function, not a component: declared inside the page, a component would remount on every keystroke and the date boxes would lose focus.
  function statementView() {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-end gap-3 dark:bg-slate-900 dark:border-slate-700">
          {mayReadPlans && (
            <Field label="Person">
              <select value={stmtWho} onChange={(e) => setStmtWho(e.target.value)} onFocus={() => { if (!people.length) api.get('/api/company/users').then((r: any) => setPeople(listOf(r).filter((u: any) => u.isActive !== false))).catch(() => {}) }} className={inputCls}>
                <option value="">Me</option>
                {people.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</option>)}
              </select>
            </Field>
          )}
          <Field label="From"><input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="To"><input type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} className={inputCls} /></Field>
          <Button onClick={loadStatement}>Show statement</Button>
          {statement && <Button variant="secondary" onClick={printStatement}><Printer className="w-4 h-4" />Print</Button>}
        </div>
        {statement && (
          <div className="relative bg-white border border-gray-200 rounded-lg overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">{statement.person.name}</h2>
              <p className="text-sm text-gray-600 dark:text-slate-400">{statement.from || 'From the start'} to {statement.to || 'today'}</p>
            </div>
            <table className="w-full min-w-[560px]">
              <thead><tr className="text-left text-xs font-semibold uppercase text-gray-600 dark:text-slate-300"><th className="px-4 py-2">Earned</th><th className="px-4 py-2">How</th><th className="px-4 py-2">Commission</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody>
                {statement.lines.length === 0
                  ? <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-400">No commissions in this period.</td></tr>
                  : statement.lines.map((l: any) => (
                    <tr key={l.id} className="border-t border-gray-100 dark:border-slate-800">
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300">{instantDay(l.earnedAt)}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300">{SOURCE_WORDS[l.source] || l.source}{l.notes ? <span className="block text-xs text-gray-600 dark:text-slate-400">{l.notes}</span> : null}</td>
                      <td className="px-4 py-2 text-sm font-semibold text-gray-900 dark:text-slate-100">{money(l.commissionAmount)}</td>
                      <td className="px-4 py-2"><StatusBadge status={l.status} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-t border-gray-200 dark:border-slate-700">
              {([['Paid', statement.totals.paid], ['Approved', statement.totals.approved], ['Pending', statement.totals.pending], ['Owed', statement.totals.owed]] as const).map(([label, v]) => (
                <div key={label}><dt className="text-xs uppercase text-gray-600 dark:text-slate-400">{label}</dt><dd className="text-lg font-semibold text-gray-900 dark:text-slate-100">{money(v)}</dd></div>
              ))}
            </dl>
          </div>
        )}
      </div>
    )
  }

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
        <button role="tab" aria-selected={tab === 'statements'} onClick={() => setTab('statements')} className={tabCls(tab === 'statements')}>Statements</button>
      </div>

      {tab === 'statements' ? (
        statementView()
      ) : tab === 'records' ? (
        <div className="relative bg-white border border-gray-200 rounded-lg overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
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
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">{r.userName || 'Former team member'}{r.source && r.source !== 'manual' && <span className="block text-xs text-gray-600 dark:text-slate-400">{SOURCE_WORDS[r.source] || r.source}</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{money(r.baseAmount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{r.rateApplied ? `${Number(r.rateApplied)}%` : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-slate-100">{money(r.commissionAmount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{instantDay(r.earnedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} />{r.status === 'void' && r.voidReason && <span className="block text-xs text-gray-600 dark:text-slate-400 mt-1">{r.voidReason}</span>}</td>
                  <td className="px-4 py-3">
                    {mayUpdate && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {OPEN.includes(r.status) && <Button variant="secondary" className="!px-2 !py-1" onClick={() => openMove(r)}><UserCog className="w-4 h-4" />Reassign</Button>}
                        {OPEN.includes(r.status) && <Button variant="danger" className="!px-2 !py-1" onClick={() => voidRecord(r)}><Ban className="w-4 h-4" />Void</Button>}
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
                {planWords[p.planType] || p.planType} · for {config.roleWords[p.appliesToRole] || p.appliesToRole || config.roleWords.all}
                {p.isActive === false && ' · no longer offered for new earnings'}
              </div>
              <div className="text-sm text-gray-700 mb-2 dark:text-slate-300">
                {namedOn(p).length
                  ? <>Pays {namedOn(p).map((id) => personName(people.find((u) => u.id === id))).join(', ')}</>
                  : <>Pays anyone it reaches who has no plan of their own</>}
              </div>
              <div className="text-sm text-gray-900 dark:text-slate-100">
                {p.planType === 'flat_rate' && <>{money(p.flatRateAmount)} per job</>}
                {(p.planType === 'percent_of_invoice' || p.planType === 'percent_of_margin') && <>{Number(p.percentRate || 0)}% of {baseWords[p.planType]}</>}
                {p.planType === 'tiered' && <>Tiered: {(p.tiers || []).length} brackets</>}
              </div>
              {p.autoEarn === 'job_sales_rep'
                ? <p className="mt-2 text-sm text-gray-700 flex items-center gap-1 dark:text-slate-300"><Zap className="w-4 h-4" />Pays the job&rsquo;s sales rep{namedOn(p).length ? ', when they are on this plan,' : ''} automatically when the whole job is paid</p>
                : p.autoEarn && p.autoEarn !== 'none' && <p className="mt-2 text-sm text-gray-700 flex items-center gap-1 dark:text-slate-300"><Zap className="w-4 h-4" />Pays {p.autoEarn === 'job_assignee' ? 'the person assigned the job' : 'the person who booked the job'}{namedOn(p).length ? ', when they are on this plan,' : ''} automatically when its invoice is paid in full</p>}
              {p.isActive === false
                ? (mayUpdate && <button onClick={() => restorePlan(p)} className="mt-3 text-sm text-gray-700 underline dark:text-slate-300">Bring back</button>)
                : (mayRetire && <button onClick={() => retirePlan(p)} className="mt-3 text-sm text-red-700 underline dark:text-red-300">Retire</button>)}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={planOpen} onClose={() => setPlanOpen(false)} title={editingPlan ? 'Edit commission plan' : 'New commission plan'}>
        <form onSubmit={savePlan} className="space-y-3">
          <Field label="Plan name"><input required placeholder={`e.g. ${config.planExample}`} value={planForm.name} onChange={(e) => setPlanForm((prev) => ({ ...prev, name: e.target.value }))} className={inputCls} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="How it is worked out">
              <select value={planForm.planType} onChange={(e) => setPlanForm((prev) => ({ ...prev, planType: e.target.value }))} className={inputCls} disabled={editingPlan?.planType === 'tiered'}>
                <option value="flat_rate">{planWords.flat_rate}</option>
                <option value="percent_of_invoice">{planWords.percent_of_invoice}</option>
                <option value="percent_of_margin">{planWords.percent_of_margin}</option>
                {editingPlan?.planType === 'tiered' && <option value="tiered">{planWords.tiered}</option>}
              </select>
            </Field>
            {/* "Intended for" is a note on the plan: a commission is recorded against a person, and nothing matches a plan to anyone by role. (T51) */}
            <Field label="Intended for">
              <select value={planForm.appliesToRole} onChange={(e) => setPlanForm((prev) => ({ ...prev, appliesToRole: e.target.value }))} className={inputCls}>
                {Object.entries(config.roleWords).map(([value, word]) => <option key={value} value={value}>{word}</option>)}
              </select>
            </Field>
          </div>
          {planForm.planType === 'flat_rate'
            ? <Field label="Amount per job ($)"><input type="number" min="0" step="0.01" required value={planForm.flatRateAmount} onChange={(e) => setPlanForm((prev) => ({ ...prev, flatRateAmount: e.target.value }))} className={inputCls} /></Field>
            : planForm.planType !== 'tiered' && <Field label="Rate (%)" hint="Between 0 and 100."><input type="number" min="0" max="100" step="0.1" required value={planForm.percentRate} onChange={(e) => setPlanForm((prev) => ({ ...prev, percentRate: e.target.value }))} className={inputCls} /></Field>}
          {/* WHO IT PAYS (contractor re-test 2026-10-22: a plan could not be given to anyone). */}
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Who it pays</legend>
            <p className="text-xs text-gray-600 mb-2 dark:text-slate-400">Tick the people on this plan. Leave everyone unticked and it pays anyone it reaches who has no plan of their own.</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-1 dark:border-slate-700">
              {people.filter((u) => u.isActive !== false || planForm.userIds.includes(u.id)).map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-100">
                  <input type="checkbox" checked={planForm.userIds.includes(u.id)} onChange={() => togglePerson(u.id)} />
                  {personName(u)}{u.isActive === false ? ' (switched off)' : ''}
                </label>
              ))}
              {people.length === 0 && <p className="text-xs text-gray-600 dark:text-slate-400">Loading the team…</p>}
            </div>
          </fieldset>
          <Field label="Pay it automatically?" hint={planForm.planType === 'percent_of_margin' && !salesRepAuto ? 'A margin plan is recorded by hand — the margin has to be entered.' : salesRepAuto && autoFor(planForm.planType, planForm.autoEarn) === 'job_sales_rep' ? 'When every invoice on a job is paid, from now on, the job\u2019s sales rep earns it once, on the whole job, if this plan pays them. A percent-of plan is worked out on what was invoiced before tax; a margin plan on the job\u2019s gross profit. A full refund of the last invoice takes it back.' : 'When an invoice for a job is paid in full, from now on, the job\u2019s person earns it if this plan pays them. A full refund takes it back.'}>
            <select value={autoFor(planForm.planType, planForm.autoEarn)} disabled={planForm.planType === 'percent_of_margin' && !salesRepAuto} onChange={(e) => setPlanForm((prev) => ({ ...prev, autoEarn: e.target.value }))} className={inputCls}>
              {Object.entries(autoChoices(planForm.planType)).map(([value, word]) => <option key={value} value={value}>{word}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{editingPlan ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!moving} onClose={() => setMoving(null)} title="Reassign commission">
        <form onSubmit={saveMove} className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-slate-300">{moving ? <>{money(moving.commissionAmount)} earned {instantDay(moving.earnedAt)}, now with <strong>{moving.userName || 'Former team member'}</strong>. The amount and status stay as they are; the move is kept in the audit log.</> : null}</p>
          <Field label="Who earned it">
            <select required value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={inputCls}>
              <option value="">Choose a person…</option>
              {people.filter((u) => u.isActive !== false && u.id !== moving?.userId).map((u) => <option key={u.id} value={u.id}>{personName(u)}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMoving(null)}>Cancel</Button>
            <Button type="submit" disabled={busy || !moveTo}>Reassign</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={recordOpen} onClose={() => setRecordOpen(false)} title="Record a commission">
        <form onSubmit={saveRecord} className="space-y-3">
          <Field label="Who earned it">
            <select required value={recordForm.userId} onChange={(e) => pickEarner(e.target.value)} className={inputCls}>
              <option value="">Choose a person…</option>
              {people.filter((u) => u.isActive !== false).map((u) => <option key={u.id} value={u.id}>{personName(u)}</option>)}
            </select>
          </Field>
          <Field label="Plan" hint={plan ? `${planWords[plan.planType] || plan.planType}. The amount is worked out from the plan when you save.` : 'No plan: enter the agreed amount yourself.'}>
            <select value={recordForm.planId} onChange={(e) => setRecordForm((prev) => ({ ...prev, planId: e.target.value }))} className={inputCls}>
              <option value="">No plan — an agreed amount</option>
              {plansFor(recordForm.userId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Invoice (optional)">
              <select value={recordForm.invoiceId} onChange={(e) => setRecordForm((prev) => ({ ...prev, invoiceId: e.target.value }))} className={inputCls}>
                <option value="">None</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.number}{i.contact?.name ? ` — ${i.contact.name}` : ''} · {money(i.total)}</option>)}
              </select>
            </Field>
            <Field label="Job (optional)">
              <select value={recordForm.jobId} onChange={(e) => setRecordForm((prev) => ({ ...prev, jobId: e.target.value }))} className={inputCls}>
                <option value="">None</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.number} — {j.title}</option>)}
              </select>
            </Field>
          </div>
          {needsBase && (
            <Field label={plan?.planType === 'percent_of_margin' ? 'Margin it is worked out on ($)' : 'Amount it is worked out on ($)'}>
              <input type="number" min="0" step="0.01" required value={recordForm.baseAmount} onChange={(e) => setRecordForm((prev) => ({ ...prev, baseAmount: e.target.value }))} className={inputCls} />
            </Field>
          )}
          {!recordForm.planId && (
            <Field label="Commission amount ($)">
              <input type="number" min="0" step="0.01" required value={recordForm.commissionAmount} onChange={(e) => setRecordForm((prev) => ({ ...prev, commissionAmount: e.target.value }))} className={inputCls} />
            </Field>
          )}
          <Field label="Notes (optional)"><textarea rows={2} value={recordForm.notes} onChange={(e) => setRecordForm((prev) => ({ ...prev, notes: e.target.value }))} className={inputCls} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}><DollarSign className="w-4 h-4" />Record</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
