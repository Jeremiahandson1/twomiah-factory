// How an inspection report is laid out (docs/parity/roof-inspection-report.md #14): photos per row, which details print under a
// photo, whether the job's facts and its timeline are printed. The page and the PDF both read it through `layoutOf`, so a report
// with none saved looks exactly as every report did before layouts existed. A saved template carries one too.
import { z } from 'zod'

export interface ReportLayout {
  /** Photos side by side: 1 (large), 2 (the standard) or 3 (small). */
  perRow: 1 | 2 | 3
  /** Each photo's caption. */
  captions: boolean
  /** The time each photo was taken, on the company's clock. */
  timestamps: boolean
  /** Where each photo was taken, with a map link on the page. */
  gps: boolean
  /** "Photographed by" first name and initial. */
  photographer: boolean
  /** The job's facts at the top: property, homeowner, job number, dates, claim. */
  details: boolean
  /** The job's story at the end: when it was opened, the stages it moved through, when photos were taken. */
  timeline: boolean
}

export const STANDARD_LAYOUT: ReportLayout = { perRow: 2, captions: true, timestamps: true, gps: true, photographer: true, details: true, timeline: false }

/** The layout a row holds, whatever shape an old or hand-edited row has: anything missing or odd is the standard. */
export function layoutOf(raw: unknown): ReportLayout {
  const r: any = raw && typeof raw === 'object' ? raw : {}
  const flag = (k: keyof ReportLayout) => (typeof r[k] === 'boolean' ? r[k] : (STANDARD_LAYOUT[k] as boolean))
  return {
    perRow: r.perRow === 1 || r.perRow === 3 ? r.perRow : 2,
    captions: flag('captions'), timestamps: flag('timestamps'), gps: flag('gps'), photographer: flag('photographer'), details: flag('details'), timeline: flag('timeline'),
  }
}

export const layoutBody = z.object({
  perRow: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  captions: z.boolean(), timestamps: z.boolean(), gps: z.boolean(), photographer: z.boolean(), details: z.boolean(), timeline: z.boolean(),
}).partial()

/** Words for each choice, for the screen and the tests: never the field names. */
export const LAYOUT_LABELS: Record<keyof ReportLayout, string> = {
  perRow: 'Photos per row', captions: 'Captions', timestamps: 'Date and time', gps: 'Location', photographer: 'Who took the photo', details: 'Job details', timeline: 'Job timeline',
}
