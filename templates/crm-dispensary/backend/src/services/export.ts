/**
 * Data Export Service (Drizzle)
 *
 * Export dispensary entities to CSV or Excel format:
 * - Contacts (customers)
 * - Products (menu items)
 * - Orders
 * - Loyalty members
 * - Team members
 * - Audit logs
 */

import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';

// Field definitions for each entity type
interface FieldDef {
  key: string;
  label: string;
  format?: (val: any, row?: any) => string;
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

const ENTITY_FIELDS: Record<string, FieldDef[]> = {
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
    { key: 'tags', label: 'Tags', format: (v: any) => (Array.isArray(v) ? v : []).join(', ') },
    { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created', format: formatDate },
  ],
  products: [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'brand', label: 'Brand' },
    { key: 'strain_name', label: 'Strain' },
    { key: 'strain_type', label: 'Strain Type' },
    { key: 'thc_percent', label: 'THC %' },
    { key: 'cbd_percent', label: 'CBD %' },
    { key: 'price', label: 'Price', format: formatCurrency },
    { key: 'cost', label: 'Cost', format: formatCurrency },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'stock_quantity', label: 'Stock' },
    { key: 'unit_type', label: 'Unit' },
    { key: 'weight_grams', label: 'Weight (g)' },
    { key: 'active', label: 'Active', format: (v: any) => v ? 'Yes' : 'No' },
    { key: 'description', label: 'Description' },
    { key: 'created_at', label: 'Created', format: formatDate },
  ],
  orders: [
    { key: 'order_number', label: 'Order #' },
    { key: 'status', label: 'Status' },
    { key: 'type', label: 'Type' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
    { key: 'tax_amount', label: 'Tax', format: formatCurrency },
    { key: 'discount_amount', label: 'Discount', format: formatCurrency },
    { key: 'total', label: 'Total', format: formatCurrency },
    { key: 'payment_method', label: 'Payment Method' },
    { key: 'payment_status', label: 'Payment Status' },
    { key: 'is_medical', label: 'Medical', format: (v: any) => v ? 'Yes' : 'No' },
    { key: 'total_cannabis_weight_oz', label: 'Cannabis Weight (oz)' },
    { key: 'loyalty_points_earned', label: 'Points Earned' },
    { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created', format: formatDateTime },
    { key: 'completed_at', label: 'Completed', format: formatDateTime },
  ],
  loyalty: [
    { key: 'contact_name', label: 'Customer' },
    { key: 'contact_email', label: 'Email' },
    { key: 'contact_phone', label: 'Phone' },
    { key: 'points_balance', label: 'Points Balance' },
    { key: 'lifetime_points', label: 'Lifetime Points' },
    { key: 'tier', label: 'Tier' },
    { key: 'total_visits', label: 'Total Visits' },
    { key: 'total_spent', label: 'Total Spent', format: formatCurrency },
    { key: 'opted_in_sms', label: 'SMS Opt-In', format: (v: any) => v ? 'Yes' : 'No' },
    { key: 'opted_in_email', label: 'Email Opt-In', format: (v: any) => v ? 'Yes' : 'No' },
    { key: 'referral_code', label: 'Referral Code' },
    { key: 'joined_at', label: 'Joined', format: formatDate },
    { key: 'last_activity_at', label: 'Last Activity', format: formatDate },
  ],
  team: [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role' },
    { key: 'is_active', label: 'Active', format: (v: any) => v ? 'Yes' : 'No' },
    { key: 'created_at', label: 'Created', format: formatDate },
  ],
  'audit-logs': [
    { key: 'created_at', label: 'Timestamp', format: formatDateTime },
    { key: 'action', label: 'Action' },
    { key: 'entity_type', label: 'Entity' },
    { key: 'entity_id', label: 'Entity ID' },
    { key: 'user_id', label: 'User ID' },
    { key: 'ip_address', label: 'IP Address' },
  ],
};

/**
 * Build parameterized query for export
 */
function buildQuery(entityType: string, companyId: string, filters: Record<string, unknown>, limit: number) {
  const conditions: ReturnType<typeof sql>[] = [];

  if (filters.status) conditions.push(sql`status = ${filters.status as string}`);
  if (filters.type) conditions.push(sql`type = ${filters.type as string}`);
  if (filters.startDate) conditions.push(sql`created_at >= ${new Date(filters.startDate as string)}`);
  if (filters.endDate) conditions.push(sql`created_at <= ${new Date(filters.endDate as string)}`);
  if (filters.contactId) conditions.push(sql`contact_id = ${filters.contactId as string}`);
  if (filters.category) conditions.push(sql`category = ${filters.category as string}`);

  const extraWhere = conditions.length > 0
    ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)
    : sql``;

  switch (entityType) {
    case 'contacts':
      return conditions.length > 0
        ? sql`SELECT * FROM contact WHERE company_id = ${companyId} AND ${extraWhere} ORDER BY name ASC LIMIT ${limit}`
        : sql`SELECT * FROM contact WHERE company_id = ${companyId} ORDER BY name ASC LIMIT ${limit}`;

    case 'products':
      return conditions.length > 0
        ? sql`SELECT * FROM products WHERE company_id = ${companyId} AND ${extraWhere} ORDER BY name ASC LIMIT ${limit}`
        : sql`SELECT * FROM products WHERE company_id = ${companyId} ORDER BY name ASC LIMIT ${limit}`;

    case 'orders':
      return conditions.length > 0
        ? sql`SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN contact c ON o.contact_id = c.id WHERE o.company_id = ${companyId} AND ${extraWhere} ORDER BY o.created_at DESC LIMIT ${limit}`
        : sql`SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN contact c ON o.contact_id = c.id WHERE o.company_id = ${companyId} ORDER BY o.created_at DESC LIMIT ${limit}`;

    case 'loyalty':
      return conditions.length > 0
        ? sql`SELECT lm.*, c.name as contact_name, c.email as contact_email, c.phone as contact_phone FROM loyalty_members lm LEFT JOIN contact c ON lm.contact_id = c.id WHERE lm.company_id = ${companyId} AND ${extraWhere} ORDER BY lm.joined_at DESC LIMIT ${limit}`
        : sql`SELECT lm.*, c.name as contact_name, c.email as contact_email, c.phone as contact_phone FROM loyalty_members lm LEFT JOIN contact c ON lm.contact_id = c.id WHERE lm.company_id = ${companyId} ORDER BY lm.joined_at DESC LIMIT ${limit}`;

    case 'team':
      return conditions.length > 0
        ? sql`SELECT * FROM "user" WHERE company_id = ${companyId} AND ${extraWhere} ORDER BY first_name ASC LIMIT ${limit}`
        : sql`SELECT * FROM "user" WHERE company_id = ${companyId} ORDER BY first_name ASC LIMIT ${limit}`;

    case 'audit-logs':
      return conditions.length > 0
        ? sql`SELECT * FROM audit_log WHERE company_id = ${companyId} AND ${extraWhere} ORDER BY created_at DESC LIMIT ${limit}`
        : sql`SELECT * FROM audit_log WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT ${limit}`;

    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
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
  const fields = ENTITY_FIELDS[entityType];
  if (!fields) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const limit = (filters.limit as number) || 10000;
  const query = buildQuery(entityType, companyId, filters, limit);

  const result = await db.execute(query);
  const data = (result as any).rows || result;

  // Build CSV
  const headers = fields.map(f => f.label);
  const rows = (data as any[]).map(row => {
    return fields.map(field => {
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
  const fields = ENTITY_FIELDS[entityType];
  if (!fields) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const limit = (filters.limit as number) || 10000;
  const query = buildQuery(entityType, companyId, filters, limit);

  const result = await db.execute(query);
  const data = (result as any).rows || result;

  // Build TSV
  const headers = fields.map(f => f.label);
  const rows = (data as any[]).map(row => {
    return fields.map(field => {
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
  return Object.keys(ENTITY_FIELDS);
}

/**
 * Get fields for an entity type
 */
export function getExportFields(entityType: string): Array<{ key: string; label: string }> | null {
  const fields = ENTITY_FIELDS[entityType];
  if (!fields) return null;
  return fields.map(f => ({ key: f.key, label: f.label }));
}

export default {
  exportToCSV,
  exportToExcel,
  getExportTypes,
  getExportFields,
};
