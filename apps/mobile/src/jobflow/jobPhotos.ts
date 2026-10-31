/**
 * A job's photos taken with no signal — pure TypeScript, tested by tests/mobile/job-photos-offline.test.ts.
 *
 * The photo stays a FILE on the phone (the camera's address) and the save goes through the offline queue (../offline/README.md,
 * localPhotos.ts): just before the send each file is uploaded to POST /api/jobs/:id/photos/file under a name made from the
 * save's id (so a retry replaces the file, never adds one), then POST /api/jobs/:id/photos/saved records the addresses on the
 * job. With signal it goes at once; without, it waits and the strip shows the picture with "Waiting to send".
 */
import type { ItemView, NewItem } from '../offline/engine'

export const photosKey = (jobId: string) => `jobphotos:${jobId}`
const savedPath = (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}/photos/saved`
const filePath = (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}/photos/file`

/** The save the gallery hands the offline queue for the pictures just taken. */
export function jobPhotoRequest(jobId: string, uris: string[], label: string): NewItem {
  return { method: 'POST', path: savedPath(jobId), body: { $photos: { uploadTo: filePath(jobId), uris } }, recordKey: photosKey(jobId), label }
}

export interface PendingPhoto { uri: string; itemId: string; state: 'waiting' | 'sending' | 'failed'; message?: string }

/** The pictures of this job still on the phone: waiting to be sent, being sent, or refused by the server. */
export function pendingJobPhotos(queue: Array<Pick<ItemView, 'id' | 'path' | 'method' | 'state' | 'body' | 'refusal'>>, jobId: string): PendingPhoto[] {
  return queue
    .filter((q) => q.method === 'POST' && q.path === savedPath(jobId))
    .flatMap((q) => ((q.body as any)?.$photos?.uris ?? []).map((uri: string) => ({
      uri, itemId: q.id, state: q.state as PendingPhoto['state'], ...(q.refusal?.message ? { message: q.refusal.message } : {}),
    })))
}
