// A job's own named photo folders (job_photo_folder — Buildertrend's and CompanyCam's folders; live test 11/11) — the rules both
// photo stores share: the job's own photos (jobs/jobs.ts, job_photo.folder_id) and the photo library's (files/photos.ts,
// document.photo_folder_id). One list of folders per job, whichever store its photos are in.
import { and, asc, eq } from 'drizzle-orm'

/** The standard folders' names, in every store — a named folder may not take one. */
const STANDARD = ['general', 'before', 'during', 'after', 'progress', 'damage', 'inspection', 'issue', 'issues', 'material', 'materials', 'equipment', 'safety', 'permit', 'permits', 'other', 'photo', 'no folder']

/** A folder's name: 1–60 characters, not a standard folder's, not another of this job's (letter case aside). */
export async function folderNameCheck(db: any, folders: any, jobId: string, companyId: string, v: unknown, except?: string): Promise<{ name: string } | { error: string; status: 400 | 409 }> {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 60) return { error: 'Name the folder (up to 60 characters).', status: 400 }
  const low = name.toLowerCase()
  if (STANDARD.includes(low)) return { error: `"${name}" is already one of the standard folders.`, status: 409 }
  const others = await db.select({ id: folders.id, name: folders.name }).from(folders).where(and(eq(folders.jobId, jobId), eq(folders.companyId, companyId)))
  if ((others as any[]).some((f) => f.id !== except && String(f.name).toLowerCase() === low)) return { error: `This job already has a folder called "${name}".`, status: 409 }
  return { name }
}

/** One of this job's folders (this company's), or null. */
export async function ownFolderOf(db: any, folders: any, jobId: string | null | undefined, companyId: string, folderId: unknown) {
  if (!jobId || typeof folderId !== 'string' || !folderId) return null
  const [f] = await db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.jobId, jobId), eq(folders.companyId, companyId))).limit(1)
  return f ?? null
}

/** The job's folders, oldest first (the order they were made). */
export const foldersOfJob = (db: any, folders: any, jobId: string, companyId: string) =>
  db.select({ id: folders.id, name: folders.name }).from(folders).where(and(eq(folders.jobId, jobId), eq(folders.companyId, companyId))).orderBy(asc(folders.createdAt), asc(folders.id))
