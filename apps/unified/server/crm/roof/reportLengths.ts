// The linear lengths of a roof (eave, rake, ridge, hip, valley) from a measurement that already has them, so the material
// list is worked from real edges instead of estimated from the squares (docs/parity/roof-material-list.md #6).
//
// Two places hold them:
//   · our own roof report (roof_report: `measurements` {eaveLF, rakeLF, ridgeLF, hipLF, valleyLF} and the drawn `edges`,
//     the numbers the map editor shows and the roofer corrects — web/.../roof/reports/MapEdgeEditor.tsx);
//   · a provider's report (EagleView, HOVER, GAF) the roofer keyed in from its PDF: a measurement_report whose raw_data
//     carries `lengths` (importProviderReport below). The provider's own API is the provider-account step, not built.
// A roof report belongs to a homeowner (contact) and an address, not to a job, so it is offered for a job only when it is
// the same homeowner's and the same address: another property's lengths would size the wrong roof.
import { and, desc, eq } from 'drizzle-orm'
import { measurementReport, roofReport } from '../../db/schema/index.ts'

export interface ReportLengths { eaveFt: number; rakeFt: number; ridgeFt: number; hipFt: number; valleyFt: number }
export const PROVIDERS = ['eagleview', 'hover', 'gaf'] as const
export type Provider = (typeof PROVIDERS)[number]
/** Each provider as the roofer says it. */
export const PROVIDER_LABELS: Record<Provider, string> = { eagleview: 'EagleView', hover: 'HOVER', gaf: 'GAF QuickMeasure' }

const round1 = (n: number) => Math.round(n * 10) / 10
const feet = (v: unknown): number | null => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? round1(n) : null }

/** The five lengths if any of them is a real (above 0) figure; null when the report measured nothing. */
function ifMeasured(l: ReportLengths): ReportLengths | null {
  return l.eaveFt + l.rakeFt + l.ridgeFt + l.hipFt + l.valleyFt > 0 ? l : null
}

/** From a roof report's `measurements` (the editor's totals); falls back to summing its drawn `edges` when the totals are not there. */
export function lengthsFromRoofReport(measurements: any, edges?: any): ReportLengths | null {
  const m = measurements && typeof measurements === 'object' ? measurements : {}
  const fromTotals = { eaveFt: feet(m.eaveLF), rakeFt: feet(m.rakeLF), ridgeFt: feet(m.ridgeLF), hipFt: feet(m.hipLF), valleyFt: feet(m.valleyLF) }
  if (Object.values(fromTotals).some((v) => v !== null)) {
    return ifMeasured({ eaveFt: fromTotals.eaveFt ?? 0, rakeFt: fromTotals.rakeFt ?? 0, ridgeFt: fromTotals.ridgeFt ?? 0, hipFt: fromTotals.hipFt ?? 0, valleyFt: fromTotals.valleyFt ?? 0 })
  }
  const sum = { eaveFt: 0, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0 }
  for (const e of Array.isArray(edges) ? edges : []) {
    const len = feet(e?.lengthFt)
    const key = ({ eave: 'eaveFt', rake: 'rakeFt', ridge: 'ridgeFt', hip: 'hipFt', valley: 'valleyFt' } as Record<string, keyof ReportLengths>)[String(e?.type)]
    if (len !== null && key) sum[key] = round1(sum[key] + len)
  }
  return ifMeasured(sum)
}

/** From a provider report keyed in (measurement_report.raw_data.lengths). */
export function lengthsFromProviderReport(rawData: any): ReportLengths | null {
  const l = rawData?.lengths
  if (!l || typeof l !== 'object') return null
  return ifMeasured({ eaveFt: feet(l.eaveFt) ?? 0, rakeFt: feet(l.rakeFt) ?? 0, ridgeFt: feet(l.ridgeFt) ?? 0, hipFt: feet(l.hipFt) ?? 0, valleyFt: feet(l.valleyFt) ?? 0 })
}

/** The material list's four lengths: "ridge" there is ridge AND hip (the cap runs along both). */
export const listLengths = (l: ReportLengths) => ({ eaveFt: l.eaveFt, rakeFt: l.rakeFt, ridgeFt: round1(l.ridgeFt + l.hipFt), valleyFt: l.valleyFt })

/** An address compared the way a person would: case, punctuation and runs of spaces do not matter. */
export const sameAddress = (a: unknown, b: unknown) => {
  const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) !== '' && norm(a) === norm(b)
}

export interface ReportChoice {
  id: string
  kind: 'roof_report' | 'provider_report'
  /** For the screen: "Roof report, 12 Gable Ln (Oct 3)" / "EagleView report 4471". */
  label: string
  provider?: Provider
  createdAt: string
  lengths: ReportLengths
  squares: number | null
}

/** Every report that can give this job its lengths, newest first (the job's own pointer, if it has lengths, goes first). */
export async function reportChoicesFor(db: any, companyId: string, job: any): Promise<ReportChoice[]> {
  const out: ReportChoice[] = []
  const provided = await db.select().from(measurementReport)
    .where(and(eq(measurementReport.companyId, companyId), eq(measurementReport.jobId, job.id)))
    .orderBy(desc(measurementReport.createdAt)).limit(20)
  for (const r of provided) {
    const lengths = lengthsFromProviderReport(r.rawData)
    if (!lengths) continue
    const provider = (PROVIDERS as readonly string[]).includes(r.provider) ? (r.provider as Provider) : undefined
    out.push({
      id: r.id, kind: 'provider_report', provider,
      label: `${provider ? PROVIDER_LABELS[provider] : 'Provider'} report${r.externalOrderId ? ` ${r.externalOrderId}` : ''}`,
      createdAt: new Date(r.createdAt).toISOString(), lengths, squares: Number(r.totalSquares) > 0 ? Number(r.totalSquares) : null,
    })
  }
  if (job.contactId) {
    const roof = await db.select().from(roofReport)
      .where(and(eq(roofReport.companyId, companyId), eq(roofReport.contactId, job.contactId)))
      .orderBy(desc(roofReport.createdAt)).limit(20)
    for (const r of roof) {
      if (!sameAddress(r.address, job.address)) continue
      const lengths = lengthsFromRoofReport(r.measurements, r.edges)
      if (!lengths) continue
      out.push({
        id: r.id, kind: 'roof_report',
        label: `Roof report, ${r.address}${r.userEdited ? ' (corrected by hand)' : ''}`,
        createdAt: new Date(r.createdAt).toISOString(), lengths, squares: Number(r.totalSquares) > 0 ? Number(r.totalSquares) : null,
      })
    }
  }
  out.sort((a, b) => Number(b.id === job.measurementReportId) - Number(a.id === job.measurementReportId) || b.createdAt.localeCompare(a.createdAt))
  return out
}
