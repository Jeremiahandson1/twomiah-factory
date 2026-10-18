// Data export: any of the CRM's lists as CSV, or as tab-separated text Excel opens. Moved from
// templates/crm/backend/src/routes/export.ts and services/export.ts; the queries are in server/data/export.ts.
// The registry signs the person in; each download keeps the template's permission and its audit row.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { exportRows, exportEntityTypes } from '../../data/export.ts'

interface FieldDef {
  key: string
  label: string
  format?: (val: any, row?: any) => string
}

function formatDate(val: unknown): string {
  if (!val) return ''
  return new Date(val as string).toLocaleDateString('en-US')
}

function formatDateTime(val: unknown): string {
  if (!val) return ''
  return new Date(val as string).toLocaleString('en-US')
}

function formatCurrency(val: unknown): string {
  if (val === null || val === undefined) return ''
  return Number(val).toFixed(2)
}

const yesNo = (v: any) => (v ? 'Yes' : 'No')
const listOf = (v: any) => (Array.isArray(v) ? v : []).join(', ')

/** Each entity's columns, in order: the row key (camelCase, server/data/export.ts) and the spreadsheet heading. */
const FIELDS: Record<string, FieldDef[]> = {
  contacts: [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'company', label: 'Company' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    { key: 'source', label: 'Source' },
    { key: 'tags', label: 'Tags', format: listOf },
    { key: 'notes', label: 'Notes' },
    { key: 'createdAt', label: 'Created', format: formatDate },
  ],
  projects: [
    { key: 'number', label: 'Project #' },
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    { key: 'startDate', label: 'Start Date', format: formatDate },
    { key: 'endDate', label: 'End Date', format: formatDate },
    { key: 'estimatedValue', label: 'Estimated Value', format: formatCurrency },
    { key: 'budget', label: 'Budget', format: formatCurrency },
    { key: 'progress', label: 'Progress %' },
    { key: 'contactName', label: 'Client' },
    { key: 'createdAt', label: 'Created', format: formatDate },
  ],
  jobs: [
    { key: 'number', label: 'Job #' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'description', label: 'Description' },
    { key: 'scheduledDate', label: 'Scheduled', format: formatDate },
    { key: 'estimatedHours', label: 'Est. Hours' },
    { key: 'actualHours', label: 'Actual Hours' },
    { key: 'projectName', label: 'Project' },
    { key: 'contactName', label: 'Client' },
    { key: 'assignedToName', label: 'Assigned To' },
    { key: 'completedAt', label: 'Completed', format: formatDate },
    { key: 'createdAt', label: 'Created', format: formatDate },
  ],
  quotes: [
    { key: 'number', label: 'Quote #' },
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
    { key: 'taxRate', label: 'Tax Rate %' },
    { key: 'taxAmount', label: 'Tax', format: formatCurrency },
    { key: 'discount', label: 'Discount', format: formatCurrency },
    { key: 'total', label: 'Total', format: formatCurrency },
    { key: 'expiryDate', label: 'Valid Until', format: formatDate },
    { key: 'contactName', label: 'Client' },
    { key: 'projectName', label: 'Project' },
    { key: 'sentAt', label: 'Sent', format: formatDate },
    { key: 'approvedAt', label: 'Approved', format: formatDate },
    { key: 'createdAt', label: 'Created', format: formatDate },
  ],
  invoices: [
    { key: 'number', label: 'Invoice #' },
    { key: 'status', label: 'Status' },
    { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
    { key: 'taxRate', label: 'Tax Rate %' },
    { key: 'taxAmount', label: 'Tax', format: formatCurrency },
    { key: 'discount', label: 'Discount', format: formatCurrency },
    { key: 'total', label: 'Total', format: formatCurrency },
    { key: 'amountPaid', label: 'Paid', format: formatCurrency },
    { key: 'dueDate', label: 'Due Date', format: formatDate },
    { key: 'contactName', label: 'Client' },
    { key: 'projectName', label: 'Project' },
    { key: 'sentAt', label: 'Sent', format: formatDate },
    { key: 'paidAt', label: 'Paid', format: formatDate },
    { key: 'createdAt', label: 'Created', format: formatDate },
  ],
  time: [
    { key: 'date', label: 'Date', format: formatDate },
    { key: 'hours', label: 'Hours' },
    { key: 'description', label: 'Description' },
    { key: 'billable', label: 'Billable', format: yesNo },
    { key: 'hourlyRate', label: 'Rate', format: formatCurrency },
    { key: 'employeeName', label: 'Employee' },
    { key: 'jobTitle', label: 'Job' },
    { key: 'projectName', label: 'Project' },
  ],
  expenses: [
    { key: 'date', label: 'Date', format: formatDate },
    { key: 'category', label: 'Category' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', format: formatCurrency },
    { key: 'billable', label: 'Billable', format: yesNo },
    { key: 'projectName', label: 'Project' },
    { key: 'jobTitle', label: 'Job' },
  ],
  team: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role' },
    { key: 'department', label: 'Department' },
    { key: 'hireDate', label: 'Hire Date', format: formatDate },
    { key: 'hourlyRate', label: 'Hourly Rate', format: formatCurrency },
    { key: 'active', label: 'Active', format: yesNo },
    { key: 'skills', label: 'Skills', format: listOf },
  ],
  'audit-logs': [
    { key: 'createdAt', label: 'Timestamp', format: formatDateTime },
    { key: 'action', label: 'Action' },
    { key: 'entity', label: 'Entity' },
    { key: 'entityId', label: 'Entity ID' },
    { key: 'entityName', label: 'Entity Name' },
    { key: 'userEmail', label: 'User' },
    { key: 'ipAddress', label: 'IP Address' },
  ],
}

/** The template's CSV cell: quoted when it holds a comma, a quote or a newline; quotes doubled. Kept as it was. */
function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function escapeTSV(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ')
}

/** Export row cap: a positive integer, defaulting to 10000 and capped at 100000. */
function exportLimit(v: unknown): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(100000, n) : 10000
}

export function getExportFields(entityType: string): Array<{ key: string; label: string }> | null {
  const fields = FIELDS[entityType]
  if (!fields) return null
  return fields.map((f) => ({ key: f.key, label: f.label }))
}

export function createExportService(d: CrmDeps) {
  async function build(entityType: string, companyId: string, filters: Record<string, unknown>, sep: string, cell: (v: unknown) => string) {
    const fields = FIELDS[entityType]
    if (!fields) throw new Error(`Unknown entity type: ${entityType}`)
    const data = await exportRows(d.db, entityType, companyId, filters, exportLimit(filters.limit))
    const headers = fields.map((f) => f.label)
    const rows = data.map((row) => fields.map((field) => {
      let value: unknown = row[field.key]
      if (field.format) value = field.format(value, row)
      return cell(value)
    }))
    return { text: [headers.join(sep), ...rows.map((r) => r.join(sep))].join('\n'), count: data.length }
  }

  return {
    getExportTypes: exportEntityTypes,
    getExportFields,
    async exportToCSV(entityType: string, companyId: string, filters: Record<string, unknown> = {}) {
      const { text, count } = await build(entityType, companyId, filters, ',', escapeCSV)
      return { data: text, filename: `${entityType}-export-${Date.now()}.csv`, contentType: 'text/csv', count }
    },
    /** Excel-compatible: tab-separated text with an .xls name. */
    async exportToExcel(entityType: string, companyId: string, filters: Record<string, unknown> = {}) {
      const { text, count } = await build(entityType, companyId, filters, '\t', escapeTSV)
      return { data: text, filename: `${entityType}-export-${Date.now()}.xls`, contentType: 'application/vnd.ms-excel', count }
    },
  }
}

export function createExportRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const exportService = createExportService(d)
  const app = new Hono<AppEnv>()

  app.get('/types', async (c) => one(c, { types: exportService.getExportTypes() }))

  app.get('/fields/:type', async (c) => {
    const fields = exportService.getExportFields(c.req.param('type'))
    if (!fields) return fail(c, 404, 'Unknown export type')
    return one(c, { fields })
  })

  const download = (format: 'csv' | 'excel') => async (c: any) => {
    const user = c.get('user') as any
    // The type from the path; the audit log's own route below names it outright.
    const type = c.req.param('type') ?? 'audit-logs'
    // An unknown type is a URL somebody typed, not a server fault: 404, the same answer GET /fields/:type gives.
    if (!exportService.getExportFields(type)) return fail(c, 404, 'Unknown export type')
    const { status, startDate, endDate, contactId, projectId, limit } = c.req.query() as any
    const filters = { status, startDate, endDate, contactId, projectId, limit: limit ? parseInt(limit) : undefined }
    const result = format === 'csv'
      ? await exportService.exportToCSV(type, user.companyId, filters)
      : await exportService.exportToExcel(type, user.companyId, filters)

    d.audit.log({ req: c,
      action: d.audit.ACTIONS.EXPORT,
      entity: type,
      entityName: `${result.count} records`,
      metadata: { format, filters: c.req.query() },
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.body(result.data, 200, {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    })
  }

  // The audit log carries every sign-in, IP address and two-factor change: it is audit:read's (owner and admins), the
  // permission GET /api/audit asks. The template let anyone with dashboard:read (every role) download it here.
  app.get('/audit-logs/csv', requirePermission('dashboard:read'), requirePermission('audit:read'), download('csv'))
  app.get('/audit-logs/excel', requirePermission('dashboard:read'), requirePermission('audit:read'), download('excel'))

  // Each export needs the permission its own list page asks for: the template asked dashboard:read (every role) for all
  // of them, so a viewer could download every invoice, and the team's pay. The team export carries hourly rates, which
  // the team list shows only with payroll:read.
  const EXPORT_PERMISSIONS: Record<string, string[]> = {
    contacts: ['contacts:read'], projects: ['projects:read'], jobs: ['jobs:read'], quotes: ['quotes:read'],
    invoices: ['invoices:read'], time: ['time:read'], expenses: ['expenses:read'], team: ['team:read', 'payroll:read'],
  }
  const mayExport = async (c: any, next: any) => {
    const need = EXPORT_PERMISSIONS[c.req.param('type')]
    if (!need) return fail(c, 404, 'Unknown export type')
    const u = c.get('user') as any
    const extra = await d.permissions.getExtraPermissions(u.userId)
    for (const p of need) if (!d.permissions.hasPermission(u.role, p, extra)) return fail(c, 403, `Permission denied: exporting this needs ${p}.`, 'permission_denied')
    await next()
  }
  app.get('/:type/csv', requirePermission('dashboard:read'), mayExport, download('csv'))
  app.get('/:type/excel', requirePermission('dashboard:read'), mayExport, download('excel'))

  return app
}
