// Who fits a job, and which zone it is in — on any board that puts work on people (the Schedule's person lanes; the field
// service Dispatch Board has its own copy of the same rules). ServiceTitan's dispatcher sees the recommended technicians
// wherever a job is assigned, and one zone at a time; live test 11/11 moved a job on Schedule › By person and saw neither.
//   · skills (skill_matching): GET /api/skills — each person's skills and what each kind of job needs (server data/skills.ts);
//   · zones (service_zones): GET /api/service-zones — each zone's ZIPs and the techs who work it (server crm/field/serviceZones.ts).
import { useEffect, useState } from 'react'
import { codeLabel } from '../labels/codes'
import type { ScheduleApi } from './types'

import { fitFrom, neededFor, missingFor, zoneOf, inZone, type Fit, type FitZone, type FitJob } from './dispatchRules'
export type { FitZone, FitJob } from './dispatchRules'

export function useDispatchFit(api: ScheduleApi, on: { skills?: boolean; zones?: boolean }) {
  const [fit, setFit] = useState<Fit | null>(null)
  const [zones, setZones] = useState<FitZone[]>([])
  const [zoneShown, setZoneShown] = useState('')
  useEffect(() => {
    if (!on.skills) { setFit(null); return }
    api.get('/api/skills').then((r: any) => setFit(fitFrom(r))).catch(() => setFit(null))
  }, [on.skills]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on.zones) { setZones([]); return }
    api.get('/api/service-zones').then((r: any) => setZones(r?.zones || [])).catch(() => setZones([]))
  }, [on.zones]) // eslint-disable-line react-hooks/exhaustive-deps

  const needs = (j: FitJob | null | undefined) => neededFor(fit, j)
  const lacks = (personId: string, needed: string[]) => missingFor(fit, personId, needed)
  const zoneOfJob = (j: FitJob) => zoneOf(zones, j)
  const inZoneShown = (j: FitJob) => inZone(zones, zoneShown, j)
  /** One zone picked that names its techs: their ids (others' lanes are left out unless a shown job names them). */
  const zoneTechs = zoneShown && zoneShown !== 'none' ? zones.find((z) => z.id === zoneShown)?.techIds || null : null
  return { neededFor: needs, missingFor: lacks, zoneOf: zoneOfJob, inZoneShown, zones, zoneShown, setZoneShown, zoneTechs: zoneTechs && zoneTechs.length ? zoneTechs : null }
}
export type DispatchFit = ReturnType<typeof useDispatchFit>

/** The zone picker: All zones, each zone, No zone. Shown once there is a zone. */
export function ZonePicker({ fit }: { fit: DispatchFit }) {
  if (!fit.zones.length) return null
  return (
    <select aria-label="Zone" data-testid="zone-filter" value={fit.zoneShown} onChange={(e) => fit.setZoneShown(e.target.value)}
      className="px-3 py-1.5 text-sm border rounded-lg text-gray-900 bg-white border-gray-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700">
      <option value="">All zones</option>
      {fit.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
      <option value="none">No zone</option>
    </select>
  )
}

/** While a job is being moved: what its kind needs and the people who have it, best first (fewest missing, then fewest jobs). */
export function SkillRanking({ fit, job, people, load }: { fit: DispatchFit; job: FitJob | null; people: Array<{ id: string; name: string }>; load: (personId: string) => number }) {
  const needed = fit.neededFor(job)
  if (!job || !needed.length) return null
  const ranked = people.map((p) => ({ p, missing: fit.missingFor(p.id, needed), load: load(p.id) }))
    .sort((a, b) => a.missing.length - b.missing.length || a.load - b.load || a.p.name.localeCompare(b.p.name))
  return (
    <p data-testid="skill-ranking" className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <span className="font-semibold">{codeLabel(job.jobType)} needs {needed.join(', ')}.</span>{' '}
      Best fit: {ranked.map((r, i) => <span key={r.p.id}>{i ? ', ' : ''}{r.p.name}{r.missing.length ? ` (missing ${r.missing.join(', ')})` : ' ✓'}</span>)}
    </p>
  )
}

/** A person's lane, while a job is being moved: has its skills, or what they are missing. */
export function LaneSkill({ fit, job, personId }: { fit: DispatchFit; job: FitJob | null; personId: string }) {
  const needed = fit.neededFor(job)
  if (!job || !needed.length) return null
  const missing = fit.missingFor(personId, needed)
  return missing.length
    ? <p data-skill="missing" className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Missing {missing.join(', ')}</p>
    : <p data-skill="has" className="mt-1 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-900 dark:bg-green-900/40 dark:text-green-100">Has the skills</p>
}
