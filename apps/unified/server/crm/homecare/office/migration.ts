// Assisted migration (row 10, docs/parity/homecare-import.md). Two doors to core/migration.ts:
//
//   /api/care-migration (the agency, care_migration, not ready)
//     GET  /requests                 the agency's requests, with their files, checklist and the imports staff ran
//     POST /requests                 multipart { fromSystem?, note?, files[] } — send the old system's export to Twomiah
//     GET  /requests/:id             one request
//     PUT  /requests/:id/old-counts  { counts: { clients: 120, … } } what the old system showed, for the comparison
//     GET  /requests/:id/comparison  old vs here, per record kind
//     PUT  /requests/:id/signoff     { item, done } — the agency's side of the checklist (signed with the person's name)
//     POST /requests/:id/cancel
//   Permissions: care-clients:create for all of it (the same as importing clients) — caregivers hold care-clients:read, and
//   this is office business.
//
//   /api/internal/care-migration (the Factory, X-Factory-Key; apps/api/src/unified/migration.ts is the caller)
//     GET  /requests  · GET /requests/:id  · GET /files/:id (the file, base64)  · GET /requests/:id/comparison
//     POST /requests/:id/import   { fileId, kind, by, mapping?, sheet?, dateFormat?, updateMatches?, edits?, dryRun? } — the same importer
//     POST /requests/:id/attach   { fileId, kind, by, dryRun?, dateFormat? }
//     PUT  /requests/:id/signoff  { item, done, by }   · PUT /requests/:id/status { status, staffNote? }
//     POST /batches/:id/undo      { by }
//   Each answers 403 FEATURE_NOT_ENABLED when the agency does not have care_migration, so the Factory cannot load data into
//   an agency that has not been given the feature.
import { Hono } from 'hono'
import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { holds } from '../hr/shared.ts'
import { uploadedForm } from '../core/upload.ts'
import { SIGNOFF_ITEMS, COUNTED_KINDS, MAX_MIGRATION_FILES, type MigrationFileIn } from '../core/migration.ts'
import { IMPORT_KINDS, KIND_LABEL, DATE_FORMATS, type DateFormat } from '../core/importRows.ts'
import { ATTACH_KINDS } from '../core/importAttach.ts'

const bodyOf = async (c: Context) => (await c.req.json().catch(() => ({}))) as any

export function createMigrationRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const me = (c: Context) => c.get('user' as never) as any
  /** The signed-in person's name, for the sign-off (the session carries only their id and email). */
  const name = async (u: any) => {
    const [row] = await d.db.select({ firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.id, String(u.userId || u.id))).limit(1)
    return `${row?.firstName ?? ''} ${row?.lastName ?? ''}`.trim() || String(u.email ?? u.userId ?? u.id)
  }

  app.get('/requests', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    return listAll(c, await core.migration.list(me(c).companyId))
  })

  app.post('/requests', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const user = me(c)
    const form = await uploadedForm(c)
    const files: MigrationFileIn[] = []
    for (const f of form.getAll('files')) if (f instanceof File) files.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })
    const single = form.get('file')
    if (single instanceof File) files.push({ name: single.name, data: Buffer.from(await single.arrayBuffer()) })
    if (files.length > MAX_MIGRATION_FILES) return fail(c, 400, `Send at most ${MAX_MIGRATION_FILES} files in one request.`, 'too_many_files')
    const out = await core.migration.create(user.companyId, String(user.userId || user.id), { fromSystem: form.get('fromSystem') as string | null, note: form.get('note') as string | null, files })
    if (!out || 'problem' in out) return fail(c, 400, out?.problem ?? 'Could not send.', out?.code)
    return one(c, out, 201)
  })

  app.get('/requests/:id', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const out = await core.migration.get(me(c).companyId, c.req.param('id'))
    return out ? one(c, out) : fail(c, 404, 'That request was not found.', 'not_found')
  })

  app.put('/requests/:id/old-counts', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const out = await core.migration.setOldCounts(me(c).companyId, c.req.param('id'), b.counts)
    if (!out) return fail(c, 404, 'That request was not found.', 'not_found')
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out)
  })

  app.get('/requests/:id/comparison', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const rows = await core.migration.comparison(me(c).companyId, c.req.param('id'))
    return rows ? listAll(c, rows) : fail(c, 404, 'That request was not found.', 'not_found')
  })

  app.put('/requests/:id/signoff', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const out = await core.migration.signoff(me(c).companyId, c.req.param('id'), { item: String(b.item ?? ''), done: b.done !== false, by: await name(me(c)), side: 'agency' })
    if (!out) return fail(c, 404, 'That request was not found.', 'not_found')
    if ('problem' in out) return fail(c, out.code === 'forbidden' ? 403 : 400, out.problem, out.code)
    return one(c, out)
  })

  app.post('/requests/:id/cancel', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const out = await core.migration.setStatus(me(c).companyId, c.req.param('id'), 'cancelled')
    if (!out) return fail(c, 404, 'That request was not found.', 'not_found')
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out)
  })

  app.get('/checklist', async (c) => {
    if (!(await holds(d, c, 'care-clients:create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    return one(c, { items: SIGNOFF_ITEMS, counted: COUNTED_KINDS })
  })

  return app
}

/** The Factory's door (X-Factory-Key). The company is the tenant's one company; the feature is checked on every call. */
export function createMigrationInternalRoutes(core: HomecareCore, d: CrmDeps, companyId: () => Promise<string | null>) {
  const app = new Hono<AppEnv>()
  const by = (b: any) => String(b.by ?? 'staff').slice(0, 120)

  app.use('*', async (c, next) => {
    const id = await companyId()
    if (!id) return fail(c, 503, 'This tenant has no business yet.', 'not_provisioned')
    if (!(await core.migration.enabled(id))) return fail(c, 403, 'This agency does not have assisted migration turned on.', 'FEATURE_NOT_ENABLED')
    c.set('companyId' as never, id as never)
    await next()
  })
  const co = (c: Context) => c.get('companyId' as never) as string

  app.get('/requests', async (c) => listAll(c, await core.migration.list(co(c))))
  app.get('/requests/:id', async (c) => {
    const out = await core.migration.get(co(c), c.req.param('id'))
    return out ? one(c, out) : fail(c, 404, 'That request was not found.', 'not_found')
  })
  app.get('/files/:id', async (c) => {
    const f = await core.migration.file(co(c), c.req.param('id'))
    return f ? one(c, { id: f.id, requestId: f.requestId, name: f.name, size: f.data.length, data: f.data.toString('base64') }) : fail(c, 404, 'That file was not found.', 'not_found')
  })
  app.get('/requests/:id/comparison', async (c) => {
    const rows = await core.migration.comparison(co(c), c.req.param('id'))
    return rows ? listAll(c, rows) : fail(c, 404, 'That request was not found.', 'not_found')
  })
  app.get('/kinds', async (c) => one(c, { kinds: IMPORT_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k] })), attach: ATTACH_KINDS, dateFormats: DATE_FORMATS, checklist: SIGNOFF_ITEMS }))
  app.post('/requests/:id/import', async (c) => {
    const b = await bodyOf(c)
    const out = await core.migration.runImport(co(c), c.req.param('id'), {
      fileId: String(b.fileId ?? ''), kind: b.kind, by: by(b), mapping: b.mapping && typeof b.mapping === 'object' ? b.mapping : undefined, sheet: typeof b.sheet === 'string' ? b.sheet : undefined,
      dateFormat: DATE_FORMATS.includes(b.dateFormat) ? (b.dateFormat as DateFormat) : undefined, updateMatches: b.updateMatches === true, edits: Array.isArray(b.edits) ? b.edits : undefined, dryRun: b.dryRun === true,
    })
    if ('problem' in out) return fail(c, out.code === 'not_found' ? 404 : 400, out.problem, out.code)
    return one(c, out, b.dryRun === true ? 200 : 201)
  })
  app.post('/requests/:id/attach', async (c) => {
    const b = await bodyOf(c)
    const out = await core.migration.runAttach(co(c), c.req.param('id'), { fileId: String(b.fileId ?? ''), kind: b.kind, by: by(b), dryRun: b.dryRun === true, dateFormat: DATE_FORMATS.includes(b.dateFormat) ? (b.dateFormat as DateFormat) : undefined })
    if ('problem' in out) return fail(c, out.code === 'not_found' ? 404 : 400, out.problem, out.code)
    return one(c, out, b.dryRun === true ? 200 : 201)
  })
  app.put('/requests/:id/signoff', async (c) => {
    const b = await bodyOf(c)
    const out = await core.migration.signoff(co(c), c.req.param('id'), { item: String(b.item ?? ''), done: b.done !== false, by: by(b), side: 'staff' })
    if (!out) return fail(c, 404, 'That request was not found.', 'not_found')
    if ('problem' in out) return fail(c, out.code === 'forbidden' ? 403 : 400, out.problem, out.code)
    return one(c, out)
  })
  app.put('/requests/:id/status', async (c) => {
    const b = await bodyOf(c)
    const out = await core.migration.setStatus(co(c), c.req.param('id'), String(b.status ?? ''), b.staffNote)
    if (!out) return fail(c, 404, 'That request was not found.', 'not_found')
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out)
  })
  app.post('/batches/:id/undo', async (c) => {
    const b = await bodyOf(c)
    const out = await core.csvImport.undo(co(c), `factory:${by(b)}`, c.req.param('id'))
    if (out.notFound) return fail(c, 404, 'That import was not found.', 'not_found')
    if (out.problem) return fail(c, 409, out.problem, out.code)
    return one(c, out)
  })
  app.get('/ping', (c) => done(c))

  return app
}
