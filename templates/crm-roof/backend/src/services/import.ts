/**
 * CSV Import Service for CRM-Roof
 *
 * Handles multi-file import from Jobber and other field service platforms.
 * Cross-references contacts ↔ jobs ↔ quotes ↔ invoices by name, email, and address.
 *
 * Key behaviors:
 * - Deduplicates contacts (same person with multiple properties stays as one contact)
 * - Matches jobs to contacts by name/email/address
 * - Creates quotes and invoices from job CSV data and links them
 * - Handles Jobber-specific column naming (J-ID, Service Street 1, etc.)
 */

import { parse } from 'csv-parse/sync'
import { db } from '../../db/index.ts'
import { contact, job, quote, invoice, user } from '../../db/schema.ts'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'

// ============================================
// CSV PARSING HELPERS
// ============================================

function parseCSV(content: string): Record<string, string>[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  })
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function normalizeColumns(row: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(key)] = value
  }
  return normalized
}

function getValue(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key)
    if (row[normalizedKey] !== undefined && row[normalizedKey] !== '') {
      return row[normalizedKey].trim()
    }
  }
  return null
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null
  return phone.replace(/[^0-9+]/g, '')
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null
  // Jobber exports can have multiple emails comma-separated — take the first
  const first = email.split(',')[0].trim().toLowerCase()
  return first || null
}

function parseDecimal(value: string | null): number | null {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseDate(value: string | null): Date | null {
  if (!value || value === '-') return null
  // Handle Jobber date formats: "29/07/2025" (DD/MM/YYYY) and "Dec 02, 2025"
  const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  }
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

// ============================================
// CONTACT MATCHING / DEDUPLICATION
// ============================================

/**
 * Normalize a name for fuzzy matching:
 * - Lowercase, trim whitespace
 * - Remove extra spaces
 * - Strip common titles
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Score how well two names match (0-1).
 * Handles cases like "Richard Golde" matching "Richard  Golde " (extra whitespace)
 * and "Craig & Molly Denore" matching job's "Craig & Molly  Denore"
 */
function nameMatchScore(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return 1.0
  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.9
  // Check last name match (for cases like "Craig & Molly Denore" vs "Denore")
  const partsA = na.split(' ')
  const partsB = nb.split(' ')
  const lastA = partsA[partsA.length - 1]
  const lastB = partsB[partsB.length - 1]
  if (lastA === lastB && lastA.length > 2) return 0.7
  return 0
}

/**
 * Normalize address for comparison
 */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bst\b\.?/g, 'street')
    .replace(/\bave\b\.?/g, 'avenue')
    .replace(/\bdr\b\.?/g, 'drive')
    .replace(/\brd\b\.?/g, 'road')
    .replace(/\bln\b\.?/g, 'lane')
    .replace(/\bct\b\.?/g, 'court')
    .replace(/\bblvd\b\.?/g, 'boulevard')
    .trim()
}

// ============================================
// TYPES
// ============================================

interface ImportResults {
  imported: number
  skipped: number
  updated: number
  errors: Array<{ line: number; error: string }>
  records: Array<{
    line: number
    id?: string
    type: string
    name: string
    action: string
    linkedTo?: string
  }>
}

interface CrossRefMap {
  /** Map of normalized "firstName lastName" → contact DB id */
  contactsByName: Map<string, string>
  /** Map of normalized email → contact DB id */
  contactsByEmail: Map<string, string>
  /** Map of normalized address → contact DB id */
  contactsByAddress: Map<string, string>
  /** Map of jobber J-ID prefix (before _) → contact DB id */
  contactsByExternalId: Map<string, string>
  /** Map of job number → job DB id */
  jobsById: Map<string, string>
  /** Map of job number → contact DB id */
  jobContactMap: Map<string, string>
}

// ============================================
// CONTACT IMPORT (from Jobber Clients CSV)
// ============================================

const CLIENT_COLUMNS = {
  externalId: ['j_id', 'jobber_id', 'id', 'client_id', 'customer_id'],
  displayName: ['display_name', 'name', 'full_name', 'client_name'],
  companyName: ['company_name', 'company', 'business_name'],
  firstName: ['first_name', 'firstname', 'first', 'given_name'],
  lastName: ['last_name', 'lastname', 'last', 'surname'],
  email: ['e_mails', 'email', 'email_address', 'primary_email'],
  mainPhone: ['main_phone_s', 'phone', 'phone_number', 'telephone', 'main_phone'],
  mobilePhone: ['mobile_phone_s', 'mobile', 'cell', 'cell_phone', 'mobile_phone'],
  workPhone: ['work_phone_s', 'work_phone', 'office_phone'],
  homePhone: ['home_phone_s', 'home_phone'],
  // Service/property address (preferred for roofing — this is the job site)
  serviceStreet: ['service_street_1', 'service_street', 'property_street_1', 'property_address', 'service_address'],
  serviceStreet2: ['service_street_2', 'property_street_2'],
  serviceCity: ['service_city', 'property_city'],
  serviceState: ['service_state', 'service_province', 'property_state'],
  serviceZip: ['service_zip_code', 'service_zip', 'property_zip', 'service_postal_code'],
  serviceCountry: ['service_country', 'property_country'],
  servicePropertyName: ['service_property_name', 'property_name'],
  // Billing address (fallback)
  billingStreet: ['billing_street_1', 'billing_address', 'address', 'street'],
  billingCity: ['billing_city', 'city'],
  billingState: ['billing_state', 'state', 'province'],
  billingZip: ['billing_zip_code', 'billing_zip', 'zip'],
  // Metadata
  leadSource: ['lead_source', 'source'],
  tags: ['tags', 'tag'],
  insuranceClaim: ['cft_insurance_claim', 'insurance_claim', 'claim_number'],
  archived: ['archived'],
  isCompany: ['is_company'],
  trades: ['pfs_trades', 'trades'],
  smsEnabled: ['text_message_enabled_phone'],
}

export async function importContacts(
  csvContent: string,
  companyId: string,
  crossRef: CrossRefMap,
  options: { dryRun?: boolean } = {}
): Promise<ImportResults> {
  const { dryRun = false } = options
  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, updated: 0, errors: [], records: [] }

  // Track seen names to deduplicate within the CSV (same person, multiple properties)
  const seenContacts = new Map<string, { id: string; properties: string[] }>()

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      // Skip archived contacts
      const archived = getValue(row, ...CLIENT_COLUMNS.archived)
      if (archived === 'true') {
        results.skipped++
        results.records.push({ line: lineNum, type: 'contact', name: getValue(row, ...CLIENT_COLUMNS.displayName) || 'Unknown', action: 'skipped_archived' })
        continue
      }

      // Extract name
      let firstName = getValue(row, ...CLIENT_COLUMNS.firstName)?.trim() || ''
      let lastName = getValue(row, ...CLIENT_COLUMNS.lastName)?.trim() || ''
      const displayName = getValue(row, ...CLIENT_COLUMNS.displayName)
      const companyName = getValue(row, ...CLIENT_COLUMNS.companyName)

      // Fall back to parsing display name if no first/last
      if (!firstName && !lastName && displayName) {
        const parts = displayName.trim().split(/\s+/)
        if (parts.length >= 2) {
          lastName = parts.pop()!
          firstName = parts.join(' ')
        } else {
          firstName = displayName
          lastName = ''
        }
      }

      if (!firstName && !lastName) {
        if (companyName) {
          firstName = companyName
          lastName = ''
        } else {
          results.errors.push({ line: lineNum, error: 'No name found' })
          results.skipped++
          continue
        }
      }

      const fullName = normalizeName(`${firstName} ${lastName}`)
      const email = normalizeEmail(getValue(row, ...CLIENT_COLUMNS.email))
      const phone = normalizePhone(getValue(row, ...CLIENT_COLUMNS.mainPhone))
      const mobilePhone = normalizePhone(getValue(row, ...CLIENT_COLUMNS.mobilePhone)) ||
                          normalizePhone(getValue(row, ...CLIENT_COLUMNS.homePhone)) ||
                          normalizePhone(getValue(row, ...CLIENT_COLUMNS.workPhone))

      // Build address — prefer service address (job site) over billing
      const serviceStreet = getValue(row, ...CLIENT_COLUMNS.serviceStreet)
      const billingStreet = getValue(row, ...CLIENT_COLUMNS.billingStreet)
      const address = serviceStreet || billingStreet || null
      const city = getValue(row, ...CLIENT_COLUMNS.serviceCity) || getValue(row, ...CLIENT_COLUMNS.billingCity)
      const state = getValue(row, ...CLIENT_COLUMNS.serviceState) || getValue(row, ...CLIENT_COLUMNS.billingState)
      const zip = getValue(row, ...CLIENT_COLUMNS.serviceZip) || getValue(row, ...CLIENT_COLUMNS.billingZip)
      const propertyName = getValue(row, ...CLIENT_COLUMNS.servicePropertyName)

      // External ID for cross-referencing (Jobber J-ID has format "clientId_propertyId")
      const externalId = getValue(row, ...CLIENT_COLUMNS.externalId)
      const clientIdPrefix = externalId?.split('_')[0] || null

      // Metadata
      const leadSource = getValue(row, ...CLIENT_COLUMNS.leadSource)
      const trades = getValue(row, ...CLIENT_COLUMNS.trades)
      const insuranceClaim = getValue(row, ...CLIENT_COLUMNS.insuranceClaim)

      // Deduplicate: check if we already processed this person in THIS import
      // Jobber exports one row per property, so Richard Golde with 4 properties = 4 rows
      const dedupeKey = email ? email : fullName
      const alreadySeen = seenContacts.get(dedupeKey)

      if (alreadySeen) {
        // Same person, different property — store the property address in notes
        if (address) {
          alreadySeen.properties.push(
            [propertyName, address, city, state, zip].filter(Boolean).join(', ')
          )
        }
        // Update cross-ref maps for this property's address
        if (address) {
          crossRef.contactsByAddress.set(normalizeAddress(address), alreadySeen.id)
        }
        if (clientIdPrefix) {
          crossRef.contactsByExternalId.set(clientIdPrefix, alreadySeen.id)
        }
        results.skipped++
        results.records.push({
          line: lineNum,
          id: alreadySeen.id,
          type: 'contact',
          name: `${firstName} ${lastName}`.trim(),
          action: 'deduplicated',
          linkedTo: `Contact ${alreadySeen.id} (additional property)`,
        })
        continue
      }

      // Check if contact already exists in DB
      let existingContact: any = null
      if (email) {
        const [found] = await db.select().from(contact)
          .where(and(eq(contact.companyId, companyId), eq(contact.email, email)))
          .limit(1)
        existingContact = found
      }
      if (!existingContact && firstName && lastName) {
        const [found] = await db.select().from(contact)
          .where(and(
            eq(contact.companyId, companyId),
            ilike(contact.firstName, firstName.trim()),
            ilike(contact.lastName, lastName.trim()),
          ))
          .limit(1)
        existingContact = found
      }

      const contactData = {
        companyId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email,
        phone,
        mobilePhone,
        address,
        city: city ? city.charAt(0).toUpperCase() + city.slice(1).toLowerCase() : null,
        state: state ? state.charAt(0).toUpperCase() + state.slice(1) : null,
        zip,
        leadSource: leadSource || trades || null,
        propertyType: null as string | null,
      }

      if (dryRun) {
        const id = `dry-${i}`
        seenContacts.set(dedupeKey, { id, properties: address ? [address] : [] })
        crossRef.contactsByName.set(fullName, id)
        if (email) crossRef.contactsByEmail.set(email, id)
        if (address) crossRef.contactsByAddress.set(normalizeAddress(address), id)
        if (clientIdPrefix) crossRef.contactsByExternalId.set(clientIdPrefix, id)
        results.records.push({ line: lineNum, type: 'contact', name: `${firstName} ${lastName}`.trim(), action: 'would_create' })
        results.imported++
        continue
      }

      let contactId: string

      if (existingContact) {
        // Update only empty fields
        const updates: Record<string, any> = {}
        for (const [key, value] of Object.entries(contactData)) {
          if (key === 'companyId') continue
          if (value && !(existingContact as any)[key]) {
            updates[key] = value
          }
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date()
          await db.update(contact).set(updates).where(eq(contact.id, existingContact.id))
          results.updated++
          results.records.push({
            line: lineNum,
            id: existingContact.id,
            type: 'contact',
            name: `${firstName} ${lastName}`.trim(),
            action: 'updated',
          })
        } else {
          results.skipped++
          results.records.push({
            line: lineNum,
            id: existingContact.id,
            type: 'contact',
            name: `${firstName} ${lastName}`.trim(),
            action: 'skipped_exists',
          })
        }
        contactId = existingContact.id
      } else {
        const [created] = await db.insert(contact).values(contactData).returning()
        contactId = created.id
        results.imported++
        results.records.push({
          line: lineNum,
          id: created.id,
          type: 'contact',
          name: `${firstName} ${lastName}`.trim(),
          action: 'created',
        })
      }

      // Register in cross-ref maps
      seenContacts.set(dedupeKey, { id: contactId, properties: address ? [address] : [] })
      crossRef.contactsByName.set(fullName, contactId)
      if (email) crossRef.contactsByEmail.set(email, contactId)
      if (address) crossRef.contactsByAddress.set(normalizeAddress(address), contactId)
      if (clientIdPrefix) crossRef.contactsByExternalId.set(clientIdPrefix, contactId)
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

// ============================================
// JOB IMPORT (from Jobber One-off Jobs CSV)
// ============================================

const JOB_COLUMNS = {
  jobNumber: ['job', 'job_number', 'job_id', 'number'],
  clientName: ['client_name', 'client', 'customer', 'contact', 'display_name'],
  leadSource: ['lead_source', 'source'],
  clientEmail: ['client_email', 'email'],
  clientPhone: ['client_phone', 'phone'],
  // Service address
  servicePropertyName: ['service_property_name', 'property_name'],
  serviceStreet: ['service_street', 'service_address', 'property_address', 'address'],
  serviceCity: ['service_city', 'city'],
  serviceState: ['service_province', 'service_state', 'state', 'province'],
  serviceZip: ['service_zip', 'zip'],
  // Billing address (fallback)
  billingStreet: ['billing_street', 'billing_address'],
  billingCity: ['billing_city'],
  billingState: ['billing_province', 'billing_state'],
  billingZip: ['billing_zip', 'billing_postal_code'],
  // Job details
  title: ['title', 'job_title', 'name', 'job_name', 'description'],
  createdDate: ['created_date', 'created', 'date_created'],
  scheduledStart: ['scheduled_start_date', 'scheduled_date', 'start_date'],
  closedDate: ['closed_date', 'completed_date', 'end_date'],
  salesperson: ['salesperson', 'sales_rep', 'assigned_to'],
  lineItems: ['line_items', 'items', 'description', 'scope'],
  visitsAssignedTo: ['visits_assigned_to', 'assigned_to', 'technician'],
  invoiceNumbers: ['invoice_s', 'invoice_number', 'invoice_numbers', 'invoice'],
  quoteNumber: ['quote', 'quote_number', 'estimate_number', 'quote_id'],
  quoteDiscount: ['quote_discount', 'discount'],
  totalRevenue: ['total_revenue', 'total', 'revenue', 'amount'],
  onlineBooking: ['online_booking'],
}

/**
 * Find a contact in the cross-ref maps or DB, matching by name, email, or address
 */
async function findContact(
  crossRef: CrossRefMap,
  companyId: string,
  name: string | null,
  email: string | null,
  address: string | null,
): Promise<string | null> {
  // 1. Try email match (most reliable)
  if (email) {
    const normalized = normalizeEmail(email)
    if (normalized && crossRef.contactsByEmail.has(normalized)) {
      return crossRef.contactsByEmail.get(normalized)!
    }
    // Check DB
    const [found] = await db.select({ id: contact.id }).from(contact)
      .where(and(eq(contact.companyId, companyId), eq(contact.email, normalized!)))
      .limit(1)
    if (found) {
      crossRef.contactsByEmail.set(normalized!, found.id)
      return found.id
    }
  }

  // 2. Try name match
  if (name) {
    const normalized = normalizeName(name)
    if (crossRef.contactsByName.has(normalized)) {
      return crossRef.contactsByName.get(normalized)!
    }
    // Try fuzzy match against all known names
    let bestMatch: string | null = null
    let bestScore = 0
    for (const [knownName, id] of crossRef.contactsByName) {
      const score = nameMatchScore(normalized, knownName)
      if (score > bestScore && score >= 0.7) {
        bestScore = score
        bestMatch = id
      }
    }
    if (bestMatch) return bestMatch

    // DB fuzzy match — split name and search
    const parts = normalized.split(' ').filter(p => p.length > 1)
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1]
      const firstName = parts.slice(0, -1).join(' ')
      const [found] = await db.select({ id: contact.id }).from(contact)
        .where(and(
          eq(contact.companyId, companyId),
          ilike(contact.lastName, `%${lastName}%`),
          ilike(contact.firstName, `%${firstName.split(' ')[0]}%`),
        ))
        .limit(1)
      if (found) {
        crossRef.contactsByName.set(normalized, found.id)
        return found.id
      }
    }
  }

  // 3. Try address match
  if (address) {
    const normalized = normalizeAddress(address)
    if (crossRef.contactsByAddress.has(normalized)) {
      return crossRef.contactsByAddress.get(normalized)!
    }
    // DB address search
    const [found] = await db.select({ id: contact.id }).from(contact)
      .where(and(eq(contact.companyId, companyId), ilike(contact.address, `%${address}%`)))
      .limit(1)
    if (found) {
      crossRef.contactsByAddress.set(normalized, found.id)
      return found.id
    }
  }

  return null
}

/**
 * Find a sales rep user by name
 */
async function findSalesRep(
  companyId: string,
  name: string | null,
): Promise<string | null> {
  if (!name) return null
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return null

  const [found] = await db.select({ id: user.id }).from(user)
    .where(and(
      eq(user.companyId, companyId),
      eq(user.isActive, true),
      ilike(user.firstName, `%${parts[0]}%`),
    ))
    .limit(1)
  return found?.id ?? null
}

/**
 * Get the next job number for a company
 */
async function getNextJobNumber(companyId: string): Promise<number> {
  const [last] = await db.select({ jobNumber: job.jobNumber })
    .from(job)
    .where(eq(job.companyId, companyId))
    .orderBy(desc(job.createdAt))
    .limit(1)

  if (!last?.jobNumber) return 1
  const match = last.jobNumber.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

async function getNextQuoteNumber(companyId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<string>`MAX(quote_number)` })
    .from(quote)
    .where(eq(quote.companyId, companyId))
  if (!result?.maxNum) return 1
  const match = result.maxNum.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

async function getNextInvoiceNumber(companyId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<string>`MAX(invoice_number)` })
    .from(invoice)
    .where(eq(invoice.companyId, companyId))
  if (!result?.maxNum) return 1
  const match = result.maxNum.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

/**
 * Map Jobber job status to crm-roof pipeline status
 */
function mapJobStatus(closedDate: string | null, revenue: number | null): string {
  if (closedDate && closedDate !== '-') {
    return revenue && revenue > 0 ? 'collected' : 'invoiced'
  }
  return 'signed' // Open jobs from Jobber are at least signed/awarded
}

/**
 * Detect job type from title and line items
 */
function detectJobType(title: string | null, lineItems: string | null): string {
  const combined = `${title || ''} ${lineItems || ''}`.toLowerCase()
  if (combined.includes('siding')) return 'siding'
  if (combined.includes('gutter')) return 'gutters'
  if (combined.includes('window')) return 'windows'
  if (combined.includes('soffit') || combined.includes('fascia')) return 'soffit_fascia'
  if (combined.includes('chimney')) return 'chimney'
  if (combined.includes('repair')) return 'repair'
  return 'roofing' // Default for a roofing company
}

export async function importJobs(
  csvContent: string,
  companyId: string,
  crossRef: CrossRefMap,
  options: { dryRun?: boolean; createMissingContacts?: boolean } = {}
): Promise<ImportResults> {
  const { dryRun = false, createMissingContacts = true } = options
  const records = parseCSV(csvContent)
  const results: ImportResults = { imported: 0, skipped: 0, updated: 0, errors: [], records: [] }

  let nextJobNum = await getNextJobNumber(companyId)
  let nextQuoteNum = await getNextQuoteNumber(companyId)
  let nextInvoiceNum = await getNextInvoiceNumber(companyId)

  for (let i = 0; i < records.length; i++) {
    const row = normalizeColumns(records[i])
    const lineNum = i + 2

    try {
      const jobNum = getValue(row, ...JOB_COLUMNS.jobNumber)
      const clientName = getValue(row, ...JOB_COLUMNS.clientName)
      const clientEmail = normalizeEmail(getValue(row, ...JOB_COLUMNS.clientEmail))
      const clientPhone = normalizePhone(getValue(row, ...JOB_COLUMNS.clientPhone))
      const title = getValue(row, ...JOB_COLUMNS.title)
      const lineItemsRaw = getValue(row, ...JOB_COLUMNS.lineItems)
      const serviceStreet = getValue(row, ...JOB_COLUMNS.serviceStreet) || getValue(row, ...JOB_COLUMNS.billingStreet)
      const serviceCity = getValue(row, ...JOB_COLUMNS.serviceCity) || getValue(row, ...JOB_COLUMNS.billingCity)
      const serviceState = getValue(row, ...JOB_COLUMNS.serviceState) || getValue(row, ...JOB_COLUMNS.billingState)
      const serviceZip = getValue(row, ...JOB_COLUMNS.serviceZip) || getValue(row, ...JOB_COLUMNS.billingZip)

      if (!serviceStreet) {
        results.errors.push({ line: lineNum, error: 'No address found — required for roofing jobs' })
        results.skipped++
        continue
      }

      // Find or create contact
      let contactId = await findContact(crossRef, companyId, clientName, clientEmail, serviceStreet)

      if (!contactId && createMissingContacts && !dryRun) {
        // Parse name into first/last
        let firstName = clientName || 'Unknown'
        let lastName = ''
        if (clientName) {
          const parts = clientName.trim().split(/\s+/)
          if (parts.length >= 2) {
            lastName = parts.pop()!
            firstName = parts.join(' ')
          }
        }

        const [created] = await db.insert(contact).values({
          companyId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: clientEmail,
          phone: clientPhone,
          address: serviceStreet,
          city: serviceCity,
          state: serviceState,
          zip: serviceZip,
        }).returning()
        contactId = created.id

        // Register in cross-ref
        if (clientName) crossRef.contactsByName.set(normalizeName(clientName), contactId)
        if (clientEmail) crossRef.contactsByEmail.set(clientEmail, contactId)
        if (serviceStreet) crossRef.contactsByAddress.set(normalizeAddress(serviceStreet), contactId)

        results.records.push({
          line: lineNum,
          id: contactId,
          type: 'contact',
          name: clientName || 'Unknown',
          action: 'auto_created',
          linkedTo: `Job #${jobNum || nextJobNum}`,
        })
      }

      if (!contactId && !dryRun) {
        results.errors.push({
          line: lineNum,
          error: `Could not match contact "${clientName}" — no match by name, email, or address`,
        })
        results.skipped++
        continue
      }

      // Parse financial data
      const totalRevenue = parseDecimal(getValue(row, ...JOB_COLUMNS.totalRevenue))
      const quoteDiscount = parseDecimal(getValue(row, ...JOB_COLUMNS.quoteDiscount))
      const closedDate = getValue(row, ...JOB_COLUMNS.closedDate)
      const createdDate = getValue(row, ...JOB_COLUMNS.createdDate)
      const scheduledStart = getValue(row, ...JOB_COLUMNS.scheduledStart)
      const salesperson = getValue(row, ...JOB_COLUMNS.salesperson)
      const quoteNum = getValue(row, ...JOB_COLUMNS.quoteNumber)
      const invoiceNums = getValue(row, ...JOB_COLUMNS.invoiceNumbers)

      // Parse line items into structured format
      const lineItemsParsed = lineItemsRaw
        ? lineItemsRaw.split(',').map((item: string) => ({
            description: item.trim(),
            quantity: 1,
            unitPrice: 0,
          })).filter((item: any) => item.description)
        : []

      const assignedSalesRepId = await findSalesRep(companyId, salesperson)

      const jobData = {
        companyId,
        contactId: contactId || 'placeholder',
        jobNumber: jobNum ? String(jobNum) : String(nextJobNum++),
        jobType: detectJobType(title, lineItemsRaw),
        status: mapJobStatus(closedDate, totalRevenue),
        propertyAddress: serviceStreet,
        city: serviceCity || '',
        state: serviceState || '',
        zip: serviceZip || '',
        estimatedRevenue: totalRevenue ? String(totalRevenue) : null,
        finalRevenue: (closedDate && closedDate !== '-' && totalRevenue) ? String(totalRevenue) : null,
        source: getValue(row, ...JOB_COLUMNS.leadSource) || 'Jobber Import',
        priority: 'medium',
        notes: [
          title ? `Title: ${title}` : null,
          lineItemsRaw ? `Scope: ${lineItemsRaw}` : null,
          salesperson ? `Salesperson: ${salesperson}` : null,
          getValue(row, ...JOB_COLUMNS.visitsAssignedTo) ? `Crew: ${getValue(row, ...JOB_COLUMNS.visitsAssignedTo)}` : null,
        ].filter(Boolean).join('\n'),
        inspectionDate: parseDate(scheduledStart),
        installDate: parseDate(scheduledStart),
        installEndDate: parseDate(closedDate),
        assignedSalesRepId,
      }

      if (dryRun) {
        results.records.push({
          line: lineNum,
          type: 'job',
          name: title || `Job #${jobData.jobNumber}`,
          action: 'would_create',
          linkedTo: clientName ? `Contact: ${clientName}` : undefined,
        })
        results.imported++
        continue
      }

      // Create the job
      const [createdJob] = await db.insert(job).values(jobData).returning()

      crossRef.jobsById.set(jobData.jobNumber, createdJob.id)
      crossRef.jobContactMap.set(jobData.jobNumber, contactId!)

      results.records.push({
        line: lineNum,
        id: createdJob.id,
        type: 'job',
        name: title || `Job #${jobData.jobNumber}`,
        action: 'created',
        linkedTo: `Contact: ${clientName}`,
      })
      results.imported++

      // Create quote if quote number exists
      if (quoteNum && contactId) {
        try {
          const subtotal = totalRevenue || 0
          const quoteData = {
            companyId,
            contactId,
            jobId: createdJob.id,
            quoteNumber: `Q-${String(nextQuoteNum++).padStart(4, '0')}`,
            status: closedDate && closedDate !== '-' ? 'approved' : 'sent',
            lineItems: lineItemsParsed.length > 0 ? lineItemsParsed : [{ description: title || 'Roofing work', quantity: 1, unitPrice: subtotal }],
            subtotal: String(subtotal + (quoteDiscount || 0)),
            taxRate: '0',
            taxAmount: '0',
            total: String(subtotal),
            notes: `Imported from Jobber Quote #${quoteNum}${quoteDiscount ? ` (discount: $${quoteDiscount})` : ''}`,
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            approvedAt: closedDate && closedDate !== '-' ? parseDate(closedDate) : null,
          }

          const [createdQuote] = await db.insert(quote).values(quoteData).returning()
          results.records.push({
            line: lineNum,
            id: createdQuote.id,
            type: 'quote',
            name: `Quote ${quoteData.quoteNumber} (Jobber #${quoteNum})`,
            action: 'created',
            linkedTo: `Job #${jobData.jobNumber} → Contact: ${clientName}`,
          })
        } catch (err: any) {
          results.errors.push({ line: lineNum, error: `Quote creation failed: ${err.message}` })
        }
      }

      // Create invoice(s) if invoice numbers exist and there's revenue
      if (invoiceNums && totalRevenue && totalRevenue > 0 && contactId) {
        try {
          const invoiceNumList = invoiceNums.split(',').map((n: string) => n.trim()).filter(Boolean)

          for (const origInvNum of invoiceNumList) {
            const isPaid = closedDate && closedDate !== '-'
            const invoiceTotal = totalRevenue / invoiceNumList.length // Split evenly if multiple

            const invoiceData = {
              companyId,
              jobId: createdJob.id,
              contactId,
              invoiceNumber: `INV-${String(nextInvoiceNum++).padStart(4, '0')}`,
              status: isPaid ? 'paid' : 'sent',
              lineItems: lineItemsParsed.length > 0 ? lineItemsParsed : [{ description: title || 'Roofing work', quantity: 1, unitPrice: invoiceTotal }],
              subtotal: String(invoiceTotal),
              taxRate: '0',
              taxAmount: '0',
              total: String(invoiceTotal),
              amountPaid: isPaid ? String(invoiceTotal) : '0',
              balance: isPaid ? '0' : String(invoiceTotal),
              paidAt: isPaid ? parseDate(closedDate) : null,
            }

            const [createdInvoice] = await db.insert(invoice).values(invoiceData).returning()
            results.records.push({
              line: lineNum,
              id: createdInvoice.id,
              type: 'invoice',
              name: `Invoice ${invoiceData.invoiceNumber} (Jobber #${origInvNum})`,
              action: 'created',
              linkedTo: `Job #${jobData.jobNumber} → Contact: ${clientName}`,
            })
          }
        } catch (err: any) {
          results.errors.push({ line: lineNum, error: `Invoice creation failed: ${err.message}` })
        }
      }
    } catch (error: any) {
      results.errors.push({ line: lineNum, error: error.message })
      results.skipped++
    }
  }

  return results
}

// ============================================
// UNIFIED MULTI-FILE IMPORT
// ============================================

export interface FileUpload {
  name: string
  content: string
  detectedType: 'clients' | 'jobs' | 'unknown'
}

/**
 * Auto-detect CSV type from column headers
 */
export function detectCSVType(csvContent: string): 'clients' | 'jobs' | 'unknown' {
  try {
    const records = parseCSV(csvContent)
    if (records.length === 0) return 'unknown'

    const columns = Object.keys(normalizeColumns(records[0]))
    const colStr = columns.join(' ')

    // Jobber Clients CSV has "J-ID", "Display Name", "First Name", "Last Name", "Billing Street 1"
    if (colStr.includes('j_id') || colStr.includes('display_name') || colStr.includes('billing_street_1')) {
      return 'clients'
    }
    // Jobber Jobs CSV has "Job #", "Client name", "Total revenue", "Quote #", "Invoice #s"
    if (colStr.includes('job') || colStr.includes('total_revenue') || colStr.includes('invoice') || colStr.includes('quote')) {
      return 'jobs'
    }
    // Generic detection: has first_name/last_name without job-specific fields → clients
    if ((colStr.includes('first_name') || colStr.includes('last_name')) && !colStr.includes('revenue')) {
      return 'clients'
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Preview what an import would do without saving
 */
export function previewCSV(csvContent: string) {
  try {
    const records = parseCSV(csvContent)
    if (records.length === 0) return { valid: false, error: 'CSV is empty', rowCount: 0, columns: [], sample: [] }

    const columns = Object.keys(records[0])
    const type = detectCSVType(csvContent)

    return {
      valid: true,
      type,
      rowCount: records.length,
      columns,
      sample: records.slice(0, 5),
    }
  } catch (error: any) {
    return { valid: false, error: `Failed to parse CSV: ${error.message}`, rowCount: 0, columns: [], sample: [] }
  }
}

/**
 * Run a full multi-file import.
 *
 * Processing order:
 * 1. Clients CSVs first (creates contacts + builds cross-ref maps)
 * 2. Jobs CSVs second (links to contacts, creates quotes/invoices)
 *
 * Cross-referencing happens via shared CrossRefMap that accumulates
 * name→id, email→id, address→id mappings across all files.
 */
export async function runImport(
  files: FileUpload[],
  companyId: string,
  options: { dryRun?: boolean; createMissingContacts?: boolean } = {}
): Promise<{
  summary: { contacts: ImportResults; jobs: ImportResults }
  crossRefStats: { contactsMatched: number; contactsCreated: number; orphanedJobs: number }
}> {
  const crossRef: CrossRefMap = {
    contactsByName: new Map(),
    contactsByEmail: new Map(),
    contactsByAddress: new Map(),
    contactsByExternalId: new Map(),
    jobsById: new Map(),
    jobContactMap: new Map(),
  }

  // Pre-load existing contacts into cross-ref maps
  const existingContacts = await db.select().from(contact)
    .where(eq(contact.companyId, companyId))
  for (const c of existingContacts) {
    const fullName = normalizeName(`${c.firstName} ${c.lastName}`)
    crossRef.contactsByName.set(fullName, c.id)
    if (c.email) crossRef.contactsByEmail.set(c.email.toLowerCase(), c.id)
    if (c.address) crossRef.contactsByAddress.set(normalizeAddress(c.address), c.id)
  }

  // Sort files: clients first, then jobs
  const clientFiles = files.filter(f => f.detectedType === 'clients')
  const jobFiles = files.filter(f => f.detectedType === 'jobs')

  // Import clients
  const contactResults: ImportResults = { imported: 0, skipped: 0, updated: 0, errors: [], records: [] }
  for (const file of clientFiles) {
    const result = await importContacts(file.content, companyId, crossRef, options)
    contactResults.imported += result.imported
    contactResults.skipped += result.skipped
    contactResults.updated += result.updated
    contactResults.errors.push(...result.errors.map(e => ({ ...e, error: `[${file.name}] ${e.error}` })))
    contactResults.records.push(...result.records)
  }

  // Import jobs (with cross-referencing to contacts)
  const jobResults: ImportResults = { imported: 0, skipped: 0, updated: 0, errors: [], records: [] }
  for (const file of jobFiles) {
    const result = await importJobs(file.content, companyId, crossRef, options)
    jobResults.imported += result.imported
    jobResults.skipped += result.skipped
    jobResults.updated += result.updated
    jobResults.errors.push(...result.errors.map(e => ({ ...e, error: `[${file.name}] ${e.error}` })))
    jobResults.records.push(...result.records)
  }

  const contactsCreated = contactResults.records.filter(r => r.action === 'created' || r.action === 'auto_created').length
  const contactsMatched = jobResults.records.filter(r => r.type === 'job' && r.linkedTo).length
  const orphanedJobs = jobResults.records.filter(r => r.type === 'job' && !r.linkedTo).length

  return {
    summary: { contacts: contactResults, jobs: jobResults },
    crossRefStats: { contactsMatched, contactsCreated, orphanedJobs },
  }
}

export default {
  importContacts,
  importJobs,
  runImport,
  detectCSVType,
  previewCSV,
}
