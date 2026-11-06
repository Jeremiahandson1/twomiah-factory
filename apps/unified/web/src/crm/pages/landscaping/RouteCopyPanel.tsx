// Copy a route, and route templates, on the Route Board (landscaping parity row 28; Yardbook's copy route; route_copy, not ready):
//   · on an open route: Copy to… (a day and a name — a new route with the same stops in order, crew, start time, billing and season)
//     and Save as template;                       POST /api/recurring-routes/templates/copy/:routeId | /from/:routeId   (jobs:create)
//   · Route templates: each with Make a route (a day and a name) and Delete.
//                                                GET /api/recurring-routes/templates, POST …/:id/use, DELETE …/:id
// A route with priced stops is copied by a seat that may see money (the server says so otherwise).
import { useCallback, useEffect, useState } from 'react'
import { Copy, LayoutTemplate, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite, useAuth } from '../../../shared'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const made = (out: any) => `${out?.route?.name || 'Route'} made with ${out?.stops ?? 0} stop${out?.stops === 1 ? '' : 's'}${out?.leftOut ? ` — ${out.leftOut} left out (property deleted)` : ''}`

/** A day and a name, then the action. */
function DayAndName({ label, initialName, initialDay, onGo, busy }: { label: string; initialName: string; initialDay: number; onGo: (name: string, day: number) => void; busy: boolean }) {
  const [name, setName] = useState(initialName)
  const [day, setDay] = useState(initialDay)
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input className="input" aria-label="New route name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" aria-label="Day the new route runs" value={day} onChange={(e) => setDay(parseInt(e.target.value, 10))}>
        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>
      <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => onGo(name.trim(), day)}>{label}</button>
    </div>
  )
}

export function RouteCopyPanel({ route, onMade }: { route: { id: string; name: string; dayOfWeek?: number }; onMade: (routeId: string) => void }) {
  const toast = useToast()
  const on = useAuth().hasFeature('route_copy')
  const mayCreate = useMayWrite('jobs:create')
  const [open, setOpen] = useState<'copy' | 'template' | null>(null)
  const [tplName, setTplName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOpen(null); setTplName(`${route.name} template`) }, [route.id, route.name])
  if (!on || !mayCreate) return null
  const copy = async (name: string, dayOfWeek: number) => {
    setBusy(true)
    try {
      const out: any = await api.post(`/api/recurring-routes/templates/copy/${route.id}`, { name, dayOfWeek })
      toast.success(made(out)); setOpen(null); onMade(out.route.id)
    } catch (e) { toast.error(errorText(e, 'Could not copy the route')) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try {
      await api.post(`/api/recurring-routes/templates/from/${route.id}`, { name: tplName })
      toast.success('Saved as a template'); setOpen(null); window.dispatchEvent(new Event('route-templates-changed'))
    } catch (e) { toast.error(errorText(e, 'Could not save the template')) }
    finally { setBusy(false) }
  }
  return (
    <div className="mb-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary flex items-center gap-1" aria-expanded={open === 'copy'} onClick={() => setOpen(open === 'copy' ? null : 'copy')}><Copy className="w-4 h-4" /> Copy to…</button>
        <button className="btn-secondary flex items-center gap-1" aria-expanded={open === 'template'} onClick={() => setOpen(open === 'template' ? null : 'template')}><LayoutTemplate className="w-4 h-4" /> Save as template</button>
      </div>
      {open === 'copy' && (
        <div className="mt-2 rounded border border-gray-200 p-3 dark:border-slate-700">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">A new route with the same stops in order, crew, start time, billing and season. Its visits are made as for any new route.</p>
          <DayAndName label="Copy route" initialName={`${route.name} (copy)`} initialDay={route.dayOfWeek ?? 1} onGo={copy} busy={busy} />
        </div>
      )}
      {open === 'template' && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded border border-gray-200 p-3 dark:border-slate-700">
          <input className="input" aria-label="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <button className="btn-primary" disabled={busy || !tplName.trim()} onClick={save}>Save template</button>
        </div>
      )}
    </div>
  )
}

interface Template { id: string; name: string; stopCount: number; estimatedMinutes: number; startTime: string; weeklyRevenue?: number }

export function RouteTemplatesPanel({ onMade }: { onMade: (routeId: string) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const on = useAuth().hasFeature('route_copy')
  const mayCreate = useMayWrite('jobs:create')
  const mayDelete = useMayWrite('jobs:delete')
  const [rows, setRows] = useState<Template[]>([])
  const [using, setUsing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/recurring-routes/templates'); setRows(Array.isArray(r?.data) ? r.data : []) }
    catch (e) { toast.error(errorText(e, 'Could not load the route templates')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) return
    load()
    const again = () => { load() }
    window.addEventListener('route-templates-changed', again)
    return () => window.removeEventListener('route-templates-changed', again)
  }, [on, load])
  if (!on || rows.length === 0) return null
  const use = async (t: Template, name: string, dayOfWeek: number) => {
    setBusy(true)
    try {
      const out: any = await api.post(`/api/recurring-routes/templates/${t.id}/use`, { name, dayOfWeek })
      toast.success(made(out)); setUsing(null); onMade(out.route.id)
    } catch (e) { toast.error(errorText(e, 'Could not make the route')) }
    finally { setBusy(false) }
  }
  const remove = async (t: Template) => {
    if (!(await confirm('Routes already made from it stay as they are.', { title: `Delete the template “${t.name}”?`, confirmText: 'Delete template' }))) return
    try { await api.delete(`/api/recurring-routes/templates/${t.id}`); toast.success('Template deleted'); await load() }
    catch (e) { toast.error(errorText(e, 'Could not delete the template')) }
  }
  return (
    <div className="mb-6 rounded-lg border p-4 dark:border-slate-700">
      <p className="font-medium flex items-center gap-1 mb-2"><LayoutTemplate className="w-4 h-4" /> Route templates</p>
      <div className="space-y-2">
        {rows.map((t) => (
          <div key={t.id} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t.name} <span className="text-gray-500 dark:text-slate-400">· {t.stopCount} stop{t.stopCount === 1 ? '' : 's'} · {t.estimatedMinutes} min · crew leaves {t.startTime}</span></span>
              <span className="flex items-center gap-2">
                {mayCreate && <button className="btn-secondary" aria-expanded={using === t.id} onClick={() => setUsing(using === t.id ? null : t.id)}>Make a route</button>}
                {mayDelete && <button aria-label={`Delete template ${t.name}`} className="text-red-600 dark:text-red-400" onClick={() => remove(t)}><Trash2 className="w-4 h-4" /></button>}
              </span>
            </div>
            {using === t.id && <div className="mt-2"><DayAndName label="Make route" initialName={t.name.replace(/ template$/i, '')} initialDay={1} onGo={(n, d) => use(t, n, d)} busy={busy} /></div>}
          </div>
        ))}
      </div>
    </div>
  )
}
