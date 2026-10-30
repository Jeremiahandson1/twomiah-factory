// People on jobs, for the Schedule's lanes and the Dispatch Board (2026-10-24: several people per job, lanes per
// person, route optimise). One place for: who is on a job, what a drag from one person's lane to another sends, and the
// "Optimise route" window — so the two screens cannot come to disagree about any of them.
import { useEffect, useState } from 'react'
import { MapPin, Navigation, Route } from 'lucide-react'
import { Button, Modal, ConfirmModal, errMsg } from '../invoicing/ui'
import type { ScheduleApi, ScheduleToast } from './types'
import { useMayWrite } from '../auth/PermissionsContext'

export interface CrewPerson { id: string; name?: string | null; firstName?: string | null; lastName?: string | null; kind?: 'user' | 'member'; lead?: boolean }
export interface CrewJob { id: string; assignedToId?: string | null; assignedToMemberId?: string | null; assignedTo?: CrewPerson | null; assignees?: CrewPerson[] }
export interface Lane { id: string; name: string }
/** The lane for work nobody is on. */
export const UNASSIGNED = ''

export const personName = (p?: CrewPerson | null) => (p ? (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unnamed') : '')

/** Everyone on a job, lead first: the API's `assignees`, else the lead alone (an older reply). */
export function crewOf(job: CrewJob): CrewPerson[] {
  if (Array.isArray(job.assignees) && job.assignees.length) return job.assignees
  const lead = job.assignedToId || job.assignedToMemberId || job.assignedTo?.id
  return lead ? [{ ...(job.assignedTo || {}), id: lead, lead: true }] : []
}
export const crewIdsOf = (job: CrewJob) => crewOf(job).map((p) => p.id)

/** Every person a list of jobs names, beside a roster (the roster's order first), plus nobody else. */
export function lanesFor(roster: Lane[], jobs: CrewJob[]): Lane[] {
  const out = [...roster], seen = new Set(roster.map((r) => r.id))
  for (const j of jobs) for (const p of crewOf(j)) if (!seen.has(p.id)) { seen.add(p.id); out.push({ id: p.id, name: personName(p) }) }
  return out
}

/**
 * What a move from one lane to another sends (PUT /api/jobs/:id): the person whose lane it left comes off the job and
 * the one whose lane it landed in goes on, in the same place — the lead stays the lead. Into "Unassigned" takes that
 * one person off (the next person then leads); out of it puts the job on that person alone. Null: no change.
 */
export function laneMoveBody(job: CrewJob, from: string, to: string): { assignedToId: string; otherAssigneeIds: string[] } | null {
  if (from === to) return null
  const now = crewIdsOf(job)
  let next: string[]
  if (from === UNASSIGNED) next = now.includes(to) ? now : [to, ...now]
  else if (to === UNASSIGNED) next = now.filter((id) => id !== from)
  else next = now.includes(to) ? now.filter((id) => id !== from) : now.map((id) => (id === from ? to : id))
  if (next.join(',') === now.join(',')) return null
  return { assignedToId: next[0] || '', otherAssigneeIds: next.slice(1) }
}

/**
 * A 409 the server lets the office book past (tenant-backend jobs.ts): too little time to drive between two jobs, or a
 * person who is off that day / outside their hours (code 'unavailable', where Tech Availability is on).
 */
export const isTravelWarning = (err: unknown) => ['travel_time', 'unavailable'].includes((err as any)?.data?.code)
/** The question's title: it reads the same for both kinds of warning, the message under it says which. */
export const BOOK_ANYWAY_TITLE = 'Check before you book'

interface DayRoute {
  date: string; userId: string; name?: string | null
  stops: Array<{ id: string; number?: string; title?: string; address?: string | null; scheduledTime?: string | null }>
  unplaced: Array<{ id: string; number?: string; title?: string; address?: string | null; scheduledTime?: string | null }>
  proposed: Array<{ id: string; scheduledTime: string; driveMinutes: number }>
  googleMapsUrl?: string | null; totalMiles?: number; savings?: { miles: number; minutes: number } | null; message?: string
}

/**
 * "Optimise route" for one person's day: the stops in the best order (GET /api/day-route — nothing changes), a Google
 * Maps directions link, and — only after the office says yes — the new start times (POST /api/jobs/retime).
 */
export function RouteOptimiser({ api, toast, date, person, mayRetime, mayLocate, onClose, onApplied }: {
  api: ScheduleApi; toast: ScheduleToast; date: string; person: Lane; mayRetime: boolean; mayLocate: boolean; onClose: () => void; onApplied: () => void
}) {
  // Both writes here — re-timing (POST /api/jobs/retime) and putting jobs on the map (POST /api/day-route/locate) — ask
  // jobs:update on the server; the screen asks it too, beside what the page that opened this decided.
  const mayUpdateJobs = useMayWrite('jobs:update')
  // New start times are the schedule's: jobs:dispatch (tenant-backend jobs/dispatch.ts), as POST /api/jobs/retime asks.
  const mayDispatch = useMayWrite('jobs:dispatch')
  const [route, setRoute] = useState<DayRoute | null>(null)
  const [loading, setLoading] = useState(true)
  const [asking, setAsking] = useState(false)
  const [locating, setLocating] = useState(false)
  const load = () => {
    setLoading(true)
    return api.get('/api/day-route', { date, userId: person.id })
      .then((r: any) => setRoute(r?.data ?? r))
      .catch((err: unknown) => toast.error(errMsg(err, 'Could not route this day')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { void load() }, [date, person.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const timeOf = (id: string) => route?.stops.find((s) => s.id === id)?.scheduledTime || ''
  const changes = (route?.proposed || []).filter((p) => timeOf(p.id) !== p.scheduledTime)
  const retime = async () => {
    try {
      await api.post('/api/jobs/retime', { times: (route?.proposed || []).map(({ id, scheduledTime }) => ({ id, scheduledTime })) })
      toast.success(`${changes.length} start time${changes.length === 1 ? '' : 's'} changed`)
      setAsking(false)
      onApplied()
    } catch (err) { toast.error(errMsg(err, 'Could not re-time the day')) }
  }
  const locate = async () => {
    setLocating(true)
    try {
      const r: any = await api.post('/api/day-route/locate', { date })
      const n = (r?.data ?? r)?.located?.length || 0
      toast.success(n ? `${n} job${n === 1 ? '' : 's'} put on the map` : 'No address could be found on the map')
      await load()
    } catch (err) { toast.error(errMsg(err, 'Could not put the jobs on the map')) } finally { setLocating(false) }
  }
  const proposedFor = (id: string) => route?.proposed.find((p) => p.id === id)
  return (
    <>
      <Modal isOpen onClose={onClose} title={`Optimise route — ${person.name}`} size="lg">
        {loading ? <p className="text-sm text-gray-600 dark:text-slate-300" aria-busy="true">Working out the best order…</p> : !route ? null : (
          <div className="space-y-4" data-testid="route-optimiser">
            {route.message && <p className="text-sm text-gray-700 dark:text-slate-300">{route.message}</p>}
            {route.stops.length > 0 && (
              <ol className="space-y-2">
                {route.stops.map((s, i) => {
                  const p = proposedFor(s.id)
                  const moved = p && p.scheduledTime !== (s.scheduledTime || '')
                  return (
                    <li key={s.id} data-route-stop={s.id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-2 dark:border-slate-700">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{s.title}{s.number ? ` (${s.number})` : ''}</p>
                        {s.address && <p className="truncate text-xs text-gray-600 dark:text-slate-400">{s.address}</p>}
                        {p && p.driveMinutes > 0 && <p className="text-xs text-gray-600 dark:text-slate-400">about {p.driveMinutes} min drive from the stop before</p>}
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <p className="text-gray-600 dark:text-slate-400">{s.scheduledTime || 'No time'}</p>
                        {moved && <p className="font-semibold text-orange-800 dark:text-orange-200">→ {p!.scheduledTime}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            {(route.totalMiles || 0) > 0 && (
              <p className="text-sm text-gray-700 dark:text-slate-300">
                {route.totalMiles} mi in this order{route.savings && route.savings.miles > 0 ? ` — ${route.savings.miles} mi${route.savings.minutes > 0 ? ` and ${route.savings.minutes} min` : ''} less than as booked` : ''}.
              </p>
            )}
            {route.googleMapsUrl && (
              <a href={route.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200">
                <Navigation className="h-4 w-4" />Open directions in Google Maps
              </a>
            )}
            {route.unplaced.length > 0 && (
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100"><MapPin className="mr-1 inline h-4 w-4" />Not on the map yet, so left where they are:</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-700 dark:text-slate-300">
                  {route.unplaced.map((u) => <li key={u.id}>{u.title}{u.number ? ` (${u.number})` : ''}{u.address ? ` — ${u.address}` : ' — no address'}</li>)}
                </ul>
                {mayLocate && mayUpdateJobs && <Button variant="secondary" onClick={locate} disabled={locating}>{locating ? 'Finding them…' : 'Put them on the map'}</Button>}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              {mayRetime && mayUpdateJobs && mayDispatch && changes.length > 0 && <Button onClick={() => setAsking(true)}><Route className="mr-1 inline h-4 w-4" />Re-time {changes.length} job{changes.length === 1 ? '' : 's'}</Button>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmModal isOpen={asking} onClose={() => setAsking(false)} onConfirm={retime} danger={false}
        title="Re-time this day?"
        message={`${changes.length} start time${changes.length === 1 ? '' : 's'} will change to follow the new order: ${changes.map((c) => `${route?.stops.find((s) => s.id === c.id)?.number || 'job'} ${timeOf(c.id) || 'no time'} → ${c.scheduledTime}`).join(', ')}. Everyone on those jobs is told.`}
        confirmText="Re-time jobs" />
    </>
  )
}
