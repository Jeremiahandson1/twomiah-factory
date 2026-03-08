/**
 * Material Takeoff Service
 *
 * Calculate material quantities from plans.
 *
 * NOTE: The schema does not include takeoff_assembly / assembly_material /
 * takeoff_sheet / takeoff_item / takeoff_calculated_material tables.
 * This module uses raw SQL via Drizzle's sql helper for those tables.
 */

import { db } from '../../db/index.ts'
import { purchaseOrder, purchaseOrderItem } from '../../db/schema.ts'
import { eq, sql } from 'drizzle-orm'

/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

// Measurement types
export const MEASUREMENT_TYPES = {
  AREA: 'area',
  LINEAR: 'linear',
  COUNT: 'count',
  VOLUME: 'volume',
  BOARD_FEET: 'board_feet',
} as const

// ============================================
// ASSEMBLIES (Material Templates)
// ============================================

/**
 * Create assembly template
 */
export async function createAssembly(companyId: string, data: any) {
  const [assembly] = rows(await db.execute(sql`
    INSERT INTO takeoff_assembly (company_id, name, description, category, measurement_type, waste_factor, active)
    VALUES (${companyId}, ${data.name}, ${data.description || null}, ${data.category || null}, ${data.measurementType || 'area'}, ${data.wasteFactor || 10}, true)
    RETURNING *
  `))

  if (data.materials?.length) {
    for (const mat of data.materials) {
      await db.execute(sql`
        INSERT INTO assembly_material (assembly_id, name, description, quantity_per, unit, unit_cost, unit_price, inventory_item_id)
        VALUES (${assembly.id}, ${mat.name}, ${mat.description || null}, ${mat.quantityPer || 1}, ${mat.unit || 'each'}, ${mat.unitCost || 0}, ${mat.unitPrice || 0}, ${mat.inventoryItemId || null})
      `)
    }
  }

  return getAssembly(assembly.id, companyId)
}

/**
 * Get assembly with materials
 */
export async function getAssembly(assemblyId: string, companyId: string) {
  const [assembly] = rows(await db.execute(sql`
    SELECT * FROM takeoff_assembly WHERE id = ${assemblyId} AND company_id = ${companyId}
  `))
  if (!assembly) return null

  assembly.materials = rows(await db.execute(sql`
    SELECT am.*, json_build_object('id', ii.id, 'name', ii.name, 'sku', ii.sku, 'unit_cost', ii.unit_cost) as inventory_item
    FROM assembly_material am
    LEFT JOIN inventory_item ii ON ii.id = am.inventory_item_id
    WHERE am.assembly_id = ${assemblyId}
  `))

  return assembly
}

/**
 * Get all assemblies
 */
export async function getAssemblies(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
  const conditions: string[] = [`ta.company_id = '${companyId}'`]
  if (category) conditions.push(`ta.category = '${category}'`)
  if (active !== null) conditions.push(`ta.active = ${active}`)

  const assemblies = rows(await db.execute(sql.raw(`
    SELECT ta.* FROM takeoff_assembly ta WHERE ${conditions.join(' AND ')} ORDER BY ta.category ASC, ta.name ASC
  `)))

  // Load materials for each
  for (const assembly of assemblies) {
    assembly.materials = rows(await db.execute(sql`
      SELECT * FROM assembly_material WHERE assembly_id = ${assembly.id}
    `))
  }

  return assemblies
}

/**
 * Update assembly
 */
export async function updateAssembly(assemblyId: string, companyId: string, data: any) {
  const sets: string[] = []
  if (data.name !== undefined) sets.push(`name = '${data.name}'`)
  if (data.description !== undefined) sets.push(`description = '${data.description}'`)
  if (data.category !== undefined) sets.push(`category = '${data.category}'`)
  if (data.wasteFactor !== undefined) sets.push(`waste_factor = ${data.wasteFactor}`)
  if (data.active !== undefined) sets.push(`active = ${data.active}`)

  if (sets.length === 0) return

  return db.execute(sql.raw(`
    UPDATE takeoff_assembly SET ${sets.join(', ')} WHERE id = '${assemblyId}' AND company_id = '${companyId}'
  `))
}

/**
 * Seed common assemblies
 */
export async function seedDefaultAssemblies(companyId: string) {
  const defaults = [
    {
      name: 'Interior Wall Framing (2x4)',
      category: 'framing',
      measurementType: 'linear',
      wasteFactor: 10,
      materials: [
        { name: '2x4x8 Stud', quantityPer: 0.75, unit: 'each', unitCost: 4.5 },
        { name: '2x4x10 Plate', quantityPer: 0.25, unit: 'each', unitCost: 5.5 },
        { name: '16d Framing Nails', quantityPer: 0.5, unit: 'lb', unitCost: 3.0 },
      ],
    },
    {
      name: 'Drywall (1/2")',
      category: 'drywall',
      measurementType: 'area',
      wasteFactor: 12,
      materials: [
        { name: '1/2" Drywall 4x8', quantityPer: 0.03125, unit: 'sheet', unitCost: 12.0 },
        { name: 'Drywall Screws', quantityPer: 0.05, unit: 'lb', unitCost: 8.0 },
        { name: 'Joint Compound', quantityPer: 0.01, unit: 'bucket', unitCost: 15.0 },
        { name: 'Drywall Tape', quantityPer: 0.1, unit: 'roll', unitCost: 4.0 },
      ],
    },
  ]

  for (const assembly of defaults) {
    const [existing] = rows(await db.execute(sql`
      SELECT id FROM takeoff_assembly WHERE company_id = ${companyId} AND name = ${assembly.name}
    `))

    if (!existing) {
      await createAssembly(companyId, assembly)
    }
  }
}

// ============================================
// TAKEOFF SHEETS
// ============================================

/**
 * Create takeoff sheet for project
 */
export async function createTakeoffSheet(companyId: string, data: any) {
  const [sheet] = rows(await db.execute(sql`
    INSERT INTO takeoff_sheet (company_id, project_id, name, description, plan_reference, plan_url, status)
    VALUES (${companyId}, ${data.projectId}, ${data.name}, ${data.description || null}, ${data.planReference || null}, ${data.planUrl || null}, 'draft')
    RETURNING *
  `))
  return sheet
}

/**
 * Get takeoff sheets for project
 */
export async function getProjectTakeoffs(projectId: string, companyId: string) {
  return rows(await db.execute(sql`
    SELECT ts.*,
      (SELECT count(*) FROM takeoff_item ti WHERE ti.sheet_id = ts.id) as item_count
    FROM takeoff_sheet ts
    WHERE ts.project_id = ${projectId} AND ts.company_id = ${companyId}
    ORDER BY ts.created_at DESC
  `))
}

/**
 * Get takeoff sheet with full details
 */
export async function getTakeoffSheet(sheetId: string, companyId: string) {
  const [sheet] = rows(await db.execute(sql`
    SELECT ts.*, json_build_object('id', p.id, 'name', p.name) as project
    FROM takeoff_sheet ts
    LEFT JOIN project p ON p.id = ts.project_id
    WHERE ts.id = ${sheetId} AND ts.company_id = ${companyId}
  `))
  if (!sheet) return null

  sheet.items = rows(await db.execute(sql`
    SELECT ti.*, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.sheet_id = ${sheetId}
    ORDER BY ti.sort_order ASC
  `))

  for (const item of sheet.items) {
    item.calculatedMaterials = rows(await db.execute(sql`
      SELECT * FROM takeoff_calculated_material WHERE item_id = ${item.id}
    `))
  }

  return sheet
}

// ============================================
// TAKEOFF ITEMS (Measurements)
// ============================================

/**
 * Add measurement to takeoff sheet
 */
export async function addTakeoffItem(sheetId: string, companyId: string, data: any) {
  const assembly = await getAssembly(data.assemblyId, companyId)
  if (!assembly) throw new Error('Assembly not found')

  const measurementValue = calculateMeasurement(data, assembly.measurement_type)

  const [item] = rows(await db.execute(sql`
    INSERT INTO takeoff_item (sheet_id, assembly_id, name, location, measurement_type, length, width, height, quantity, measurement_value, waste_factor, notes, sort_order)
    VALUES (${sheetId}, ${data.assemblyId}, ${data.name || assembly.name}, ${data.location || null}, ${assembly.measurement_type}, ${data.length || 0}, ${data.width || 0}, ${data.height || 0}, ${data.quantity || 1}, ${measurementValue}, ${data.wasteFactor ?? assembly.waste_factor}, ${data.notes || null}, ${data.sortOrder || 0})
    RETURNING *
  `))

  await calculateItemMaterials(item.id, companyId)

  return getTakeoffItem(item.id)
}

/**
 * Calculate measurement value based on type
 */
function calculateMeasurement(data: any, measurementType: string): number {
  switch (measurementType) {
    case 'area':
      return (data.length || 0) * (data.width || 0)
    case 'linear':
      return data.length || 0
    case 'count':
      return data.quantity || 1
    case 'volume':
      return (data.length || 0) * (data.width || 0) * (data.height || 0)
    default:
      return data.quantity || 0
  }
}

/**
 * Calculate materials for a takeoff item
 */
async function calculateItemMaterials(itemId: string, companyId: string) {
  const [item] = rows(await db.execute(sql`
    SELECT ti.*, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.id = ${itemId}
  `))

  if (!item) return

  const materials = rows(await db.execute(sql`
    SELECT * FROM assembly_material WHERE assembly_id = ${item.assembly_id}
  `))

  await db.execute(sql`DELETE FROM takeoff_calculated_material WHERE item_id = ${itemId}`)

  const wasteFactor = 1 + (item.waste_factor || 0) / 100

  for (const mat of materials) {
    const baseQuantity = item.measurement_value * mat.quantity_per
    const quantityWithWaste = baseQuantity * wasteFactor
    const roundedQuantity = Math.ceil(quantityWithWaste * 100) / 100

    const totalCost = roundedQuantity * Number(mat.unit_cost || 0)
    const totalPrice = roundedQuantity * Number(mat.unit_price || 0)

    await db.execute(sql`
      INSERT INTO takeoff_calculated_material (item_id, material_name, unit, base_quantity, waste_quantity, total_quantity, unit_cost, unit_price, total_cost, total_price, inventory_item_id)
      VALUES (${itemId}, ${mat.name}, ${mat.unit}, ${baseQuantity}, ${quantityWithWaste - baseQuantity}, ${roundedQuantity}, ${mat.unit_cost}, ${mat.unit_price}, ${totalCost}, ${totalPrice}, ${mat.inventory_item_id})
    `)
  }
}

/**
 * Get takeoff item
 */
async function getTakeoffItem(itemId: string) {
  const [item] = rows(await db.execute(sql`
    SELECT ti.*, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.id = ${itemId}
  `))
  if (!item) return null

  item.calculatedMaterials = rows(await db.execute(sql`
    SELECT * FROM takeoff_calculated_material WHERE item_id = ${itemId}
  `))

  return item
}

/**
 * Update takeoff item
 */
export async function updateTakeoffItem(itemId: string, companyId: string, data: any) {
  const [item] = rows(await db.execute(sql`
    SELECT ti.*, ts.company_id, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.id = ${itemId}
  `))

  if (!item || item.company_id !== companyId) {
    throw new Error('Item not found')
  }

  const merged = { ...item, ...data }
  const measurementValue = calculateMeasurement(merged, item.assembly?.measurement_type || 'area')

  const sets: string[] = [`measurement_value = ${measurementValue}`]
  if (data.length !== undefined) sets.push(`length = ${data.length}`)
  if (data.width !== undefined) sets.push(`width = ${data.width}`)
  if (data.height !== undefined) sets.push(`height = ${data.height}`)
  if (data.quantity !== undefined) sets.push(`quantity = ${data.quantity}`)
  if (data.name !== undefined) sets.push(`name = '${data.name}'`)
  if (data.location !== undefined) sets.push(`location = '${data.location}'`)
  if (data.notes !== undefined) sets.push(`notes = '${data.notes}'`)
  if (data.wasteFactor !== undefined) sets.push(`waste_factor = ${data.wasteFactor}`)

  await db.execute(sql.raw(`UPDATE takeoff_item SET ${sets.join(', ')} WHERE id = '${itemId}'`))
  await calculateItemMaterials(itemId, companyId)

  return getTakeoffItem(itemId)
}

/**
 * Delete takeoff item
 */
export async function deleteTakeoffItem(itemId: string, companyId: string) {
  const [item] = rows(await db.execute(sql`
    SELECT ti.id, ts.company_id
    FROM takeoff_item ti
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    WHERE ti.id = ${itemId}
  `))

  if (!item || item.company_id !== companyId) {
    throw new Error('Item not found')
  }

  await db.execute(sql`DELETE FROM takeoff_calculated_material WHERE item_id = ${itemId}`)
  await db.execute(sql`DELETE FROM takeoff_item WHERE id = ${itemId}`)
}

// ============================================
// TOTALS AND SUMMARIES
// ============================================

/**
 * Get material totals for a takeoff sheet
 */
export async function getSheetMaterialTotals(sheetId: string, companyId: string) {
  const [sheet] = rows(await db.execute(sql`
    SELECT * FROM takeoff_sheet WHERE id = ${sheetId} AND company_id = ${companyId}
  `))
  if (!sheet) throw new Error('Sheet not found')

  const allMaterials = rows(await db.execute(sql`
    SELECT tcm.*
    FROM takeoff_calculated_material tcm
    JOIN takeoff_item ti ON ti.id = tcm.item_id
    WHERE ti.sheet_id = ${sheetId}
  `))

  return aggregateMaterials(allMaterials)
}

/**
 * Get material totals for entire project
 */
export async function getProjectMaterialTotals(projectId: string, companyId: string) {
  const allMaterials = rows(await db.execute(sql`
    SELECT tcm.*
    FROM takeoff_calculated_material tcm
    JOIN takeoff_item ti ON ti.id = tcm.item_id
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    WHERE ts.project_id = ${projectId} AND ts.company_id = ${companyId}
  `))

  return aggregateMaterials(allMaterials)
}

function aggregateMaterials(allMaterials: any[]) {
  const materialTotals: Record<string, any> = {}

  for (const mat of allMaterials) {
    const key = mat.material_name
    if (!materialTotals[key]) {
      materialTotals[key] = {
        name: mat.material_name,
        unit: mat.unit,
        totalQuantity: 0,
        totalCost: 0,
        totalPrice: 0,
        inventoryItemId: mat.inventory_item_id,
      }
    }
    materialTotals[key].totalQuantity += Number(mat.total_quantity)
    materialTotals[key].totalCost += Number(mat.total_cost)
    materialTotals[key].totalPrice += Number(mat.total_price)
  }

  const materials = Object.values(materialTotals).map((m: any) => ({
    ...m,
    totalQuantity: Math.ceil(m.totalQuantity * 100) / 100,
    totalCost: Math.round(m.totalCost * 100) / 100,
    totalPrice: Math.round(m.totalPrice * 100) / 100,
  }))

  return {
    materials: materials.sort((a: any, b: any) => a.name.localeCompare(b.name)),
    totals: {
      totalCost: materials.reduce((sum: number, m: any) => sum + m.totalCost, 0),
      totalPrice: materials.reduce((sum: number, m: any) => sum + m.totalPrice, 0),
      materialCount: materials.length,
    },
  }
}

/**
 * Export materials to purchase order
 */
export async function exportToPurchaseOrder(sheetId: string, companyId: string, { vendorId }: { vendorId: string }) {
  const { materials, totals } = await getSheetMaterialTotals(sheetId, companyId)

  const [sheet] = rows(await db.execute(sql`
    SELECT ts.*, p.name as project_name FROM takeoff_sheet ts LEFT JOIN project p ON p.id = ts.project_id WHERE ts.id = ${sheetId} AND ts.company_id = ${companyId}
  `))

  // Create purchase order - schema requires locationId and vendor as string
  const [po] = await db
    .insert(purchaseOrder)
    .values({
      companyId,
      number: `PO-TK-${Date.now()}`,
      vendor: vendorId,
      status: 'draft',
      notes: `Generated from takeoff: ${sheet.name}`,
      total: String(totals.totalCost),
      locationId: vendorId, // placeholder - should be a location ID
    })
    .returning()

  for (const mat of materials) {
    if (mat.inventoryItemId) {
      await db.insert(purchaseOrderItem).values({
        purchaseOrderId: po.id,
        itemId: mat.inventoryItemId,
        quantity: Math.ceil(mat.totalQuantity),
        unitCost: String(mat.totalCost / mat.totalQuantity),
        totalCost: String(mat.totalCost),
      })
    }
  }

  return po
}

export default {
  MEASUREMENT_TYPES,
  createAssembly,
  getAssembly,
  getAssemblies,
  updateAssembly,
  seedDefaultAssemblies,
  createTakeoffSheet,
  getProjectTakeoffs,
  getTakeoffSheet,
  addTakeoffItem,
  updateTakeoffItem,
  deleteTakeoffItem,
  getSheetMaterialTotals,
  getProjectMaterialTotals,
  exportToPurchaseOrder,
}
