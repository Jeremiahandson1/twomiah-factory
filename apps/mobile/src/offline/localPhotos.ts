/**
 * Photos in the offline queue — pure TypeScript, tested by tests/mobile/offline-photos.test.ts.
 *
 * A queued save stays JSON (./engine.ts), so a photo is never the picture itself in the queue: the save carries the
 * camera's FILE addresses under `$photos` { uploadTo, uris }, and just before it is sent each file is read and uploaded
 * to `uploadTo` (a route answering { url }), then the save goes with `photos` = those addresses. Each photo is uploaded
 * under a name made from the save's id and its place, so a retry after a lost reply replaces the file, never adds one.
 *
 *   · the file is checked first and uploaded by its address (React Native's FormData takes a file address, not bytes);
 *   · no answer, 401, 408, 425, 429 or a 5xx on an upload → the whole save waits and is tried again (the engine's rules);
 *   · a photo whose file is gone from the phone, or that the server refuses as a picture, is left off — the save still
 *     goes, and its `notes` say how many were left off, so the rep and the office both see it;
 *   · the place the save is going refused (404: the session is not there) → the save fails with that refusal.
 */

export interface PhotosSpec { uploadTo: string; uris: string[] }
/** Is the camera's file still on the phone? */
export type FileExists = (uri: string) => Promise<boolean>
export type UploadPhoto = (path: string, name: string, uri: string) => Promise<{ status: number; data?: any }>

const RETRY = new Set([0, 401, 408, 425, 429])
const waits = (status: number) => RETRY.has(status) || status >= 500

export const photoName = (saveId: string, index: number) => `${saveId.replace(/[^A-Za-z0-9_-]/g, '')}-${index}`.slice(0, 80)

/** What a save carrying `$photos` becomes once its photos are uploaded — or the status to answer the engine with instead. */
export async function withUploadedPhotos(saveId: string, body: any, exists: FileExists, upload: UploadPhoto): Promise<{ body: any } | { status: number; data?: any }> {
  const spec: PhotosSpec | undefined = body?.$photos
  if (!spec) return { body }
  const { $photos: _drop, ...rest } = body
  const urls: string[] = []
  let leftOff = 0
  for (const [i, uri] of (spec.uris || []).entries()) {
    let there = false
    try { there = await exists(uri) } catch { there = false }
    if (!there) { leftOff++; continue }
    let r: { status: number; data?: any }
    try { r = await upload(spec.uploadTo, photoName(saveId, i), uri) } catch { r = { status: 0 } }
    if (r.status >= 200 && r.status < 300 && typeof r.data?.url === 'string') { urls.push(r.data.url); continue }
    if (waits(r.status)) return { status: r.status, data: r.data }
    if (r.status === 404) return { status: 404, data: r.data }
    leftOff++
  }
  const note = leftOff ? `(${leftOff} photo${leftOff === 1 ? '' : 's'} could not be sent from the phone)` : ''
  return { body: { ...rest, photos: urls, ...(note ? { notes: [rest.notes, note].filter(Boolean).join('\n') } : {}) } }
}
