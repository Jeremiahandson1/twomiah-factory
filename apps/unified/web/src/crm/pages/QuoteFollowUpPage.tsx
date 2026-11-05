// Settings › Quote Follow-up (server crm/billing/quoteFollowUp.ts, /api/quote-followup/settings; feature quote_followup, not
// ready): an automatic, polite email to a customer who was sent a quote and has not answered it. Every word here is what the
// hourly pass does — nothing is a promise it does not keep.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck, Loader2, Plus, X } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Rules { enabled: boolean; afterDays: number[]; sendFromHour?: number }
type Form = { enabled: boolean; afterDays: string[] }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const errText = 'mt-1 text-xs text-red-700 dark:text-red-300'
const toForm = (r: Rules): Form => ({ enabled: r.enabled, afterDays: r.afterDays.map(String) })
const hourWords = (h = 8) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

export default function QuoteFollowUpPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [rules, setRules] = useState<Rules | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/quote-followup/settings')
      .then((r: Rules) => { setRules(r); setForm(toForm(r)) })
      .catch((e: Error) => setLoadError(e.message || 'The follow-up settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form || !rules) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Rules = await api.put('/api/quote-followup/settings', { enabled: form.enabled, afterDays: form.afterDays.filter((d) => d.trim() !== '').map(Number) })
      setRules(next); setForm(toForm(next))
      toast.success('Quote follow-up saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The follow-up settings could not be saved.')
    } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MailCheck className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Quote Follow-up</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Email a customer who was sent a quote and has not answered it, automatically. Follow-ups go out from {hourWords(rules.sendFromHour)} on your
          business&rsquo;s clock (the time zone in Settings › Company), each one once. They stop the moment the customer approves or declines, or you mark the quote,
          and never go out after the quote&rsquo;s &ldquo;valid until&rdquo; day. A customer who unsubscribed from your emails is never sent one.
        </p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="Follow-ups">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.enabled} disabled={!mayEdit} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" />
          Follow up on quotes that have not been answered
        </label>
        <p className={hint}>Off by default. Off, nothing is sent.</p>

        <div className="mt-4">
          <span className="block text-sm font-medium text-gray-800 dark:text-slate-200">Days after the quote was sent</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {form.afterDays.map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <input aria-label={`Follow-up ${i + 1}, days after sending`} type="number" min="1" max="90" inputMode="numeric" className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={d} disabled={!mayEdit}
                  onChange={(e) => set({ afterDays: form.afterDays.map((x, j) => (j === i ? e.target.value : x)) })} />
                {mayEdit && <button type="button" aria-label={`Remove follow-up ${i + 1}`} onClick={() => set({ afterDays: form.afterDays.filter((_, j) => j !== i) })} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
              </span>
            ))}
            {mayEdit && form.afterDays.length < 3 && (
              <button type="button" onClick={() => set({ afterDays: [...form.afterDays, ''] })} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200"><Plus className="h-4 w-4" />Add</button>
            )}
          </div>
          <p className={hint}>Up to three. A quote first found later than one of these gets only the latest follow-up it has reached. If you send a quote again, its follow-ups start over.</p>
          {Object.entries(errors).filter(([k]) => k.startsWith('afterDays')).map(([k, v]) => <p key={k} className={errText}>{v}</p>)}
        </div>
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
