// Settings › Service zones (parity tier 3, field service; server crm/field/serviceZones.ts, /api/service-zones; feature service_zones,
// not ready): the areas the business works in, each a list of ZIP codes. A job is in the zone of its ZIP; the Dispatch Board shows
// it and can show one zone at a time.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPinned, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Zone { id?: string; name: string; zips: string; color?: string }
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export default function ServiceZonesPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/api/service-zones').then((r: any) => setZones((r?.zones || []).map((z: any) => ({ id: z.id, name: z.name, zips: z.zips.join(', '), color: z.color }))))
      .catch((e: Error) => setError(e.message || 'The zones could not be loaded.'))
  }, [])

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!zones) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true)
    try {
      const r: any = await api.put('/api/service-zones', { zones: zones.filter((z) => z.name.trim()).map((z) => ({ ...(z.id ? { id: z.id } : {}), name: z.name.trim(), zips: z.zips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean), ...(z.color ? { color: z.color } : {}) })) })
      setZones((r?.zones || []).map((z: any) => ({ id: z.id, name: z.name, zips: z.zips.join(', '), color: z.color })))
      toast.success('Zones saved')
    } catch (e: any) { toast.error(e?.message || 'The zones could not be saved.') } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MapPinned className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Service zones</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Name the areas you work in by their ZIP codes. A job is in the zone of its ZIP; the Dispatch Board shows each job&rsquo;s zone and can show one zone at a time. A ZIP belongs to one zone.</p>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 space-y-3" aria-label="Zones">
        {zones.length === 0 && <p className="text-sm text-gray-700 dark:text-slate-300">No zones yet.</p>}
        {zones.map((z, i) => (
          <div key={z.id ?? `new-${i}`} className="flex flex-wrap items-start gap-2">
            <span className="mt-3 inline-block h-3 w-3 rounded-full" style={{ background: z.color || '#4b5563' }} aria-hidden="true" />
            <input aria-label={`Zone ${i + 1} name`} className={`${input} w-40`} placeholder="e.g. North side" maxLength={60} value={z.name} disabled={!mayEdit} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <textarea aria-label={`Zone ${i + 1} ZIP codes`} className={`${input} min-w-[14rem] flex-1`} rows={2} placeholder="53703, 53704, 53705" value={z.zips} disabled={!mayEdit} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, zips: e.target.value } : x)))} />
            {mayEdit && <button type="button" aria-label={`Remove zone ${i + 1}`} className="mt-2 p-1 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200" onClick={() => setZones(zones.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {mayEdit && (
          <div className="flex flex-wrap gap-4">
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300" onClick={() => setZones([...zones, { name: '', zips: '' }])}><Plus className="h-4 w-4" />Add a zone</button>
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </section>
    </div>
  )
}
