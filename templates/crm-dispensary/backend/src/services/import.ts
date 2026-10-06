/**
 * CSV Import Service
 *
 * Import data from CSV files:
 * - Contacts (customers)
 * - Products (dispensary menu items)
 */

import { parse } from 'csv-parse/sync'
import { roundsToNothing } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, product } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { underageRefusal } from '../utils/cannabis.ts'

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
/**
 * One spelling for a column name, used on BOTH sides of every lookup.
 *
 * T46 N6/N7: there were two normalizers and they disagreed. The header was folded to
 * `weight__g_` → `weight_g` while the alias list was folded to `weight_grams`, so the products
 * template's OWN "Weight (g)" column never matched anything and every flower product imported from
 * the official template arrived with no weight — and a product with no weight cannot be sold at
 * all ("no weight recorded"). The same gap silently dropped a `dateOfBirth` header on the customer
 * import, so a person born in 2012 was imported as a lead with no date of birth and no refusal,
 * while "Date of Birth", "DOB" and "date_of_birth" all worked.
 *
 * Separators carry no meaning in a spreadsheet header, so they are removed rather than
 * standardised: "Weight (g)", "weight_g" and "WEIGHT G" are one column, and "dateOfBirth",
 * "Date of Birth" and "date_of_birth" are one column, which is what anyone exporting from another
 * system would expect.
 */
function canonicalColumn(key: string): string {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeColumns(row: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[canonicalColumn(key)] = value
  }
  return normalized
}

/**
 * Get value from row with multiple possible column names
 */
function getValue(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const normalizedKey = canonicalColumn(key)
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
  // An expiry is half of a medical card: a card with no expiry is treated as valid for ever, and
  // the register reads the expiry to decide whether a patient under 21 may be sold to at all. The
  // customers template offers the column now, so it has to be read. (T46 N6)
  medicalCardExpiry: ['medical_card_expiry', 'card_expiry', 'mmj_expiry', 'medical_card_expiration', 'card_expiration'],
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
  /**
   * Rows that came in, but not whole — something the shop should know about before it wonders why
   * a product will not sell. Distinct from `errors`, which are rows that did NOT come in. (T47 P18)
   */
  warnings?: Array<{ line: number; warning: string }>
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
          results.errors.push({ line: lineNum, error: underageRefusal(name, age) })
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
        medicalCardExpiry: parseDob(getValue(row, ...CONTACT_COLUMN_MAP.medicalCardExpiry)),
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
  // 'weight_g' is the products template's own header, "Weight (g)". It is listed explicitly
  // because separators are dropped, not translated: "Weight (g)" reads as `weightg`, which is not
  // `weightgrams`. (T46 N7)
  // 'grams' and 'gram_weight' added by T47 P18: a column headed "Grams" was not on this list, so
  // every flower row imported with NO weight and no warning — and a cannabis product with no
  // weight cannot be sold at all, because the till refuses to count it against the purchase limit.
  // A spreadsheet the shop exported from somewhere else is exactly where that header comes from.
  weightGrams: ['weight', 'weight_g', 'weight_grams', 'grams', 'gram_weight', 'net_weight', 'net_weight_g'],
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
      if (!Number.isFinite(price) || price < 0 || roundsToNothing(price)) {
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

      // A percentage of a thing cannot exceed the whole of it. T46 N7: THC 150% imported cleanly
      // and was then listed on the shop's public menu, where it is both an impossible figure and an
      // advertised one. The same rule applies to CBD, for the same reason.
      let badPotency: string | null = null
      for (const [label, keys] of [['THC', PRODUCT_COLUMN_MAP.thcPercent], ['CBD', PRODUCT_COLUMN_MAP.cbdPercent]] as const) {
        const raw = getValue(row, ...keys)
        if (raw == null || raw === '') continue
        const pct = Number(String(raw).replace(/%/g, '').trim())
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          badPotency = `"${raw}" is not a valid ${label} percentage for ${name} — it has to be between 0 and 100`
          break
        }
      }
      if (badPotency) {
        results.errors.push({ line: lineNum, error: badPotency })
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

      const importedCost = getValue(row, ...PRODUCT_COLUMN_MAP.cost)
      const importedWeight = getValue(row, ...PRODUCT_COLUMN_MAP.weightGrams)

      // A cannabis product with no weight cannot be SOLD — the till refuses it, because it cannot
      // count an unknown weight against the purchase limit. Importing one silently means the shop
      // finds out at the counter with a customer waiting. (T47 P18)
      if (!importedWeight && rawCategory !== 'merch' && rawCategory !== 'accessories') {
        ;(results.warnings ||= []).push({
          line: lineNum,
          warning: `${name} came in with no weight. A cannabis product needs one before it can be sold — the register counts it against the purchase limit. Add a "Weight (g)" or "Grams" column, or set it on the product.`,
        })
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
        // BOTH cost columns, always the same value.
        //
        // `cost` and `cost_price` are one fact in two columns, and T46 N26 taught the goods-in path
        // to write both. The importer kept writing only one, so a shop that brought its catalogue in
        // from a spreadsheet had margins computed off a null on whichever screen read the other
        // spelling. Same bug, second door. (T47 P18)
        cost: importedCost,
        costPrice: importedCost,
        weightGrams: importedWeight,
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
    // T46 N6: the customers template carried no Date of Birth and no Medical Card column, although
    // the Import screen says it imports both and refuses under-21s — so every customer imported
    // from the shop's own template arrived with no date of birth, and the age rule the screen
    // promised had nothing to check. A template that omits the column the rule depends on is how a
    // shop ends up with an unverifiable customer list.
    contacts: 'Name,Email,Phone,Mobile,Company,Type,Date of Birth,Medical Card Number,Medical Card Expiry,Address,City,State,Zip,Notes\nJohn Smith,john@example.com,555-1234,555-5678,,customer,1985-04-02,,,123 Main St,Denver,CO,80201,Regular customer',
    products: 'Name,SKU,Category,Brand,Strain,Strain Type,THC%,CBD%,Price,Cost,Weight (g),Unit,Stock,Description,Barcode\nBlue Dream,SKU-001,flower,Local Farms,Blue Dream,hybrid,22.5,0.5,35.00,18.00,3.5,eighth,100,Premium hybrid flower,123456789',
  }

  return templates[type] || ''
}

/**
 * What "Check the file" answers.
 *
 * T46 N20: it reported valid:true and nothing else, so a file with a 2012-born customer, a
 * negative price and a duplicate SKU checked out clean and only showed its refusals AFTER the
 * import had run — which is the wrong way round for a screen whose whole purpose is to tell you
 * before you commit.
 *
 * It runs the REAL import in dry-run now, which is the only way the preview and the import can
 * agree about what will happen: same column reading, same rules, same messages, nothing written.
 */
export async function previewImport(csvContent: string, type: string, companyId: string) {
  const shape = validateCSV(csvContent, type)
  if (!shape.valid) return shape

  const dry = type === 'contacts'
    ? await importContacts(csvContent, companyId, { dryRun: true })
    : await importProducts(csvContent, companyId, { dryRun: true })

  return {
    ...shape,
    // `valid` still means the file is readable and has the column the import needs — a single bad
    // row must not stop a shop importing the other nine hundred.
    willImport: dry.imported,
    willSkip: dry.skipped,
    errors: dry.errors,
    // T48 Q12: the dry run has been producing these all along and Check the file threw them away,
    // so "no weight recorded" — the one thing that stops a product being sellable — only appeared
    // AFTER the import had run. A check that hides what the real thing will say is not a check;
    // the whole point of pressing it is to find this out first.
    warnings: dry.warnings || [],
  }
}

export default {
  importContacts,
  importProducts,
  validateCSV,
  previewImport,
  getTemplate,
}
