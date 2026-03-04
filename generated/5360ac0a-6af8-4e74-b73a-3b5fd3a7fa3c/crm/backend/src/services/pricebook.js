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

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// PRICEBOOK CATEGORIES
// ============================================

/**
 * Create category
 */
export async function createCategory(companyId, data) {
  const sortOrder = await getNextSortOrder(companyId, data.parentId);
  
  return prisma.pricebookCategory.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      parentId: data.parentId || null,
      icon: data.icon,
      color: data.color,
      sortOrder,
      active: true,
    },
  });
}

async function getNextSortOrder(companyId, parentId) {
  const max = await prisma.pricebookCategory.aggregate({
    where: { companyId, parentId: parentId || null },
    _max: { sortOrder: true },
  });
  return (max._max.sortOrder || 0) + 1;
}

/**
 * Get categories with hierarchy
 */
export async function getCategories(companyId, { flat = false, active = true } = {}) {
  const where = { companyId };
  if (active !== null) where.active = active;

  const categories = await prisma.pricebookCategory.findMany({
    where,
    include: {
      _count: { select: { items: true, children: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  if (flat) return categories;

  // Build tree structure
  const rootCategories = categories.filter(c => !c.parentId);
  const buildTree = (parent) => ({
    ...parent,
    children: categories
      .filter(c => c.parentId === parent.id)
      .map(buildTree),
  });

  return rootCategories.map(buildTree);
}

/**
 * Update category
 */
export async function updateCategory(categoryId, companyId, data) {
  return prisma.pricebookCategory.updateMany({
    where: { id: categoryId, companyId },
    data,
  });
}

/**
 * Reorder categories
 */
export async function reorderCategories(companyId, orderedIds) {
  const updates = orderedIds.map((id, index) =>
    prisma.pricebookCategory.updateMany({
      where: { id, companyId },
      data: { sortOrder: index },
    })
  );
  return Promise.all(updates);
}

// ============================================
// PRICEBOOK ITEMS (Services)
// ============================================

/**
 * Create pricebook item
 */
export async function createItem(companyId, data) {
  const code = data.code || await generateItemCode(companyId);

  return prisma.pricebookItem.create({
    data: {
      companyId,
      categoryId: data.categoryId,
      code,
      name: data.name,
      description: data.description,
      customerDescription: data.customerDescription,
      
      // Pricing
      price: data.price || 0,
      cost: data.cost || 0,
      laborHours: data.laborHours || 0,
      laborRate: data.laborRate,
      
      // Display
      imageUrl: data.imageUrl,
      showToCustomer: data.showToCustomer ?? true,
      
      // Warranty
      warrantyDays: data.warrantyDays || 0,
      warrantyDescription: data.warrantyDescription,
      
      // Flags
      taxable: data.taxable ?? true,
      commissionable: data.commissionable ?? true,
      active: true,
      
      // Materials (link to inventory items)
      materials: data.materials ? {
        create: data.materials.map(m => ({
          inventoryItemId: m.inventoryItemId,
          quantity: m.quantity,
          priceOverride: m.priceOverride,
        })),
      } : undefined,
    },
    include: {
      category: true,
      materials: { include: { inventoryItem: true } },
    },
  });
}

async function generateItemCode(companyId) {
  const count = await prisma.pricebookItem.count({ where: { companyId } });
  return `SVC-${String(count + 1).padStart(4, '0')}`;
}

/**
 * Get pricebook items
 */
export async function getItems(companyId, {
  categoryId,
  search,
  active = true,
  showToCustomer,
  page = 1,
  limit = 50,
} = {}) {
  const where = { companyId };

  if (active !== null) where.active = active;
  if (categoryId) where.categoryId = categoryId;
  if (showToCustomer !== undefined) where.showToCustomer = showToCustomer;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.pricebookItem.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        materials: {
          include: {
            inventoryItem: { select: { id: true, name: true, unitCost: true } },
          },
        },
        _count: { select: { goodBetterBest: true } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pricebookItem.count({ where }),
  ]);

  // Calculate margins
  const itemsWithMargin = items.map(item => {
    const materialCost = item.materials.reduce(
      (sum, m) => sum + Number(m.inventoryItem?.unitCost || 0) * m.quantity,
      0
    );
    const totalCost = Number(item.cost) + materialCost;
    const margin = item.price > 0 
      ? ((Number(item.price) - totalCost) / Number(item.price) * 100).toFixed(1)
      : 0;
    
    return { ...item, materialCost, totalCost, margin };
  });

  return {
    data: itemsWithMargin,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single item with full details
 */
export async function getItem(itemId, companyId) {
  return prisma.pricebookItem.findFirst({
    where: { id: itemId, companyId },
    include: {
      category: true,
      materials: {
        include: {
          inventoryItem: true,
        },
      },
      goodBetterBest: { orderBy: { tier: 'asc' } },
    },
  });
}

/**
 * Update pricebook item
 */
export async function updateItem(itemId, companyId, data) {
  // Handle materials update separately
  if (data.materials) {
    // Delete existing
    await prisma.pricebookMaterial.deleteMany({
      where: { pricebookItemId: itemId },
    });
    
    // Create new
    await prisma.pricebookMaterial.createMany({
      data: data.materials.map(m => ({
        pricebookItemId: itemId,
        inventoryItemId: m.inventoryItemId,
        quantity: m.quantity,
        priceOverride: m.priceOverride,
      })),
    });
    
    delete data.materials;
  }

  return prisma.pricebookItem.updateMany({
    where: { id: itemId, companyId },
    data,
  });
}

/**
 * Duplicate item
 */
export async function duplicateItem(itemId, companyId) {
  const original = await getItem(itemId, companyId);
  if (!original) throw new Error('Item not found');

  const code = await generateItemCode(companyId);
  
  return createItem(companyId, {
    ...original,
    code,
    name: `${original.name} (Copy)`,
    materials: original.materials.map(m => ({
      inventoryItemId: m.inventoryItemId,
      quantity: m.quantity,
      priceOverride: m.priceOverride,
    })),
  });
}

// ============================================
// GOOD-BETTER-BEST OPTIONS
// ============================================

/**
 * Set Good-Better-Best options for an item
 */
export async function setGoodBetterBest(itemId, companyId, options) {
  // Verify ownership
  const item = await prisma.pricebookItem.findFirst({
    where: { id: itemId, companyId },
  });
  if (!item) throw new Error('Item not found');

  // Delete existing
  await prisma.pricebookGoodBetterBest.deleteMany({
    where: { pricebookItemId: itemId },
  });

  // Create new options
  return prisma.pricebookGoodBetterBest.createMany({
    data: options.map(opt => ({
      pricebookItemId: itemId,
      tier: opt.tier, // 'good', 'better', 'best'
      name: opt.name,
      description: opt.description,
      price: opt.price,
      features: opt.features, // JSON array of feature strings
      recommended: opt.recommended || false,
    })),
  });
}

/**
 * Get Good-Better-Best for an item
 */
export async function getGoodBetterBest(itemId) {
  return prisma.pricebookGoodBetterBest.findMany({
    where: { pricebookItemId: itemId },
    orderBy: { tier: 'asc' },
  });
}

// ============================================
// PRICING ADJUSTMENTS
// ============================================

/**
 * Apply bulk price adjustment
 */
export async function bulkPriceAdjustment(companyId, {
  categoryId,
  itemIds,
  adjustmentType, // 'percent' or 'fixed'
  adjustmentValue,
  applyTo, // 'price' or 'cost'
}) {
  const where = { companyId };
  if (categoryId) where.categoryId = categoryId;
  if (itemIds?.length) where.id = { in: itemIds };

  const items = await prisma.pricebookItem.findMany({ where });
  
  const updates = items.map(item => {
    const currentValue = Number(item[applyTo]);
    let newValue;

    if (adjustmentType === 'percent') {
      newValue = currentValue * (1 + adjustmentValue / 100);
    } else {
      newValue = currentValue + adjustmentValue;
    }

    return prisma.pricebookItem.update({
      where: { id: item.id },
      data: { [applyTo]: Math.round(newValue * 100) / 100 },
    });
  });

  return Promise.all(updates);
}

/**
 * Get pricing suggestions based on margin targets
 */
export function calculateSuggestedPrice(cost, targetMarginPercent) {
  // Price = Cost / (1 - Margin%)
  return cost / (1 - targetMarginPercent / 100);
}

// ============================================
// IMPORT/EXPORT
// ============================================

/**
 * Export pricebook to CSV format
 */
export async function exportPricebook(companyId) {
  const items = await prisma.pricebookItem.findMany({
    where: { companyId },
    include: { category: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });

  return items.map(item => ({
    code: item.code,
    name: item.name,
    category: item.category?.name || '',
    description: item.description || '',
    price: item.price,
    cost: item.cost,
    laborHours: item.laborHours,
    taxable: item.taxable,
    active: item.active,
  }));
}

/**
 * Import pricebook from data
 */
export async function importPricebook(companyId, data, { updateExisting = false } = {}) {
  const results = { created: 0, updated: 0, errors: [] };

  for (const row of data) {
    try {
      // Find or create category
      let categoryId = null;
      if (row.category) {
        let category = await prisma.pricebookCategory.findFirst({
          where: { companyId, name: row.category },
        });
        if (!category) {
          category = await createCategory(companyId, { name: row.category });
        }
        categoryId = category.id;
      }

      // Check for existing item
      const existing = await prisma.pricebookItem.findFirst({
        where: { companyId, code: row.code },
      });

      if (existing) {
        if (updateExisting) {
          await updateItem(existing.id, companyId, {
            name: row.name,
            categoryId,
            description: row.description,
            price: parseFloat(row.price) || 0,
            cost: parseFloat(row.cost) || 0,
            laborHours: parseFloat(row.laborHours) || 0,
          });
          results.updated++;
        }
      } else {
        await createItem(companyId, {
          code: row.code,
          name: row.name,
          categoryId,
          description: row.description,
          price: parseFloat(row.price) || 0,
          cost: parseFloat(row.cost) || 0,
          laborHours: parseFloat(row.laborHours) || 0,
        });
        results.created++;
      }
    } catch (error) {
      results.errors.push({ row, error: error.message });
    }
  }

  return results;
}

// ============================================
// SEARCH & FILTERING
// ============================================

/**
 * Search pricebook for quotes/invoices
 */
export async function searchForQuoting(companyId, query) {
  return prisma.pricebookItem.findMany({
    where: {
      companyId,
      active: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
        { category: { name: { contains: query, mode: 'insensitive' } } },
      ],
    },
    include: {
      category: { select: { name: true } },
    },
    take: 20,
    orderBy: { name: 'asc' },
  });
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
};
