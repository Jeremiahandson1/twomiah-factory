// Storm mode on the Snow & Ice page: start a storm, send every contract on a route (or tag, or all of them) out at once, log the
// whole route with one set of figures, bill the storm, end it. The crews log their own stops from "Today's route" on the phone.
// Same asks as the server (/api/snow/storms): jobs:dispatch to start and send out, invoices:create to bill; the money columns
// only show for a seat that may read invoices.
import { useEffect, useRef, useState } from 'react'
import { CloudSnow, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite, useAuth } from '../../../shared'
import { money } from '@twomiah/tenant-ui/src/money'

interface Storm { id: string; name: string; status: string; stops: number; done: number; open: number; skipped: number; earned?: number; unbilled?: number }
interface Stop {
  id: string; siteName: string; status: string; billingMode: string
  event: null | { pushes: number; snowfallInches: string | number; saltApplied: boolean; hours: string | number; billableAmount?: string | number }
}
interface BillLine { contractId: string; siteName: string | null; visits: number; total: number; skip?: string; invoiceNumber?: string }

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const today = () => new Date().toLocaleDateString('en-CA')

export default function SnowStormPanel({ onBilled }: { onBilled: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const mayRun = useMayWrite('jobs:dispatch') && useMayWrite('jobs:create')
  const mayLog = useMayWrite('jobs:update')
  const mayBill = useMayWrite('invoices:create')
  const [storms, setStorms] = useState<Storm[]>([])
  const [loading, setLoading] = useState(true)
  const [routes, setRoutes] = useState<Array<{ id: string; name: string }>>([])
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([])
  const [name, setName] = useState('')
  const [to, setTo] = useState<'route' | 'tag' | 'all'>('route')
  const [routeId, setRouteId] = useState('')
  const [tag, setTag] = useState('')
  const [crewId, setCrewId] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [fig, setFig] = useState({ pushes: '1', snowfallInches: '', saltApplied: false, hours: '', saltQuantity: '' })
  const [bill, setBill] = useState<{ lines: BillLine[]; invoices: number; total: number } | null>(null)
  const billRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (bill) billRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [bill])
  // Rows 25 and 30 (snow_tools, not ready): the snowfall expected, the forecast's proposals, starting on its own, the storm text.
  const tools = useAuth().hasFeature('snow_tools')
  const mayText = useMayWrite('sms:send')
  const [expected, setExpected] = useState('')
  const [proposals, setProposals] = useState<Array<{ date: string; summary: string; snowInches: number; contracts: number; contractIds: string[] }>>([])
  const [autoStart, setAutoStart] = useState<boolean | null>(null)
  const [textPreview, setTextPreview] = useState<null | { stormId: string; willText: number; preview: Array<{ name: string; body: string }>; skipped: Array<{ name: string; reason: string }> }>(null)
  useEffect(() => {
    if (!tools || !mayRun) return
    api.get('/api/snow/storms/forecast').then((r: any) => setProposals(Array.isArray(r?.data) ? r.data.filter((d: any) => d.contracts > 0) : [])).catch(() => setProposals([]))
    api.get('/api/snow/storms/settings').then((r: any) => setAutoStart(!!(r?.data ?? r)?.autoStart)).catch(() => setAutoStart(null))
  }, [tools, mayRun])
  const startFromForecast = async (p: { date: string; snowInches: number; contractIds: string[] }) => {
    setBusy(true)
    try {
      const r = await api.post('/api/snow/storms', { name: `Snow ${p.date}`, target: { contractIds: p.contractIds }, date: p.date, expectedInches: p.snowInches, source: 'forecast' }) as any
      const out = r?.data ?? r
      toast.success(`Storm started from the forecast — ${out.made ?? 0} contract${out.made === 1 ? '' : 's'} sent out`)
      await load(); if (out.storm?.id) await openStorm(out.storm.id)
    } catch (e) { toast.error(errorText(e, 'Could not start the storm')) } finally { setBusy(false) }
  }
  const changeAutoStart = async (on: boolean) => {
    try { await api.put('/api/snow/storms/settings', { autoStart: on }); setAutoStart(on) } catch (e) { toast.error(errorText(e, 'Could not save that')) }
  }
  const previewText = async (stormId: string) => {
    try { const r = await api.post(`/api/snow/storms/${stormId}/notify`, {}) as any; setTextPreview({ stormId, ...(r?.data ?? r) }) } catch (e) { toast.error(errorText(e, 'Could not get the texts ready')) }
  }
  const sendText = async () => {
    if (!textPreview) return
    try { const r = await api.post(`/api/snow/storms/${textPreview.stormId}/notify`, { dryRun: false }) as any; toast.success(`${(r?.data ?? r).queued} customer text${(r?.data ?? r).queued === 1 ? '' : 's'} queued`); setTextPreview(null) }
    catch (e) { toast.error(errorText(e, 'The texts were not sent')) }
  }

  const load = async () => {
    try { const r = await api.get('/api/snow/storms') as any; setStorms(Array.isArray(r?.data) ? r.data : []) }
    catch { setStorms([]) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!mayRun) return
    api.get('/api/recurring-routes').then((r: any) => setRoutes(Array.isArray(r?.data) ? r.data : [])).catch(() => setRoutes([]))
    api.get('/api/team/assignable').then((r: any) => setTeam(r?.data || (Array.isArray(r) ? r : []))).catch(() => setTeam([]))
  }, [mayRun])

  const openStorm = async (id: string) => {
    setOpenId(id); setBill(null)
    try { const r = await api.get(`/api/snow/storms/${id}`) as any; setStops((r?.data ?? r)?.stops ?? []) } catch { setStops([]) }
  }
  const refresh = async (id: string) => { await load(); await openStorm(id) }

  const start = async () => {
    if (!name.trim()) { toast.error('Name the storm first'); return }
    const target = to === 'route' ? { routeId } : to === 'tag' ? { tag: tag.trim() } : { all: true }
    if (to === 'route' && !routeId) { toast.error('Pick the route'); return }
    if (to === 'tag' && !tag.trim()) { toast.error('Type the customer tag'); return }
    setBusy(true)
    try {
      const r = await api.post('/api/snow/storms', { name: name.trim(), target, date, assignedToId: crewId || undefined, ...(tools && expected !== '' ? { expectedInches: Number(expected) } : {}) }) as any
      const out = r?.data ?? r
      toast.success(out.made ? `Storm started — ${out.made} contract${out.made === 1 ? '' : 's'} sent out` : 'Storm started — no active contracts matched')
      setName(''); await load(); if (out.storm?.id) await openStorm(out.storm.id)
    } catch (e) { toast.error(errorText(e, 'Could not start the storm')) } finally { setBusy(false) }
  }

  const logAll = async (id: string) => {
    if (!(await confirm('Every stop still open gets these figures. A stop that cannot take them stays open and is listed.', { title: 'Log the whole storm?', confirmText: 'Log them all', danger: false }))) return
    setBusy(true)
    try {
      const r = await api.post(`/api/snow/storms/${id}/log-all`, fig) as any
      const out = r?.data ?? r
      toast.success(`Logged ${out.logged.length}${out.failed.length ? ` — ${out.failed.length} left open: ${out.failed.map((f: any) => f.siteName).join(', ')}` : ''}`)
      await refresh(id)
    } catch (e) { toast.error(errorText(e, 'Could not log the storm')) } finally { setBusy(false) }
  }

  const previewBill = async (id: string) => {
    setBusy(true)
    try { const r = await api.post(`/api/snow/storms/${id}/bill`, {}) as any; setBill(r?.data ?? r) }
    catch (e) { toast.error(errorText(e, 'Could not work out the bill')) } finally { setBusy(false) }
  }
  const runBill = async (id: string) => {
    if (!bill) return
    if (!(await confirm(`${bill.invoices} draft invoice${bill.invoices === 1 ? '' : 's'}, ${money(bill.total)} in all — one per contract, this storm's visits only. Review and send them from Invoices.`, { title: 'Bill this storm?', confirmText: 'Create drafts', danger: false }))) return
    setBusy(true)
    try {
      const r = await api.post(`/api/snow/storms/${id}/bill`, { confirm: true }) as any
      const out = r?.data ?? r
      toast.success(`${out.invoices} draft invoice${out.invoices === 1 ? '' : 's'} created`)
      setBill(null); await refresh(id); onBilled()
    } catch (e) { toast.error(errorText(e, 'Could not bill the storm')) } finally { setBusy(false) }
  }

  const end = async (id: string) => {
    if (!(await confirm('Stops nobody served are skipped and leave the crews\' lists. Visits already logged stay, ready to bill.', { title: 'End this storm?', confirmText: 'End storm' }))) return
    try { await api.post(`/api/snow/storms/${id}/end`, {}); toast.success('Storm ended'); await refresh(id) }
    catch (e) { toast.error(errorText(e, 'Could not end the storm')) }
  }

  if (loading) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin" /></div>
  if (!mayRun && !storms.length) return null
  const current = storms.find((s) => s.id === openId)

  return (
    <section className="mb-6 rounded-lg border bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Storms">
      <h2 className="font-semibold flex items-center gap-2 mb-1"><CloudSnow className="w-5 h-5" /> Storms</h2>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Start a storm and send every contract on a route (or tag) out at once. Crews see their stops on Today&apos;s route and log pushes, salt and hours from the phone; bill the whole storm when it is done.</p>

      {tools && mayRun && (proposals.length > 0 || autoStart !== null) && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30" data-testid="snow-forecast">
          {proposals.map((p) => (
            <div key={p.date} className="flex flex-wrap items-center justify-between gap-2">
              <span><strong>{p.snowInches} in</strong> of snow forecast for {p.date} ({p.summary}) — {p.contracts} contract{p.contracts === 1 ? '' : 's'} reach their trigger.</span>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => startFromForecast(p)}>Start this storm</button>
            </div>
          ))}
          {autoStart !== null && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={autoStart} onChange={(e) => changeAutoStart(e.target.checked)} /> Start a storm on its own when the day's forecast reaches a contract's trigger</label>}
        </div>
      )}
      {mayRun && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <label className="text-xs text-gray-600 dark:text-slate-400 col-span-2">Storm name
            <input className="input w-full mt-1" aria-label="Storm name" placeholder="Dec 14 storm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-xs text-gray-600 dark:text-slate-400">Send to
            <select className="input w-full mt-1" aria-label="Send to" value={to} onChange={(e) => setTo(e.target.value as any)}>
              <option value="route">A route</option><option value="tag">A customer tag</option><option value="all">Every active contract</option>
            </select>
          </label>
          {to === 'route' && (
            <label className="text-xs text-gray-600 dark:text-slate-400">Route
              <select className="input w-full mt-1" aria-label="Route" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                <option value="">Pick a route…</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          {to === 'tag' && (
            <label className="text-xs text-gray-600 dark:text-slate-400">Tag
              <input className="input w-full mt-1" aria-label="Customer tag" placeholder="snow-north" value={tag} onChange={(e) => setTag(e.target.value)} />
            </label>
          )}
          {to === 'all' && <span />}
          <label className="text-xs text-gray-600 dark:text-slate-400">Crew
            <select className="input w-full mt-1" aria-label="Crew" value={crewId} onChange={(e) => setCrewId(e.target.value)}>
              <option value="">{to === 'route' ? "The route's crew" : 'Unassigned'}</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600 dark:text-slate-400">Day
            <input className="input w-full mt-1" aria-label="Day" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {tools && <label className="text-xs text-gray-600 dark:text-slate-400">Snow expected (in)
            <input className="input w-full mt-1" aria-label="Snow expected in inches" type="number" min={0} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>}
          <button onClick={start} disabled={busy} className="btn-primary md:col-span-2 self-end disabled:opacity-50">{busy ? 'Starting…' : 'Start storm and send out'}</button>
        </div>
      )}

      <div className="space-y-2">
        {storms.map((s) => (
          <div key={s.id} className={`rounded-lg border p-3 dark:border-slate-700 ${openId === s.id ? 'ring-2 ring-orange-500' : ''}`}>
            <button className="w-full text-left flex justify-between gap-3 flex-wrap" onClick={() => (openId === s.id ? setOpenId(null) : openStorm(s.id))} aria-expanded={openId === s.id}>
              <span className="font-medium">{s.name} <span className="text-xs font-normal text-gray-500 dark:text-slate-400">· {s.status === 'active' ? 'going' : 'ended'}</span></span>
              <span className="text-xs text-gray-600 dark:text-slate-400">{s.done} of {s.stops} done{s.open ? ` · ${s.open} open` : ''}{s.skipped ? ` · ${s.skipped} skipped` : ''}{s.unbilled != null ? ` · ${money(s.unbilled)} to bill` : ''}</span>
            </button>
            {openId === s.id && current && (
              <div className="mt-3">
                <div className="divide-y dark:divide-slate-700 text-sm">
                  {stops.map((p) => (
                    <div key={p.id} className="py-1.5 flex justify-between gap-2">
                      <span>{p.siteName}</span>
                      <span className="text-gray-600 dark:text-slate-400">
                        {p.event ? [Number(p.event.pushes) > 0 ? `${p.event.pushes} push` : '', Number(p.event.hours) > 0 ? `${Number(p.event.hours)} h` : '', p.event.saltApplied ? 'salt' : '', p.event.billableAmount != null ? money(Number(p.event.billableAmount)) : ''].filter(Boolean).join(' · ') : p.status}
                      </span>
                    </div>
                  ))}
                  {!stops.length && <p className="py-2 text-gray-500 dark:text-slate-400">No contracts were sent out in this storm.</p>}
                </div>
                {current.status === 'active' && mayRun && mayLog && current.open > 0 && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                    <label className="text-xs text-gray-600 dark:text-slate-400">Pushes<input className="input w-full mt-1" type="number" aria-label="Pushes for all" value={fig.pushes} onChange={(e) => setFig({ ...fig, pushes: e.target.value })} /></label>
                    <label className="text-xs text-gray-600 dark:text-slate-400">Snowfall (in)<input className="input w-full mt-1" type="number" aria-label="Snowfall for all" value={fig.snowfallInches} onChange={(e) => setFig({ ...fig, snowfallInches: e.target.value })} /></label>
                    <label className="text-xs text-gray-600 dark:text-slate-400">Hours (hourly contracts)<input className="input w-full mt-1" type="number" aria-label="Hours for all" value={fig.hours} onChange={(e) => setFig({ ...fig, hours: e.target.value })} /></label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fig.saltApplied} onChange={(e) => setFig({ ...fig, saltApplied: e.target.checked })} /> Salt</label>
                    {/* Salt by amount, for the contracts that count it (bags, tons…); a flat-salt contract reads only the tick. */}
                    <label className="text-xs text-gray-600 dark:text-slate-400">Salt amount (contracts that count it)<input className="input w-full mt-1" type="number" min="0" step="0.25" aria-label="Salt amount for all" value={fig.saltQuantity} onChange={(e) => setFig({ ...fig, saltQuantity: e.target.value })} /></label>
                    <button className="btn-secondary" disabled={busy} onClick={() => logAll(s.id)}>Log all open stops</button>
                  </div>
                )}
                <div className="mt-3 flex gap-2 flex-wrap">
                  {mayBill && <button className="btn-primary btn-sm" disabled={busy} onClick={() => previewBill(s.id)}>Bill this storm…</button>}
                  {s.status === 'active' && mayRun && <button className="btn-secondary btn-sm" onClick={() => end(s.id)}>End storm</button>}
                  {tools && mayRun && mayText && <button className="btn-secondary btn-sm" onClick={() => previewText(s.id)}>Text the customers…</button>}
                  {textPreview?.stormId === s.id && (
                    <div className="mt-2 w-full rounded border p-2 text-xs dark:border-slate-700">
                      <p>{textPreview.willText} customer{textPreview.willText === 1 ? '' : 's'} will be texted{textPreview.skipped.length ? `; not: ${textPreview.skipped.map((x) => `${x.name} (${x.reason === 'opted_out' ? 'opted out' : 'no phone'})`).join(', ')}` : ''}.</p>
                      {textPreview.preview[0] && <p className="mt-1 italic">“{textPreview.preview[0].body}”</p>}
                      <div className="mt-2 flex gap-2"><button className="btn-primary btn-sm" disabled={!textPreview.willText} onClick={sendText}>Send</button><button className="btn-secondary btn-sm" onClick={() => setTextPreview(null)}>Cancel</button></div>
                    </div>
                  )}
                </div>
                {bill && (
                  // Brought into view when it opens: low on the page it opened below the screen and the click looked dead (re-check 11/08).
                  <div ref={billRef} className="mt-3 rounded-lg border p-3 text-sm dark:border-slate-700">
                    {bill.lines.length === 0 ? <p>Nothing to bill — every visit in this storm is already billed.</p> : (
                      <>
                        {bill.lines.map((l) => (
                          <div key={l.contractId} className="flex justify-between gap-2 py-0.5">
                            <span>{l.siteName}</span>
                            <span className={l.skip ? 'text-amber-700 dark:text-amber-300' : ''}>{l.skip ?? `${l.visits} visit${l.visits === 1 ? '' : 's'} · ${money(l.total)}`}</span>
                          </div>
                        ))}
                        {bill.invoices > 0 && <button className="btn-primary btn-sm mt-2" disabled={busy} onClick={() => runBill(s.id)}>Create {bill.invoices} draft invoice{bill.invoices === 1 ? '' : 's'} — {money(bill.total)}</button>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!storms.length && <p className="text-sm text-gray-500 dark:text-slate-400">No storms yet.</p>}
      </div>
    </section>
  )
}
