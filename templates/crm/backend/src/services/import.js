/**
 * CSV Import Service
 * 
 * Import data from CSV files:
 * - Contacts
 * - Projects
 * - Jobs
 * - Invoices
 * - Products/Services
 */

import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Parse CSV content
 */
function parseCSV(content, options = {}) {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...options,
  });
}

/**
 * Normalize column names (handle variations)
 */
function normalizeColumns(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    normalized[normalizedKey] = value;
  }
  return normalized;
}

/**
 * Get value from row with multiple possible column names
 */
function getValue(row, ...keys) {
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (row[normalizedKey] !== undefined && row[normalizedKey] !== '') {
      return row[normalizedKey];
    }
  }
  return null;
}

// ============================================
// CONTACT IMPORT
// ============================================

const CONTACT_COLUMN_MAP = {
  name: ['name', 'full_name', 'contact_name', 'company_name', 'customer_name', 'client_name'],
  email: ['email', 'email_address', 'e_mail'],
  phone: ['phone', 'phone_number', 'telephone', 'tel', 'primary_phone', 'main_phone'],
  mobile: ['mobile', 'cell', 'cell_phone', 'mobile_phone'],
  company: ['company', 'company_name', 'business_name', 'organization'],
  type: ['type', 'contact_type', 'category'],
  address: ['address', 'street', 'street_address', 'address_1', 'address1'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postcode'],
  notes: ['notes', 'comments', 'description'],
  website: ['website', 'web', 'url'],
  source: ['source', 'lead_source', 'referral_source'],
};

export async function importContacts(csvContent, companyId, options = {}) {
  const { dryRun = false, skipDuplicates = true } = options;
  
  const records = parseCSV(csvContent);
  const results = { imported: 0, skipped: 0, errors: [], records: [] };

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i]);
    const lineNum = i + 2; // +2 for header and 0-index

    try {
      // Extract fields
      const name = getValue(row, ...CONTACT_COLUMN_MAP.name);
      const email = getValue(row, ...CONTACT_COLUMN_MAP.email);

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Name is required' });
        results.skipped++;
        continue;
      }

      // Check for duplicates
      if (skipDuplicates && email) {
        const existing = await prisma.contact.findFirst({
          where: { companyId, email },
        });
        if (existing) {
          results.errors.push({ line: lineNum, error: `Duplicate email: ${email}` });
          results.skipped++;
          continue;
        }
      }

      const contactData = {
        companyId,
        name,
        email: email || null,
        phone: getValue(row, ...CONTACT_COLUMN_MAP.phone),
        mobile: getValue(row, ...CONTACT_COLUMN_MAP.mobile),
        company: getValue(row, ...CONTACT_COLUMN_MAP.company),
        type: mapContactType(getValue(row, ...CONTACT_COLUMN_MAP.type)),
        address: getValue(row, ...CONTACT_COLUMN_MAP.address),
        city: getValue(row, ...CONTACT_COLUMN_MAP.city),
        state: getValue(row, ...CONTACT_COLUMN_MAP.state),
        zip: getValue(row, ...CONTACT_COLUMN_MAP.zip),
        notes: getValue(row, ...CONTACT_COLUMN_MAP.notes),
        website: getValue(row, ...CONTACT_COLUMN_MAP.website),
        source: getValue(row, ...CONTACT_COLUMN_MAP.source),
      };

      if (!dryRun) {
        const contact = await prisma.contact.create({ data: contactData });
        results.records.push({ line: lineNum, id: contact.id, name: contact.name });
      } else {
        results.records.push({ line: lineNum, data: contactData });
      }
      
      results.imported++;
    } catch (error) {
      results.errors.push({ line: lineNum, error: error.message });
      results.skipped++;
    }
  }

  return results;
}

function mapContactType(type) {
  if (!type) return 'lead';
  const t = type.toLowerCase();
  if (t.includes('client') || t.includes('customer')) return 'client';
  if (t.includes('vendor') || t.includes('supplier')) return 'vendor';
  if (t.includes('sub')) return 'subcontractor';
  if (t.includes('lead') || t.includes('prospect')) return 'lead';
  return 'other';
}

// ============================================
// PROJECT IMPORT
// ============================================

const PROJECT_COLUMN_MAP = {
  name: ['name', 'project_name', 'title', 'project_title'],
  number: ['number', 'project_number', 'project_id', 'id'],
  description: ['description', 'desc', 'details'],
  status: ['status', 'project_status', 'state'],
  address: ['address', 'site_address', 'location', 'job_site'],
  city: ['city'],
  state: ['state', 'province'],
  zip: ['zip', 'zipcode', 'postal_code'],
  value: ['value', 'contract_value', 'amount', 'budget', 'price'],
  startDate: ['start_date', 'start', 'begin_date', 'commencement'],
  endDate: ['end_date', 'end', 'completion', 'due_date'],
  contactName: ['contact', 'contact_name', 'client', 'customer', 'client_name'],
  contactEmail: ['contact_email', 'client_email', 'email'],
};

export async function importProjects(csvContent, companyId, options = {}) {
  const { dryRun = false, createContacts = true } = options;
  
  const records = parseCSV(csvContent);
  const results = { imported: 0, skipped: 0, errors: [], records: [] };

  // Get next project number
  let nextNumber = await getNextProjectNumber(companyId);

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i]);
    const lineNum = i + 2;

    try {
      const name = getValue(row, ...PROJECT_COLUMN_MAP.name);

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Project name is required' });
        results.skipped++;
        continue;
      }

      // Find or create contact
      let contactId = null;
      const contactName = getValue(row, ...PROJECT_COLUMN_MAP.contactName);
      const contactEmail = getValue(row, ...PROJECT_COLUMN_MAP.contactEmail);

      if (contactName || contactEmail) {
        let contact = await prisma.contact.findFirst({
          where: {
            companyId,
            OR: [
              contactEmail ? { email: contactEmail } : {},
              contactName ? { name: contactName } : {},
            ].filter(c => Object.keys(c).length > 0),
          },
        });

        if (!contact && createContacts && !dryRun) {
          contact = await prisma.contact.create({
            data: {
              companyId,
              name: contactName || contactEmail,
              email: contactEmail,
              type: 'client',
            },
          });
        }

        contactId = contact?.id;
      }

      const projectData = {
        companyId,
        name,
        number: getValue(row, ...PROJECT_COLUMN_MAP.number) || `PRJ-${String(nextNumber++).padStart(4, '0')}`,
        description: getValue(row, ...PROJECT_COLUMN_MAP.description),
        status: mapProjectStatus(getValue(row, ...PROJECT_COLUMN_MAP.status)),
        address: getValue(row, ...PROJECT_COLUMN_MAP.address),
        city: getValue(row, ...PROJECT_COLUMN_MAP.city),
        state: getValue(row, ...PROJECT_COLUMN_MAP.state),
        zip: getValue(row, ...PROJECT_COLUMN_MAP.zip),
        value: parseDecimal(getValue(row, ...PROJECT_COLUMN_MAP.value)),
        startDate: parseDate(getValue(row, ...PROJECT_COLUMN_MAP.startDate)),
        endDate: parseDate(getValue(row, ...PROJECT_COLUMN_MAP.endDate)),
        contactId,
      };

      if (!dryRun) {
        const project = await prisma.project.create({ data: projectData });
        results.records.push({ line: lineNum, id: project.id, name: project.name });
      } else {
        results.records.push({ line: lineNum, data: projectData });
      }

      results.imported++;
    } catch (error) {
      results.errors.push({ line: lineNum, error: error.message });
      results.skipped++;
    }
  }

  return results;
}

function mapProjectStatus(status) {
  if (!status) return 'planning';
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('progress')) return 'active';
  if (s.includes('complete') || s.includes('done') || s.includes('finished')) return 'completed';
  if (s.includes('hold') || s.includes('pause')) return 'on_hold';
  if (s.includes('cancel')) return 'cancelled';
  return 'planning';
}

// ============================================
// JOBS IMPORT
// ============================================

const JOB_COLUMN_MAP = {
  title: ['title', 'job_title', 'name', 'job_name', 'description'],
  number: ['number', 'job_number', 'job_id', 'work_order'],
  type: ['type', 'job_type', 'service_type', 'category'],
  status: ['status', 'job_status'],
  priority: ['priority'],
  scheduledDate: ['scheduled_date', 'date', 'service_date', 'appointment'],
  scheduledTime: ['scheduled_time', 'time', 'appointment_time'],
  address: ['address', 'site_address', 'location', 'service_address'],
  city: ['city'],
  state: ['state'],
  zip: ['zip', 'zipcode'],
  notes: ['notes', 'instructions', 'description', 'details'],
  projectName: ['project', 'project_name'],
  contactName: ['contact', 'contact_name', 'customer', 'client'],
  assignedTo: ['assigned_to', 'technician', 'worker', 'employee'],
};

export async function importJobs(csvContent, companyId, options = {}) {
  const { dryRun = false, createContacts = true } = options;
  
  const records = parseCSV(csvContent);
  const results = { imported: 0, skipped: 0, errors: [], records: [] };

  let nextNumber = await getNextJobNumber(companyId);

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i]);
    const lineNum = i + 2;

    try {
      const title = getValue(row, ...JOB_COLUMN_MAP.title);

      if (!title) {
        results.errors.push({ line: lineNum, error: 'Job title is required' });
        results.skipped++;
        continue;
      }

      // Find contact
      let contactId = null;
      const contactName = getValue(row, ...JOB_COLUMN_MAP.contactName);
      if (contactName) {
        const contact = await prisma.contact.findFirst({
          where: { companyId, name: { contains: contactName, mode: 'insensitive' } },
        });
        contactId = contact?.id;
      }

      // Find project
      let projectId = null;
      const projectName = getValue(row, ...JOB_COLUMN_MAP.projectName);
      if (projectName) {
        const project = await prisma.project.findFirst({
          where: { companyId, name: { contains: projectName, mode: 'insensitive' } },
        });
        projectId = project?.id;
      }

      // Find assigned user
      let assignedToId = null;
      const assignedTo = getValue(row, ...JOB_COLUMN_MAP.assignedTo);
      if (assignedTo) {
        const user = await prisma.user.findFirst({
          where: {
            companyId,
            OR: [
              { email: { contains: assignedTo, mode: 'insensitive' } },
              { firstName: { contains: assignedTo, mode: 'insensitive' } },
              { lastName: { contains: assignedTo, mode: 'insensitive' } },
            ],
          },
        });
        assignedToId = user?.id;
      }

      const jobData = {
        companyId,
        title,
        number: getValue(row, ...JOB_COLUMN_MAP.number) || `JOB-${String(nextNumber++).padStart(5, '0')}`,
        type: getValue(row, ...JOB_COLUMN_MAP.type),
        status: mapJobStatus(getValue(row, ...JOB_COLUMN_MAP.status)),
        priority: mapPriority(getValue(row, ...JOB_COLUMN_MAP.priority)),
        scheduledDate: parseDate(getValue(row, ...JOB_COLUMN_MAP.scheduledDate)),
        address: getValue(row, ...JOB_COLUMN_MAP.address),
        city: getValue(row, ...JOB_COLUMN_MAP.city),
        state: getValue(row, ...JOB_COLUMN_MAP.state),
        zip: getValue(row, ...JOB_COLUMN_MAP.zip),
        notes: getValue(row, ...JOB_COLUMN_MAP.notes),
        contactId,
        projectId,
        assignedToId,
      };

      if (!dryRun) {
        const job = await prisma.job.create({ data: jobData });
        results.records.push({ line: lineNum, id: job.id, title: job.title });
      } else {
        results.records.push({ line: lineNum, data: jobData });
      }

      results.imported++;
    } catch (error) {
      results.errors.push({ line: lineNum, error: error.message });
      results.skipped++;
    }
  }

  return results;
}

function mapJobStatus(status) {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  if (s.includes('schedul')) return 'scheduled';
  if (s.includes('progress') || s.includes('started')) return 'in_progress';
  if (s.includes('complete') || s.includes('done')) return 'completed';
  if (s.includes('cancel')) return 'cancelled';
  return 'pending';
}

function mapPriority(priority) {
  if (!priority) return 'medium';
  const p = priority.toLowerCase();
  if (p.includes('low')) return 'low';
  if (p.includes('high') || p.includes('urgent')) return 'high';
  if (p.includes('critical') || p.includes('emergency')) return 'critical';
  return 'medium';
}

// ============================================
// PRODUCTS/SERVICES IMPORT
// ============================================

const PRODUCT_COLUMN_MAP = {
  name: ['name', 'product_name', 'service_name', 'item_name', 'description'],
  sku: ['sku', 'code', 'item_code', 'product_code'],
  type: ['type', 'item_type'],
  price: ['price', 'unit_price', 'rate', 'amount', 'cost'],
  unit: ['unit', 'uom', 'unit_of_measure'],
  category: ['category', 'group'],
  description: ['description', 'desc', 'details', 'notes'],
  taxable: ['taxable', 'tax'],
};

export async function importProducts(csvContent, companyId, options = {}) {
  const { dryRun = false } = options;
  
  const records = parseCSV(csvContent);
  const results = { imported: 0, skipped: 0, errors: [], records: [] };

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i]);
    const lineNum = i + 2;

    try {
      const name = getValue(row, ...PRODUCT_COLUMN_MAP.name);

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Product name is required' });
        results.skipped++;
        continue;
      }

      const productData = {
        companyId,
        name,
        sku: getValue(row, ...PRODUCT_COLUMN_MAP.sku),
        type: getValue(row, ...PRODUCT_COLUMN_MAP.type) || 'service',
        price: parseDecimal(getValue(row, ...PRODUCT_COLUMN_MAP.price)),
        unit: getValue(row, ...PRODUCT_COLUMN_MAP.unit) || 'each',
        category: getValue(row, ...PRODUCT_COLUMN_MAP.category),
        description: getValue(row, ...PRODUCT_COLUMN_MAP.description),
        taxable: parseBoolean(getValue(row, ...PRODUCT_COLUMN_MAP.taxable)),
        active: true,
      };

      if (!dryRun) {
        const product = await prisma.product.create({ data: productData });
        results.records.push({ line: lineNum, id: product.id, name: product.name });
      } else {
        results.records.push({ line: lineNum, data: productData });
      }

      results.imported++;
    } catch (error) {
      results.errors.push({ line: lineNum, error: error.message });
      results.skipped++;
    }
  }

  return results;
}

// ============================================
// HELPERS
// ============================================

async function getNextProjectNumber(companyId) {
  const last = await prisma.project.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (!last?.number) return 1;
  const match = last.number.match(/(\d+)/);
  return match ? parseInt(match[1]) + 1 : 1;
}

async function getNextJobNumber(companyId) {
  const last = await prisma.job.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (!last?.number) return 1;
  const match = last.number.match(/(\d+)/);
  return match ? parseInt(match[1]) + 1 : 1;
}

function parseDecimal(value) {
  if (!value) return null;
  const cleaned = value.toString().replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function parseBoolean(value) {
  if (!value) return false;
  const v = value.toString().toLowerCase();
  return ['true', 'yes', '1', 'y'].includes(v);
}

/**
 * Validate CSV structure before import
 */
export function validateCSV(csvContent, type) {
  try {
    const records = parseCSV(csvContent);
    
    if (records.length === 0) {
      return { valid: false, error: 'CSV file is empty' };
    }

    const firstRow = normalizeColumns(records[0]);
    const columns = Object.keys(firstRow);

    // Check for required columns based on type
    const requiredMap = {
      contacts: CONTACT_COLUMN_MAP.name,
      projects: PROJECT_COLUMN_MAP.name,
      jobs: JOB_COLUMN_MAP.title,
      products: PRODUCT_COLUMN_MAP.name,
    };

    const required = requiredMap[type];
    const hasRequired = required.some(col => 
      columns.some(c => c.includes(col.replace(/_/g, '')))
    );

    if (!hasRequired) {
      return { 
        valid: false, 
        error: `Missing required column. Expected one of: ${required.join(', ')}`,
        columns,
      };
    }

    return {
      valid: true,
      rowCount: records.length,
      columns,
      sample: records.slice(0, 3),
    };
  } catch (error) {
    return { valid: false, error: `Failed to parse CSV: ${error.message}` };
  }
}

/**
 * Get import template
 */
export function getTemplate(type) {
  const templates = {
    contacts: 'Name,Email,Phone,Mobile,Company,Type,Address,City,State,Zip,Notes\nJohn Smith,john@example.com,555-1234,555-5678,Acme Corp,client,123 Main St,Springfield,IL,62701,Important customer',
    projects: 'Name,Number,Description,Status,Address,City,State,Zip,Value,Start Date,End Date,Contact Name,Contact Email\nNew Office Build,PRJ-001,Commercial office renovation,active,456 Oak Ave,Chicago,IL,60601,150000,2024-01-15,2024-06-30,Jane Doe,jane@client.com',
    jobs: 'Title,Number,Type,Status,Priority,Scheduled Date,Address,City,State,Zip,Notes,Project,Contact,Assigned To\nHVAC Installation,JOB-001,installation,scheduled,high,2024-02-01,789 Pine St,Chicago,IL,60602,Bring extra filters,New Office Build,Jane Doe,john@company.com',
    products: 'Name,SKU,Type,Price,Unit,Category,Description,Taxable\nStandard Labor,LAB-001,service,75.00,hour,Labor,Standard hourly rate,yes\nPVC Pipe 4in,MAT-001,product,12.50,foot,Materials,4 inch PVC pipe,yes',
  };

  return templates[type] || '';
}

export default {
  importContacts,
  importProjects,
  importJobs,
  importProducts,
  validateCSV,
  getTemplate,
};
