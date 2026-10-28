// GET /api/export-everything — one download with every list the business has (data/exportAll.ts). The owner's and
// the admins' (settings:update); one business only, the signed-in person's; each download is an audit row.
import { Hono } from 'hono'
import { buildBusinessExport } from '../data/exportAll.ts'
import type { Audit } from '../core/audit.ts'

export function createExportEverythingRoute(deps: { db: any; audit: Audit; permissions: any }) {
  const app = new Hono()
  app.get('/', deps.permissions.requirePermission('settings:update'), async (c: any) => {
    const me = c.get('user')
    const out = await buildBusinessExport(deps.db, me.companyId)
    deps.audit.log({
      req: c, action: deps.audit.ACTIONS.EXPORT, entity: 'everything', entityName: `${out.files.length} files, ${out.rows} rows`,
      metadata: { files: out.files.length, rows: out.rows }, userId: me.userId, companyId: me.companyId,
    })
    return c.body(out.zip, 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    })
  })
  return app
}
