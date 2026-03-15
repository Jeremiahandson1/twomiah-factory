/**
 * CSV Import Service
 *
 * Import data from CSV files:
 * - Contacts (customers)
 * - Products (dispensary menu items)
 */

import { parse } from 'csv-parse/sync'
import { db } from '../../db/index.ts'
import { contact, product } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'

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
  source: ['source', 'lead_source', 'referral_source'],
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
      const name = getValue(row, ...CONTACT_COLUMN_MAP.name)
      const email = getValue(row, ...CONTACT_COLUMN_MAP.email)

      if (!name) {
        results.errors.push({ line: lineNum, error: 'Name is required' })
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
        source: getValue(row, ...CONTACT_COLUMN_MAP.source),
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
  if (t.includes('lead') || t.includes('prospect')) return 'lead'
  return 'other'
}

// ============================================
// PRODUCTS IMPORT
// ============================================

const PRODUCT_COLUMN_MAP = {
  name: ['name', 'product_name', 'item_name', 'title'],
  sku: ['sku', 'code', 'item_code', 'product_code'],
  category: ['category', 'type', 'product_type'],
  brand: ['brand', 'manufacturer'],
  strainName: ['strain', 'strain_name'],
  strainType: ['strain_type', 'indica_sativa'],
  thcPercent: ['thc', 'thc_percent', 'thc_pct'],
  cbdPercent: ['cbd', 'cbd_percent', 'cbd_pct'],
  price: ['price', 'unit_price', 'retail_price', 'amount'],
  cost: ['cost', 'cost_price', 'wholesale'],
  weightGrams: ['weight', 'weight_grams', 'net_weight'],
  unitType: ['unit', 'unit_type', 'uom'],
  stockQuantity: ['quantity', 'stock', 'stock_quantity', 'qty', 'on_hand'],
  description: ['description', 'desc', 'details', 'notes'],
  barcode: ['barcode', 'upc'],
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
        sku: getValue(row, ...PRODUCT_COLUMN_MAP.sku),
        category: getValue(row, ...PRODUCT_COLUMN_MAP.category) || 'flower',
        brand: getValue(row, ...PRODUCT_COLUMN_MAP.brand),
        strainName: getValue(row, ...PRODUCT_COLUMN_MAP.strainName),
        strainType: getValue(row, ...PRODUCT_COLUMN_MAP.strainType),
        thcPercent: getValue(row, ...PRODUCT_COLUMN_MAP.thcPercent),
        cbdPercent: getValue(row, ...PRODUCT_COLUMN_MAP.cbdPercent),
        price: getValue(row, ...PRODUCT_COLUMN_MAP.price) || '0',
        cost: getValue(row, ...PRODUCT_COLUMN_MAP.cost),
        weightGrams: getValue(row, ...PRODUCT_COLUMN_MAP.weightGrams),
        unitType: getValue(row, ...PRODUCT_COLUMN_MAP.unitType) || 'each',
        stockQuantity: parseInt(getValue(row, ...PRODUCT_COLUMN_MAP.stockQuantity) || '0') || 0,
        description: getValue(row, ...PRODUCT_COLUMN_MAP.description),
        barcode: getValue(row, ...PRODUCT_COLUMN_MAP.barcode),
        active: true,
      }

      if (!dryRun) {
        const [created] = await db.insert(product).values(productData).returning()
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
      products: PRODUCT_COLUMN_MAP.name,
    }

    const required = requiredMap[type]
    if (!required) {
      return { valid: false, error: `Unknown import type: ${type}` }
    }

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
    contacts: 'Name,Email,Phone,Mobile,Company,Type,Address,City,State,Zip,Notes\nJohn Smith,john@example.com,555-1234,555-5678,,customer,123 Main St,Denver,CO,80201,Regular customer',
    products: 'Name,SKU,Category,Brand,Strain,Strain Type,THC%,CBD%,Price,Cost,Weight (g),Unit,Stock,Description,Barcode\nBlue Dream,SKU-001,flower,Local Farms,Blue Dream,hybrid,22.5,0.5,35.00,18.00,3.5,eighth,100,Premium hybrid flower,123456789',
  }

  return templates[type] || ''
}

export default {
  importContacts,
  importProducts,
  validateCSV,
  previewImport: validateCSV,
  getTemplate,
}
