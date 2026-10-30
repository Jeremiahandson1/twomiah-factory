// /api/care-import — bring an agency's clients, caregivers and recurring shifts in from a spreadsheet (item 1, docs/parity/homecare-import.md).
// Mounted only for an agency with care_import (not ready). The work is core/csvImport.ts.
//
//   GET  /template/:kind      the header row and an example row to start a file from
//   POST /preview             { kind, csv, mapping? } → columns matched to fields, every row checked (ok / duplicate / error). Writes nothing.
//   POST /commit              { kind, csv, mapping?, fileName?, dryRun? } → creates the good rows, skips duplicates and bad rows and says why.
//                             dryRun:true answers what it WOULD do and writes nothing.
//   GET  /batches             past imports (of the kinds the person may import)
//   POST /batches/:id/undo    removes what the import created, keeping anything already used
//
// Permissions: the same as adding one by hand, per kind — clients care-clients:create, caregivers care-hr:create, recurring shifts
// care-schedule:create; undo asks that area's :delete.
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { holds } from '../hr/shared.ts'
import { IMPORT_KINDS, IMPORT_PERMISSION, type ImportKind } from '../core/csvImport.ts'
import { FIELDS } from '../core/importRows.ts'

const EXAMPLE: Record<ImportKind, string[]> = {
  clients: ['Maria', 'Lopez', '1948-03-15', 'Female', '(715) 555-0100', 'maria@example.com', '12 Oak St', 'Eau Claire', 'WI', '54701', '2026-01-05', 'Personal care', '', 'no', '', ''],
  caregivers: ['Sam', 'Reed', 'sam.reed@example.com', '(715) 555-0111', '2025-06-01', '18.50', '12 Oak St', 'Eau Claire', 'WI', '54701'],
  schedules: ['Maria Lopez', 'sam.reed@example.com', 'Monday', '9:00 AM', '1:00 PM', 'weekly', '', '', ''],
}

export function createCsvImportRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const kindOf = (v: unknown): ImportKind | null => (IMPORT_KINDS as readonly string[]).includes(String(v)) ? (String(v) as ImportKind) : null

  /** Whether the person may import (or undo) at least one kind — asked before anything in the request is looked at. */
  async function mayAny(c: Context, verb: 'create' | 'delete'): Promise<boolean> {
    for (const k of IMPORT_KINDS) if (await holds(d, c, IMPORT_PERMISSION[k][verb])) return true
    return false
  }

  /** The kind in the request, if the person may import it; otherwise the refusal. */
  async function allowed(c: Context, v: unknown, verb: 'create' | 'delete'): Promise<ImportKind | Response> {
    const kind = kindOf(v)
    if (!kind) return fail(c, 400, 'kind must be clients, caregivers or schedules.', 'bad_kind')
    if (!(await holds(d, c, IMPORT_PERMISSION[kind][verb]))) return fail(c, 403, 'Permission denied', 'forbidden')
    return kind
  }

  app.get('/template/:kind', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const kind = await allowed(c, c.req.param('kind'), 'create')
    if (kind instanceof Response) return kind
    const defs = FIELDS[kind].filter((f) => f.key !== 'fullName')
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    return one(c, { kind, headers: defs.map((f) => f.label), csv: `${defs.map((f) => q(f.label)).join(',')}\n${EXAMPLE[kind].slice(0, defs.length).map(q).join(',')}\n` })
  })

  const bodyOf = async (c: Context) => (await c.req.json().catch(() => ({}))) as any

  app.post('/preview', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const kind = await allowed(c, b.kind, 'create')
    if (kind instanceof Response) return kind
    const { companyId } = c.get('user' as never) as any
    const out = await core.csvImport.analyze(companyId, { kind, csv: b.csv, mapping: b.mapping })
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out)
  })

  app.post('/commit', async (c) => {
    if (!(await mayAny(c, 'create'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const b = await bodyOf(c)
    const kind = await allowed(c, b.kind, 'create')
    if (kind instanceof Response) return kind
    const user = c.get('user' as never) as any
    if (b.dryRun === true) {
      const out = await core.csvImport.analyze(user.companyId, { kind, csv: b.csv, mapping: b.mapping })
      if ('problem' in out) return fail(c, 400, out.problem, out.code)
      if (!out.ready) return fail(c, 400, `Match a column to: ${out.missingRequired.join(', ')}.`, 'missing_fields')
      return one(c, {
        dryRun: true, kind, wouldCreate: out.counts.ok, wouldSkipDuplicates: out.counts.duplicates, wouldSkipBadRows: out.counts.errors,
        rows: out.rows.map(({ values: _v, ...r }) => r),
        note: kind === 'caregivers' ? 'Each new caregiver takes a seat; if the plan is full the rest are refused when you run it for real.' : undefined,
      })
    }
    const out = await core.csvImport.commit(user.companyId, String(user.userId || user.id), { kind, csv: b.csv, mapping: b.mapping, fileName: b.fileName })
    if ('problem' in out) return fail(c, 400, out.problem, out.code)
    return one(c, out, 201)
  })

  app.get('/batches', async (c) => {
    const { companyId } = c.get('user' as never) as any
    const kinds: ImportKind[] = []
    for (const k of IMPORT_KINDS) if (await holds(d, c, IMPORT_PERMISSION[k].create)) kinds.push(k)
    if (!kinds.length) return fail(c, 403, 'Permission denied', 'forbidden')
    return listAll(c, await core.csvImport.batches(companyId, kinds))
  })

  app.post('/batches/:id/undo', async (c) => {
    if (!(await mayAny(c, 'delete'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const user = c.get('user' as never) as any
    const kind = await core.csvImport.batchKind(user.companyId, c.req.param('id'))
    if (!kind) return fail(c, 404, 'That import was not found.', 'not_found')
    const ok = await allowed(c, kind, 'delete')
    if (ok instanceof Response) return ok
    const out = await core.csvImport.undo(user.companyId, String(user.userId || user.id), c.req.param('id'))
    if (out.notFound) return fail(c, 404, 'That import was not found.', 'not_found')
    if (out.problem) return fail(c, 409, out.problem, out.code)
    return one(c, out)
  })

  return app
}
