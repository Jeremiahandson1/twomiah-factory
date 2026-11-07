// Beside an invoice (contractor parity row 12; server crm/billing/paymentPlans.ts): its payment plan — installments that add up to
// the total, each with its day and where it stands — and how the customer may pay it online (card, bank or both). Each part only
// where the business has its switch on (payment_plans, payment_method_choice); changing either asks invoices:update.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth, usePermissions, useToast } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { evenPlan, type Inst } from './evenPlan'
import { todayKey } from '@twomiah/tenant-ui/src/time/day'

const box = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'


export function InvoicePaymentsPanel({ invoiceId, total, status, paymentMethods }: { invoiceId: string; total: number; status: string; paymentMethods?: string | null }) {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  const toast = useToast()
  const plansOn = hasFeature('payment_plans')
  const methodsOn = hasFeature('payment_method_choice')
  const mayChange = known && can('invoices:update')
  const [plan, setPlan] = useState<Inst[]>([])
  const [draft, setDraft] = useState<Inst[] | null>(null)
  const [methods, setMethods] = useState(paymentMethods || 'both')
  const load = useCallback(() => {
    if (!plansOn) return
    api.get(`/api/invoice-payments/${invoiceId}/plan`).then((r: any) => setPlan(r?.installments || [])).catch(() => setPlan([]))
  }, [invoiceId, plansOn])
  useEffect(() => { load() }, [load])
  if (!plansOn && !methodsOn) return null
  const open = !['draft', 'void', 'paid', 'refunded'].includes(status)
  const sum = Math.round((draft || []).reduce((s, i) => s + (Number(i.amount) || 0), 0) * 100) / 100

  const save = async () => {
    try { const r: any = await api.put(`/api/invoice-payments/${invoiceId}/plan`, { installments: (draft || []).map((i) => ({ dueDate: i.dueDate, amount: Number(i.amount) })) }); setPlan(r?.installments || []); setDraft(null); toast.success('Payment plan saved') }
    catch (e: any) { toast.error(e?.message || 'Could not save the plan') }
  }
  const remove = async () => { try { await api.delete(`/api/invoice-payments/${invoiceId}/plan`); setPlan([]); toast.success('Plan removed') } catch (e: any) { toast.error(e?.message || 'Could not remove it') } }
  const setMethod = async (v: string) => { try { const r: any = await api.put(`/api/invoice-payments/${invoiceId}/methods`, { paymentMethods: v }); setMethods(r?.paymentMethods || v) } catch (e: any) { toast.error(e?.message || 'Could not change it') } }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-4 space-y-3" data-testid="invoice-payments-panel">
      {methodsOn && (
        <label className="flex items-center justify-between gap-2 text-sm">Paid online by
          <select aria-label="How the customer may pay online" disabled={!mayChange} value={methods} onChange={(e) => setMethod(e.target.value)} className={box}>
            <option value="both">card or bank</option><option value="card">card only</option><option value="bank">bank (ACH) only</option>
          </select>
        </label>
      )}
      {plansOn && (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Payment plan</p>
          {!draft && plan.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm" data-testid="plan-rows">
              {plan.map((p) => <li key={p.id} className="flex justify-between"><span>{p.dueDate}</span><span>{money(p.amount)} · {p.state}</span></li>)}
            </ul>
          )}
          {!draft && plan.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400">None. The customer pays the whole balance by the due date.</p>}
          {draft && (
            <div className="mt-1 space-y-1">
              {draft.map((i, n) => (
                <div key={n} className="flex gap-2">
                  <input aria-label={`Installment ${n + 1} due`} type="date" value={i.dueDate} onChange={(e) => setDraft(draft.map((x, j) => (j === n ? { ...x, dueDate: e.target.value } : x)))} className={box} />
                  <input aria-label={`Installment ${n + 1} amount`} type="number" step="0.01" value={String(i.amount)} onChange={(e) => setDraft(draft.map((x, j) => (j === n ? { ...x, amount: Number(e.target.value) } : x)))} className={`${box} w-28`} />
                  <button type="button" onClick={() => setDraft(draft.filter((_, j) => j !== n))} aria-label={`Remove installment ${n + 1}`} className="text-red-700 dark:text-red-300">×</button>
                </div>
              ))}
              <p className={`text-xs ${Math.abs(sum - total) > 0.005 ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-slate-400'}`}>Adds up to {money(sum)} of {money(total)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setDraft([...draft, { dueDate: draft[draft.length - 1]?.dueDate || todayKey(), amount: 0 }])} className="text-sm text-orange-700 dark:text-orange-200">+ Installment</button>
                <button type="button" onClick={save} className="rounded-lg bg-orange-600 px-3 py-1 text-sm text-white">Save plan</button>
                <button type="button" onClick={() => setDraft(null)} className="rounded-lg border px-3 py-1 text-sm dark:border-slate-600">Cancel</button>
              </div>
            </div>
          )}
          {mayChange && open && !draft && (
            <div className="mt-2 flex flex-wrap gap-2">
              {[2, 3, 4, 6].map((n) => <button key={n} type="button" onClick={() => setDraft(evenPlan(total, n, todayKey()))} className="rounded-lg border px-2 py-1 text-xs dark:border-slate-600">{n} monthly</button>)}
              {plan.length > 0 && <button type="button" onClick={() => setDraft(plan.map((p) => ({ dueDate: p.dueDate, amount: p.amount })))} className="rounded-lg border px-2 py-1 text-xs dark:border-slate-600">Change</button>}
              {plan.length > 0 && <button type="button" onClick={remove} className="text-xs text-red-700 dark:text-red-300">Remove</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
