/**
 * Data Export Service
 * 
 * Export any entity to CSV or Excel format
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Field definitions for each entity type
const ENTITY_CONFIGS = {
  contacts: {
    model: 'contact',
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
      { key: 'tags', label: 'Tags', format: (v) => (v || []).join(', ') },
      { key: 'notes', label: 'Notes' },
      { key: 'createdAt', label: 'Created', format: formatDate },
    ],
    orderBy: { name: 'asc' },
  },

  projects: {
    model: 'project',
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
      { key: 'startDate', label: 'Start Date', format: formatDate },
      { key: 'endDate', label: 'End Date', format: formatDate },
      { key: 'estimatedValue', label: 'Estimated Value', format: formatCurrency },
      { key: 'budget', label: 'Budget', format: formatCurrency },
      { key: 'progress', label: 'Progress %' },
      { key: 'contact.name', label: 'Client' },
      { key: 'createdAt', label: 'Created', format: formatDate },
    ],
    include: { contact: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  },

  jobs: {
    model: 'job',
    fields: [
      { key: 'number', label: 'Job #' },
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'description', label: 'Description' },
      { key: 'scheduledDate', label: 'Scheduled', format: formatDate },
      { key: 'estimatedHours', label: 'Est. Hours' },
      { key: 'actualHours', label: 'Actual Hours' },
      { key: 'project.name', label: 'Project' },
      { key: 'contact.name', label: 'Client' },
      { key: 'assignedTo.firstName', label: 'Assigned To', format: (v, row) => row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '' },
      { key: 'completedAt', label: 'Completed', format: formatDate },
      { key: 'createdAt', label: 'Created', format: formatDate },
    ],
    include: {
      project: { select: { name: true } },
      contact: { select: { name: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  },

  quotes: {
    model: 'quote',
    fields: [
      { key: 'number', label: 'Quote #' },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
      { key: 'taxRate', label: 'Tax Rate %' },
      { key: 'taxAmount', label: 'Tax', format: formatCurrency },
      { key: 'discount', label: 'Discount', format: formatCurrency },
      { key: 'total', label: 'Total', format: formatCurrency },
      { key: 'validUntil', label: 'Valid Until', format: formatDate },
      { key: 'contact.name', label: 'Client' },
      { key: 'project.name', label: 'Project' },
      { key: 'sentAt', label: 'Sent', format: formatDate },
      { key: 'approvedAt', label: 'Approved', format: formatDate },
      { key: 'createdAt', label: 'Created', format: formatDate },
    ],
    include: {
      contact: { select: { name: true } },
      project: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  },

  invoices: {
    model: 'invoice',
    fields: [
      { key: 'number', label: 'Invoice #' },
      { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Subtotal', format: formatCurrency },
      { key: 'taxRate', label: 'Tax Rate %' },
      { key: 'taxAmount', label: 'Tax', format: formatCurrency },
      { key: 'discount', label: 'Discount', format: formatCurrency },
      { key: 'total', label: 'Total', format: formatCurrency },
      { key: 'amountPaid', label: 'Paid', format: formatCurrency },
      { key: 'balance', label: 'Balance', format: formatCurrency },
      { key: 'dueDate', label: 'Due Date', format: formatDate },
      { key: 'contact.name', label: 'Client' },
      { key: 'project.name', label: 'Project' },
      { key: 'sentAt', label: 'Sent', format: formatDate },
      { key: 'paidAt', label: 'Paid', format: formatDate },
      { key: 'createdAt', label: 'Created', format: formatDate },
    ],
    include: {
      contact: { select: { name: true } },
      project: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  },

  time: {
    model: 'timeEntry',
    fields: [
      { key: 'date', label: 'Date', format: formatDate },
      { key: 'hours', label: 'Hours' },
      { key: 'description', label: 'Description' },
      { key: 'billable', label: 'Billable', format: (v) => v ? 'Yes' : 'No' },
      { key: 'hourlyRate', label: 'Rate', format: formatCurrency },
      { key: 'total', label: 'Total', format: formatCurrency },
      { key: 'status', label: 'Status' },
      { key: 'user.firstName', label: 'Employee', format: (v, row) => row.user ? `${row.user.firstName} ${row.user.lastName}` : '' },
      { key: 'job.title', label: 'Job' },
      { key: 'project.name', label: 'Project' },
    ],
    include: {
      user: { select: { firstName: true, lastName: true } },
      job: { select: { title: true } },
      project: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  },

  expenses: {
    model: 'expense',
    fields: [
      { key: 'date', label: 'Date', format: formatDate },
      { key: 'category', label: 'Category' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount', format: formatCurrency },
      { key: 'billable', label: 'Billable', format: (v) => v ? 'Yes' : 'No' },
      { key: 'status', label: 'Status' },
      { key: 'project.name', label: 'Project' },
      { key: 'job.title', label: 'Job' },
    ],
    include: {
      project: { select: { name: true } },
      job: { select: { title: true } },
    },
    orderBy: { date: 'desc' },
  },

  team: {
    model: 'teamMember',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'role', label: 'Role' },
      { key: 'department', label: 'Department' },
      { key: 'hireDate', label: 'Hire Date', format: formatDate },
      { key: 'hourlyRate', label: 'Hourly Rate', format: formatCurrency },
      { key: 'active', label: 'Active', format: (v) => v ? 'Yes' : 'No' },
      { key: 'skills', label: 'Skills', format: (v) => (v || []).join(', ') },
    ],
    orderBy: { name: 'asc' },
  },

  'audit-logs': {
    model: 'auditLog',
    fields: [
      { key: 'createdAt', label: 'Timestamp', format: formatDateTime },
      { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' },
      { key: 'entityId', label: 'Entity ID' },
      { key: 'entityName', label: 'Entity Name' },
      { key: 'userEmail', label: 'User' },
      { key: 'ipAddress', label: 'IP Address' },
    ],
    orderBy: { createdAt: 'desc' },
  },
};

// Format helpers
function formatDate(val) {
  if (!val) return '';
  return new Date(val).toLocaleDateString('en-US');
}

function formatDateTime(val) {
  if (!val) return '';
  return new Date(val).toLocaleString('en-US');
}

function formatCurrency(val) {
  if (val === null || val === undefined) return '';
  return Number(val).toFixed(2);
}

/**
 * Get nested value from object (e.g., "contact.name")
 */
function getValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

/**
 * Export data to CSV format
 */
export async function exportToCSV(entityType, companyId, filters = {}) {
  const config = ENTITY_CONFIGS[entityType];
  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // Build query
  const where = { companyId, ...buildWhere(filters) };
  
  // Fetch data
  const data = await prisma[config.model].findMany({
    where,
    include: config.include,
    orderBy: config.orderBy,
    take: filters.limit || 10000, // Safety limit
  });

  // Build CSV
  const headers = config.fields.map(f => f.label);
  const rows = data.map(row => {
    return config.fields.map(field => {
      let value = getValue(row, field.key);
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
    count: data.length,
  };
}

/**
 * Export data to Excel-compatible format (TSV with .xls extension)
 * For true .xlsx, you'd need a library like exceljs
 */
export async function exportToExcel(entityType, companyId, filters = {}) {
  const config = ENTITY_CONFIGS[entityType];
  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // Build query
  const where = { companyId, ...buildWhere(filters) };
  
  // Fetch data
  const data = await prisma[config.model].findMany({
    where,
    include: config.include,
    orderBy: config.orderBy,
    take: filters.limit || 10000,
  });

  // Build TSV (Excel opens this correctly)
  const headers = config.fields.map(f => f.label);
  const rows = data.map(row => {
    return config.fields.map(field => {
      let value = getValue(row, field.key);
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
    count: data.length,
  };
}

/**
 * Build where clause from filters
 */
function buildWhere(filters) {
  const where = {};
  
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.type) {
    where.type = filters.type;
  }
  if (filters.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(filters.startDate) };
  }
  if (filters.endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(filters.endDate) };
  }
  if (filters.contactId) {
    where.contactId = filters.contactId;
  }
  if (filters.projectId) {
    where.projectId = filters.projectId;
  }
  
  return where;
}

/**
 * Escape value for CSV
 */
function escapeCSV(val) {
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
function escapeTSV(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
}

/**
 * Get available export types
 */
export function getExportTypes() {
  return Object.keys(ENTITY_CONFIGS);
}

/**
 * Get fields for an entity type
 */
export function getExportFields(entityType) {
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
