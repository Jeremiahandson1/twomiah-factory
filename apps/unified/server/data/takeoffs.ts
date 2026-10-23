// Takeoffs: the raw SQL of the CRM template's services/takeoffs.ts (templates/crm/backend/src/services), one named
// function per statement. Every function returns camelCase rows (RULEBOOK §2); the rows that are joined table rows
// (row_to_json / json_build_object) are camelised inside too, the same NESTED list the template used.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { rowsOf, camelRow, camelRows } from '@twomiah/tenant-backend'

/** Aliases that are table rows, and so are safe to camelise inside. */
const NESTED = ['assembly', 'project', 'inventory_item']

// ── assemblies ───────────────────────────────────────────────────────────────────────────────────

export async function insertAssembly(db: any, companyId: string, data: any) {
  return camelRow(rowsOf(await db.execute(sql`
    INSERT INTO takeoff_assembly (id, company_id, name, description, category, measurement_type, waste_factor, active)
    VALUES (${createId()}, ${companyId}, ${data.name}, ${data.description || null}, ${data.category || null}, ${data.measurementType || 'area'}, ${data.wasteFactor || 10}, true)
    RETURNING *
  `))[0], NESTED)
}

export async function insertAssemblyMaterial(db: any, assemblyId: string, mat: any) {
  await db.execute(sql`
    INSERT INTO assembly_material (id, assembly_id, name, description, quantity_per, unit, unit_cost, unit_price, inventory_item_id)
    VALUES (${createId()}, ${assemblyId}, ${mat.name}, ${mat.description || null}, ${mat.quantityPer || 1}, ${mat.unit || 'each'}, ${mat.unitCost || 0}, ${mat.unitPrice || 0}, ${mat.inventoryItemId || null})
  `)
}

export async function findAssembly(db: any, assemblyId: string, companyId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT * FROM takeoff_assembly WHERE id = ${assemblyId} AND company_id = ${companyId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

/** An assembly's materials with the inventory item each is linked to. */
export async function assemblyMaterialsWithItem(db: any, assemblyId: string) {
  return camelRows(await db.execute(sql`
    SELECT am.*, json_build_object('id', ii.id, 'name', ii.name, 'sku', ii.sku, 'unit_cost', ii.unit_cost) as inventory_item
    FROM assembly_material am
    LEFT JOIN inventory_item ii ON ii.id = am.inventory_item_id
    WHERE am.assembly_id = ${assemblyId}
  `), NESTED)
}

export async function assemblyMaterials(db: any, assemblyId: string) {
  return camelRows(await db.execute(sql`
    SELECT * FROM assembly_material WHERE assembly_id = ${assemblyId}
  `))
}

export async function listAssemblies(db: any, companyId: string, { category, active }: { category?: string; active: boolean | null }) {
  const conditions = [sql`ta.company_id = ${companyId}`]
  if (category) conditions.push(sql`ta.category = ${category}`)
  if (active !== null) conditions.push(sql`ta.active = ${active}`)
  return camelRows(await db.execute(sql`
    SELECT ta.* FROM takeoff_assembly ta WHERE ${sql.join(conditions, sql` AND `)} ORDER BY ta.category ASC, ta.name ASC
  `), NESTED)
}

/** The fields given, and only those; nothing when none are. */
export async function updateAssemblyFields(db: any, assemblyId: string, companyId: string, data: any) {
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const sets: any[] = []
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.category !== undefined) sets.push(sql`category = ${data.category}`)
  if (data.wasteFactor !== undefined) sets.push(sql`waste_factor = ${num(data.wasteFactor)}`)
  if (data.active !== undefined) sets.push(sql`active = ${!!data.active}`)
  if (sets.length === 0) return
  await db.execute(sql`
    UPDATE takeoff_assembly SET ${sql.join(sets, sql`, `)} WHERE id = ${assemblyId} AND company_id = ${companyId}
  `)
}

/**
 * The prices on an assembly's materials — what each unit costs the company (unit_cost) and what the customer is charged
 * for it (unit_price). Only rows of THIS assembly, and only when the assembly is this company's: assembly_material has
 * no company_id, so it is reached through takeoff_assembly. A field not given is left as it is.
 */
export async function updateAssemblyMaterialPrices(db: any, assemblyId: string, companyId: string, materials: Array<{ id: string; unitCost?: number; unitPrice?: number }>) {
  for (const m of materials) {
    const sets: any[] = []
    if (m.unitCost !== undefined) sets.push(sql`unit_cost = ${m.unitCost}`)
    if (m.unitPrice !== undefined) sets.push(sql`unit_price = ${m.unitPrice}`)
    if (!sets.length) continue
    await db.execute(sql`
      UPDATE assembly_material SET ${sql.join(sets, sql`, `)}
      WHERE id = ${m.id} AND assembly_id = ${assemblyId}
        AND assembly_id IN (SELECT id FROM takeoff_assembly WHERE company_id = ${companyId})
    `)
  }
}

/** The ids of this company's takeoff items measured with an assembly, so their materials can be worked out again. */
export async function itemIdsUsingAssembly(db: any, assemblyId: string, companyId: string): Promise<string[]> {
  return rowsOf(await db.execute(sql`
    SELECT ti.id FROM takeoff_item ti JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    WHERE ti.assembly_id = ${assemblyId} AND ts.company_id = ${companyId}
  `)).map((r: any) => r.id)
}

export async function findAssemblyIdByName(db: any, companyId: string, name: string): Promise<string | null> {
  const row = rowsOf(await db.execute(sql`
    SELECT id FROM takeoff_assembly WHERE company_id = ${companyId} AND name = ${name}
  `))[0]
  return row ? row.id : null
}

// ── sheets ───────────────────────────────────────────────────────────────────────────────────────

export async function insertTakeoffSheet(db: any, companyId: string, data: any) {
  return camelRow(rowsOf(await db.execute(sql`
    INSERT INTO takeoff_sheet (id, company_id, project_id, name, description, plan_reference, plan_url, status)
    VALUES (${createId()}, ${companyId}, ${data.projectId}, ${data.name}, ${data.description || null}, ${data.planReference || null}, ${data.planUrl || null}, 'draft')
    RETURNING *
  `))[0], NESTED)
}

export async function listProjectTakeoffs(db: any, projectId: string, companyId: string) {
  return camelRows(await db.execute(sql`
    SELECT ts.*,
      (SELECT count(*) FROM takeoff_item ti WHERE ti.sheet_id = ts.id) as item_count
    FROM takeoff_sheet ts
    WHERE ts.project_id = ${projectId} AND ts.company_id = ${companyId}
    ORDER BY ts.created_at DESC
  `))
}

/** A sheet with its project's id and name. */
export async function findSheetWithProject(db: any, sheetId: string, companyId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT ts.*, json_build_object('id', p.id, 'name', p.name) as project
    FROM takeoff_sheet ts
    LEFT JOIN project p ON p.id = ts.project_id
    WHERE ts.id = ${sheetId} AND ts.company_id = ${companyId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

export async function findSheet(db: any, sheetId: string, companyId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT * FROM takeoff_sheet WHERE id = ${sheetId} AND company_id = ${companyId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

/** A sheet with its project's name flat on it (projectName), for the purchase order. */
export async function findSheetWithProjectName(db: any, sheetId: string, companyId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT ts.*, p.name as project_name FROM takeoff_sheet ts LEFT JOIN project p ON p.id = ts.project_id WHERE ts.id = ${sheetId} AND ts.company_id = ${companyId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

// ── items ────────────────────────────────────────────────────────────────────────────────────────

/** A sheet's items, each with its assembly, in their order. */
export async function sheetItems(db: any, sheetId: string) {
  return camelRows(await db.execute(sql`
    SELECT ti.*, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.sheet_id = ${sheetId}
    ORDER BY ti.sort_order ASC
  `), NESTED)
}

export async function insertTakeoffItem(db: any, sheetId: string, v: {
  assemblyId: string; name: string; location: string | null; measurementType: string; length: any; width: any; height: any
  quantity: any; measurementValue: number; wasteFactor: any; notes: string | null; sortOrder: any
}) {
  return camelRow(rowsOf(await db.execute(sql`
    INSERT INTO takeoff_item (id, sheet_id, assembly_id, name, location, measurement_type, length, width, height, quantity, measurement_value, waste_factor, notes, sort_order)
    VALUES (${createId()}, ${sheetId}, ${v.assemblyId}, ${v.name}, ${v.location}, ${v.measurementType}, ${v.length}, ${v.width}, ${v.height}, ${v.quantity}, ${v.measurementValue}, ${v.wasteFactor}, ${v.notes}, ${v.sortOrder})
    RETURNING *
  `))[0], NESTED)
}

/** One item with its assembly. */
export async function findItemWithAssembly(db: any, itemId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT ti.*, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.id = ${itemId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

/** One item with its assembly and the company its sheet belongs to (takeoff_item has no company_id). */
export async function findItemWithCompany(db: any, itemId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT ti.*, ts.company_id, row_to_json(ta.*) as assembly
    FROM takeoff_item ti
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    LEFT JOIN takeoff_assembly ta ON ta.id = ti.assembly_id
    WHERE ti.id = ${itemId}
  `))[0]
  return row ? camelRow(row, NESTED) : null
}

/** The item's id and its sheet's company. */
export async function findItemOwner(db: any, itemId: string): Promise<{ id: string; companyId: string } | null> {
  const row = rowsOf(await db.execute(sql`
    SELECT ti.id, ts.company_id
    FROM takeoff_item ti
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    WHERE ti.id = ${itemId}
  `))[0]
  return row ? camelRow(row) : null
}

/**
 * The fields given, plus the recomputed measurement. Scoped through the SHEET, because takeoff_item has no
 * company_id (the template's T32 500-1).
 */
export async function updateTakeoffItemFields(db: any, itemId: string, companyId: string, measurementValue: number, data: any) {
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const sets: any[] = [sql`measurement_value = ${num(measurementValue)}`]
  if (data.length !== undefined) sets.push(sql`length = ${num(data.length)}`)
  if (data.width !== undefined) sets.push(sql`width = ${num(data.width)}`)
  if (data.height !== undefined) sets.push(sql`height = ${num(data.height)}`)
  if (data.quantity !== undefined) sets.push(sql`quantity = ${num(data.quantity)}`)
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.location !== undefined) sets.push(sql`location = ${data.location}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  if (data.wasteFactor !== undefined) sets.push(sql`waste_factor = ${num(data.wasteFactor)}`)
  await db.execute(sql`
    UPDATE takeoff_item SET ${sql.join(sets, sql`, `)}
    WHERE id = ${itemId}
      AND sheet_id IN (SELECT id FROM takeoff_sheet WHERE company_id = ${companyId})
  `)
}

export async function deleteTakeoffItemRow(db: any, itemId: string) {
  await db.execute(sql`DELETE FROM takeoff_item WHERE id = ${itemId}`)
}

// ── calculated materials ─────────────────────────────────────────────────────────────────────────

export async function calculatedMaterials(db: any, itemId: string) {
  return camelRows(await db.execute(sql`
    SELECT * FROM takeoff_calculated_material WHERE item_id = ${itemId}
  `))
}

export async function deleteCalculatedMaterials(db: any, itemId: string) {
  await db.execute(sql`DELETE FROM takeoff_calculated_material WHERE item_id = ${itemId}`)
}

export async function insertCalculatedMaterial(db: any, itemId: string, v: {
  materialName: any; unit: any; baseQuantity: number; wasteQuantity: number; totalQuantity: number
  unitCost: any; unitPrice: any; totalCost: number; totalPrice: number; inventoryItemId: any
}) {
  await db.execute(sql`
    INSERT INTO takeoff_calculated_material (id, item_id, material_name, unit, base_quantity, waste_quantity, total_quantity, unit_cost, unit_price, total_cost, total_price, inventory_item_id)
    VALUES (${createId()}, ${itemId}, ${v.materialName}, ${v.unit}, ${v.baseQuantity}, ${v.wasteQuantity}, ${v.totalQuantity}, ${v.unitCost}, ${v.unitPrice}, ${v.totalCost}, ${v.totalPrice}, ${v.inventoryItemId})
  `)
}

/** Every calculated material on a sheet. */
export async function sheetCalculatedMaterials(db: any, sheetId: string) {
  return camelRows(await db.execute(sql`
    SELECT tcm.*
    FROM takeoff_calculated_material tcm
    JOIN takeoff_item ti ON ti.id = tcm.item_id
    WHERE ti.sheet_id = ${sheetId}
  `))
}

/** Every calculated material on a project's sheets. */
export async function projectCalculatedMaterials(db: any, projectId: string, companyId: string) {
  return camelRows(await db.execute(sql`
    SELECT tcm.*
    FROM takeoff_calculated_material tcm
    JOIN takeoff_item ti ON ti.id = tcm.item_id
    JOIN takeoff_sheet ts ON ts.id = ti.sheet_id
    WHERE ts.project_id = ${projectId} AND ts.company_id = ${companyId}
  `))
}
