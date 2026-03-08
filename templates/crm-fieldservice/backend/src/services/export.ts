/**
 * Data Export Service (Drizzle)
 *
 * Export any entity to CSV or Excel format
 */

import { db } from '../../db/index.ts';
import {
  contact,
  project,
  job,
  quote,
  invoice,
  timeEntry,
  expense,
  teamMember,
  user,
} from '../../db/schema.ts';
import { eq, and, gte, lte, asc, desc, sql } from 'drizzle-orm';

// Field definitions for each entity type
interface FieldDef {
  key: string;
  label: string;
  format?: (val: any, row?: any) => string;
}

interface EntityConfig {
  table: any;
  fields: FieldDef[];
  orderBy: any;
  joins?: Array<{ table: any; on: any; columns: Record<string, any> }>;
}

// Format helpers
function formatDate(val: unknown): string {
  if (!val) return '';
  return new Date(val as string).toLocaleDateString('en-US');
}

function formatDateTime(val: unknown): string {
  if (!val) return '';
  return new Date(val as string).toLocaleString('en-US');
}

function formatCurrency(val: unknown): string {
  if (val === null || val === undefined) return '';
  return Number(val).toFixed(2);
}

/**
 * Get nested value from object (e.g., "contact.name")
 */
function getValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: any, part) => acc?.[part], obj);
}

// We use raw queries to support JOINs since these are complex export queries.
// The entity configs map entity types to SQL queries.

const ENTITY_CONFIGS: Record<string, {
  fields: FieldDef[];
  query: (companyId: string, where: string, limit: number) => string;
}> = {
  contacts: {
    fields: [
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
      { key: 'tags', label: 'Tags', format: (v: any) => (Array.isArray(v) ? v : []).join(', ') },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created', format: formatDate },
    ],
    query: (companyId, where, limit) =>
      `SELECT * FROM contact WHERE company_id = '${companyId}' ${where} ORDER BY name ASC LIMIT ${limit}`,
  },

  projects: {
    fields: [
      { key: 'number', label: 'Project #' },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'type', label: 'Type' },
      { key: 'description', label: 'Description' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'Zip' },
      { key: 'start_date', label: 'Start Date', format: formatDate },
      { key: 'end_date', label: 'End Date', format: formatDate },
      { key: 'estimated_value', label: 'Estimated Value', format: formatCurrency },
      { key: 'budget', label: 'Budget', format: formatCurrency },
      { key: 'progress', label: 'Progress %' },
      { key: 'contact_name', label: 'Client' },
      { key: 'created_at', label: 'Created', format: formatDate },
    ],
    query: (companyId, where, limit) =>
      `SELECT p.*, c.name as contact_name FROM project p LEFT JOIN contact c ON p.contact_id = c.id WHERE p.company_id = '${companyId}' ${where} ORDER BY p.created_at DESC LIMIT ${limit}`,
  },

  jobs: {
    fields: [
      { key: 'number', label: 'Job #' },
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'description', label: 'Description' },
      { key: 'scheduled_date', label: 'Scheduled', format: formatDate },
      { key: 'estimated_hours', label: 'Est. Hours' },
      { key: 'actual_hours', label: 'Actual Hours' },
      { key: 'project_name', label: 'Project' },
      { key: 'contact_name', label: 'Client' },
      { key: 'assigned_to_name', label: 'Assigned To' },
      { key: 'completed_at', label: 'Completed', format: formatDate },
      { key: 'created_at', label: 'Created', format: formatDate },
    ],
    query: (companyId, where, limit) =>
      `SELECT j.*, p.name as project_name, c.name as contact_name, CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name
       FROM job j
       LEFT JOIN project p ON j.project_id = p.id
       LEFT JOIN contact c ON j.contact_id = c.id
       LEFT JOIN "user" u ON j.assigned_to_id = u.id
       WHERE j.company_id = '${companyId}' ${where}
       ORDER BY j.created_at DESC LIMIT ${limit}`,
  },

  quotes: {
    fields: [
      { key: 'number', label: 'Quote #' },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
      { key: 'tax_rate', label: 'Tax Rate %' },
      { key: 'tax_amount', label: 'Tax', format: formatCurrency },
      { key: 'discount', label: 'Discount', format: formatCurrency },
      { key: 'total', label: 'Total', format: formatCurrency },
      { key: 'expiry_date', label: 'Valid Until', format: formatDate },
      { key: 'contact_name', label: 'Client' },
      { key: 'project_name', label: 'Project' },
      { key: 'sent_at', label: 'Sent', format: formatDate },
      { key: 'approved_at', label: 'Approved', format: formatDate },
      { key: 'created_at', label: 'Created', format: formatDate },
    ],
    query: (companyId, where, limit) =>
      `SELECT q.*, c.name as contact_name, p.name as project_name
       FROM quote q
       LEFT JOIN contact c ON q.contact_id = c.id
       LEFT JOIN project p ON q.project_id = p.id
       WHERE q.company_id = '${companyId}' ${where}
       ORDER BY q.created_at DESC LIMIT ${limit}`,
  },

  invoices: {
    fields: [
      { key: 'number', label: 'Invoice #' },
      { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
      { key: 'tax_rate', label: 'Tax Rate %' },
      { key: 'tax_amount', label: 'Tax', format: formatCurrency },
      { key: 'discount', label: 'Discount', format: formatCurrency },
      { key: 'total', label: 'Total', format: formatCurrency },
      { key: 'amount_paid', label: 'Paid', format: formatCurrency },
      { key: 'due_date', label: 'Due Date', format: formatDate },
      { key: 'contact_name', label: 'Client' },
      { key: 'project_name', label: 'Project' },
      { key: 'sent_at', label: 'Sent', format: formatDate },
      { key: 'paid_at', label: 'Paid', format: formatDate },
      { key: 'created_at', label: 'Created', format: formatDate },
    ],
    query: (companyId, where, limit) =>
      `SELECT i.*, c.name as contact_name, p.name as project_name
       FROM invoice i
       LEFT JOIN contact c ON i.contact_id = c.id
       LEFT JOIN project p ON i.project_id = p.id
       WHERE i.company_id = '${companyId}' ${where}
       ORDER BY i.created_at DESC LIMIT ${limit}`,
  },

  time: {
    fields: [
      { key: 'date', label: 'Date', format: formatDate },
      { key: 'hours', label: 'Hours' },
      { key: 'description', label: 'Description' },
      { key: 'billable', label: 'Billable', format: (v: any) => v ? 'Yes' : 'No' },
      { key: 'hourly_rate', label: 'Rate', format: formatCurrency },
      { key: 'employee_name', label: 'Employee' },
      { key: 'job_title', label: 'Job' },
      { key: 'project_name', label: 'Project' },
    ],
    query: (companyId, where, limit) =>
      `SELECT te.*, CONCAT(u.first_name, ' ', u.last_name) as employee_name, j.title as job_title, p.name as project_name
       FROM time_entry te
       LEFT JOIN "user" u ON te.user_id = u.id
       LEFT JOIN job j ON te.job_id = j.id
       LEFT JOIN project p ON te.project_id = p.id
       WHERE te.company_id = '${companyId}' ${where}
       ORDER BY te.date DESC LIMIT ${limit}`,
  },

  expenses: {
    fields: [
      { key: 'date', label: 'Date', format: formatDate },
      { key: 'category', label: 'Category' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount', format: formatCurrency },
      { key: 'billable', label: 'Billable', format: (v: any) => v ? 'Yes' : 'No' },
      { key: 'project_name', label: 'Project' },
      { key: 'job_title', label: 'Job' },
    ],
    query: (companyId, where, limit) =>
      `SELECT e.*, p.name as project_name, j.title as job_title
       FROM expense e
       LEFT JOIN project p ON e.project_id = p.id
       LEFT JOIN job j ON e.job_id = j.id
       WHERE e.company_id = '${companyId}' ${where}
       ORDER BY e.date DESC LIMIT ${limit}`,
  },

  team: {
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'role', label: 'Role' },
      { key: 'department', label: 'Department' },
      { key: 'hire_date', label: 'Hire Date', format: formatDate },
      { key: 'hourly_rate', label: 'Hourly Rate', format: formatCurrency },
      { key: 'active', label: 'Active', format: (v: any) => v ? 'Yes' : 'No' },
      { key: 'skills', label: 'Skills', format: (v: any) => (Array.isArray(v) ? v : []).join(', ') },
    ],
    query: (companyId, where, limit) =>
      `SELECT * FROM team_member WHERE company_id = '${companyId}' ${where} ORDER BY name ASC LIMIT ${limit}`,
  },

  'audit-logs': {
    fields: [
      { key: 'created_at', label: 'Timestamp', format: formatDateTime },
      { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'entity_name', label: 'Entity Name' },
      { key: 'user_email', label: 'User' },
      { key: 'ip_address', label: 'IP Address' },
    ],
    query: (companyId, where, limit) =>
      `SELECT * FROM audit_log WHERE company_id = '${companyId}' ${where} ORDER BY created_at DESC LIMIT ${limit}`,
  },
};

/**
 * Build where clause from filters
 */
function buildWhere(filters: Record<string, unknown>): string {
  const clauses: string[] = [];

  if (filters.status) {
    clauses.push(`status = '${filters.status}'`);
  }
  if (filters.type) {
    clauses.push(`type = '${filters.type}'`);
  }
  if (filters.startDate) {
    clauses.push(`created_at >= '${new Date(filters.startDate as string).toISOString()}'`);
  }
  if (filters.endDate) {
    clauses.push(`created_at <= '${new Date(filters.endDate as string).toISOString()}'`);
  }
  if (filters.contactId) {
    clauses.push(`contact_id = '${filters.contactId}'`);
  }
  if (filters.projectId) {
    clauses.push(`project_id = '${filters.projectId}'`);
  }

  return clauses.length > 0 ? 'AND ' + clauses.join(' AND ') : '';
}

/**
 * Escape value for CSV
 */
function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Escape value for TSV
 */
function escapeTSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
}

/**
 * Export data to CSV format
 */
export async function exportToCSV(entityType: string, companyId: string, filters: Record<string, unknown> = {}) {
  const config = ENTITY_CONFIGS[entityType];
  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const where = buildWhere(filters);
  const limit = (filters.limit as number) || 10000;

  const result = await db.execute(sql.raw(config.query(companyId, where, limit)));
  const data = (result as any).rows || result;

  // Build CSV
  const headers = config.fields.map(f => f.label);
  const rows = (data as any[]).map(row => {
    return config.fields.map(field => {
      let value = row[field.key];
      if (field.format) {
        value = field.format(value, row);
      }
      return escapeCSV(value);
    });
  });

  const csv = [
    headers.join(','),
    ...rows.map(r => r.join(',')),
  ].join('\n');

  return {
    data: csv,
    filename: `${entityType}-export-${Date.now()}.csv`,
    contentType: 'text/csv',
    count: (data as any[]).length,
  };
}

/**
 * Export data to Excel-compatible format (TSV with .xls extension)
 */
export async function exportToExcel(entityType: string, companyId: string, filters: Record<string, unknown> = {}) {
  const config = ENTITY_CONFIGS[entityType];
  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const where = buildWhere(filters);
  const limit = (filters.limit as number) || 10000;

  const result = await db.execute(sql.raw(config.query(companyId, where, limit)));
  const data = (result as any).rows || result;

  // Build TSV
  const headers = config.fields.map(f => f.label);
  const rows = (data as any[]).map(row => {
    return config.fields.map(field => {
      let value = row[field.key];
      if (field.format) {
        value = field.format(value, row);
      }
      return escapeTSV(value);
    });
  });

  const tsv = [
    headers.join('\t'),
    ...rows.map(r => r.join('\t')),
  ].join('\n');

  return {
    data: tsv,
    filename: `${entityType}-export-${Date.now()}.xls`,
    contentType: 'application/vnd.ms-excel',
    count: (data as any[]).length,
  };
}

/**
 * Get available export types
 */
export function getExportTypes(): string[] {
  return Object.keys(ENTITY_CONFIGS);
}

/**
 * Get fields for an entity type
 */
export function getExportFields(entityType: string): Array<{ key: string; label: string }> | null {
  const config = ENTITY_CONFIGS[entityType];
  if (!config) return null;
  return config.fields.map(f => ({ key: f.key, label: f.label }));
}

export default {
  exportToCSV,
  exportToExcel,
  getExportTypes,
  getExportFields,
};
