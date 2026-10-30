// The crew's half of a work order: the private link they were texted, /w/<token> on the app, answered here at
// /api/crew-link/:token — no sign-in. Public (the registry mounts it for the feature roof_work_orders and answers 404
// while that is off).
//
//   GET  /:token                       the work order: scope, address, start date, materials (no prices), photos
//   POST /:token/accept   { name }     "I'll do it" — the crew lead's full name, as Roofr's crew approval asks for
//   POST /:token/reject   { name, reason }
//   POST /:token/photos   photo        a photo of the work, while it is accepted (kept on the job too)
//   POST /:token/complete { note }     done — with the photos sent so far
//   GET  /:token/photos/:photoId       one of THIS work order's photos
//
// What the link is: the token looked up by exact match in work_order.public_token (a 64-hex random value, so it cannot be
// guessed), refused once it has run out (410). Everything below reads and writes the one row the token names; no id from
// the request ever picks a work order, and a photo is served only when it is on that row's own lists. A wrong or malformed
// token answers the same 404 as an unknown one, so nothing says which tokens exist.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { isDocumentToken, sniffType } from '@twomiah/tenant-backend'
import { company, job, jobNote, jobPhoto, workOrder } from '../../db/schema/index.ts'
import { EVENTS } from '../../core/realtime.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { createGuessLimiter, TOKEN_GUESS_MAX, TOKEN_GUESS_WINDOW_MS } from '../../http/guards.ts'
import { uploadedForm } from '../office/upload.ts'
import type { CrmDeps } from '../deps.ts'
import { noteAuthor } from './workOrders.ts'

const PHOTO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const MAX_COMPLETION_PHOTOS = 20
const MEDIA_PREFIX = '/media/'
const PHOTO_KINDS = ['before', 'during', 'after']

const nameSchema = z.string().trim().min(2, 'Enter your full name.').max(80)
const rejectSchema = z.object({ name: nameSchema, reason: z.string().trim().min(1, 'Say why you cannot take it.').max(500) })
const acceptSchema = z.object({ name: nameSchema })
const completeSchema = z.object({ note: z.string().trim().max(2000).optional(), name: z.string().trim().max(80).optional() })

export function createCrewLinkRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv & { Variables: { wo: any } }>()
  // Guessing: an address that keeps missing is shut out and gets the same "not valid" a wrong token gets (never a 429).
  const guesses = createGuessLimiter(TOKEN_GUESS_WINDOW_MS, TOKEN_GUESS_MAX)

  // Every door below: the token names the work order (c.get('wo')), or the door is shut.
  app.use('/:token', tokenGate)
  app.use('/:token/*', tokenGate)
  async function tokenGate(c: any, next: any) {
    const token = c.req.param('token')
    if (guesses.shut(c)) return fail(c, 404, 'This link is not valid.')
    if (!isDocumentToken(token)) { guesses.miss(c); return fail(c, 404, 'This link is not valid.') }
    const [row] = await db.select().from(workOrder).where(eq(workOrder.publicToken, token)).limit(1)
    if (!row) { guesses.miss(c); return fail(c, 404, 'This link is not valid.') }
    if (row.tokenExpiresAt && new Date(row.tokenExpiresAt) < new Date()) return fail(c, 410, 'This link has run out. Ask the office to send you a new one.', 'link_expired')
    c.set('wo', row)
    await next()
  }

  const photoUrl = (token: string, id: string) => `/api/crew-link/${token}/photos/${id}`

  /** What the crew sees: the work and nothing about the homeowner, the price, or any other record. */
  async function crewView(row: any) {
    const ids = [...(row.photoIds as string[]), ...(row.completionPhotoIds as string[])]
    const photos = ids.length ? await db.select().from(jobPhoto).where(and(eq(jobPhoto.companyId, row.companyId), eq(jobPhoto.jobId, row.jobId), inArray(jobPhoto.id, ids))) : []
    const shape = (list: string[]) => photos.filter((p: any) => list.includes(p.id)).map((p: any) => ({ id: p.id, url: photoUrl(row.publicToken, p.id), caption: p.caption || null }))
    const [co] = await db.select({ name: company.name, phone: company.phone, logo: company.logo }).from(company).where(eq(company.id, row.companyId)).limit(1)
    const open = !['completed', 'cancelled'].includes(row.status)
    return {
      title: row.title, scope: row.scope, address: row.address, startDate: row.startDate, recipientName: row.recipientName,
      status: row.status, company: { name: co?.name ?? null, phone: co?.phone ?? null, logo: co?.logo ?? null },
      materials: (row.materialLines as any[]).map((m) => ({ description: m.description, qty: m.qty, unit: m.unit })),
      photos: shape(row.photoIds), completionPhotos: shape(row.completionPhotoIds),
      respondedByName: row.respondedByName, rejectReason: row.rejectReason, completedAt: row.completedAt, completionNote: row.completionNote,
      expiresAt: row.tokenExpiresAt,
      // What the crew may do from here (the screen offers exactly these).
      can: { accept: row.status === 'sent', reject: row.status === 'sent' || row.status === 'accepted', photos: row.status === 'accepted', complete: row.status === 'accepted' },
      cancelled: row.status === 'cancelled', open,
    }
  }

  async function jobNoteFor(row: any, body: string) {
    const [jobRow] = await db.select().from(job).where(and(eq(job.id, row.jobId), eq(job.companyId, row.companyId))).limit(1)
    const author = await noteAuthor(db, row.companyId, jobRow)
    if (author) { try { await db.insert(jobNote).values({ companyId: row.companyId, jobId: row.jobId, userId: author, body, isInternal: true } as any) } catch { /* a note never holds up the crew */ } }
    d.realtime.emitToCompany(row.companyId, EVENTS.REFRESH, { entity: 'work_order', id: row.id })
  }

  /** A change of state written only from the state it is allowed from, so a double tap or two phones change it once. */
  const move = async (row: any, from: string[], set: Record<string, unknown>) =>
    (await db.update(workOrder).set({ ...set, updatedAt: new Date() } as any)
      .where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, row.companyId), inArray(workOrder.status, from))).returning())[0]
  const wrong = (c: any, row: any, what: string) => fail(c, 409, row.status === 'cancelled' ? 'The office cancelled this work order.' : `This work order is ${row.status}, so you cannot ${what} it.`, 'wrong_status')

  app.get('/:token', async (c) => one(c, await crewView(c.get('wo'))))

  app.post('/:token/accept', async (c) => {
    const row = c.get('wo')
    const parsed = acceptSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Enter your full name.', 'validation_failed', { name: parsed.error.issues[0]?.message || 'Enter your full name.' })
    if (row.status !== 'sent') return wrong(c, row, 'accept')
    const moved = await move(row, ['sent'], { status: 'accepted', respondedAt: new Date(), respondedByName: parsed.data.name, rejectReason: null })
    if (!moved) return wrong(c, (await currentOf(row)) ?? row, 'accept')
    await jobNoteFor(row, `Work order "${row.title}" accepted by ${parsed.data.name}.`)
    return one(c, await crewView(moved))
  })

  app.post('/:token/reject', async (c) => {
    const row = c.get('wo')
    const parsed = rejectSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return fail(c, 400, issue?.message || 'Enter your name and a reason.', 'validation_failed', { [String(issue?.path[0] ?? 'reason')]: issue?.message || 'Required.' })
    }
    if (!['sent', 'accepted'].includes(row.status)) return wrong(c, row, 'reject')
    const moved = await move(row, ['sent', 'accepted'], { status: 'rejected', respondedAt: new Date(), respondedByName: parsed.data.name, rejectReason: parsed.data.reason })
    if (!moved) return wrong(c, (await currentOf(row)) ?? row, 'reject')
    await jobNoteFor(row, `Work order "${row.title}" rejected by ${parsed.data.name}: ${parsed.data.reason}`)
    return one(c, await crewView(moved))
  })

  app.post('/:token/photos', async (c) => {
    const row = c.get('wo')
    if (row.status !== 'accepted') return fail(c, 409, row.status === 'sent' ? 'Accept the work order before you add photos.' : `This work order is ${row.status}, so photos cannot be added.`, 'wrong_status')
    if ((row.completionPhotoIds as string[]).length >= MAX_COMPLETION_PHOTOS) return fail(c, 400, `Up to ${MAX_COMPLETION_PHOTOS} photos on one work order.`)
    const form = await uploadedForm(c)
    const file = form.get('photo') as File | null
    if (!file || typeof file === 'string') return fail(c, 400, 'No photo provided')
    if (file.size > MAX_PHOTO_SIZE) return fail(c, 400, 'Photo exceeds 10MB limit')
    const kind = String(form.get('photoType') || 'after')
    if (!PHOTO_KINDS.includes(kind)) return fail(c, 400, `photoType must be one of: ${PHOTO_KINDS.join(', ')}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = sniffType(buffer) || ''
    if (!PHOTO_EXT[type]) return fail(c, 400, 'That file is not an image. JPEG, PNG, GIF and WebP are supported.')
    if (d.services.storage.storageConfigured && !d.services.storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    const key = `photos/${row.companyId}/${row.jobId}/${crypto.randomUUID().replace(/-/g, '')}.${PHOTO_EXT[type]}`
    await d.services.storage.put(key, buffer, type)
    const caption = String(form.get('caption') || '').trim().slice(0, 200) || `Work order: ${row.title} (${row.respondedByName || row.recipientName})`
    const [photo] = await db.insert(jobPhoto).values({
      companyId: row.companyId, jobId: row.jobId, uploadedById: null, photoType: kind, url: MEDIA_PREFIX + key, caption, takenAt: new Date(),
    } as any).returning()
    // Added to THIS work order's list under a row lock, so two photos sent at once are both kept, and a work order the
    // office cancelled in the meantime takes none.
    const updated = await db.transaction(async (tx: any) => {
      const [cur] = await tx.select().from(workOrder).where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, row.companyId))).for('update')
      if (!cur || cur.status !== 'accepted') return undefined
      const [u] = await tx.update(workOrder).set({ completionPhotoIds: [...(cur.completionPhotoIds as string[]), photo.id], updatedAt: new Date() } as any)
        .where(eq(workOrder.id, row.id)).returning()
      return u
    })
    if (!updated) {
      await db.delete(jobPhoto).where(eq(jobPhoto.id, photo.id))
      try { await d.services.storage.deleteFile(key) } catch { /* the row was the record */ }
      return fail(c, 409, 'This work order is no longer open for photos.', 'wrong_status')
    }
    return one(c, { id: photo.id, url: photoUrl(row.publicToken, photo.id), caption }, 201)
  })

  app.post('/:token/complete', async (c) => {
    const row = c.get('wo')
    const parsed = completeSchema.safeParse(await c.req.json().catch(() => ({})) ?? {})
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Invalid', 'validation_failed')
    if (row.status !== 'accepted') return wrong(c, row, 'complete')
    const moved = await move(row, ['accepted'], { status: 'completed', completedAt: new Date(), completionNote: parsed.data.note || null })
    if (!moved) return wrong(c, (await currentOf(row)) ?? row, 'complete')
    const n = (moved.completionPhotoIds as string[]).length
    await jobNoteFor(row, `Work order "${row.title}" completed by ${row.respondedByName || row.recipientName}${n ? ` with ${n} photo${n === 1 ? '' : 's'}` : ''}.${parsed.data.note ? ` ${parsed.data.note}` : ''}`)
    return one(c, await crewView(moved))
  })

  app.get('/:token/photos/:photoId', async (c) => {
    const row = c.get('wo')
    const id = c.req.param('photoId')
    // Only a photo on THIS work order's own lists: another job's photo, or another work order's, is not here.
    if (![...(row.photoIds as string[]), ...(row.completionPhotoIds as string[])].includes(id)) return fail(c, 404, 'Photo not found')
    const [photo] = await db.select().from(jobPhoto).where(and(eq(jobPhoto.id, id), eq(jobPhoto.companyId, row.companyId), eq(jobPhoto.jobId, row.jobId))).limit(1)
    if (!photo || !String(photo.url).startsWith(MEDIA_PREFIX)) return fail(c, 404, 'Photo not found')
    const obj = await (d.services.storage as any).getObject(String(photo.url).slice(MEDIA_PREFIX.length)).catch(() => null)
    if (!obj || !String(obj.contentType || '').startsWith('image/')) return fail(c, 404, 'Photo not found')
    return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' } })
  })

  async function currentOf(row: any) {
    return (await db.select().from(workOrder).where(eq(workOrder.id, row.id)).limit(1))[0]
  }

  return app
}
