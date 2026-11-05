// The job's story for the report (docs/parity/roof-inspection-report.md #6): when the job was opened, the stages it moved
// through (in the company's own stage names, as the job page's timeline says them) and when photos were taken, oldest first.
// Only what the homeowner or the adjuster may read: not the office's notes, the texts to and from the homeowner, or who did
// what. The same job_note forms the job's own timeline reads (../jobRecord.ts jobEvent), so the two cannot drift.
import { and, asc, eq } from 'drizzle-orm'
import { company, job, jobNote, jobPhoto } from '../../../db/schema/index.ts'
import { jobEvent } from '../jobRecord.ts'
import { loadPipelineConfig, stageLabelFor } from '../pipeline.ts'

export interface TimelineEntry { at: string; text: string }

const dayKey = (d: Date, timeZone: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(d) } catch { return d.toISOString().slice(0, 10) } }

export async function reportTimeline(db: any, companyId: string, jobId: string, timeZone: string): Promise<TimelineEntry[]> {
  const [jb] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!jb) return []
  const [notes, photos] = await Promise.all([
    db.select().from(jobNote).where(and(eq(jobNote.jobId, jobId), eq(jobNote.companyId, companyId))).orderBy(asc(jobNote.createdAt)),
    db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, jobId), eq(jobPhoto.companyId, companyId))).orderBy(asc(jobPhoto.takenAt)),
  ])
  const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  const features = (co?.enabledFeatures as string[] | null) || []
  const names = features.includes('pipeline_boards') ? await loadPipelineConfig(db, companyId) : null
  const stage = (s: string) => stageLabelFor(names, s, jb.jobType)

  const out: Array<TimelineEntry & { t: number }> = []
  const push = (at: Date, text: string) => out.push({ at: at.toISOString(), text, t: at.getTime() })
  push(new Date(jb.createdAt), 'Job opened')
  for (const n of notes) {
    const e = jobEvent(n.body, stage)
    if (e && (e.kind === 'status_change' || e.kind === 'closed' || e.kind === 'reopened')) push(new Date(n.createdAt), e.text)
  }
  // Photos by the day they were taken (a marked copy is a drawing on a photo already counted, not another photo).
  const days = new Map<string, { at: Date; n: number }>()
  for (const p of photos) {
    if (p.sourcePhotoId) continue
    const when = new Date(p.takenAt || p.createdAt)
    const k = dayKey(when, timeZone)
    const d = days.get(k)
    if (d) d.n++; else days.set(k, { at: when, n: 1 })
  }
  for (const { at, n } of days.values()) push(at, `${n} photo${n === 1 ? '' : 's'} taken`)
  return out.sort((a, b) => a.t - b.t).map(({ at, text }) => ({ at, text }))
}
