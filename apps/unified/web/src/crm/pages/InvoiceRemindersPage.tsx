// Settings › Invoice Reminders (server crm/billing/invoiceReminders.ts, /api/invoice-reminders/settings): automatic
// "due soon" and "overdue" emails and the optional late fee. Every word here is what the engine does — nothing is a
// promise the hourly pass does not keep.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Loader2, Plus, X } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions, money } from '../../shared'

interface Rules {
  enabled: boolean
  dueSoonDays: number
  overdueDays: number[]
  lateFee: { enabled: boolean; type: 'percent' | 'flat'; amount: number; afterDays: number }
  sendFromHour?: number
  lateFeeApplies?: 'invoices' | 'none'
}
type Form = { enabled: boolean; dueSoonDays: string; overdueDays: string[]; lateFee: { enabled: boolean; type: 'percent' | 'flat'; amount: string; afterDays: string } }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const field = 'mt-1 w-full max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-sm font-medium text-gray-800 dark:text-slate-200'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const errText = 'mt-1 text-xs text-red-700 dark:text-red-300'

const toForm = (r: Rules): Form => ({
  enabled: r.enabled, dueSoonDays: String(r.dueSoonDays), overdueDays: r.overdueDays.map(String),
  lateFee: { enabled: r.lateFee.enabled, type: r.lateFee.type, amount: String(r.lateFee.amount), afterDays: String(r.lateFee.afterDays) },
})
const hourWords = (h = 8) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

export default function InvoiceRemindersPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [rules, setRules] = useState<Rules | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/invoice-reminders/settings')
      .then((r: Rules) => { setRules(r); setForm(toForm(r)) })
      .catch((e: Error) => setLoadError(e.message || 'The reminder settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form || !rules) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const setFee = (patch: Partial<Form['lateFee']>) => setForm({ ...form, lateFee: { ...form.lateFee, ...patch } })
  const careOnly = rules.lateFeeApplies === 'none'

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Rules = await api.put('/api/invoice-reminders/settings', {
        enabled: form.enabled,
        dueSoonDays: Number(form.dueSoonDays === '' ? NaN : form.dueSoonDays),
        overdueDays: form.overdueDays.filter((d) => d.trim() !== '').map(Number),
        lateFee: { enabled: form.lateFee.enabled, type: form.lateFee.type, amount: Number(form.lateFee.amount || 0), afterDays: Number(form.lateFee.afterDays) },
      })
      setRules(next); setForm(toForm(next))
      toast.success('Invoice reminders saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The reminder settings could not be saved.')
    } finally { setSaving(false) }
  }

  const feeExample = form.lateFee.type === 'percent'
    ? `${form.lateFee.amount || 0}% of a ${money(200)} balance is ${money(Math.round(200 * Number(form.lateFee.amount || 0)) / 100)}`
    : `${money(Number(form.lateFee.amount || 0))} on any overdue balance`

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><BellRing className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Invoice Reminders</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Email customers about invoices that are due soon or overdue, automatically. Reminders go out from {hourWords(rules.sendFromHour)} on
          your business&rsquo;s clock (the time zone in Settings › Company), each one once. Every email has the invoice&rsquo;s own link to view and pay it.
          A customer who unsubscribed from your emails is never sent one.
        </p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="Reminders">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.enabled} disabled={!mayEdit} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" />
          Send automatic invoice reminders
        </label>
        <p className={hint}>Off by default. Off, nothing is sent and no late fee is added.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="due-soon" className={label}>&ldquo;Due soon&rdquo; reminder, days before the due date</label>
            <input id="due-soon" type="number" min="0" max="30" inputMode="numeric" className={field} value={form.dueSoonDays} disabled={!mayEdit} onChange={(e) => set({ dueSoonDays: e.target.value })} />
            <p className={hint}>0 sends none.</p>
            {errors.dueSoonDays && <p className={errText}>{errors.dueSoonDays}</p>}
          </div>
          <div>
            <span className={label}>&ldquo;Overdue&rdquo; reminders, days after the due date</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {form.overdueDays.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <input aria-label={`Overdue reminder ${i + 1}, days late`} type="number" min="1" max="365" inputMode="numeric" className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={d} disabled={!mayEdit}
                    onChange={(e) => set({ overdueDays: form.overdueDays.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {mayEdit && <button type="button" aria-label={`Remove overdue reminder ${i + 1}`} onClick={() => set({ overdueDays: form.overdueDays.filter((_, j) => j !== i) })} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
                </span>
              ))}
              {mayEdit && form.overdueDays.length < 5 && (
                <button type="button" onClick={() => set({ overdueDays: [...form.overdueDays, ''] })} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200"><Plus className="h-4 w-4" />Add</button>
              )}
            </div>
            <p className={hint}>Up to five. An invoice first found later than one of these gets only the latest reminder it has reached.</p>
            {Object.entries(errors).filter(([k]) => k.startsWith('overdueDays')).map(([k, v]) => <p key={k} className={errText}>{v}</p>)}
          </div>
        </div>
      </section>

      <section className={box} aria-label="Late fee">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Late fee</h2>
        {careOnly ? (
          <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">Late fees are not added to your Billing invoices: their lines are caregiver visits, and most are billed to Medicaid and other payers. Reminders above still go to the client.</p>
        ) : (
          <>
            <label className="mt-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
              <input type="checkbox" checked={form.lateFee.enabled} disabled={!mayEdit} onChange={(e) => setFee({ enabled: e.target.checked })} className="h-4 w-4" />
              Add a late fee to overdue invoices
            </label>
            <p className={hint}>Off by default. Added once per invoice, as its own &ldquo;Late fee&rdquo; line the customer sees, and written in the audit log. Like every line, it is included in the invoice&rsquo;s sales tax if the invoice has a tax rate.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="fee-type" className={label}>Fee</label>
                <select id="fee-type" className={field} value={form.lateFee.type} disabled={!mayEdit} onChange={(e) => setFee({ type: e.target.value as 'percent' | 'flat' })}>
                  <option value="percent">A percent of the balance</option>
                  <option value="flat">A flat amount</option>
                </select>
              </div>
              <div>
                <label htmlFor="fee-amount" className={label}>{form.lateFee.type === 'percent' ? 'Percent' : 'Amount ($)'}</label>
                <input id="fee-amount" type="number" min="0" step="0.01" inputMode="decimal" className={field} value={form.lateFee.amount} disabled={!mayEdit} onChange={(e) => setFee({ amount: e.target.value })} />
                {errors['lateFee.amount'] && <p className={errText}>{errors['lateFee.amount']}</p>}
              </div>
              <div>
                <label htmlFor="fee-after" className={label}>Days after the due date</label>
                <input id="fee-after" type="number" min="1" max="365" inputMode="numeric" className={field} value={form.lateFee.afterDays} disabled={!mayEdit} onChange={(e) => setFee({ afterDays: e.target.value })} />
                {errors['lateFee.afterDays'] && <p className={errText}>{errors['lateFee.afterDays']}</p>}
              </div>
            </div>
            <p className={hint}>For example: {feeExample}, added {form.lateFee.afterDays || '…'} days after the due date.</p>
          </>
        )}
      </section>

      {mayEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
          </button>
        </div>
      )}
    </div>
  )
}
