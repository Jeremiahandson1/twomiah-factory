/**
 * CSV Import Service
 *
 * Import data from CSV files:
 * - Contacts
 * - Projects
 * - Jobs
 * - Products/Services
 */

import { parse } from 'csv-parse/sync'
import { db } from '../../db/index.ts'
import { contact, project, job, user, pricebookItem } from '../../db/schema.ts'
import { eq, and, or, ilike, desc } from 'drizzle-orm'

/**
 * Parse CSV content
 */
function parseCSV(content: string, options: Record<string, any> = {}): Record<string, string>[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...options,
  })
}

/**
 * Normalize column names (handle variations)
 */
function normalizeColumns(row: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
    normalized[normalizedKey] = value
  }
  return normalized
}

/**
 * Get value from row with multiple possible column names
 */
function getValue(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '_')
    if (row[normalizedKey] !== undefined && row[normalizedKey] !== '') {
      return row[normalizedKey]
    }
  }
  return null
}

// ============================================
// CONTACT IMPORT
// ============================================

const CONTACT_COLUMN_MAP = {
  // Name fields
  name: ['name', 'full_name', 'contact_name', 'customer_name', 'client_name', 'client', 'display_name'],
  firstName: ['first_name', 'firstname', 'first', 'given_name'],
  lastName: ['last_name', 'lastname', 'last', 'surname', 'family_name'],
  company: ['company', 'company_name', 'business_name', 'organization'],
  title: ['title', 'prefix', 'salutation'],

  // Contact info
  email: ['email', 'email_address', 'e_mail', 'primary_email'],
  phone: ['phone', 'phone_number', 'telephone', 'tel', 'primary_phone', 'main_phone', 'home_phone', 'work_phone', 'office_phone'],
  mobile: ['mobile', 'cell', 'cell_phone', 'mobile_phone', 'mobile_number'],
  fax: ['fax', 'fax_number'],

  // Billing/mailing address
  address: ['address', 'street', 'street_address', 'address_1', 'address1', 'street_1', 'billing_address', 'mailing_address'],
  address2: ['address_2', 'address2', 'street_2', 'suite', 'apt', 'unit'],
  city: ['city', 'town', 'billing_city'],
  state: ['state', 'province', 'region', 'state_province', 'billing_state'],
  zip: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postcode', 'billing_zip', 'billing_postal_code'],
  country: ['country', 'billing_country'],

  // Property/service address (Jobber exports these separately)
  propertyAddress: ['property_street_1', 'property_address', 'service_address', 'job_address', 'property_street'],
  propertyAddress2: ['property_street_2'],
  propertyCity: ['property_city', 'service_city', 'job_city'],
  propertyState: ['property_state_province', 'property_state', 'service_state'],
  propertyZip: ['property_zip_postal_code', 'property_zip', 'property_postal_code', 'service_zip'],
  propertyCountry: ['property_country'],

  // Metadata
  type: ['type', 'contact_type', 'category', 'client_type'],
  notes: ['notes', 'comments', 'description', 'note'],
  tags: ['tags', 'tag', 'labels', 'categories'],
  website: ['website', 'web', 'url'],
  source: ['source', 'lead_source', 'referral_source'],

  // External IDs (for migration tracking)
  externalId: ['j_id', 'jobber_id', 'id', 'client_id', 'customer_id', 'external_id', 'servicetitan_id', 'housecall_id'],
}

interface ImportOptions {
  dryRun?: boolean
  skipDuplicates?: boolean
  createContacts?: boolean
}

interface ImportResults {
  imported: number
  skipped: number
  errors: Array<{ line: number; error: string }>
  records: Array<any>
}

export async function importContacts(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
  const { dryRun = false, skipDuplicates = true } = options

  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, errors: [], records: [] }

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      // Build name from full name OR first+last name columns
      let name = getValue(row, ...CONTACT_COLUMN_MAP.name)
      if (!name) {
        const firstName = getValue(row, ...CONTACT_COLUMN_MAP.firstName)
        const lastName = getValue(row, ...CONTACT_COLUMN_MAP.lastName)
        if (firstName || lastName) {
          name = [firstName, lastName].filter(Boolean).join(' ')
        }
      }
      // Fall back to company name if no personal name
      if (!name) {
        name = getValue(row, ...CONTACT_COLUMN_MAP.company)
      }
      const email = getValue(row, ...CONTACT_COLUMN_MAP.email)

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Name is required (provide name, first_name + last_name, or company_name)' })
        results.skipped++
        continue
      }

      // Check for duplicates
      if (skipDuplicates && email) {
        const [existing] = await db.select({ id: contact.id })
          .from(contact)
          .where(and(eq(contact.companyId, companyId), eq(contact.email, email)))
          .limit(1)

        if (existing) {
          results.errors.push({ line: lineNum, error: `Duplicate email: ${email}` })
          results.skipped++
          continue
        }
      }

      // Build address — prefer property address over billing if both exist (service businesses care about job site)
      const billingAddress = getValue(row, ...CONTACT_COLUMN_MAP.address)
      const propertyAddress = getValue(row, ...CONTACT_COLUMN_MAP.propertyAddress)
      const address2 = getValue(row, ...CONTACT_COLUMN_MAP.address2) || getValue(row, ...CONTACT_COLUMN_MAP.propertyAddress2)

      const primaryAddress = propertyAddress || billingAddress
      const fullAddress = address2 ? `${primaryAddress}, ${address2}` : primaryAddress

      const primaryCity = getValue(row, ...CONTACT_COLUMN_MAP.propertyCity) || getValue(row, ...CONTACT_COLUMN_MAP.city)
      const primaryState = getValue(row, ...CONTACT_COLUMN_MAP.propertyState) || getValue(row, ...CONTACT_COLUMN_MAP.state)
      const primaryZip = getValue(row, ...CONTACT_COLUMN_MAP.propertyZip) || getValue(row, ...CONTACT_COLUMN_MAP.zip)

      // Build notes — include tags and any extra info
      const notes = getValue(row, ...CONTACT_COLUMN_MAP.notes)
      const tags = getValue(row, ...CONTACT_COLUMN_MAP.tags)
      const externalId = getValue(row, ...CONTACT_COLUMN_MAP.externalId)
      const fullNotes = [
        notes,
        tags ? `Tags: ${tags}` : null,
        externalId ? `Imported ID: ${externalId}` : null,
      ].filter(Boolean).join('\n') || null

      const contactData = {
        companyId,
        name,
        email: email || null,
        phone: getValue(row, ...CONTACT_COLUMN_MAP.phone),
        mobile: getValue(row, ...CONTACT_COLUMN_MAP.mobile),
        company: getValue(row, ...CONTACT_COLUMN_MAP.company),
        type: mapContactType(getValue(row, ...CONTACT_COLUMN_MAP.type)),
        address: fullAddress || null,
        city: primaryCity,
        state: primaryState,
        zip: primaryZip,
        notes: fullNotes,
        source: getValue(row, ...CONTACT_COLUMN_MAP.source),
        tags: tags ? JSON.stringify(tags.split(',').map((t: string) => t.trim())) : '[]',
      }

      if (!dryRun) {
        const [created] = await db.insert(contact).values(contactData).returning()
        results.records.push({ line: lineNum, id: created.id, name: created.name })
      } else {
        results.records.push({ line: lineNum, data: contactData })
      }

      results.imported++
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

function mapContactType(type: string | null): string {
  if (!type) return 'lead'
  const t = type.toLowerCase()
  if (t.includes('client') || t.includes('customer')) return 'client'
  if (t.includes('vendor') || t.includes('supplier')) return 'vendor'
  if (t.includes('sub')) return 'subcontractor'
  if (t.includes('lead') || t.includes('prospect')) return 'lead'
  return 'other'
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
}

export async function importProjects(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
  const { dryRun = false, createContacts = true } = options

  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, errors: [], records: [] }

  let nextNumber = await getNextProjectNumber(companyId)

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      const name = getValue(row, ...PROJECT_COLUMN_MAP.name)

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Project name is required' })
        results.skipped++
        continue
      }

      // Find or create contact
      let contactId: string | null = null
      const contactName = getValue(row, ...PROJECT_COLUMN_MAP.contactName)
      const contactEmail = getValue(row, ...PROJECT_COLUMN_MAP.contactEmail)

      if (contactName || contactEmail) {
        const conditions = []
        if (contactEmail) conditions.push(eq(contact.email, contactEmail))
        if (contactName) conditions.push(eq(contact.name, contactName))

        const [existingContact] = await db.select({ id: contact.id })
          .from(contact)
          .where(and(eq(contact.companyId, companyId), or(...conditions)))
          .limit(1)

        if (existingContact) {
          contactId = existingContact.id
        } else if (createContacts && !dryRun) {
          const [newContact] = await db.insert(contact).values({
            companyId,
            name: contactName || contactEmail!,
            email: contactEmail,
            type: 'client',
          }).returning()
          contactId = newContact.id
        }
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
        estimatedValue: parseDecimal(getValue(row, ...PROJECT_COLUMN_MAP.value))?.toString() ?? null,
        startDate: parseDate(getValue(row, ...PROJECT_COLUMN_MAP.startDate)),
        endDate: parseDate(getValue(row, ...PROJECT_COLUMN_MAP.endDate)),
        contactId,
      }

      if (!dryRun) {
        const [created] = await db.insert(project).values(projectData).returning()
        results.records.push({ line: lineNum, id: created.id, name: created.name })
      } else {
        results.records.push({ line: lineNum, data: projectData })
      }

      results.imported++
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

function mapProjectStatus(status: string | null): string {
  if (!status) return 'planning'
  const s = status.toLowerCase()
  if (s.includes('active') || s.includes('progress')) return 'active'
  if (s.includes('complete') || s.includes('done') || s.includes('finished')) return 'completed'
  if (s.includes('hold') || s.includes('pause')) return 'on_hold'
  if (s.includes('cancel')) return 'cancelled'
  return 'planning'
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
}

export async function importJobs(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
  const { dryRun = false } = options

  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, errors: [], records: [] }

  let nextNumber = await getNextJobNumber(companyId)

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      const title = getValue(row, ...JOB_COLUMN_MAP.title)

      if (!title) {
        results.errors.push({ line: lineNum, error: 'Job title is required' })
        results.skipped++
        continue
      }

      // Find contact
      let contactId: string | null = null
      const contactName = getValue(row, ...JOB_COLUMN_MAP.contactName)
      if (contactName) {
        const [found] = await db.select({ id: contact.id })
          .from(contact)
          .where(and(eq(contact.companyId, companyId), ilike(contact.name, `%${contactName}%`)))
          .limit(1)
        contactId = found?.id ?? null
      }

      // Find project
      let projectId: string | null = null
      const projectName = getValue(row, ...JOB_COLUMN_MAP.projectName)
      if (projectName) {
        const [found] = await db.select({ id: project.id })
          .from(project)
          .where(and(eq(project.companyId, companyId), ilike(project.name, `%${projectName}%`)))
          .limit(1)
        projectId = found?.id ?? null
      }

      // Find assigned user
      let assignedToId: string | null = null
      const assignedTo = getValue(row, ...JOB_COLUMN_MAP.assignedTo)
      if (assignedTo) {
        const [found] = await db.select({ id: user.id })
          .from(user)
          .where(and(
            eq(user.companyId, companyId),
            or(
              ilike(user.email, `%${assignedTo}%`),
              ilike(user.firstName, `%${assignedTo}%`),
              ilike(user.lastName, `%${assignedTo}%`),
            ),
          ))
          .limit(1)
        assignedToId = found?.id ?? null
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
      }

      if (!dryRun) {
        const [created] = await db.insert(job).values(jobData).returning()
        results.records.push({ line: lineNum, id: created.id, title: created.title })
      } else {
        results.records.push({ line: lineNum, data: jobData })
      }

      results.imported++
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

function mapJobStatus(status: string | null): string {
  if (!status) return 'pending'
  const s = status.toLowerCase()
  if (s.includes('schedul')) return 'scheduled'
  if (s.includes('progress') || s.includes('started')) return 'in_progress'
  if (s.includes('complete') || s.includes('done')) return 'completed'
  if (s.includes('cancel')) return 'cancelled'
  return 'pending'
}

function mapPriority(priority: string | null): string {
  if (!priority) return 'medium'
  const p = priority.toLowerCase()
  if (p.includes('low')) return 'low'
  if (p.includes('high') || p.includes('urgent')) return 'high'
  if (p.includes('critical') || p.includes('emergency')) return 'critical'
  return 'medium'
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
}

export async function importProducts(csvContent: string, companyId: string, options: ImportOptions = {}): Promise<ImportResults> {
  const { dryRun = false } = options

  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, errors: [], records: [] }

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      const name = getValue(row, ...PRODUCT_COLUMN_MAP.name)

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Product name is required' })
        results.skipped++
        continue
      }

      const productData = {
        companyId,
        name,
        code: getValue(row, ...PRODUCT_COLUMN_MAP.sku),
        type: getValue(row, ...PRODUCT_COLUMN_MAP.type) || 'service',
        price: String(parseDecimal(getValue(row, ...PRODUCT_COLUMN_MAP.price)) || 0),
        unit: getValue(row, ...PRODUCT_COLUMN_MAP.unit) || 'each',
        description: getValue(row, ...PRODUCT_COLUMN_MAP.description),
        taxable: parseBoolean(getValue(row, ...PRODUCT_COLUMN_MAP.taxable)),
        active: true,
      }

      if (!dryRun) {
        const [created] = await db.insert(pricebookItem).values(productData).returning()
        results.records.push({ line: lineNum, id: created.id, name: created.name })
      } else {
        results.records.push({ line: lineNum, data: productData })
      }

      results.imported++
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

// ============================================
// HELPERS
// ============================================

async function getNextProjectNumber(companyId: string): Promise<number> {
  const [last] = await db.select({ number: project.number })
    .from(project)
    .where(eq(project.companyId, companyId))
    .orderBy(desc(project.createdAt))
    .limit(1)

  if (!last?.number) return 1
  const match = last.number.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

async function getNextJobNumber(companyId: string): Promise<number> {
  const [last] = await db.select({ number: job.number })
    .from(job)
    .where(eq(job.companyId, companyId))
    .orderBy(desc(job.createdAt))
    .limit(1)

  if (!last?.number) return 1
  const match = last.number.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

function parseDecimal(value: string | null): number | null {
  if (!value) return null
  const cleaned = value.toString().replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

function parseBoolean(value: string | null): boolean {
  if (!value) return false
  const v = value.toString().toLowerCase()
  return ['true', 'yes', '1', 'y'].includes(v)
}

/**
 * Validate CSV structure before import
 */
export function validateCSV(csvContent: string, type: string) {
  try {
    const records = parseCSV(csvContent)

    if (records.length === 0) {
      return { valid: false, error: 'CSV file is empty' }
    }

    const firstRow = normalizeColumns(records[0])
    const columns = Object.keys(firstRow)

    // Check for required columns based on type
    const requiredMap: Record<string, string[]> = {
      contacts: CONTACT_COLUMN_MAP.name,
      projects: PROJECT_COLUMN_MAP.name,
      jobs: JOB_COLUMN_MAP.title,
      products: PRODUCT_COLUMN_MAP.name,
    }

    const required = requiredMap[type]
    const hasRequired = required.some(col =>
      columns.some(c => c.includes(col.replace(/_/g, '')))
    )

    if (!hasRequired) {
      return {
        valid: false,
        error: `Missing required column. Expected one of: ${required.join(', ')}`,
        columns,
      }
    }

    return {
      valid: true,
      rowCount: records.length,
      columns,
      sample: records.slice(0, 3),
    }
  } catch (error: any) {
    return { valid: false, error: `Failed to parse CSV: ${error.message}` }
  }
}

/**
 * Get import template
 */
export function getTemplate(type: string): string {
  const templates: Record<string, string> = {
    contacts: 'Name,Email,Phone,Mobile,Company,Type,Address,City,State,Zip,Notes\nJohn Smith,john@example.com,555-1234,555-5678,Acme Corp,client,123 Main St,Springfield,IL,62701,Important customer',
    projects: 'Name,Number,Description,Status,Address,City,State,Zip,Value,Start Date,End Date,Contact Name,Contact Email\nNew Office Build,PRJ-001,Commercial office renovation,active,456 Oak Ave,Chicago,IL,60601,150000,2024-01-15,2024-06-30,Jane Doe,jane@client.com',
    jobs: 'Title,Number,Type,Status,Priority,Scheduled Date,Address,City,State,Zip,Notes,Project,Contact,Assigned To\nHVAC Installation,JOB-001,installation,scheduled,high,2024-02-01,789 Pine St,Chicago,IL,60602,Bring extra filters,New Office Build,Jane Doe,john@company.com',
    products: 'Name,SKU,Type,Price,Unit,Category,Description,Taxable\nStandard Labor,LAB-001,service,75.00,hour,Labor,Standard hourly rate,yes\nPVC Pipe 4in,MAT-001,product,12.50,foot,Materials,4 inch PVC pipe,yes',
  }

  return templates[type] || ''
}

export default {
  importContacts,
  importProjects,
  importJobs,
  importProducts,
  validateCSV,
  previewImport: validateCSV,
  getTemplate,
}
