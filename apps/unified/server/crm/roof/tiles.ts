// ROOFING'S HOME TILES — the conditions behind each count, written once for the dashboard's figure (field/dashboard.ts)
// and the job list the tile opens (jobs.ts, GET /api/jobs?tile=…). A roofing job has no scheduled_date: its days are the
// inspection and the install, read on the company's own calendar day.
import { and, gte, lt, notInArray } from 'drizzle-orm'
import { storeDayRange } from '@twomiah/tenant-backend'
import { job } from '../../db/schema/index.ts'
import { TERMINAL_STATUSES } from './validation.ts'

/** Statuses that are not "still running": paid in full, or closed as lost / cancelled. */
export const NOT_OPEN = ['collected', ...TERMINAL_STATUSES] as string[]

/** The `?tile=` values GET /api/jobs accepts on a roofing business. */
export const ROOF_JOB_TILES = ['inspections-today', 'installs-today', 'open'] as const

/**
 * A job closed as lost or cancelled is not on today's board, whatever dates it still carries (the same rule as the contractor
 * "Jobs today": a cancelled job is not today's work). A job already paid in full ('collected') whose install was today did happen,
 * so it stays. Written once: the desktop dashboard's figure and the list the phone tile opens both call these.
 */
export const inspectionsTodayCondition = (timeZone: string) => {
  const { start, end } = storeDayRange(timeZone)
  return and(gte(job.inspectionDate, start), lt(job.inspectionDate, end), notInArray(job.status, [...TERMINAL_STATUSES]))!
}
export const installsTodayCondition = (timeZone: string) => {
  const { start, end } = storeDayRange(timeZone)
  return and(gte(job.installDate, start), lt(job.installDate, end), notInArray(job.status, [...TERMINAL_STATUSES]))!
}
export const openJobCondition = () => notInArray(job.status, NOT_OPEN)

export function roofTileCondition(tile: string, timeZone: string) {
  if (tile === 'inspections-today') return inspectionsTodayCondition(timeZone)
  if (tile === 'installs-today') return installsTodayCondition(timeZone)
  if (tile === 'open') return openJobCondition()
  return null
}
