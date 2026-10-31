// The owner's "needs you today" panel and the crew member's "my day" (server crm/dashboard/ownerDashboard.ts and
// crewDashboard.ts; features owner_dashboard and crew_dashboard, not ready), above the jobs dashboard. Each renders nothing — and
// asks the server nothing — unless the feature is on and the seat holds the permission the server asks (dashboard:read with
// jobs:read-all for the owner's; jobs:read without jobs:read-all for the crew's, who see their own work only).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { useAuth, money } from '../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const link = 'font-medium text-orange-700 hover:underline dark:text-orange-200'
const muted = 'text-gray-600 dark:text-slate-300'

interface Attention { id: string; label: string; count: number; amount?: number; detail?: string[]; href: string }
interface CrewGroup { person: { id: string; name: string } | null; jobs: Array<{ id: string; number: string; title: string; status: string; scheduledTime: string | null }> }

/** Whether the owner's panel is for this seat: the feature, and the permissions the server asks. */
export function useOwnerPanel() {
  const { hasFeature, can } = useAuth()
  return hasFeature('owner_dashboard') && can('dashboard:read') && can('jobs:read-all')
}
/** Whether the crew's panel is for this seat: the feature, and a seat that reads its own jobs only. */
export function useCrewPanel() {
  const { hasFeature, can } = useAuth()
  return hasFeature('crew_dashboard') && can('jobs:read') && !can('jobs:read-all')
}

export function OwnerDashboard() {
  const on = useOwnerPanel()
  const [data, setData] = useState<{ attention: Attention[]; crewToday?: CrewGroup[] } | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    api.get('/api/owner-dashboard').then((r: { attention: Attention[]; crewToday?: CrewGroup[] }) => { if (live) setData(r) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [on])
  if (!on || !data) return null
  const items = data.attention.filter((a) => a.count > 0)
  return (
    <section aria-label="Needs you today" className={card} data-testid="owner-dashboard">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Needs you today</h2>
      {items.length === 0 ? (
        <p className={`mt-2 text-sm ${muted}`}>Nothing is waiting on you.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
          {items.map((a) => (
            <li key={a.id} data-attention={a.id} className="py-2">
              <Link to={a.href} className={link}>{a.count} — {a.label}</Link>
              {a.amount !== undefined && <span className={`ml-2 ${muted}`}>{money(a.amount, 0)}</span>}
              {a.detail && a.detail.length > 0 && <span className={`block text-xs ${muted}`}>{a.detail.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.crewToday && (
        <div className="mt-4" data-testid="crew-today">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Who is on which job today</h3>
          {data.crewToday.length === 0 ? (
            <p className={`mt-1 text-sm ${muted}`}>No jobs are scheduled for today.</p>
          ) : (
            <ul className="mt-1 space-y-2 text-sm">
              {data.crewToday.map((g) => (
                <li key={g.person?.id || 'nobody'} data-person={g.person?.id || 'nobody'}>
                  <span className="font-medium text-gray-900 dark:text-slate-100">{g.person ? g.person.name : 'Nobody yet'}</span>
                  <ul className="ml-3">
                    {g.jobs.map((j) => (
                      <li key={j.id}><Link to={`/crm/jobs/${j.id}`} className={link}>{j.number} · {j.title}</Link> <span className={muted}>{j.scheduledTime ? `${j.scheduledTime} · ` : ''}{codeLabel(j.status)}</span></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

interface CrewJob { id: string; number: string; title: string; status: string; scheduledTime: string | null; address: string | null; city: string | null; customer: string | null; day?: string }
interface Crew { today: CrewJob[]; next: CrewJob[]; nextCount: number; hours?: { today: number; week: number }; tasks?: { open: number; next: Array<{ id: string; title: string }> } }

export function CrewDashboard() {
  const on = useCrewPanel()
  const { hasFeature } = useAuth()
  const [data, setData] = useState<Crew | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    api.get('/api/crew-dashboard').then((r: Crew) => { if (live) setData(r) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [on])
  if (!on || !data) return null
  const where = (j: CrewJob) => [j.address, j.city].filter(Boolean).join(', ')
  const row = (j: CrewJob) => (
    <li key={j.id} data-job={j.id} className="py-2">
      <Link to={`/crm/jobs/${j.id}`} className={link}>{j.number} · {j.title}</Link>
      <span className={`block text-xs ${muted}`}>{[j.day, j.scheduledTime, j.customer, where(j), codeLabel(j.status)].filter(Boolean).join(' · ')}</span>
    </li>
  )
  return (
    <section aria-label="My day" className={card} data-testid="crew-dashboard">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">My day</h2>
      {data.today.length === 0 ? <p className={`mt-2 text-sm ${muted}`}>You have nothing scheduled today.</p> : <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800" data-testid="crew-today-jobs">{data.today.map(row)}</ul>}
      {data.next.length > 0 && (
        <div className="mt-3" data-testid="crew-next-jobs">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Coming up</h3>
          <ul className="divide-y divide-gray-100 text-sm dark:divide-slate-800">{data.next.map(row)}</ul>
          {data.nextCount > data.next.length && <p className={`mt-1 text-xs ${muted}`}>and {data.nextCount - data.next.length} more this week.</p>}
        </div>
      )}
      {data.hours && <p className={`mt-3 text-sm ${muted}`} data-testid="crew-hours">Hours: {data.hours.today} today, {data.hours.week} this week. <Link to="/crm/time" className={link}>Time</Link></p>}
      {data.tasks && <p className={`mt-1 text-sm ${muted}`} data-testid="crew-tasks">{data.tasks.open === 0 ? 'No open tasks.' : `${data.tasks.open} open ${data.tasks.open === 1 ? 'task' : 'tasks'}: ${data.tasks.next.map((t) => t.title).join(', ')}`}</p>}
      {hasFeature('tech_mobile_view') && <Link to="/crm/tech" className={`mt-2 inline-block text-sm ${link}`}>Open Field View</Link>}
    </section>
  )
}
