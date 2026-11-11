// A project's size and its builder's risk policy (parity tier 3, contractor; server crm/projects/projectDetails.ts,
// /api/project-details; feature builders_risk, not ready): square feet, price and budget per square foot (for seats that see
// project money), and the policy, flagged as it nears its end.
import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Policy { carrier: string; policyNumber?: string | null; coverage?: number | null; startsOn?: string | null; endsOn?: string | null }
interface Details { squareFeet: number | null; buildersRisk: Policy | null; policyStanding: 'ok' | 'ending_soon' | 'ended' | null; perSquareFoot: { price: number | null; budget: number | null } | null }

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-xs font-medium text-gray-700 dark:text-slate-200'
/** '2026-12-31' → 'Dec 31, 2026', a calendar day as written. */
const day = (s?: string | null) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')

export function ProjectSizeRiskPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('projects:update')
  const [d, setD] = useState<Details | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ squareFeet: '', carrier: '', policyNumber: '', coverage: '', startsOn: '', endsOn: '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.get(`/api/project-details/${projectId}`).then((r: Details) => {
    setD(r)
    const p = r.buildersRisk
    setForm({ squareFeet: r.squareFeet ? String(r.squareFeet) : '', carrier: p?.carrier || '', policyNumber: p?.policyNumber || '', coverage: p?.coverage != null ? String(p.coverage) : '', startsOn: p?.startsOn || '', endsOn: p?.endsOn || '' })
  }).catch(() => setD(null))
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/project-details/${projectId}`, {
        squareFeet: form.squareFeet.trim() ? Number(form.squareFeet) : null,
        buildersRisk: form.carrier.trim() ? { carrier: form.carrier.trim(), policyNumber: form.policyNumber.trim() || null, coverage: form.coverage.trim() ? Number(form.coverage) : null, startsOn: form.startsOn || null, endsOn: form.endsOn || null } : null,
      })
      toast.success('Saved'); setEditing(false); await load()
    } catch (e: any) { toast.error(e?.message || 'Could not save.') } finally { setSaving(false) }
  }

  if (!d) return null
  const p = d.buildersRisk
  return (
    <section className="rounded-lg border bg-white p-4 dark:bg-slate-900 dark:border-slate-700" aria-label="Size and builder's risk">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><ShieldCheck className="h-5 w-5 text-orange-600 dark:text-orange-300" aria-hidden="true" />Size &amp; builder&rsquo;s risk</h2>
        {mayEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">Edit</button>}
      </div>
      {!editing ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-900 dark:text-slate-100">
          <dt className="text-gray-600 dark:text-slate-400">Square feet</dt><dd>{d.squareFeet ? d.squareFeet.toLocaleString('en-US') : 'Not set'}</dd>
          {d.perSquareFoot?.price != null && <><dt className="text-gray-600 dark:text-slate-400">Price per sq ft</dt><dd>{money(d.perSquareFoot.price)}</dd></>}
          {d.perSquareFoot?.budget != null && <><dt className="text-gray-600 dark:text-slate-400">Budget per sq ft</dt><dd>{money(d.perSquareFoot.budget)}</dd></>}
          <dt className="text-gray-600 dark:text-slate-400">Builder&rsquo;s risk</dt>
          <dd>{p ? <>{p.carrier}{p.policyNumber ? ` · ${p.policyNumber}` : ''}{p.coverage != null ? ` · ${money(p.coverage)} cover` : ''}{p.endsOn ? <span className="block text-xs text-gray-600 dark:text-slate-400">{p.startsOn ? `${day(p.startsOn)} – ` : 'Until '}{day(p.endsOn)}</span> : null}</> : 'No policy recorded'}</dd>
          {d.policyStanding === 'ending_soon' && <dd className="col-span-2 text-sm font-medium text-amber-800 dark:text-amber-200">The policy ends within 30 days.</dd>}
          {d.policyStanding === 'ended' && <dd className="col-span-2 text-sm font-medium text-red-700 dark:text-red-300">The policy has ended and the project is still open.</dd>}
        </dl>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="pd-sqft" className={label}>Square feet</label><input id="pd-sqft" className={input} inputMode="numeric" value={form.squareFeet} onChange={(e) => setForm({ ...form, squareFeet: e.target.value })} /></div>
          <div><label htmlFor="pd-carrier" className={label}>Builder&rsquo;s risk insurer</label><input id="pd-carrier" className={input} value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="Leave empty for none" /></div>
          <div><label htmlFor="pd-policy" className={label}>Policy number</label><input id="pd-policy" className={input} value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></div>
          <div><label htmlFor="pd-cover" className={label}>Coverage</label><input id="pd-cover" className={input} inputMode="decimal" value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })} /></div>
          <div><label htmlFor="pd-start" className={label}>Starts</label><input id="pd-start" type="date" className={input} value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
          <div><label htmlFor="pd-end" className={label}>Ends</label><input id="pd-end" type="date" className={input} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
          <div className="flex gap-3 sm:col-span-2">
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-orange-700 px-3 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-700 hover:underline dark:text-slate-300">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
