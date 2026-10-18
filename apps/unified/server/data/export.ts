// The export's queries: each entity's rows with the names a spreadsheet wants (the client's name on a job, the
// employee's on a time entry). Moved from templates/crm/backend/src/services/export.ts, whose raw JOINs these are.
// Rows come back camelCase (RULEBOOK §2): `contact_name` is `contactName`, `created_at` is `createdAt`.
import { sql, type SQL } from 'drizzle-orm'

export interface ExportFilters {
  status?: unknown
  type?: unknown
  startDate?: unknown
  endDate?: unknown
  contactId?: unknown
  projectId?: unknown
}

/**
 * The filters, each column named through the entity's own table. The template wrote them bare (`created_at >= …`),
 * which Postgres refuses as ambiguous on every export that joins a second table carrying the same column — a dated
 * export of projects, jobs, quotes, invoices, time or expenses answered 500. `q` is a constant from the table below.
 */
function buildWhere(filters: ExportFilters, q: string): SQL {
  const col = (name: string) => sql.raw(`${q}.${name}`)
  const clauses: SQL[] = []
  if (filters.status) clauses.push(sql`${col('status')} = ${filters.status}`)
  if (filters.type) clauses.push(sql`${col('type')} = ${filters.type}`)
  if (filters.startDate) clauses.push(sql`${col('created_at')} >= ${new Date(filters.startDate as string)}`)
  if (filters.endDate) clauses.push(sql`${col('created_at')} <= ${new Date(filters.endDate as string)}`)
  if (filters.contactId) clauses.push(sql`${col('contact_id')} = ${filters.contactId}`)
  if (filters.projectId) clauses.push(sql`${col('project_id')} = ${filters.projectId}`)
  return clauses.length > 0 ? sql`AND ${sql.join(clauses, sql` AND `)}` : sql``
}

const QUERIES: Record<string, (companyId: string, where: (q: string) => SQL, limit: number) => SQL> = {
  contacts: (companyId, where, limit) =>
    sql`SELECT * FROM contact WHERE company_id = ${companyId} ${where('contact')} ORDER BY name ASC LIMIT ${limit}`,

  projects: (companyId, where, limit) =>
    sql`SELECT p.*, c.name as contact_name FROM project p LEFT JOIN contact c ON p.contact_id = c.id WHERE p.company_id = ${companyId} ${where('p')} ORDER BY p.created_at DESC LIMIT ${limit}`,

  jobs: (companyId, where, limit) =>
    sql`SELECT j.*, p.name as project_name, c.name as contact_name, CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name
       FROM job j
       LEFT JOIN project p ON j.project_id = p.id
       LEFT JOIN contact c ON j.contact_id = c.id
       LEFT JOIN "user" u ON j.assigned_to_id = u.id
       WHERE j.company_id = ${companyId} ${where('j')}
       ORDER BY j.created_at DESC LIMIT ${limit}`,

  quotes: (companyId, where, limit) =>
    sql`SELECT q.*, c.name as contact_name, p.name as project_name
       FROM quote q
       LEFT JOIN contact c ON q.contact_id = c.id
       LEFT JOIN project p ON q.project_id = p.id
       WHERE q.company_id = ${companyId} ${where('q')}
       ORDER BY q.created_at DESC LIMIT ${limit}`,

  invoices: (companyId, where, limit) =>
    sql`SELECT i.*, c.name as contact_name, p.name as project_name
       FROM invoice i
       LEFT JOIN contact c ON i.contact_id = c.id
       LEFT JOIN project p ON i.project_id = p.id
       WHERE i.company_id = ${companyId} ${where('i')}
       ORDER BY i.created_at DESC LIMIT ${limit}`,

  time: (companyId, where, limit) =>
    sql`SELECT te.*, CONCAT(u.first_name, ' ', u.last_name) as employee_name, j.title as job_title, p.name as project_name
       FROM time_entry te
       LEFT JOIN "user" u ON te.user_id = u.id
       LEFT JOIN job j ON te.job_id = j.id
       LEFT JOIN project p ON te.project_id = p.id
       WHERE te.company_id = ${companyId} ${where('te')}
       ORDER BY te.date DESC LIMIT ${limit}`,

  expenses: (companyId, where, limit) =>
    sql`SELECT e.*, p.name as project_name, j.title as job_title
       FROM expense e
       LEFT JOIN project p ON e.project_id = p.id
       LEFT JOIN job j ON e.job_id = j.id
       WHERE e.company_id = ${companyId} ${where('e')}
       ORDER BY e.date DESC LIMIT ${limit}`,

  team: (companyId, where, limit) =>
    sql`SELECT * FROM team_member WHERE company_id = ${companyId} ${where('team_member')} ORDER BY name ASC LIMIT ${limit}`,

  'audit-logs': (companyId, where, limit) =>
    sql`SELECT * FROM audit_log WHERE company_id = ${companyId} ${where('audit_log')} ORDER BY created_at DESC LIMIT ${limit}`,
}

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())

/** The entity types the export knows. */
export const exportEntityTypes = (): string[] => Object.keys(QUERIES)

/** One entity's rows for the export, newest (or A–Z) first, at most `limit`, camelCase. Throws on an unknown type. */
export async function exportRows(db: any, entityType: string, companyId: string, filters: ExportFilters, limit: number): Promise<Record<string, unknown>[]> {
  const query = QUERIES[entityType]
  if (!query) throw new Error(`Unknown entity type: ${entityType}`)
  const result = await db.execute(query(companyId, (q) => buildWhere(filters, q), limit))
  const rows = ((result as any).rows || result) as Record<string, unknown>[]
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])))
}
