// Canvass territories at /crm/territories (canvass_territories — not ready): areas drawn on the map and given to the reps who
// knock them. Server: server/crm/roof/field/territories.ts (/api/territories). The office (canvassing:manage) draws, names,
// colours and assigns; a rep sees only the territories they are on; the read-only seat sees all and changes none.
//
// Like Spotio's, a territory does not fence anyone in — a door can still be logged outside it. The stats are the doors and
// leads logged inside it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPinned, Pentagon, Circle as CircleIcon, Plus, Trash2, Undo2 } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { listOf } from './http'
import ShapeMap, { type DrawnArea, type LatLng, type Shape } from './ShapeMap'

interface Rep { id: string; name: string }
interface Territory { id: string; name: string; color: string; boundary: Shape | null; zips: string[]; notes: string | null; reps: Rep[]; stormEventId: string | null }
interface Stats { doorsKnocked: number; leads: number; byOutcome: Record<string, number>; pastCustomers: number | null }
interface Person { id: string; name: string; role: string }

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2']

export default function TerritoriesPage() {
  const mayManage = useMayWrite('canvassing:manage')
  const toast = useToast()
  const confirm = useConfirm()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [rows, setRows] = useState<Territory[]>([])
  const [team, setTeam] = useState<Person[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // The form (new territory)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [zips, setZips] = useState('')
  const [mode, setMode] = useState<'off' | 'polygon' | 'circle'>('off')
  const [corners, setCorners] = useState<LatLng[]>([])
  const [centre, setCentre] = useState<LatLng | null>(null)
  const [radius, setRadius] = useState('1')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try { setRows(listOf<Territory>(await api.get('/api/territories'))) }
    catch (e) { toastRef.current.error(errorText(e, 'Could not load the territories')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!mayManage) return
    api.get('/api/territories/reps').then((r) => setTeam(listOf<Person>(r))).catch(() => setTeam([]))
  }, [mayManage])
  useEffect(() => {
    setStats(null)
    if (!openId) return
    api.get(`/api/territories/${encodeURIComponent(openId)}`).then((r: { stats: Stats }) => setStats(r.stats)).catch(() => setStats(null))
  }, [openId])

  const draft: Shape | null = mode === 'polygon' ? { kind: 'polygon', points: corners }
    : mode === 'circle' && centre ? { kind: 'circle', lat: centre[0], lng: centre[1], radiusMiles: Math.max(0.1, Number(radius) || 0.1) } : null
  const drawn: Shape | null = (mode === 'polygon' && corners.length >= 3) || (mode === 'circle' && centre && Number(radius) > 0) ? draft : null
  const zipList = zips.split(/[\s,]+/).filter(Boolean)

  const areas: DrawnArea[] = useMemo(() => rows.filter((t) => t.boundary).map((t) => ({ id: t.id, shape: t.boundary as Shape, color: t.color, label: t.name })), [rows])

  const reset = () => { setCreating(false); setName(''); setZips(''); setMode('off'); setCorners([]); setCentre(null); setPicked(new Set()) }
  const pick = (lat: number, lng: number) => {
    if (mode === 'polygon') setCorners((c) => [...c, [lat, lng]])
    else if (mode === 'circle') setCentre([lat, lng])
  }
  const create = async () => {
    setBusy(true)
    try {
      await api.post('/api/territories', { name, color, ...(drawn ? { boundary: drawn } : {}), ...(zipList.length ? { zips: zipList } : {}), repIds: [...picked] })
      toast.success('Territory saved')
      reset()
      await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the territory')) } finally { setBusy(false) }
  }
  const setReps = async (t: Territory, repId: string, on: boolean) => {
    const next = new Set(t.reps.map((r) => r.id))
    if (on) next.add(repId); else next.delete(repId)
    try { await api.put(`/api/territories/${encodeURIComponent(t.id)}/reps`, { repIds: [...next] }); await load() }
    catch (e) { toast.error(errorText(e, 'Could not change the reps')) }
  }
  const remove = async (t: Territory) => {
    if (!(await confirm(`Delete territory "${t.name}"? The doors knocked in it and the reps stay as they are.`, { title: 'Delete territory', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/territories/${encodeURIComponent(t.id)}`); setOpenId(null); await load() }
    catch (e) { toast.error(errorText(e, 'Could not delete the territory')) }
  }

  const open = rows.find((t) => t.id === openId) || null

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPinned size={24} /> Canvass Territories</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{mayManage ? 'Draw an area, give it to the reps who knock it. Nobody is fenced in — a door outside is still logged.' : 'The areas you are sent to knock.'}</p>
        </div>
        {mayManage && !creating && <button onClick={() => setCreating(true)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm inline-flex items-center gap-1"><Plus size={16} /> New territory</button>}
      </div>

      {creating && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Name<input value={name} onChange={(e) => setName(e.target.value)} className="block border rounded-lg px-3 py-2 w-64 bg-white dark:bg-slate-900" maxLength={120} /></label>
            <div className="text-sm">Colour
              <div className="flex gap-1 mt-1">{COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-black dark:border-white' : 'border-transparent'}`} style={{ background: c }} />)}</div>
            </div>
            <label className="text-sm">Zips (optional)<input value={zips} onChange={(e) => setZips(e.target.value)} placeholder="54701, 54703" className="block border rounded-lg px-3 py-2 w-56 bg-white dark:bg-slate-900" /></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'off' ? (
              <>
                <button onClick={() => setMode('polygon')} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><Pentagon size={16} /> Draw the area</button>
                <button onClick={() => setMode('circle')} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><CircleIcon size={16} /> Circle</button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-600 dark:text-slate-300">{mode === 'polygon' ? `Click the corners on the map (${corners.length} so far).` : centre ? 'Centre set.' : 'Click the centre on the map.'}</span>
                {mode === 'circle' && <label className="text-sm inline-flex items-center gap-1">Radius<input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" className="border rounded px-2 py-1 w-16 bg-white dark:bg-slate-900" /> miles</label>}
                {mode === 'polygon' && <button onClick={() => setCorners((c) => c.slice(0, -1))} disabled={!corners.length} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><Undo2 size={16} /> Undo</button>}
                <button onClick={() => { setMode('off'); setCorners([]); setCentre(null) }} className="px-3 py-2 rounded-lg border text-sm">Clear</button>
              </>
            )}
          </div>
          <fieldset className="text-sm"><legend className="font-medium">Reps</legend>
            <div className="flex flex-wrap gap-3 mt-1">
              {team.map((p) => (
                <label key={p.id} className="inline-flex items-center gap-1"><input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} /> {p.name}</label>
              ))}
              {team.length === 0 && <span className="text-gray-500">No one on the team yet.</span>}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button onClick={create} disabled={busy || !name.trim() || (!drawn && zipList.length === 0)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">Save territory</button>
            <button onClick={reset} className="px-3 py-2 rounded-lg border text-sm">Cancel</button>
            {!drawn && zipList.length === 0 && <span className="text-sm text-gray-500 self-center">Draw the area or list the zips it covers.</span>}
          </div>
        </div>
      )}

      <ShapeMap areas={areas} draft={draft} drawing={creating && mode !== 'off'} onPick={pick} onAreaClick={(id) => setOpenId(id)} fit={mode === 'off'} className="h-96" />

      {loading ? <p className="text-gray-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">{mayManage ? 'No territories yet. Draw one around a storm or a neighbourhood.' : 'You have not been given a territory yet.'}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((t) => (
            <li key={t.id} className={`rounded-lg border p-3 ${openId === t.id ? 'ring-2 ring-blue-500' : ''}`}>
              <button className="w-full text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-expanded={openId === t.id}>
                <div className="flex items-center gap-2 font-medium"><span className="w-3 h-3 rounded-full" style={{ background: t.color }} /> {t.name}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  {t.boundary ? (t.boundary.kind === 'circle' ? `Circle, ${t.boundary.radiusMiles} mi` : `Drawn, ${t.boundary.points.length} corners`) : ''}{t.boundary && t.zips.length ? ' · ' : ''}{t.zips.length ? `Zips ${t.zips.join(', ')}` : ''}
                </div>
                <div className="text-xs mt-1">{t.reps.length ? t.reps.map((r) => r.name).join(', ') : 'No reps yet'}</div>
              </button>
              {openId === t.id && (
                <div className="mt-3 border-t pt-3 text-sm space-y-2">
                  {stats ? (
                    <div className="flex flex-wrap gap-4">
                      <span><strong>{stats.doorsKnocked}</strong> doors knocked</span>
                      <span><strong>{stats.leads}</strong> leads</span>
                      {stats.pastCustomers !== null && <span><strong>{stats.pastCustomers}</strong> past customers inside</span>}
                    </div>
                  ) : <span className="text-gray-500">Counting…</span>}
                  {open && mayManage && (
                    <>
                      <div className="flex flex-wrap gap-3">
                        {team.map((p) => (
                          <label key={p.id} className="inline-flex items-center gap-1"><input type="checkbox" checked={open.reps.some((r) => r.id === p.id)} onChange={(e) => setReps(open, p.id, e.target.checked)} /> {p.name}</label>
                        ))}
                      </div>
                      <button onClick={() => remove(open)} className="inline-flex items-center gap-1 text-red-600 text-sm"><Trash2 size={14} /> Delete territory</button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
