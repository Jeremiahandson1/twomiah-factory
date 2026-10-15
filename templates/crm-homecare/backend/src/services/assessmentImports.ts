// Insurer-portal assessment imports: the printouts a payer's own portal produces, read into a
// client's care task checklist.
//
// Each format belongs to one insurer's portal, so it is configuration, not a hard-coded path:
// a format names the insurer, the states it operates in, and its reader. The care task screen
// offers only the formats that apply to the agency's state, and a new insurer's printout is one
// more entry here. MIDAS (My Choice Wisconsin's SHC/PC Assessment Summary) is the first.
import { parseMidasAssessmentPdf } from './midasAssessmentPdf.ts'

export type ImportedTask = {
  taskName: string; category: string; weeklyFrequency: number; allottedMinutes: number
  daysOfWeek: string; timeOfDay: string; description: string
}
export type ParsedAssessment = {
  source: string
  member: { lastName: string | null; firstName: string | null; memberId: string | null; assessDate: string | null; assessor: string | null }
  sections: { name: string; category: string; minsPerWeek: number | null; tasks: number }[]
  assessmentTotals: { minsPerWeek: number }
  tasks: ImportedTask[]
}

export type AssessmentFormat = {
  id: string
  label: string
  insurer: string
  portal: string
  /** Two-letter states the insurer operates in; empty = everywhere. */
  states: string[]
  parse: (pdf: Uint8Array) => Promise<ParsedAssessment>
}

export const ASSESSMENT_FORMATS: AssessmentFormat[] = [
  {
    id: 'midas_shc_pc_summary',
    label: 'MIDAS SHC/PC Assessment Summary',
    insurer: 'My Choice Wisconsin',
    portal: 'MIDAS',
    states: ['WI'],
    parse: parseMidasAssessmentPdf as (pdf: Uint8Array) => Promise<ParsedAssessment>,
  },
]

/** The formats an agency in `state` can use. An agency with no state on file sees all of them. */
export function formatsForState(state: string | null): AssessmentFormat[] {
  if (!state) return ASSESSMENT_FORMATS
  return ASSESSMENT_FORMATS.filter((f) => !f.states.length || f.states.includes(state))
}

/** Was this task row written by an insurer assessment import? */
export const isAssessmentSource = (source: string | null | undefined) =>
  !!source && (ASSESSMENT_FORMATS.some((f) => f.id === source) || /^midas/.test(source))
