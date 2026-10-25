// A visit's before and after photos — service_record.photo_before / photo_after. Salon live test, 2026-10-25: the two
// columns came over from the template and the routes accepted them, but nothing anywhere uploaded a photo, and a write
// stored whatever string it was handed (any address at all, shown later as an <img> on the client's chart).
//
// One rule, the one every record's photos follow (siteRecords/recordPhotos.ts): a photo reaches a visit ONLY by being
// uploaded to it — re-encoded, kept PRIVATE in the company's file store under the visit's own folder — and the column
// holds that store key. A JSON write may clear a photo or send back the one already there; anything else is refused.
// Reads hand each photo back at the authenticated address it is served from (photoBeforeUrl / photoAfterUrl), and a
// stored value that is not one of this visit's own uploads is never offered as a picture.
//   POST   /api/service-records/:id/photos/:slot        (schedule:update — editing the visit)  multipart `photo`
//   GET    /api/service-records/:id/photos/:slot/file   (contacts:read — reading the visit)
//   DELETE /api/service-records/:id/photos/:slot        (schedule:update)
import type { Context } from 'hono'
import { fail } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const VISIT_PHOTO_SLOTS = ['before', 'after'] as const
export type VisitPhotoSlot = typeof VISIT_PHOTO_SLOTS[number]
export const PHOTO_COLUMN: Record<VisitPhotoSlot, 'photoBefore' | 'photoAfter'> = { before: 'photoBefore', after: 'photoAfter' }
const PHOTO_FIELDS = ['photoBefore', 'photoAfter'] as const

export const isVisitPhotoSlot = (v: unknown): v is VisitPhotoSlot => (VISIT_PHOTO_SLOTS as readonly unknown[]).includes(v)

/** The store folder a visit's photos live in: under the company (what every serving route checks), then the visit. */
export const visitPhotoFolder = (companyId: string, recordId: string) => `${companyId}/service-records/${recordId}/`

/** Is this stored value one of THIS visit's own uploads — a key the upload route wrote, nothing typed in? */
export function isOwnVisitPhoto(key: unknown, companyId: string, recordId: string): key is string {
  if (typeof key !== 'string') return false
  const folder = visitPhotoFolder(companyId, recordId)
  return key.startsWith(folder) && /^[0-9a-f-]{36}\.jpg$/.test(key.slice(folder.length))
}

export const visitPhotoUrl = (recordId: string, slot: VisitPhotoSlot) => `/api/service-records/${recordId}/photos/${slot}/file`

/** A visit as sent: each photo it holds at the address it is served from; a value that is not its own upload is not shown. */
export function withVisitPhotos<T extends { id: string; companyId: string; photoBefore?: string | null; photoAfter?: string | null }>(row: T) {
  return {
    ...row,
    photoBeforeUrl: isOwnVisitPhoto(row.photoBefore, row.companyId, row.id) ? visitPhotoUrl(row.id, 'before') : null,
    photoAfterUrl: isOwnVisitPhoto(row.photoAfter, row.companyId, row.id) ? visitPhotoUrl(row.id, 'after') : null,
  }
}

/**
 * What a JSON write (create, merge, edit) may do with the photo columns: clear one (null or ''), or send back the value
 * the visit already holds. Answers the columns to write and the files to drop, or the refusal. `existing` is null for a
 * visit not yet created, which can hold no upload — its photos are added once it exists.
 */
export function photoFieldsOf(body: Record<string, unknown>, existing: { id: string; companyId: string; photoBefore?: string | null; photoAfter?: string | null } | null):
  { set: Record<string, null>; drop: string[] } | { refusal: string } {
  const set: Record<string, null> = {}
  const drop: string[] = []
  for (const k of PHOTO_FIELDS) {
    if (!(k in body)) continue
    const v = body[k]
    if (v == null || v === '') {
      if (existing?.[k]) {
        set[k] = null
        // Only a file this visit's upload wrote is ours to remove; an old typed-in value is just cleared.
        if (isOwnVisitPhoto(existing[k], existing.companyId, existing.id)) drop.push(existing[k] as string)
      }
      continue
    }
    if (existing && v === existing[k]) continue
    return { refusal: 'A before or after photo is added by uploading it to the visit (Add photo), not by naming an address.' }
  }
  return { set, drop }
}

/** The files behind a visit's photos, removed best-effort — the row is the source of truth (as recordPhotos.removeFiles). */
export function removeVisitPhotoFiles(d: CrmDeps, keys: Array<string | null | undefined>) {
  for (const k of keys) {
    if (!k) continue
    try { d.services.storage.deleteFile(k) } catch { /* nothing points at it any more */ }
  }
}

/** The refusal for a slot that is neither before nor after. */
export const unknownSlot = (c: Context) => fail(c, 404, 'A visit has a before photo and an after photo — nothing else.')
