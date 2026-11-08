// Visit optimizer (row 15, care_visit_optimizer): fill many open visits at once, as AlayaCare's Visit Optimizer does. Pick the
// visits (dates, optionally one client), say how much each objective matters, run it, review the proposed caregiver for each
// visit (with the next best), then assign the ticked ones — or offer them to the proposed caregivers.
//   GET|PUT /api/visit-optimizer/settings   POST /api/visit-optimizer/run   POST /api/visit-optimizer/assign
//   POST /api/open-shifts/:id/notify { caregiverIds }   (offering; server/crm/homecare/scheduling/{visitOptimizer,openShifts}.ts)
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatAgencyDate } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

type Objective = 'travel' | 'continuity' | 'skills' | 'waitTime' | 'dailyHours' | 'weeklyHours'
interface Scored { caregiverId: string; name: string; total: number; travelMinutes: number; continuityVisits: number; waitMinutes: number | null; dayHours: number; weekHours: number; reasons: string[] }
interface Proposal { shift: { id: string; client: string; date: string; startTime: string; endTime: string }; best: Scored | null; alternatives: Scored[]; unfilledBecause: string[] }
interface Client { id: string; firstName: string; lastName: string }

const WEIGHT_WORDS = ['Ignore', 'A little', 'Matters', 'Matters most']
const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const muted = 'text-xs text-gray-600 dark:text-slate-400'
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function VisitOptimizer() {
  const may = useMay('care-schedule')
  const toast = useToast()
  const [objectives, setObjectives] = useState<{ key: Objective; label: string }[]>([])
  const [weights, setWeights] = useState<Record<Objective, number> | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [range, setRange] = useState(() => { const t = new Date(); const e = new Date(); e.setDate(t.getDate() + 7); return { startDate: ymd(t), endDate: ymd(e), clientId: '' } })
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})        // shiftId → caregiverId ('' = leave)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/api/visit-optimizer/settings').then((r: any) => { setObjectives(r.objectives); setWeights(r.weights) }).catch((e) => toast.error(errorMessage(e, 'Could not load the optimizer')))
    listAll('/api/clients').then((r) => setClients(rows<Client>(r))).catch(() => { /* the filter works without the list */ })
  }, [toast])

  const run = useCallback(async () => {
    if (!weights) return
    setBusy(true)
    try {
      const r: any = await api.post('/api/visit-optimizer/run', { ...range, clientId: range.clientId || undefined, weights })
      setProposals(r.proposals)
      setChoice(Object.fromEntries((r.proposals as Proposal[]).map((p) => [p.shift.id, p.best?.caregiverId ?? ''])))
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }, [range, weights, toast])

  const saveWeights = async () => {
    if (!weights) return
    try { await api.put('/api/visit-optimizer/settings', { weights }); toast.success('Saved as your agency’s settings') }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const chosen = Object.entries(choice).filter(([, cg]) => cg)
  const assign = async () => {
    setBusy(true)
    try {
      const r: any = await api.post('/api/visit-optimizer/assign', { assignments: chosen.map(([shiftId, caregiverId]) => ({ shiftId, caregiverId })) })
      const refused = (r.results as any[]).filter((x) => x.status === 'refused')
      toast.success(`${r.assigned} visit${r.assigned === 1 ? '' : 's'} assigned`)
      if (refused.length) toast.error(`${refused.length} not assigned: ${refused.map((x) => x.reason).join('; ')}`)
      run()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  const offer = async () => {
    setBusy(true)
    let told = 0, failed = 0
    for (const [shiftId] of chosen) {
      const p = proposals?.find((x) => x.shift.id === shiftId)
      const ids = [p?.best, ...(p?.alternatives ?? [])].filter(Boolean).map((x) => x!.caregiverId)
      try { await api.post(`/api/open-shifts/${shiftId}/notify`, { caregiverIds: ids }); told++ } catch { failed++ }
    }
    setBusy(false)
    toast.success(`${told} visit${told === 1 ? '' : 's'} offered to the proposed caregivers`)
    if (failed) toast.error(`${failed} could not be offered`)
  }

  return (
    <div className="p-4 max-w-6xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Visit optimizer</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">Fill many open visits at once. Choose the visits, say what matters, review who is proposed for each, then assign or offer them. Nothing changes until you assign.</p>

      <div className="rounded-lg border p-3 mb-3 border-gray-200 dark:border-slate-700">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-sm">From<br /><input type="date" className={inp} value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} /></label>
          <label className="text-sm">To<br /><input type="date" className={inp} value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} /></label>
          <label className="text-sm">Client<br />
            <select className={inp} value={range.clientId} onChange={(e) => setRange({ ...range, clientId: e.target.value })}>
              <option value="">Every client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </label>
        </div>
        {weights && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-3">
            {objectives.map((o) => (
              <label key={o.key} className="text-sm">{o.label}
                <select className={`${inp} w-full`} value={weights[o.key]} onChange={(e) => setWeights({ ...weights, [o.key]: Number(e.target.value) })}>
                  {WEIGHT_WORDS.map((w, i) => <option key={i} value={i}>{w}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={busy || !weights} onClick={run}>{busy ? 'Working…' : 'Find the best caregivers'}</button>
          {may.update && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={!weights} onClick={saveWeights}>Save these settings</button>}
        </div>
      </div>

      {proposals && (proposals.length === 0
        ? <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No open visits in those dates.</div>
        : (<>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm"><b>{proposals.filter((p) => p.best).length}</b> of {proposals.length} visits have a proposal · <b>{chosen.length}</b> chosen</span>
            {may.update && <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={busy || !chosen.length} onClick={assign}>Assign the chosen</button>}
            {may.update && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={busy || !chosen.length} onClick={offer}>Offer them instead</button>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Visit</th><th>Proposed caregiver</th><th>Travel</th><th>Visits with client</th><th>Hours that day / week</th></tr></thead>
              <tbody>
                {proposals.map((p) => {
                  const options = [p.best, ...p.alternatives].filter(Boolean) as Scored[]
                  const pick = options.find((x) => x.caregiverId === choice[p.shift.id]) ?? null
                  return (
                    <tr key={p.shift.id} className="border-t border-gray-100 dark:border-slate-700 align-top">
                      <td className="px-3 py-2"><div className="font-semibold">{p.shift.client}</div><div className={muted}>{formatAgencyDate(p.shift.date)} · {p.shift.startTime}–{p.shift.endTime}</div></td>
                      <td className="py-2 pr-2">
                        {options.length ? (
                          <select className={inp} aria-label={`Caregiver for ${p.shift.client}`} value={choice[p.shift.id] ?? ''} onChange={(e) => setChoice({ ...choice, [p.shift.id]: e.target.value })}>
                            <option value="">— leave open —</option>
                            {options.map((o, i) => <option key={o.caregiverId} value={o.caregiverId}>{i === 0 ? '★ Best: ' : ''}{o.name} · {o.travelMinutes} min travel</option>)}
                          </select>
                        ) : <span className="text-red-700 dark:text-red-300">Nobody can take it</span>}
                        {/* Every reason in words (home care live test 11/08: only a score like "(-44)" showed). */}
                        {pick && <div className={`${muted} mt-1`}>{pick.reasons.join(' · ')}</div>}
                        {!options.length && p.unfilledBecause.length > 0 && <div className={`${muted} mt-1`}>{p.unfilledBecause.join(' · ')}</div>}
                      </td>
                      <td className="py-2">{pick ? `${pick.travelMinutes} min` : '—'}{pick && pick.waitMinutes !== null ? <div className={muted}>{pick.waitMinutes} min wait</div> : null}</td>
                      <td className="py-2">{pick ? pick.continuityVisits : '—'}</td>
                      <td className="py-2">{pick ? `${pick.dayHours} h / ${pick.weekHours} h` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>))}
    </div>
  )
}
