import * as XLSX from 'xlsx'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index'
import { productCategory, product, priceRange, addon } from '../../db/schema'
import { estimatorProduct, estimatorMaterialTier, estimatorAddon } from '../../db/schema-estimator'
import { eq, and } from 'drizzle-orm'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ParseResult {
  fileId: string
  columns: string[]
  rows: Record<string, string>[]
  totalRows: number
  sampleRows: Record<string, string>[]
}

export interface ColumnMapping {
  [fileColumn: string]: string // maps file column -> target field
}

export interface ValidationError {
  row: number
  field: string
  value: string
  error: string
}

export interface ValidationResult {
  valid: boolean
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  errors: ValidationError[]
  warnings: ValidationError[]
  preview: Record<string, any>[]
  newCategories: string[]
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: number
  errorDetails: ValidationError[]
  createdCategories: string[]
}

// ─── File storage (in-memory for simplicity, keyed by fileId) ──────────────────

const fileStore = new Map<string, { columns: string[]; rows: Record<string, string>[] }>()

// ─── Parse ─────────────────────────────────────────────────────────────────────

export function parseFile(buffer: Buffer, filename: string): ParseResult {
  const fileId = createId()

  let workbook: XLSX.WorkBook
  if (filename.endsWith('.csv')) {
    const text = buffer.toString('utf-8')
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })

  if (jsonData.length === 0) throw new Error('File is empty or has no data rows')

  const columns = Object.keys(jsonData[0])
  const rows = jsonData.map(row => {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) {
      clean[k.trim()] = String(v).trim()
    }
    return clean
  })

  fileStore.set(fileId, { columns, rows })

  return {
    fileId,
    columns,
    rows,
    totalRows: rows.length,
    sampleRows: rows.slice(0, 10),
  }
}

// ─── Auto-detect column mapping ────────────────────────────────────────────────

const PRICEBOOK_FIELDS: Record<string, string[]> = {
  categoryName: ['category', 'cat', 'category_name', 'categoryname', 'product category', 'group'],
  productName: ['product', 'product_name', 'productname', 'name', 'item', 'description'],
  measurementType: ['measurement', 'measurement_type', 'unit', 'unit_type', 'measure'],
  tier: ['tier', 'level', 'grade', 'quality'],
  minValue: ['min', 'min_value', 'minimum', 'from', 'range_min', 'min_size'],
  maxValue: ['max', 'max_value', 'maximum', 'to', 'range_max', 'max_size'],
  parPrice: ['par', 'par_price', 'cost', 'base_cost', 'dealer_price', 'wholesale'],
  retailPrice: ['retail', 'retail_price', 'price', 'list_price', 'msrp', 'selling_price'],
  yr1MarkupPct: ['yr1_markup', '1yr_markup', 'year1', 'one_year_markup'],
  day30MarkupPct: ['day30_markup', '30day_markup', 'thirty_day', '30_day_markup'],
  todayDiscountPct: ['today_discount', 'buy_today', 'same_day', 'today_pct'],
}

const ESTIMATOR_FIELDS: Record<string, string[]> = {
  categoryName: ['category', 'cat', 'category_name', 'group'],
  productName: ['product', 'product_name', 'name', 'item'],
  tier: ['tier', 'level', 'grade'],
  materialName: ['material', 'material_name', 'material_type'],
  materialCostPerUnit: ['material_cost', 'cost_per_unit', 'unit_cost', 'mat_cost'],
  laborRate: ['labor', 'labor_rate', 'labor_cost', 'install_rate'],
  laborUnit: ['labor_unit', 'install_unit'],
  manufacturer: ['manufacturer', 'mfg', 'brand', 'vendor'],
  warrantyYears: ['warranty', 'warranty_years', 'warranty_yrs'],
  wasteFactor: ['waste', 'waste_factor', 'waste_pct'],
  measurementUnit: ['unit', 'measurement', 'measure_unit'],
  setupFee: ['setup', 'setup_fee', 'mobilization'],
  minimumCharge: ['minimum', 'min_charge', 'minimum_charge'],
}

const PRICEBOOK_REQUIRED = ['categoryName', 'productName', 'parPrice', 'retailPrice']
const ESTIMATOR_REQUIRED = ['categoryName', 'productName', 'materialName', 'materialCostPerUnit', 'laborRate']
const VALID_TIERS = ['good', 'better', 'best']

export function autoDetectMapping(columns: string[], importType: 'pricebook' | 'estimator'): ColumnMapping {
  const fields = importType === 'pricebook' ? PRICEBOOK_FIELDS : ESTIMATOR_FIELDS
  const mapping: ColumnMapping = {}

  for (const col of columns) {
    const normalized = col.toLowerCase().replace(/[^a-z0-9]/g, '_')
    for (const [fieldName, aliases] of Object.entries(fields)) {
      if (aliases.some(a => normalized.includes(a.replace(/[^a-z0-9]/g, '_')))) {
        if (!Object.values(mapping).includes(fieldName)) {
          mapping[col] = fieldName
          break
        }
      }
    }
  }

  return mapping
}

// ─── Helper: invert mapping ────────────────────────────────────────────────────

function invertMapping(mapping: ColumnMapping): Record<string, string> {
  const inv: Record<string, string> = {}
  for (const [fileCol, field] of Object.entries(mapping)) {
    inv[field] = fileCol
  }
  return inv
}

function getMappedValue(row: Record<string, string>, inv: Record<string, string>, field: string): string {
  const col = inv[field]
  if (!col) return ''
  return (row[col] ?? '').trim()
}

function isNumeric(val: string): boolean {
  if (val === '') return false
  const n = Number(val.replace(/[$,%]/g, ''))
  return !isNaN(n) && isFinite(n)
}

function toNumber(val: string): number {
  return Number(val.replace(/[$,%]/g, ''))
}

// ─── Validate ──────────────────────────────────────────────────────────────────

export async function validateMapping(
  fileId: string,
  mapping: ColumnMapping,
  importType: 'pricebook' | 'estimator',
  tenantId: string
): Promise<ValidationResult> {
  const stored = fileStore.get(fileId)
  if (!stored) throw new Error('File not found. Please re-upload.')

  const { rows } = stored
  const inv = invertMapping(mapping)
  const requiredFields = importType === 'pricebook' ? PRICEBOOK_REQUIRED : ESTIMATOR_REQUIRED
  const numericFields =
    importType === 'pricebook'
      ? ['minValue', 'maxValue', 'parPrice', 'retailPrice', 'yr1MarkupPct', 'day30MarkupPct', 'todayDiscountPct']
      : ['materialCostPerUnit', 'laborRate', 'warrantyYears', 'wasteFactor', 'setupFee', 'minimumCharge']

  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []
  const errorRowSet = new Set<number>()
  const warningRowSet = new Set<number>()
  const preview: Record<string, any>[] = []
  const categorySet = new Set<string>()
  const seen = new Set<string>()

  // Check that required fields are mapped
  const mappedFields = new Set(Object.values(mapping))
  for (const req of requiredFields) {
    if (!mappedFields.has(req)) {
      errors.push({ row: 0, field: req, value: '', error: `Required field "${req}" is not mapped to any column` })
    }
  }

  // If required fields missing from mapping, return early
  if (errors.length > 0) {
    return {
      valid: false,
      totalRows: rows.length,
      validRows: 0,
      errorRows: rows.length,
      warningRows: 0,
      errors,
      warnings,
      preview: [],
      newCategories: [],
    }
  }

  // Validate each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +2 for 1-indexed + header row
    const mapped: Record<string, any> = { _row: rowNum }

    // Extract mapped values
    for (const [field] of Object.entries(inv)) {
      mapped[field] = getMappedValue(row, inv, field)
    }

    // Required field checks
    for (const req of requiredFields) {
      const val = getMappedValue(row, inv, req)
      if (!val) {
        errors.push({ row: rowNum, field: req, value: '', error: `Required field "${req}" is empty` })
        errorRowSet.add(i)
      }
    }

    // Numeric field checks
    for (const nf of numericFields) {
      if (!inv[nf]) continue
      const val = getMappedValue(row, inv, nf)
      if (val && !isNumeric(val)) {
        errors.push({ row: rowNum, field: nf, value: val, error: `"${val}" is not a valid number` })
        errorRowSet.add(i)
      }
    }

    // Tier validation
    const tierVal = getMappedValue(row, inv, 'tier')
    if (tierVal && !VALID_TIERS.includes(tierVal.toLowerCase())) {
      errors.push({
        row: rowNum,
        field: 'tier',
        value: tierVal,
        error: `Invalid tier "${tierVal}". Must be one of: good, better, best`,
      })
      errorRowSet.add(i)
    }

    // Duplicate check within file
    const catName = getMappedValue(row, inv, 'categoryName')
    const prodName = getMappedValue(row, inv, 'productName')
    const tier = getMappedValue(row, inv, 'tier') || 'good'

    if (catName && prodName) {
      let dupeKey: string
      if (importType === 'pricebook') {
        const minVal = getMappedValue(row, inv, 'minValue') || '0'
        const maxVal = getMappedValue(row, inv, 'maxValue') || '0'
        dupeKey = `${catName}|${prodName}|${tier}|${minVal}-${maxVal}`
      } else {
        const matName = getMappedValue(row, inv, 'materialName') || ''
        dupeKey = `${catName}|${prodName}|${tier}|${matName}`
      }

      if (seen.has(dupeKey)) {
        warnings.push({ row: rowNum, field: 'productName', value: prodName, error: 'Duplicate row detected in file' })
        warningRowSet.add(i)
      }
      seen.add(dupeKey)
    }

    // Pricebook-specific: par > retail warning
    if (importType === 'pricebook') {
      const par = getMappedValue(row, inv, 'parPrice')
      const retail = getMappedValue(row, inv, 'retailPrice')
      if (par && retail && isNumeric(par) && isNumeric(retail) && toNumber(par) > toNumber(retail)) {
        warnings.push({
          row: rowNum,
          field: 'parPrice',
          value: par,
          error: `Par price ($${par}) is higher than retail price ($${retail})`,
        })
        warningRowSet.add(i)
      }
    }

    // Collect categories
    if (catName) categorySet.add(catName)

    // Preview (first 20 rows)
    if (i < 20) {
      preview.push(mapped)
    }
  }

  // Determine new categories by checking existing
  const existingCategories = await db
    .select({ name: productCategory.name })
    .from(productCategory)
    .where(eq(productCategory.tenantId, tenantId))

  const existingNames = new Set(existingCategories.map(c => c.name.toLowerCase()))
  const newCategories = Array.from(categorySet).filter(c => !existingNames.has(c.toLowerCase()))

  const errorCount = errorRowSet.size
  const warningCount = warningRowSet.size

  return {
    valid: errors.filter(e => e.row > 0).length === 0,
    totalRows: rows.length,
    validRows: rows.length - errorCount,
    errorRows: errorCount,
    warningRows: warningCount,
    errors,
    warnings,
    preview,
    newCategories,
  }
}

// ─── Execute Import ────────────────────────────────────────────────────────────

export async function executeImport(
  fileId: string,
  mapping: ColumnMapping,
  importType: 'pricebook' | 'estimator',
  tenantId: string,
  onConflict: 'skip' | 'update' | 'replace'
): Promise<ImportResult> {
  const stored = fileStore.get(fileId)
  if (!stored) throw new Error('File not found. Please re-upload.')

  const { rows } = stored
  const inv = invertMapping(mapping)

  let imported = 0
  let updated = 0
  let skipped = 0
  let errorCount = 0
  const errorDetails: ValidationError[] = []
  const createdCategories: string[] = []

  // Category cache: name -> id
  const categoryCache = new Map<string, string>()

  // Load existing categories
  const existingCats = await db
    .select({ id: productCategory.id, name: productCategory.name })
    .from(productCategory)
    .where(eq(productCategory.tenantId, tenantId))

  for (const cat of existingCats) {
    categoryCache.set(cat.name.toLowerCase(), cat.id)
  }

  // Helper: ensure category exists
  async function ensureCategory(name: string): Promise<string> {
    const key = name.toLowerCase()
    if (categoryCache.has(key)) return categoryCache.get(key)!

    const id = createId()
    await db.insert(productCategory).values({
      id,
      tenantId,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      sortOrder: 0,
      isActive: true,
    })
    categoryCache.set(key, id)
    createdCategories.push(name)
    return id
  }

  if (importType === 'pricebook') {
    await executePricebookImport(rows, inv, tenantId, onConflict, ensureCategory, {
      imported: () => imported++,
      updated: () => updated++,
      skipped: () => skipped++,
      error: (rowNum: number, field: string, value: string, error: string) => {
        errorCount++
        errorDetails.push({ row: rowNum, field, value, error })
      },
    })
  } else {
    await executeEstimatorImport(rows, inv, tenantId, onConflict, ensureCategory, {
      imported: () => imported++,
      updated: () => updated++,
      skipped: () => skipped++,
      error: (rowNum: number, field: string, value: string, error: string) => {
        errorCount++
        errorDetails.push({ row: rowNum, field, value, error })
      },
    })
  }

  // Clean up file store
  fileStore.delete(fileId)

  return {
    imported,
    updated,
    skipped,
    errors: errorCount,
    errorDetails,
    createdCategories,
  }
}

// ─── Pricebook Import ──────────────────────────────────────────────────────────

interface Counters {
  imported: () => void
  updated: () => void
  skipped: () => void
  error: (row: number, field: string, value: string, error: string) => void
}

async function executePricebookImport(
  rows: Record<string, string>[],
  inv: Record<string, string>,
  tenantId: string,
  onConflict: 'skip' | 'update' | 'replace',
  ensureCategory: (name: string) => Promise<string>,
  counters: Counters
) {
  // Product cache: categoryId|productName|tier -> productId
  const productCache = new Map<string, string>()

  const existingProducts = await db
    .select({ id: product.id, categoryId: product.categoryId, name: product.name, tier: product.tier })
    .from(product)
    .where(eq(product.tenantId, tenantId))

  for (const p of existingProducts) {
    productCache.set(`${p.categoryId}|${p.name.toLowerCase()}|${(p.tier || 'good').toLowerCase()}`, p.id)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    try {
      const catName = getMappedValue(row, inv, 'categoryName')
      const prodName = getMappedValue(row, inv, 'productName')
      const tier = (getMappedValue(row, inv, 'tier') || 'good').toLowerCase() as 'good' | 'better' | 'best'
      const measurementType = getMappedValue(row, inv, 'measurementType') || 'sqft'
      const minValue = getMappedValue(row, inv, 'minValue')
      const maxValue = getMappedValue(row, inv, 'maxValue')
      const parPrice = getMappedValue(row, inv, 'parPrice')
      const retailPrice = getMappedValue(row, inv, 'retailPrice')
      const yr1Markup = getMappedValue(row, inv, 'yr1MarkupPct')
      const day30Markup = getMappedValue(row, inv, 'day30MarkupPct')
      const todayDiscount = getMappedValue(row, inv, 'todayDiscountPct')

      if (!catName || !prodName || !parPrice || !retailPrice) {
        counters.error(rowNum, 'required', '', 'Missing required fields')
        continue
      }

      const categoryId = await ensureCategory(catName)
      const productKey = `${categoryId}|${prodName.toLowerCase()}|${tier}`

      let productId = productCache.get(productKey)
      let productExisted = !!productId

      if (productId && onConflict === 'skip') {
        counters.skipped()
        continue
      }

      if (!productId) {
        // Create new product
        productId = createId()
        await db.insert(product).values({
          id: productId,
          tenantId,
          categoryId,
          name: prodName,
          slug: prodName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          tier,
          measurementType,
          isActive: true,
          sortOrder: 0,
        })
        productCache.set(productKey, productId)
      } else if (onConflict === 'update' || onConflict === 'replace') {
        // Update product
        await db
          .update(product)
          .set({ measurementType, name: prodName })
          .where(eq(product.id, productId))
      }

      // Handle price range
      if (minValue || maxValue || parPrice || retailPrice) {
        const rangeData = {
          tenantId,
          productId,
          minValue: minValue ? toNumber(minValue) : 0,
          maxValue: maxValue ? toNumber(maxValue) : 9999,
          parPrice: toNumber(parPrice),
          retailPrice: toNumber(retailPrice),
          yr1MarkupPct: yr1Markup ? toNumber(yr1Markup) : null,
          day30MarkupPct: day30Markup ? toNumber(day30Markup) : null,
          todayDiscountPct: todayDiscount ? toNumber(todayDiscount) : null,
        }

        if (onConflict === 'replace' && productExisted) {
          // Delete existing ranges for this product, then insert
          await db.delete(priceRange).where(eq(priceRange.productId, productId))
        }

        // Check for existing range with same min/max
        const existingRanges = await db
          .select({ id: priceRange.id })
          .from(priceRange)
          .where(
            and(
              eq(priceRange.productId, productId),
              eq(priceRange.minValue, rangeData.minValue),
              eq(priceRange.maxValue, rangeData.maxValue)
            )
          )

        if (existingRanges.length > 0 && onConflict === 'update') {
          await db
            .update(priceRange)
            .set({
              parPrice: rangeData.parPrice,
              retailPrice: rangeData.retailPrice,
              yr1MarkupPct: rangeData.yr1MarkupPct,
              day30MarkupPct: rangeData.day30MarkupPct,
              todayDiscountPct: rangeData.todayDiscountPct,
            })
            .where(eq(priceRange.id, existingRanges[0].id))
        } else if (existingRanges.length === 0 || onConflict === 'replace') {
          await db.insert(priceRange).values({
            id: createId(),
            ...rangeData,
          })
        }
      }

      if (productExisted) {
        counters.updated()
      } else {
        counters.imported()
      }
    } catch (err: any) {
      counters.error(rowNum, 'unknown', '', err.message || 'Unexpected error')
    }
  }
}

// ─── Estimator Import ──────────────────────────────────────────────────────────

async function executeEstimatorImport(
  rows: Record<string, string>[],
  inv: Record<string, string>,
  tenantId: string,
  onConflict: 'skip' | 'update' | 'replace',
  ensureCategory: (name: string) => Promise<string>,
  counters: Counters
) {
  // estimatorProduct cache: categoryId|productName -> id
  const epCache = new Map<string, string>()

  const existingEps = await db
    .select({ id: estimatorProduct.id, categoryId: estimatorProduct.categoryId, name: estimatorProduct.name })
    .from(estimatorProduct)
    .where(eq(estimatorProduct.tenantId, tenantId))

  for (const ep of existingEps) {
    epCache.set(`${ep.categoryId}|${ep.name.toLowerCase()}`, ep.id)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    try {
      const catName = getMappedValue(row, inv, 'categoryName')
      const prodName = getMappedValue(row, inv, 'productName')
      const tier = (getMappedValue(row, inv, 'tier') || 'good').toLowerCase() as 'good' | 'better' | 'best'
      const materialName = getMappedValue(row, inv, 'materialName')
      const materialCost = getMappedValue(row, inv, 'materialCostPerUnit')
      const laborRate = getMappedValue(row, inv, 'laborRate')
      const laborUnit = getMappedValue(row, inv, 'laborUnit') || 'sqft'
      const manufacturer = getMappedValue(row, inv, 'manufacturer')
      const warrantyYears = getMappedValue(row, inv, 'warrantyYears')
      const wasteFactor = getMappedValue(row, inv, 'wasteFactor')
      const measurementUnit = getMappedValue(row, inv, 'measurementUnit') || 'sqft'
      const setupFee = getMappedValue(row, inv, 'setupFee')
      const minimumCharge = getMappedValue(row, inv, 'minimumCharge')

      if (!catName || !prodName || !materialName || !materialCost || !laborRate) {
        counters.error(rowNum, 'required', '', 'Missing required fields')
        continue
      }

      const categoryId = await ensureCategory(catName)
      const epKey = `${categoryId}|${prodName.toLowerCase()}`

      let epId = epCache.get(epKey)
      let epExisted = !!epId

      if (epId && onConflict === 'skip') {
        // Still need to check material tier
      }

      if (!epId) {
        epId = createId()
        await db.insert(estimatorProduct).values({
          id: epId,
          tenantId,
          categoryId,
          name: prodName,
          slug: prodName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          measurementUnit,
          laborRate: toNumber(laborRate),
          laborUnit,
          setupFee: setupFee ? toNumber(setupFee) : 0,
          minimumCharge: minimumCharge ? toNumber(minimumCharge) : 0,
          isActive: true,
          sortOrder: 0,
        })
        epCache.set(epKey, epId)
      } else if (onConflict === 'update' || onConflict === 'replace') {
        await db
          .update(estimatorProduct)
          .set({
            measurementUnit,
            laborRate: toNumber(laborRate),
            laborUnit,
            setupFee: setupFee ? toNumber(setupFee) : 0,
            minimumCharge: minimumCharge ? toNumber(minimumCharge) : 0,
          })
          .where(eq(estimatorProduct.id, epId))
      }

      // Handle material tier
      const existingTiers = await db
        .select({ id: estimatorMaterialTier.id })
        .from(estimatorMaterialTier)
        .where(
          and(
            eq(estimatorMaterialTier.estimatorProductId, epId),
            eq(estimatorMaterialTier.tier, tier),
            eq(estimatorMaterialTier.name, materialName)
          )
        )

      const tierData = {
        tenantId,
        estimatorProductId: epId,
        tier,
        name: materialName,
        costPerUnit: toNumber(materialCost),
        manufacturer: manufacturer || null,
        warrantyYears: warrantyYears ? toNumber(warrantyYears) : null,
        wasteFactor: wasteFactor ? toNumber(wasteFactor) : 0.1,
      }

      if (existingTiers.length > 0) {
        if (onConflict === 'skip') {
          counters.skipped()
          continue
        }
        if (onConflict === 'update') {
          await db
            .update(estimatorMaterialTier)
            .set({
              costPerUnit: tierData.costPerUnit,
              manufacturer: tierData.manufacturer,
              warrantyYears: tierData.warrantyYears,
              wasteFactor: tierData.wasteFactor,
            })
            .where(eq(estimatorMaterialTier.id, existingTiers[0].id))
        } else if (onConflict === 'replace') {
          await db.delete(estimatorMaterialTier).where(eq(estimatorMaterialTier.id, existingTiers[0].id))
          await db.insert(estimatorMaterialTier).values({ id: createId(), ...tierData })
        }
      } else {
        await db.insert(estimatorMaterialTier).values({ id: createId(), ...tierData })
      }

      if (epExisted) {
        counters.updated()
      } else {
        counters.imported()
      }
    } catch (err: any) {
      counters.error(rowNum, 'unknown', '', err.message || 'Unexpected error')
    }
  }
}

// ─── Template Generation ───────────────────────────────────────────────────────

export function generatePricebookTemplate(): Buffer {
  const wb = XLSX.utils.book_new()
  const data = [
    ['Category', 'Product', 'Tier', 'Measurement Type', 'Min Value', 'Max Value', 'Par Price', 'Retail Price', 'Yr1 Markup %', '30-Day Markup %', 'Today Discount %'],
    ['Roofing', 'Asphalt Shingles', 'good', 'sqft', '0', '1000', '3.50', '5.25', '15', '10', '5'],
    ['Roofing', 'Asphalt Shingles', 'better', 'sqft', '0', '1000', '4.25', '6.50', '15', '10', '5'],
    ['Siding', 'Vinyl Siding', 'good', 'sqft', '0', '2000', '2.75', '4.50', '12', '8', '4'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Pricebook')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'csv' }))
}

export function generateEstimatorTemplate(): Buffer {
  const wb = XLSX.utils.book_new()
  const data = [
    ['Category', 'Product', 'Tier', 'Material Name', 'Material Cost Per Unit', 'Labor Rate', 'Labor Unit', 'Manufacturer', 'Warranty Years', 'Waste Factor', 'Measurement Unit', 'Setup Fee', 'Minimum Charge'],
    ['Roofing', 'Asphalt Shingles', 'good', 'GAF Timberline HDZ', '95.00', '75.00', 'square', 'GAF', '25', '0.10', 'sqft', '250.00', '1500.00'],
    ['Roofing', 'Asphalt Shingles', 'better', 'Owens Corning Duration', '115.00', '75.00', 'square', 'Owens Corning', '30', '0.10', 'sqft', '250.00', '1500.00'],
    ['Siding', 'Vinyl Siding', 'good', 'CertainTeed Monogram', '4.50', '3.25', 'sqft', 'CertainTeed', '50', '0.12', 'sqft', '200.00', '1200.00'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Estimator')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'csv' }))
}
