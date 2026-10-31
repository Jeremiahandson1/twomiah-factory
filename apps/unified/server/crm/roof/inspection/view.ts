// What an inspection report SAYS, read from the database in one place so the page, the PDF and the office screen cannot
// disagree: the company's brand, the job's facts, and each roof section with its photos (caption, the time it was taken,
// where the phone was, who took it). The report row holds only the sections' titles, notes and the photo ids; the photos
// are the job's (job_photo), so a caption fixed afterwards shows, and a photo deleted from the job drops out of the report.
// A photo id that is not THIS job's is never read — the report cannot be made to show another job's picture.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { companyTimeZone } from '@twomiah/tenant-backend'
import { company, contact, job, jobPhoto, user } from '../../../db/schema/index.ts'

export interface ReportSection { title: string; notes: string; photoIds: string[] }
export interface ReportPhoto {
  id: string
  caption: string | null
  photoType: string
  /** ISO time the photo was taken (the phone's, when it said; else when it was uploaded). */
  takenAt: string | null
  latitude: number | null
  longitude: number | null
  /** First name and last initial of who uploaded it. */
  by: string | null
  /** Where the photo is kept (/media/photos/…): the office screen shows it; the public page never prints it. */
  url: string
}
export interface ReportView {
  id: string
  jobId: string
  title: string
  intro: string
  updatedAt: string
  /** The company's clock, so a stamp reads in the roofer's own time. */
  timeZone: string
  brand: { name: string; color: string; logo: string | null; phone: string | null; email: string | null; address: string | null; license: string | null }
  job: { number: string; title: string; address: string; homeowner: string | null; claimNumber: string | null; insuranceCompany: string | null; dateOfLoss: string | null; inspectionDate: string | null }
  sections: Array<{ title: string; notes: string; photos: ReportPhoto[] }>
}

const COLOR = /^#[0-9a-fA-F]{6}$/
export const DEFAULT_BRAND_COLOR = '#f97316'

/** The sections a row holds, whatever shape an old or hand-edited row has. */
export function sectionsOf(raw: unknown): ReportSection[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s: any) => ({
    title: String(s?.title ?? '').slice(0, 80),
    notes: String(s?.notes ?? ''),
    photoIds: Array.isArray(s?.photoIds) ? s.photoIds.filter((x: unknown) => typeof x === 'string') : [],
  }))
}

const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return Number.isNaN(d.getTime()) ? null : d.toISOString() }

export async function buildReportView(db: any, report: any): Promise<ReportView> {
  const [co] = await db.select().from(company).where(eq(company.id, report.companyId)).limit(1)
  const [jb] = await db.select().from(job).where(and(eq(job.id, report.jobId), eq(job.companyId, report.companyId))).limit(1)
  const homeowner = jb?.contactId
    ? (await db.select({ name: contact.name }).from(contact).where(and(eq(contact.id, jb.contactId), eq(contact.companyId, report.companyId))).limit(1))[0]?.name ?? null
    : null
  const sections = sectionsOf(report.sections)
  const wanted = [...new Set(sections.flatMap((s) => s.photoIds))]
  // Only this job's photos, in this company.
  const rows: any[] = wanted.length
    ? await db.select().from(jobPhoto).where(and(inArray(jobPhoto.id, wanted), eq(jobPhoto.jobId, report.jobId), eq(jobPhoto.companyId, report.companyId))).orderBy(asc(jobPhoto.takenAt), asc(jobPhoto.id))
    : []
  const uploaderIds = [...new Set(rows.map((r) => r.uploadedById).filter(Boolean))] as string[]
  const people: any[] = uploaderIds.length
    ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(and(inArray(user.id, uploaderIds), eq(user.companyId, report.companyId)))
    : []
  const byName = new Map(people.map((p) => [p.id, [p.firstName, p.lastName ? `${String(p.lastName).charAt(0)}.` : ''].filter(Boolean).join(' ') || null]))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const photoOf = (r: any): ReportPhoto => ({
    id: r.id, caption: r.caption || null, photoType: r.photoType || 'general', takenAt: iso(r.takenAt),
    latitude: num(r.latitude), longitude: num(r.longitude), by: r.uploadedById ? byName.get(r.uploadedById) ?? null : null, url: r.url,
  })
  const color = COLOR.test(String(co?.primaryColor || '')) ? String(co.primaryColor) : DEFAULT_BRAND_COLOR
  const address = [jb?.address, [jb?.city, jb?.state].filter(Boolean).join(', '), jb?.zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const companyAddress = [co?.address, [co?.city, co?.state].filter(Boolean).join(', '), co?.zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return {
    id: report.id, jobId: report.jobId, title: report.title, intro: report.intro || '', updatedAt: iso(report.updatedAt) || new Date().toISOString(),
    timeZone: await companyTimeZone(db, report.companyId),
    brand: { name: co?.name || 'Your roofer', color, logo: co?.logo || null, phone: co?.phone || null, email: co?.email || null, address: companyAddress || null, license: co?.licenseNumber || null },
    job: {
      number: jb?.number || '', title: jb?.title || '', address, homeowner, claimNumber: jb?.claimNumber || null, insuranceCompany: jb?.insuranceCompany || null,
      dateOfLoss: iso(jb?.dateOfLoss), inspectionDate: iso(jb?.inspectionDate),
    },
    sections: sections.map((s) => ({ title: s.title, notes: s.notes, photos: s.photoIds.map((id) => byId.get(id)).filter(Boolean).map(photoOf) })),
  }
}

/** "Mar 4, 2026, 2:15 PM" in the company's own time. */
export function stampOf(value: string | null, timeZone: string): string {
  if (!value) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) } catch { return '' }
}
/** "Mar 4, 2026" (a calendar day or an appointment), in the company's own time. */
export function dayOf(value: string | null, timeZone: string): string {
  if (!value) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium' }).format(new Date(value)) } catch { return '' }
}
/** "43.80140, -91.43960" — five places is about a metre. */
export const gpsOf = (p: { latitude: number | null; longitude: number | null }): string =>
  p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : ''

/** Black or white, whichever reads on the brand colour. */
export function inkOn(hex: string): '#ffffff' | '#111827' {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.4 ? '#111827' : '#ffffff'
}
