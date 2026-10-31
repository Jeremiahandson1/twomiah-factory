// One rule for "can this caregiver take this client's shift at all?" — read by the suggestion list (GET /api/scheduling/suggest-caregivers)
// and by auto-fill (POST /api/scheduling/auto-fill), so the two can never disagree.
//
// The rule looks at four things and nothing else (busy with another visit, weekly hours and distance are the callers' own scoring):
//   · the client's do-not-use list
//   · time off or a blackout that covers the shift's date (approved time off, or a blackout)
//   · the caregiver marked unavailable (their availability status), or not working that weekday
//   · the shift falling outside the hours they gave for that weekday (no hours given → no limit)
//
// The suggestion list shows every caregiver with these as visible reasons and, as it always has, leaves out do-not-use and time off
// unless asked for them; the office decides about the rest. Auto-fill has no one to decide, so any of the five blocks it.

export type CaregiverFit = {
  doNotUse: boolean
  timeOff: boolean
  markedUnavailable: boolean
  notThatDay: boolean
  /** true / false when the caregiver gave hours for that weekday and the shift is inside / outside them; null when they gave none. */
  timeFits: boolean | null
  /** Why auto-fill may not use them, in plain words; empty when it may. */
  blocks: string[]
}

const toMin = (t: unknown): number | null => {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}

/**
 * `cg` is a row of caregiversForSuggestions (availabilityStatus, dayAvailable, dayStartTime, dayEndTime, isBlackedOut), read for the
 * shift's weekday and date; `doNotUse` the client's do-not-use caregiver ids; start / end the shift's times ('HH:MM' or 'HH:MM:SS').
 */
export function caregiverFit(cg: any, doNotUse: ReadonlySet<string>, startTime: string | null | undefined, endTime: string | null | undefined): CaregiverFit {
  const sMin = toMin(startTime), eMin = toMin(endTime)
  const aS = toMin(cg.dayStartTime), aE = toMin(cg.dayEndTime)
  const timeFits = aS != null && aE != null && sMin != null && eMin != null ? sMin >= aS && eMin <= aE : null
  const fit: CaregiverFit = {
    doNotUse: doNotUse.has(String(cg.id)),
    timeOff: cg.isBlackedOut === true,
    markedUnavailable: cg.availabilityStatus === 'unavailable',
    notThatDay: cg.dayAvailable === false,
    timeFits,
    blocks: [],
  }
  if (fit.doNotUse) fit.blocks.push("On this client's do-not-use list")
  if (fit.timeOff) fit.blocks.push('On time off that day')
  if (fit.markedUnavailable) fit.blocks.push('Marked unavailable')
  if (fit.notThatDay) fit.blocks.push('Not available that day of the week')
  if (fit.timeFits === false) fit.blocks.push("Outside the hours they gave for that day")
  return fit
}

export const doNotUseOf = (client: any): Set<string> => new Set((Array.isArray(client?.doNotUseCaregivers) ? client.doNotUseCaregivers : []).map(String))
