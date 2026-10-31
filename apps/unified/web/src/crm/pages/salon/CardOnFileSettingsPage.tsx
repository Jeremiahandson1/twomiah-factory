// Settings › Card on file (server crm/salon/cardOnFile.ts, GET/PUT /api/card-on-file/policy; hidden feature `card_on_file`):
// the salon's no-show and late-cancellation fees and its own policy words. The card a client keeps is charged only by a
// person pressing "Charge a fee" in The Book, for the amount set here — nothing is charged automatically. Cards live on the
// salon's own Stripe account.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, usePermissions } from '../../../shared'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

type Mode = 'none' | 'amount' | 'percent'
interface Policy {
  cardRequirement: string
  noShowFeeAmount: number | null; noShowFeePercent: number | null
  lateCancelWindowMinutes: number | null; lateCancelFeeAmount: number | null; lateCancelFeePercent: number | null
  policyText: string | null; words: string; connected: boolean
}
const modeOf = (amount: number | null, percent: number | null): Mode => (amount != null ? 'amount' : percent != null ? 'percent' : 'none')
const WINDOWS: [number, string][] = [[120, '2 hours'], [720, '12 hours'], [1440, '24 hours'], [2880, '48 hours'], [4320, '3 days'], [10080, '7 days']]

export default function CardOnFileSettingsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = known && can('company:update')
  const [loaded, setLoaded] = useState<Policy | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [noShowMode, setNoShowMode] = useState<Mode>('none')
  const [noShowValue, setNoShowValue] = useState('')
  const [lateMode, setLateMode] = useState<Mode>('none')
  const [lateValue, setLateValue] = useState('')
  const [windowMin, setWindowMin] = useState<number>(1440)
  const [text, setText] = useState('')
  const [requirement, setRequirement] = useState<string>('off')

  const fill = (p: Policy) => {
    setLoaded(p)
    setRequirement(p.cardRequirement || 'off')
    setNoShowMode(modeOf(p.noShowFeeAmount, p.noShowFeePercent))
    setNoShowValue(String(p.noShowFeeAmount ?? p.noShowFeePercent ?? ''))
    setLateMode(modeOf(p.lateCancelFeeAmount, p.lateCancelFeePercent))
    setLateValue(String(p.lateCancelFeeAmount ?? p.lateCancelFeePercent ?? ''))
    setWindowMin(p.lateCancelWindowMinutes ?? 1440)
    setText(p.policyText ?? '')
  }
  useEffect(() => {
    api.get('/api/card-on-file/policy').then(fill).catch((e: Error) => setLoadError(e.message || 'The card settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!loaded) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true); setErrors({})
    const n = (v: string) => (v.trim() === '' ? null : Number(v))
    try {
      const p: Policy = await api.put('/api/card-on-file/policy', {
        cardRequirement: requirement,
        noShowFeeAmount: noShowMode === 'amount' ? n(noShowValue) : null, noShowFeePercent: noShowMode === 'percent' ? n(noShowValue) : null,
        lateCancelFeeAmount: lateMode === 'amount' ? n(lateValue) : null, lateCancelFeePercent: lateMode === 'percent' ? n(lateValue) : null,
        lateCancelWindowMinutes: lateMode === 'none' ? null : windowMin,
        policyText: text.trim() || null,
      })
      fill(p)
      toast.success('Card policy saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The policy could not be saved.')
    } finally { setSaving(false) }
  }

  const feeRow = (label: string, mode: Mode, setMode: (m: Mode) => void, value: string, setValue: (v: string) => void, errKey: string) => (
    <div>
      <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label={`${label}: how it is set`} value={mode} disabled={!mayEdit} onChange={(e) => setMode(e.target.value as Mode)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="none">No fee</option>
          <option value="amount">A set amount ($)</option>
          <option value="percent">A percent of the service</option>
        </select>
        {mode !== 'none' && (
          <input aria-label={`${label}: ${mode === 'amount' ? 'dollars' : 'percent'}`} inputMode="decimal" value={value} disabled={!mayEdit} onChange={(e) => setValue(e.target.value)} className="w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" placeholder={mode === 'amount' ? '25' : '50'} aria-invalid={!!errors[errKey]} />
        )}
      </div>
      {errors[errKey] && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{errors[errKey]}</p>}
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><CreditCard className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Card on file</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Your no-show and late-cancellation fees, and the words clients agree to when they keep a card with you.</p>
      </div>

      {!loaded.connected && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">Connect your Stripe account (Settings › Integrations) to keep cards. Cards are kept on your own Stripe account, never ours.</p>}
      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="Fees">
        <div className="space-y-5">
          {feeRow('No-show fee', noShowMode, setNoShowMode, noShowValue, setNoShowValue, 'noShowFeeAmount')}
          {feeRow('Late-cancellation fee', lateMode, setLateMode, lateValue, setLateValue, 'lateCancelFeeAmount')}
          {lateMode !== 'none' && (
            <label className="block text-sm font-medium text-gray-900 dark:text-slate-100">
              A cancellation is late when it comes less than
              <select value={windowMin} disabled={!mayEdit} onChange={(e) => setWindowMin(Number(e.target.value))} className={fieldClass}>
                {(WINDOWS.some(([m]) => m === windowMin) ? WINDOWS : [...WINDOWS, [windowMin, `${windowMin} minutes`] as [number, string]]).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
              <span className="mt-1 block font-normal text-gray-600 dark:text-slate-300">before the appointment.</span>
              {errors.lateCancelWindowMinutes && <span role="alert" className="block text-xs text-red-700 dark:text-red-300">{errors.lateCancelWindowMinutes}</span>}
            </label>
          )}
        </div>
        <p className={hint}>Nothing is charged by itself. When a client no-shows or cancels late, someone with permission presses &ldquo;Charge a fee&rdquo; on that appointment in The Book, sees the amount and the card, and confirms.</p>
      </section>

      <section className={box} aria-label="Asking for a card when booking online">
        <label className="block text-sm font-medium text-gray-900 dark:text-slate-100">
          When a client books online, ask for a card
          <select value={requirement} disabled={!mayEdit} onChange={(e) => setRequirement(e.target.value)} className={fieldClass}>
            <option value="off">Never (the default)</option>
            <option value="new_clients">From new clients only</option>
            <option value="all">From every client without a card on file</option>
          </select>
        </label>
        <p className={hint}>
          They are shown your policy and tick to agree, then leave a card on Stripe&rsquo;s own page. <strong>Nothing is charged</strong> by this step. Their time is held
          until the card is saved, or released after the booking hold runs out. A client with a card on file is not asked again. Needs a fee or policy words
          above, and your Stripe account connected.
        </p>
      </section>

      <section className={box} aria-label="Your policy words">
        <label className="block text-sm font-medium text-gray-900 dark:text-slate-100">
          Your policy, in your own words (optional)
          <textarea value={text} disabled={!mayEdit} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} className={fieldClass} placeholder="Leave empty to use the standard sentence below." />
        </label>
        <p className={hint}>What a client is shown and agrees to: <em>{loaded.words || 'Set a fee above and the standard sentence appears here.'}</em></p>
        {errors.cardRequirement && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{errors.cardRequirement}</p>}
      </section>

      {mayEdit && (
        <div><button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save
        </button></div>
      )}
    </div>
  )
}
