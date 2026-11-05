// /api/care-import — bring an agency's records in from a spreadsheet (item 1 and parity rows 8–9, docs/parity/homecare-import.md).
// Mounted only for an agency with care_import (not ready). The work is core/csvImport.ts and core/importAttach.ts.
//
//   GET  /kinds               the kinds this person may import, and which features are on
//   GET  /template/:kind      the header row and an example row to start a file from
//   POST /preview             { kind, csv | xlsx (base64), sheet?, mapping?, dateFormat?, edits?, updateMatches? } → columns matched to fields
//                             (a saved mapping reused when the headings match), every row checked (ok / duplicate / update / error). Writes nothing.
//   POST /commit              the same body + fileName?, dryRun? → creates the good rows, updates the matched ones when asked (the owner's
//                             overwritable fields), skips the rest and says why. dryRun:true answers what it WOULD do and writes nothing.
//   POST /attach              multipart { kind: documents | qualifications, file: a zip, dryRun?, dateFormat? } → attached / skipped / failed
//   GET  /batches             past imports (of the kinds the person may import)
//   POST /batches/:id/undo    removes what the import created, puts back what it updated, keeping anything already used
//   GET  /mappings/:kind      saved column mappings       POST /mappings { kind, name, headers, mapping }       DELETE /mappings/:id
//   GET  /overwrite/:kind     the fields a re-import may overwrite, and which may be chosen       PUT /overwrite/:kind { fields } (owner / admin)
//   GET  /custom-fields/:entity/:id   a record's custom fields (client | caregiver | payer)
//
// Permissions: the same as adding one by hand, per kind (IMPORT_PERMISSION / ATTACH_PERMISSION); undo asks that area's :delete.
// Features: item 1's three kinds need care_import; the other kinds care_import_all; Excel, pasted data, saved mappings, a date
// format, inline fixes, update-in-place and the zip attach care_import_wizard.
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { holds } from '../hr/shared.ts'
import { uploadedForm } from '../core/upload.ts'
import { IMPORT_KINDS, BASE_KINDS, IMPORT_PERMISSION, UPDATABLE_FIELDS, KIND_LABEL, type ImportKind } from '../core/csvImport.ts'
import { FIELDS, DATE_FORMATS, DATE_FORMAT_LABEL, templateCsv, type DateFormat } from '../core/importRows.ts'
import { ATTACH_KINDS, ATTACH_PERMISSION, ATTACH_LABEL, type AttachKind } from '../core/importAttach.ts'

const ENTITIES = ['client', 'caregiver', 'payer'] as const

export function createCsvImportRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const kindOf = (v: unknown): ImportKind | null => (IMPORT_KINDS as readonly string[]).includes(String(v)) ? (String(v) as ImportKind) : null
  const me = (c: Context) => c.get('user' as never) as any
  const notReady = (c: Context, feature: string) => fail(c, 403, `This part of importing (${feature}) is not turned on for this agency.`, 'FEATURE_NOT_ENABLED')

  /** Whether the person may import (or undo) at least one kind — asked before anything in the request is looked at. */
  async function mayAny(c: Context, verb: 'create' | 'delete'): Promise<boolean> {
    for (const k of IMPORT_KINDS) if (await holds(d, c, IMPORT_PERMISSION[k][verb])) return true
    return false
  }

  /** The kind in the request, if the person may import it and the agency has it; otherwise the refusal. */
  async function allowed(c: Context, v: unknown, verb: 'create' | 'delete'): Promise<ImportKind | Response> {
    // the permission first, before the kind is even looked at: a caregiver learns nothing from a validation message
    if (!(await mayAny(c, verb))) return fail(c, 403, 'Permission denied', 'forbidden')
    const kind = kindOf(v)
    if (!kind) return fail(c, 400, `kind must be one of: ${IMPORT_KINDS.join(', ')}.`, 'bad_kind')
    if (!(await holds(d, c, IMPORT_PERMISSION[kind][verb]))) return fail(c, 403, 'Permission denied', 'forbidden')
    if (!BASE_KINDS.includes(kind) && !(await core.csvImport.enabledAll(me(c).companyId))) return notReady(c, 'care_import_all')
    return kind
  }

  /** Does the body use a row-9 wizard option? Then the agency needs care_import_wizard. */
  const usesWizard = (b: any) => !!(b.xlsx || b.edits?.length || (b.dateFormat && b.dateFormat !== 'mdy') || b.updateMatches || (typeof b.csv === 'string' && b.csv.includes('\t')))
  async function wizardOk(c: Context, b: any): Promise<Response | null> {
    if (!usesWizard(b)) return null
    return (await core.csvImport.enabledWizard(me(c).companyId)) ? null : notReady(c, 'care_import_wizard')
  }
  const bodyOf = async (c: Context) => (await c.req.json().catch(() => ({}))) as any
  const inputOf = (kind: ImportKind, b: any) => ({
    kind, csv: typeof b.csv === 'string' ? b.csv : undefined, xlsx: typeof b.xlsx === 'string' ? b.xlsx : undefined, sheet: typeof b.sheet === 'string' ? b.sheet : undefined,
    mapping: b.mapping && typeof b.mapping === 'object' ? b.mapping : undefined, dateFormat: DATE_FORMATS.includes(b.dateFormat) ? (b.dateFormat as DateFormat) : undefined,
    edits: Array.isArray(b.edits) ? b.edits.slice(0, 2000) : undefined, updateMatches: b.updateMatches === true, fileName: b.fileName,
  })

  app.get('/kinds', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const { companyId } = me(c)
    const [all, wizard] = await Promise.all([core.csvImport.enabledAll(companyId), core.csvImport.enabledWizard(companyId)])
    const kinds: Array<{ kind: string; label: string; mayUndo: boolean; attach?: boolean }> = []
    for (const k of IMPORT_KINDS) {
      if (!BASE_KINDS.includes(k) && !all) continue
      if (await holds(d, c, IMPORT_PERMISSION[k].create)) kinds.push({ kind: k, label: KIND_LABEL[k], mayUndo: await holds(d, c, IMPORT_PERMISSION[k].delete) })
    }
    if (wizard) for (const k of ATTACH_KINDS) if (await holds(d, c, ATTACH_PERMISSION[k].create)) kinds.push({ kind: k, label: ATTACH_LABEL[k], mayUndo: await holds(d, c, ATTACH_PERMISSION[k].delete), attach: true })
    return one(c, { kinds, features: { all, wizard }, dateFormats: DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABEL[f] })), mayChooseOverwrite: ['owner', 'admin'].includes(String(me(c).role)) })
  })

  app.get('/template/:kind', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const kind = await allowed(c, c.req.param('kind'), 'create')
    if (kind instanceof Response) return kind
    return one(c, { kind, ...templateCsv(kind) })
  })

  app.post('/preview', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const kind = await allowed(c, b.kind, 'create')
    if (kind instanceof Response) return kind
    const gate = await wizardOk(c, b)
    if (gate) return gate
    const out = await core.csvImport.analyze(me(c).companyId, inputOf(kind, b))
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out)
  })

  app.post('/commit', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const kind = await allowed(c, b.kind, 'create')
    if (kind instanceof Response) return kind
    const gate = await wizardOk(c, b)
    if (gate) return gate
    const user = me(c)
    if (b.dryRun === true) {
      const out = await core.csvImport.analyze(user.companyId, inputOf(kind, b))
      if ('problem' in out) return fail(c, 400, out.problem, out.code)
      if (!out.ready) return fail(c, 400, `Match a column to: ${out.missingRequired.join(', ')}.`, 'missing_fields')
      return one(c, {
        dryRun: true, kind, wouldCreate: out.counts.ok, wouldUpdate: out.counts.updates, wouldSkipDuplicates: out.counts.duplicates, wouldSkipBadRows: out.counts.errors,
        rows: out.rows.map(({ values: _v, cells: _c, ...r }) => r),
        note: kind === 'caregivers' ? 'Each new caregiver takes a seat; rows past the plan\'s last free seat are counted as problems above, the same as the real run refuses them.' : undefined,
      })
    }
    const out = await core.csvImport.commit(user.companyId, String(user.userId || user.id), inputOf(kind, b))
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out, 201)
  })

  app.post('/attach', async (c) => {
    const user = me(c)
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    if (!(await core.csvImport.enabledWizard(user.companyId))) return notReady(c, 'care_import_wizard')
    const form = await uploadedForm(c)
    const kind = String(form.get('kind') ?? '') as AttachKind
    if (!ATTACH_KINDS.includes(kind)) return fail(c, 400, 'kind must be documents or qualifications.', 'bad_kind')
    if (!(await holds(d, c, ATTACH_PERMISSION[kind].create))) return fail(c, 403, 'Permission denied', 'forbidden')
    const file = form.get('file')
    if (!(file instanceof File) || !file.size) return fail(c, 400, 'Choose a zip file.', 'empty_file')
    const df = String(form.get('dateFormat') ?? '')
    const out = await core.importAttach.attach(user.companyId, String(user.userId || user.id), {
      kind, zip: Buffer.from(await file.arrayBuffer()), fileName: file.name, dryRun: String(form.get('dryRun') ?? '') === 'true', dateFormat: DATE_FORMATS.includes(df as DateFormat) ? (df as DateFormat) : undefined,
    })
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out, out.dryRun ? 200 : 201)
  })

  app.get('/batches', async (c) => {
    const { companyId } = me(c)
    const kinds: string[] = []
    for (const k of IMPORT_KINDS) if (await holds(d, c, IMPORT_PERMISSION[k].create)) kinds.push(k)
    for (const k of ATTACH_KINDS) if (await holds(d, c, ATTACH_PERMISSION[k].create)) kinds.push(k)
    if (!kinds.length) return fail(c, 403, 'Permission denied', 'forbidden')
    const rows = await core.csvImport.batches(companyId, kinds)
    return listAll(c, rows.map((b: any) => ({ ...b, kindLabel: (KIND_LABEL as any)[b.kind] ?? (ATTACH_LABEL as any)[b.kind] ?? b.kind })))
  })

  app.post('/batches/:id/undo', async (c) => {
    if (!(await mayAny(c, 'delete'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const user = me(c)
    const kind = await core.csvImport.batchKind(user.companyId, c.req.param('id'))
    if (!kind) return fail(c, 404, 'That import was not found.', 'not_found')
    const perm = (IMPORT_PERMISSION as any)[kind]?.delete ?? (ATTACH_PERMISSION as any)[kind]?.delete
    if (!perm || !(await holds(d, c, perm))) return fail(c, 403, 'Permission denied', 'forbidden')
    const out = await core.csvImport.undo(user.companyId, String(user.userId || user.id), c.req.param('id'))
    if (out.notFound) return fail(c, 404, 'That import was not found.', 'not_found')
    if (out.problem) return fail(c, 409, out.problem, out.code)
    return one(c, out)
  })

  // ---- saved mappings (row 9) ----
  app.get('/mappings/:kind', async (c) => {
    const kind = await allowed(c, c.req.param('kind'), 'create')
    if (kind instanceof Response) return kind
    if (!(await core.csvImport.enabledWizard(me(c).companyId))) return notReady(c, 'care_import_wizard')
    return listAll(c, await core.csvImport.savedMappings(me(c).companyId, kind))
  })
  app.post('/mappings', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const kind = await allowed(c, b.kind, 'create')
    if (kind instanceof Response) return kind
    const user = me(c)
    if (!(await core.csvImport.enabledWizard(user.companyId))) return notReady(c, 'care_import_wizard')
    const out = await core.csvImport.saveMapping(user.companyId, String(user.userId || user.id), { kind, name: b.name, headers: b.headers, mapping: b.mapping })
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out, out.replaced ? 200 : 201)
  })
  app.delete('/mappings/:id', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    if (!(await core.csvImport.deleteMapping(me(c).companyId, c.req.param('id')))) return fail(c, 404, 'That mapping was not found.', 'not_found')
    return done(c)
  })

  // ---- the owner's overwritable fields (row 9: re-import updates matched records) ----
  app.get('/overwrite/:kind', async (c) => {
    const kind = await allowed(c, c.req.param('kind'), 'create')
    if (kind instanceof Response) return kind
    const fields = await core.csvImport.overwritable(me(c).companyId, kind)
    return one(c, { kind, fields, choices: UPDATABLE_FIELDS[kind].map((k) => ({ key: k, label: FIELDS[kind].find((f) => f.key === k)?.label ?? k })) })
  })
  app.put('/overwrite/:kind', async (c) => {
    const kind = await allowed(c, c.req.param('kind'), 'create')
    if (kind instanceof Response) return kind
    const user = me(c)
    if (!['owner', 'admin'].includes(String(user.role))) return fail(c, 403, 'Only the owner or an admin decides which fields a re-import may overwrite.', 'forbidden')
    if (!(await core.csvImport.enabledWizard(user.companyId))) return notReady(c, 'care_import_wizard')
    const b = await bodyOf(c)
    const out = await core.csvImport.setOverwritable(user.companyId, kind, b.fields)
    if (!Array.isArray(out)) return fail(c, 400, out.problem, 'invalid')
    return one(c, { kind, fields: out })
  })

  app.get('/custom-fields/:entity/:id', async (c) => {
    const entity = c.req.param('entity') as (typeof ENTITIES)[number]
    if (!ENTITIES.includes(entity)) return fail(c, 400, 'entity must be client, caregiver or payer.', 'invalid')
    const perm = entity === 'client' ? 'care-clients:read' : entity === 'caregiver' ? 'care-hr:read' : 'care-billing:read'
    if (!(await holds(d, c, perm))) return fail(c, 403, 'Permission denied', 'forbidden')
    return listAll(c, await core.csvImport.customFields(me(c).companyId, entity, c.req.param('id')))
  })

  return app
}
