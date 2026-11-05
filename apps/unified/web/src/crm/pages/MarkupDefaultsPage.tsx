// Settings › Markup Defaults (server crm/billing/markupDefaults.ts, /api/markup-defaults; feature markup_defaults, not ready):
// the markup the business usually puts on its own cost, by kind of line. The quote form fills it in on a line that has a cost and
// a kind and no price typed, and shows the margin as the quote is built. Saved quotes never change when these do.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Percent, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

const KINDS: Array<[string, string]> = [['labor', 'Labour'], ['material', 'Material'], ['part', 'Part'], ['service', 'Service'], ['other', 'Other']]
type Rules = Record<string, number | null>
type Form = Record<string, string>

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const errText = 'mt-1 text-xs text-red-700 dark:text-red-300'
const toForm = (r: Rules): Form => Object.fromEntries(KINDS.map(([k]) => [k, r[k] === null || r[k] === undefined ? '' : String(r[k])]))

export default function MarkupDefaultsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/markup-defaults').then((r: Rules) => setForm(toForm(r))).catch((e: Error) => setLoadError(e.message || 'The markup settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Rules = await api.put('/api/markup-defaults', Object.fromEntries(KINDS.map(([k]) => [k, form[k].trim() === '' ? null : Number(form[k])])))
      setForm(toForm(next))
      toast.success('Markup defaults saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The markup settings could not be saved.')
    } finally { setSaving(false) }
  }
  const example = (k: string) => { const n = Number(form[k]); return form[k].trim() !== '' && Number.isFinite(n) ? `A $100 cost is priced at $${(100 * (1 + n / 100)).toFixed(2)}, a margin of ${(n / (100 + n) * 100).toFixed(1)}%.` : 'Leave blank to set none.' }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Percent className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Markup Defaults</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          The markup you usually put on your own cost, by kind of line. On a quote line with a cost and a kind, and no price typed, the markup and the price are filled in for you.
          You can change either on the line. Quotes already saved do not change when you change these.
        </p>
      </div>
      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}
      <section className={box} aria-label="Markup by kind of line">
        <div className="grid gap-4 sm:grid-cols-2">
          {KINDS.map(([k, label]) => (
            <div key={k}>
              <label htmlFor={`markup-${k}`} className="block text-sm font-medium text-gray-800 dark:text-slate-200">{label} markup (%)</label>
              <input id={`markup-${k}`} type="number" min="0" max="1000" step="0.1" inputMode="decimal" value={form[k]} disabled={!mayEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="mt-1 w-full max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <p className={hint}>{example(k)}</p>
              {errors[k] && <p className={errText}>{errors[k]}</p>}
            </div>
          ))}
        </div>
      </section>
      {mayEdit && (
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
        </button>
      )}
    </div>
  )
}
