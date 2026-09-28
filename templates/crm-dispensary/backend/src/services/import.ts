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
  try {
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      // A stray quote mid-field — which is exactly what a pasted spreadsheet formula looks like —
      // threw out of the parser and surfaced as a 500 with no clue what to fix. Relaxing the quote
      // rule reads the field as text, which is what it is. (found while testing T45 H2)
      relax_quotes: true,
      ...options,
    })
  } catch (err: any) {
    // Anything the parser still cannot read is the FILE's problem, and the person who uploaded it
    // needs to be told which line — not handed a 500.
    const e = new Error(`That file could not be read as CSV: ${err?.message || err}`)
    ;(e as any).status = 400
    throw e
  }
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
  // The column was never read, so every imported customer arrived with no date of birth — which at
  // a dispensary means the age gate has nothing to check and a 2012-born row imports cleanly. (T45 H2)
  dateOfBirth: ['date_of_birth', 'dob', 'birth_date', 'birthdate', 'birthday'],
  medicalCardNumber: ['medical_card_number', 'medical_card', 'mmj_card', 'card_number'],
}

// ─── the rules the FORMS enforce, applied to imported rows too ──────────────────────────────────
//
// Run T45 H2: import skipped every check. "not-an-email" was accepted, a name of raw HTML was
// accepted, a spreadsheet formula name (=HYPERLINK(…)) was accepted, and every date of birth was
// dropped. On the products side a price of −$5 was accepted — and then H3 sold it, cancelling out
// the rest of the basket and ringing the whole sale at $0.00.
//
// A bulk path is not a back door. These are deliberately the same rules the single-record routes
// use, so 500 rows cannot do what one row is refused for.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A cell that a spreadsheet would execute when the file is reopened. */
const isFormula = (v: string) => /^[=+\-@\t\r]/.test(v.trim())

/** Strip tags and refuse a formula: a name is a name. */
function cleanName(raw: string): { value?: string; error?: string } {
  const v = String(raw || '').trim()
  if (!v) return { error: 'Name is required' }
  if (v.length > 200) return { error: 'Name is longer than 200 characters' }
  if (isFormula(v)) return { error: `Name "${v.slice(0, 40)}" starts with a spreadsheet formula character (= + - @)` }
  if (/<[^>]+>/.test(v)) return { error: `Name "${v.slice(0, 40)}" contains HTML` }
  return { value: v }
}

/** YYYY-MM-DD, MM/DD/YYYY or MMDDYYYY → YYYY-MM-DD; null when it is not a real date. */
function parseDob(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) return `${m[3]}-${m[1]}-${m[2]}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function ageOn(dob: string): number {
  const b = new Date(dob), today = new Date()
  let age = today.getFullYear() - b.getFullYear()
  const md = today.getMonth() - b.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < b.getDate())) age--
  return age
}

/** The categories the catalogue actually has. Anything else is a typo, not a new category. */
const PRODUCT_CATEGORIES = new Set([
  'flower', 'pre_roll', 'preroll', 'vape', 'cartridge', 'concentrate', 'edible', 'beverage',
  'tincture', 'topical', 'capsule', 'accessory', 'apparel', 'seed', 'clone', 'other',
])

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
      const rawName = getValue(row, ...CONTACT_COLUMN_MAP.name)
      const email = getValue(row, ...CONTACT_COLUMN_MAP.email)

      const named = cleanName(rawName || '')
      if (named.error) {
        results.errors.push({ line: lineNum, error: named.error })
        results.skipped++
        continue
      }
      const name = named.value!

      // "not-an-email" imported cleanly and then nothing could ever be sent to it. (T45 H2)
      if (email && !EMAIL_RE.test(email)) {
        results.errors.push({ line: lineNum, error: `"${email}" is not a valid email address` })
        results.skipped++
        continue
      }

      // The age rule the contacts route applies, applied here too: under 18 is refused outright,
      // and 18–20 is recorded with the same warning the form gives, because only a card makes them
      // sellable-to. A dispensary importing a customer list must not be a way past this. (T45 H2)
      const dobRaw = getValue(row, ...CONTACT_COLUMN_MAP.dateOfBirth)
      let dateOfBirth: string | null = null
      if (dobRaw) {
        dateOfBirth = parseDob(dobRaw)
        if (!dateOfBirth) {
          results.errors.push({ line: lineNum, error: `"${dobRaw}" is not a date this system recognises (use YYYY-MM-DD)` })
          results.skipped++
          continue
        }
        if (new Date(dateOfBirth) > new Date()) {
          results.errors.push({ line: lineNum, error: `Date of birth ${dateOfBirth} is in the future` })
          results.skipped++
          continue
        }
        const age = ageOn(dateOfBirth)
        if (age < 18) {
          results.errors.push({ line: lineNum, error: `${name} would be ${age} years old — cannabis customers must be 21+, or 18+ with a valid medical card` })
          results.skipped++
          continue
        }
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
        // Read at last, so an imported customer can actually be sold to. (T45 H2)
        dateOfBirth,
        medicalCardNumber: getValue(row, ...CONTACT_COLUMN_MAP.medicalCardNumber),
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
      const namedProduct = cleanName(getValue(row, ...PRODUCT_COLUMN_MAP.name) || '')
      if (namedProduct.error) {
        results.errors.push({ line: lineNum, error: namedProduct.error.replace(/^Name/, 'Product name') })
        results.skipped++
        continue
      }
      const name = namedProduct.value!

      // A price is money the register will take on trust. −$5 imported cleanly and then cancelled out
      // the rest of a basket, ringing a whole sale at $0.00. (T45 H2, and H3 is what it then did.)
      const rawPrice = getValue(row, ...PRODUCT_COLUMN_MAP.price)
      const price = rawPrice == null || rawPrice === '' ? 0 : Number(rawPrice)
      if (!Number.isFinite(price) || price < 0) {
        results.errors.push({ line: lineNum, error: `"${rawPrice}" is not a valid price for ${name} — a price cannot be negative` })
        results.skipped++
        continue
      }

      // "spaceship" is a typo, not a new category — and a category the reports do not know about
      // quietly drops the product out of every breakdown.
      const rawCategory = (getValue(row, ...PRODUCT_COLUMN_MAP.category) || 'flower').trim().toLowerCase().replace(/[\s-]+/g, '_')
      if (!PRODUCT_CATEGORIES.has(rawCategory)) {
        results.errors.push({ line: lineNum, error: `"${rawCategory}" is not a product category. Use one of: ${[...PRODUCT_CATEGORIES].join(', ')}` })
        results.skipped++
        continue
      }

      // A duplicate SKU makes two products indistinguishable at the till and on every report.
      const sku = getValue(row, ...PRODUCT_COLUMN_MAP.sku)
      if (sku) {
        const [clash] = await db.select({ id: product.id }).from(product)
          .where(and(eq(product.companyId, companyId), eq(product.sku, sku))).limit(1)
        if (clash) {
          results.errors.push({ line: lineNum, error: `SKU "${sku}" is already used by another product` })
          results.skipped++
          continue
        }
      }

      const productData = {
        companyId,
        name,
        sku,
        category: rawCategory,
        brand: getValue(row, ...PRODUCT_COLUMN_MAP.brand),
        strainName: getValue(row, ...PRODUCT_COLUMN_MAP.strainName),
        strainType: getValue(row, ...PRODUCT_COLUMN_MAP.strainType),
        thcPercent: getValue(row, ...PRODUCT_COLUMN_MAP.thcPercent),
        cbdPercent: getValue(row, ...PRODUCT_COLUMN_MAP.cbdPercent),
        price: String(price),
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
