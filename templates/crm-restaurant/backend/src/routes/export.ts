import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import exportService from '../services/export.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Get available export types
app.get('/types', async (c) => {
  return c.json({
    types: exportService.getExportTypes(),
  })
})

// Get fields for a type
app.get('/fields/:type', async (c) => {
  const type = c.req.param('type')
  const fields = exportService.getExportFields(type)
  if (!fields) {
    return c.json({ error: 'Unknown export type' }, 404)
  }
  return c.json({ fields })
})

// Export to CSV
app.get('/:type/csv', requirePermission('dashboard:read'), async (c) => {
  const user = c.get('user') as any
  const type = c.req.param('type')
  const { status, startDate, endDate, contactId, projectId, limit } = c.req.query() as any

  const result = await exportService.exportToCSV(type, user.companyId, {
    status,
    startDate,
    endDate,
    contactId,
    projectId,
    limit: limit ? parseInt(limit) : undefined,
  })

  audit.log({
    action: audit.ACTIONS.EXPORT,
    entity: type,
    entityName: `${result.count} records`,
    metadata: { format: 'csv', filters: c.req.query() },
    userId: user.userId,
    companyId: user.companyId,
  })

  return new Response(result.data, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  })
})

// Export to Excel
app.get('/:type/excel', requirePermission('dashboard:read'), async (c) => {
  const user = c.get('user') as any
  const type = c.req.param('type')
  const { status, startDate, endDate, contactId, projectId, limit } = c.req.query() as any

  const result = await exportService.exportToExcel(type, user.companyId, {
    status,
    startDate,
    endDate,
    contactId,
    projectId,
    limit: limit ? parseInt(limit) : undefined,
  })

  audit.log({
    action: audit.ACTIONS.EXPORT,
    entity: type,
    entityName: `${result.count} records`,
    metadata: { format: 'excel', filters: c.req.query() },
    userId: user.userId,
    companyId: user.companyId,
  })

  return new Response(result.data, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  })
})

export default app
