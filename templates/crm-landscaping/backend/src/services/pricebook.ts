/**
 * Pricebook Service
 *
 * Flat-rate pricing catalog for technicians:
 * - Pre-defined services with fixed prices
 * - Categories and subcategories
 * - Images and descriptions for customer display
 * - Labor + materials bundled
 * - Regional pricing adjustments
 * - Good-Better-Best options
 */

import { db } from '../../db/index.ts'
import { pricebookCategory, pricebookItem, inventoryItem } from '../../db/schema.ts'
import { eq, and, or, ilike, asc, desc, count, sql, inArray, max } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

// ============================================
// PRICEBOOK CATEGORIES
// ============================================

/**
 * Create category
 */
export async function createCategory(companyId: string, data: any) {
  const sortOrder = await getNextSortOrder(companyId, data.parentId)

  const [category] = await db.insert(pricebookCategory).values({
    companyId,
    name: data.name,
    description: data.description,
    parentId: data.parentId || null,
    sortOrder,
    active: true,
  }).returning()

  return category
}

async function getNextSortOrder(companyId: string, parentId?: string | null): Promise<number> {
  const [result] = await db.select({ maxOrder: max(pricebookCategory.sortOrder) })
    .from(pricebookCategory)
    .where(and(
      eq(pricebookCategory.companyId, companyId),
      parentId ? eq(pricebookCategory.parentId, parentId) : sql`${pricebookCategory.parentId} IS NULL`,
    ))

  return (result?.maxOrder || 0) + 1
}

/**
 * Get categories with hierarchy
 */
export async function getCategories(companyId: string, { flat = false, active = true }: { flat?: boolean; active?: boolean | null } = {}) {
  const conditions = [eq(pricebookCategory.companyId, companyId)]
  if (active !== null) conditions.push(eq(pricebookCategory.active, active!))

  const categories = await db.select()
    .from(pricebookCategory)
    .where(and(...conditions))
    .orderBy(asc(pricebookCategory.sortOrder))

  // Get item counts per category
  const categoryIds = categories.map(c => c.id)
  const itemCounts = categoryIds.length > 0
    ? await db.select({
        categoryId: pricebookItem.categoryId,
        count: count(),
      })
        .from(pricebookItem)
        .where(inArray(pricebookItem.categoryId, categoryIds))
        .groupBy(pricebookItem.categoryId)
    : []

  const categoriesWithCounts = categories.map(c => ({
    ...c,
    _count: {
      items: itemCounts.find(ic => ic.categoryId === c.id)?.count ?? 0,
      children: categories.filter(child => child.parentId === c.id).length,
    },
  }))

  if (flat) return categoriesWithCounts

  // Build tree structure
  const rootCategories = categoriesWithCounts.filter(c => !c.parentId)
  const buildTree = (parent: any): any => ({
    ...parent,
    children: categoriesWithCounts
      .filter(c => c.parentId === parent.id)
      .map(buildTree),
  })

  return rootCategories.map(buildTree)
}

/**
 * Update category
 */
export async function updateCategory(categoryId: string, companyId: string, data: any) {
  return db.update(pricebookCategory)
    .set(data)
    .where(and(eq(pricebookCategory.id, categoryId), eq(pricebookCategory.companyId, companyId)))
}

/**
 * Reorder categories
 */
export async function reorderCategories(companyId: string, orderedIds: string[]) {
  const updates = orderedIds.map((id, index) =>
    db.update(pricebookCategory)
      .set({ sortOrder: index })
      .where(and(eq(pricebookCategory.id, id), eq(pricebookCategory.companyId, companyId)))
  )
  return Promise.all(updates)
}

// ============================================
// PRICEBOOK ITEMS (Services)
// ============================================

/**
 * Create pricebook item
 */
export async function createItem(companyId: string, data: any) {
  const code = data.code || await generateItemCode(companyId)

  const [item] = await db.insert(pricebookItem).values({
    companyId,
    categoryId: data.categoryId || null,
    code,
    name: data.name,
    description: data.description,
    price: String(data.price || 0),
    cost: String(data.cost || 0),
    unit: data.unit || 'each',
    taxable: data.taxable ?? true,
    active: true,
    type: data.type || 'service',
  }).returning()

  return item
}

async function generateItemCode(companyId: string): Promise<string> {
  const [result] = await db.select({ value: count() })
    .from(pricebookItem)
    .where(eq(pricebookItem.companyId, companyId))

  return `SVC-${String((result?.value ?? 0) + 1).padStart(4, '0')}`
}

/**
 * Get pricebook items
 */
export async function getItems(companyId: string, {
  categoryId,
  search,
  active = true,
  showToCustomer,
  page = 1,
  limit = 50,
}: {
  categoryId?: string
  search?: string
  active?: boolean | null
  showToCustomer?: boolean
  page?: number
  limit?: number
} = {}) {
  const conditions = [eq(pricebookItem.companyId, companyId)]

  if (active !== null) conditions.push(eq(pricebookItem.active, active!))
  if (categoryId) conditions.push(eq(pricebookItem.categoryId, categoryId))
  if (search) {
    conditions.push(or(
      ilike(pricebookItem.name, `%${search}%`),
      ilike(pricebookItem.code, `%${search}%`),
      ilike(pricebookItem.description, `%${search}%`),
    )!)
  }

  const whereClause = and(...conditions)

  const [items, [totalResult]] = await Promise.all([
    db.select()
      .from(pricebookItem)
      .leftJoin(pricebookCategory, eq(pricebookItem.categoryId, pricebookCategory.id))
      .where(whereClause)
      .orderBy(asc(pricebookItem.name))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(pricebookItem)
      .where(whereClause),
  ])

  const total = totalResult?.value ?? 0

  // Calculate margins
  const itemsWithMargin = items.map(row => {
    const item = row.pricebook_item
    const totalCost = Number(item.cost)
    const margin = Number(item.price) > 0
      ? ((Number(item.price) - totalCost) / Number(item.price) * 100).toFixed(1)
      : '0'

    return {
      ...item,
      category: row.pricebook_category ? { id: row.pricebook_category.id, name: row.pricebook_category.name } : null,
      totalCost,
      margin,
    }
  })

  return {
    data: itemsWithMargin,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get single item with full details
 */
export async function getItem(itemId: string, companyId: string) {
  const [result] = await db.select()
    .from(pricebookItem)
    .leftJoin(pricebookCategory, eq(pricebookItem.categoryId, pricebookCategory.id))
    .where(and(eq(pricebookItem.id, itemId), eq(pricebookItem.companyId, companyId)))

  if (!result) return null

  return {
    ...result.pricebook_item,
    category: result.pricebook_category,
  }
}

/**
 * Update pricebook item
 */
export async function updateItem(itemId: string, companyId: string, data: any) {
  return db.update(pricebookItem)
    .set(data)
    .where(and(eq(pricebookItem.id, itemId), eq(pricebookItem.companyId, companyId)))
}

/**
 * Duplicate item
 */
export async function duplicateItem(itemId: string, companyId: string) {
  const original = await getItem(itemId, companyId)
  if (!original) throw new Error('Item not found')

  const code = await generateItemCode(companyId)

  return createItem(companyId, {
    ...original,
    code,
    name: `${original.name} (Copy)`,
  })
}

// ============================================
// GOOD-BETTER-BEST OPTIONS
// ============================================

// NOTE: pricebookGoodBetterBest table is not in the Drizzle schema.
// Using raw SQL. Add the table to schema.ts for proper integration.

/**
 * Set Good-Better-Best options for an item
 */
export async function setGoodBetterBest(itemId: string, companyId: string, options: any[]) {
  // Verify ownership
  const [item] = await db.select()
    .from(pricebookItem)
    .where(and(eq(pricebookItem.id, itemId), eq(pricebookItem.companyId, companyId)))

  if (!item) throw new Error('Item not found')

  // Delete existing
  await db.execute(sql`DELETE FROM pricebook_good_better_best WHERE pricebook_item_id = ${itemId}`)

  // Create new options
  for (const opt of options) {
    await db.execute(sql`
      INSERT INTO pricebook_good_better_best (id, pricebook_item_id, tier, name, description, price, features, recommended)
      VALUES (${createId()}, ${itemId}, ${opt.tier}, ${opt.name}, ${opt.description}, ${opt.price}, ${JSON.stringify(opt.features)}, ${opt.recommended || false})
    `)
  }
}

/**
 * Get Good-Better-Best for an item
 */
export async function getGoodBetterBest(itemId: string) {
  const result = await db.execute(sql`
    SELECT * FROM pricebook_good_better_best
    WHERE pricebook_item_id = ${itemId}
    ORDER BY tier ASC
  `)
  return result.rows ?? result
}

// ============================================
// PRICING ADJUSTMENTS
// ============================================

/**
 * Apply bulk price adjustment
 */
export async function bulkPriceAdjustment(companyId: string, {
  categoryId,
  itemIds,
  adjustmentType,
  adjustmentValue,
  applyTo,
}: {
  categoryId?: string
  itemIds?: string[]
  adjustmentType: 'percent' | 'fixed'
  adjustmentValue: number
  applyTo: 'price' | 'cost'
}) {
  const conditions = [eq(pricebookItem.companyId, companyId)]
  if (categoryId) conditions.push(eq(pricebookItem.categoryId, categoryId))
  if (itemIds?.length) conditions.push(inArray(pricebookItem.id, itemIds))

  const items = await db.select()
    .from(pricebookItem)
    .where(and(...conditions))

  const updates = items.map(item => {
    const currentValue = Number(item[applyTo])
    let newValue: number

    if (adjustmentType === 'percent') {
      newValue = currentValue * (1 + adjustmentValue / 100)
    } else {
      newValue = currentValue + adjustmentValue
    }

    return db.update(pricebookItem)
      .set({ [applyTo]: String(Math.round(newValue * 100) / 100) })
      .where(eq(pricebookItem.id, item.id))
  })

  return Promise.all(updates)
}

/**
 * Get pricing suggestions based on margin targets
 */
export function calculateSuggestedPrice(cost: number, targetMarginPercent: number): number {
  return cost / (1 - targetMarginPercent / 100)
}

// ============================================
// IMPORT/EXPORT
// ============================================

/**
 * Export pricebook to CSV format
 */
export async function exportPricebook(companyId: string) {
  const items = await db.select()
    .from(pricebookItem)
    .leftJoin(pricebookCategory, eq(pricebookItem.categoryId, pricebookCategory.id))
    .where(eq(pricebookItem.companyId, companyId))
    .orderBy(asc(pricebookItem.name))

  return items.map(row => ({
    code: row.pricebook_item.code,
    name: row.pricebook_item.name,
    category: row.pricebook_category?.name || '',
    description: row.pricebook_item.description || '',
    price: row.pricebook_item.price,
    cost: row.pricebook_item.cost,
    taxable: row.pricebook_item.taxable,
    active: row.pricebook_item.active,
  }))
}

/**
 * Import pricebook from data
 */
export async function importPricebook(companyId: string, data: any[], { updateExisting = false }: { updateExisting?: boolean } = {}) {
  const results = { created: 0, updated: 0, errors: [] as Array<{ row: any; error: string }> }

  for (const row of data) {
    try {
      // Find or create category
      let categoryId: string | null = null
      if (row.category) {
        const [existing] = await db.select()
          .from(pricebookCategory)
          .where(and(eq(pricebookCategory.companyId, companyId), eq(pricebookCategory.name, row.category)))
          .limit(1)

        if (existing) {
          categoryId = existing.id
        } else {
          const created = await createCategory(companyId, { name: row.category })
          categoryId = created.id
        }
      }

      // Check for existing item
      const [existing] = await db.select()
        .from(pricebookItem)
        .where(and(eq(pricebookItem.companyId, companyId), eq(pricebookItem.code, row.code)))
        .limit(1)

      if (existing) {
        if (updateExisting) {
          await updateItem(existing.id, companyId, {
            name: row.name,
            categoryId,
            description: row.description,
            price: String(parseFloat(row.price) || 0),
            cost: String(parseFloat(row.cost) || 0),
          })
          results.updated++
        }
      } else {
        await createItem(companyId, {
          code: row.code,
          name: row.name,
          categoryId,
          description: row.description,
          price: parseFloat(row.price) || 0,
          cost: parseFloat(row.cost) || 0,
        })
        results.created++
      }
    } catch (error: any) {
      results.errors.push({ row, error: error.message })
    }
  }

  return results
}

// ============================================
// SEARCH & FILTERING
// ============================================

/**
 * Search pricebook for quotes/invoices
 */
export async function searchForQuoting(companyId: string, query: string) {
  return db.select()
    .from(pricebookItem)
    .leftJoin(pricebookCategory, eq(pricebookItem.categoryId, pricebookCategory.id))
    .where(and(
      eq(pricebookItem.companyId, companyId),
      eq(pricebookItem.active, true),
      or(
        ilike(pricebookItem.name, `%${query}%`),
        ilike(pricebookItem.code, `%${query}%`),
        ilike(pricebookCategory.name, `%${query}%`),
      ),
    ))
    .limit(20)
    .orderBy(asc(pricebookItem.name))
    .then(rows => rows.map(r => ({
      ...r.pricebook_item,
      category: r.pricebook_category ? { name: r.pricebook_category.name } : null,
    })))
}

export default {
  createCategory,
  getCategories,
  updateCategory,
  reorderCategories,
  createItem,
  getItems,
  getItem,
  updateItem,
  duplicateItem,
  setGoodBetterBest,
  getGoodBetterBest,
  bulkPriceAdjustment,
  calculateSuggestedPrice,
  exportPricebook,
  importPricebook,
  searchForQuoting,
}
