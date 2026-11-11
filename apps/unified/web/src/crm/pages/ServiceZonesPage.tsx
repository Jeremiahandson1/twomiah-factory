// Settings › Service zones (parity tier 3, field service; server crm/field/serviceZones.ts, /api/service-zones; feature service_zones,
// not ready): the areas the business works in, each a list of ZIP codes. A job is in the zone of its ZIP; the Dispatch Board shows
// it and can show one zone at a time. Each zone can name its techs (the people who work there: Find a time offers them for a job in
// it, and the Dispatch Board's zone view shows their lanes) and a daily job limit (a job past it asks "check before you book").
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPinned, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Zone { id?: string; name: string; zips: string; color?: string; techIds: string[]; dailyLimit: string }
const fromServer = (z: any): Zone => ({ id: z.id, name: z.name, zips: z.zips.join(', '), color: z.color, techIds: z.techIds || [], dailyLimit: z.dailyLimit ? String(z.dailyLimit) : '' })
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export default function ServiceZonesPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    api.get('/api/service-zones').then((r: any) => setZones((r?.zones || []).map(fromServer)))
      .catch((e: Error) => setError(e.message || 'The zones could not be loaded.'))
    // The people who can be given work (the Dispatch Board's lanes), to name each zone's techs.
    api.get('/api/team/assignable').then((r: any) => setPeople((r?.data || []).map((p: any) => ({ id: p.id, name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || 'Unnamed' }))))
      .catch(() => setPeople([]))
  }, [])

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!zones) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true)
    try {
      const r: any = await api.put('/api/service-zones', { zones: zones.filter((z) => z.name.trim()).map((z) => ({ ...(z.id ? { id: z.id } : {}), name: z.name.trim(), zips: z.zips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean), ...(z.color ? { color: z.color } : {}), techIds: z.techIds, dailyLimit: z.dailyLimit.trim() ? Number(z.dailyLimit) : null })) })
      setZones((r?.zones || []).map(fromServer))
      toast.success('Zones saved')
    } catch (e: any) { toast.error(e?.message || 'The zones could not be saved.') } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MapPinned className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Service zones</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Name the areas you work in by their ZIP codes. A job is in the zone of its ZIP; the Dispatch Board shows each job&rsquo;s zone and can show one zone at a time. A ZIP belongs to one zone. Name the people who work each zone and Find a time offers them for its jobs; give it a daily limit and a job past it asks you to check before you book.</p>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 space-y-3" aria-label="Zones">
        {zones.length === 0 && <p className="text-sm text-gray-700 dark:text-slate-300">No zones yet.</p>}
        {zones.map((z, i) => {
          const set = (patch: Partial<Zone>) => setZones(zones.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div key={z.id ?? `new-${i}`} className="space-y-2 border-b border-gray-200 pb-4 last:border-0 dark:border-slate-700">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-3 inline-block h-3 w-3 rounded-full" style={{ background: z.color || '#4b5563' }} aria-hidden="true" />
                <input aria-label={`Zone ${i + 1} name`} className={`${input} w-40`} placeholder="e.g. North side" maxLength={60} value={z.name} disabled={!mayEdit} onChange={(e) => set({ name: e.target.value })} />
                <textarea aria-label={`Zone ${i + 1} ZIP codes`} className={`${input} min-w-[14rem] flex-1`} rows={2} placeholder="53703, 53704, 53705" value={z.zips} disabled={!mayEdit} onChange={(e) => set({ zips: e.target.value })} />
                {mayEdit && <button type="button" aria-label={`Remove zone ${i + 1}`} className="mt-2 p-1 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200" onClick={() => setZones(zones.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-5 text-sm text-gray-700 dark:text-slate-300">
                <label htmlFor={`zone-${i}-limit`}>Jobs a day, at most</label>
                <input id={`zone-${i}-limit`} type="number" min={1} max={500} inputMode="numeric" className={`${input} w-24`} placeholder="No limit" value={z.dailyLimit} disabled={!mayEdit} onChange={(e) => set({ dailyLimit: e.target.value.replace(/[^0-9]/g, '') })} />
              </div>
              {people.length > 0 && (
                <fieldset className="pl-5">
                  <legend className="text-sm text-gray-700 dark:text-slate-300">Who works {z.name.trim() || 'this zone'}</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {people.map((p) => (
                      <label key={p.id} className="inline-flex items-center gap-1.5 text-sm text-gray-900 dark:text-slate-100">
                        <input type="checkbox" checked={z.techIds.includes(p.id)} disabled={!mayEdit} onChange={(e) => set({ techIds: e.target.checked ? [...z.techIds, p.id] : z.techIds.filter((x) => x !== p.id) })} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )
        })}
        {mayEdit && (
          <div className="flex flex-wrap gap-4">
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300" onClick={() => setZones([...zones, { name: '', zips: '', techIds: [], dailyLimit: '' }])}><Plus className="h-4 w-4" />Add a zone</button>
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </section>
    </div>
  )
}
