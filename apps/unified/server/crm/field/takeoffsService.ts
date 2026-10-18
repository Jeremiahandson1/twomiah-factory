// Material takeoffs: assemblies (material templates), takeoff sheets, measured items and the materials they work out
// to. Moved from the CRM template's services/takeoffs.ts (templates/crm/backend/src/services); its raw SQL is in
// server/data/takeoffs.ts, which answers camelCase, so the arithmetic below reads camelCase names where the template
// read the raw column names (item.measurement_type → item.measurementType). The numbers are the template's.
import { jobPurchaseOrder as purchaseOrder, jobPurchaseOrderLine as purchaseOrderLine } from '../../db/schema/index.ts'
import { nextNumber } from '@twomiah/tenant-backend'
import { notFound } from '../../http/errors.ts'
import * as q from '../../data/takeoffs.ts'
import type { CrmDeps } from '../deps.ts'

export const MEASUREMENT_TYPES = {
  AREA: 'area',
  LINEAR: 'linear',
  COUNT: 'count',
  VOLUME: 'volume',
  BOARD_FEET: 'board_feet',
} as const

/**
 * The measured amount for one line, INCLUDING how many of it there are (the template's T32 B5). `count` is the
 * exception: there the quantity IS the measurement. Quantity defaults to 1.
 */
function calculateMeasurement(data: any, measurementType: string): number {
  const qty = Number(data.quantity) > 0 ? Number(data.quantity) : 1
  switch (measurementType) {
    case 'area':
      return (data.length || 0) * (data.width || 0) * qty
    case 'linear':
      return (data.length || 0) * qty
    case 'count':
      return data.quantity || 1
    case 'volume':
      return (data.length || 0) * (data.width || 0) * (data.height || 0) * qty
    default:
      return data.quantity || 0
  }
}

/**
 * A thing you buy one of, or a measure you buy some of (T32 L8). Anything unrecognised keeps its decimals.
 */
const DISCRETE_UNITS = new Set([
  'each', 'ea', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units',
  'sheet', 'sheets', 'board', 'boards', 'stud', 'studs', 'panel', 'panels',
  'bag', 'bags', 'box', 'boxes', 'roll', 'rolls', 'tube', 'tubes', 'bundle', 'bundles',
  'can', 'cans', 'bucket', 'buckets', 'pail', 'pails',
])
const isDiscreteUnit = (unit: unknown) => DISCRETE_UNITS.has(String(unit || '').trim().toLowerCase())

/**
 * Totals per material. Whole units for anything sold as a thing, two decimals (rounded up) for anything sold by
 * measure; `exactQuantity` beside it (T32 L8).
 */
function aggregateMaterials(allMaterials: any[]) {
  const materialTotals: Record<string, any> = {}
  for (const mat of allMaterials) {
    const key = mat.materialName
    if (!materialTotals[key]) {
      materialTotals[key] = {
        name: mat.materialName,
        unit: mat.unit,
        totalQuantity: 0,
        totalCost: 0,
        totalPrice: 0,
        inventoryItemId: mat.inventoryItemId,
      }
    }
    materialTotals[key].totalQuantity += Number(mat.totalQuantity)
    materialTotals[key].totalCost += Number(mat.totalCost)
    materialTotals[key].totalPrice += Number(mat.totalPrice)
  }

  const materials = Object.values(materialTotals).map((m: any) => {
    const exact = m.totalQuantity
    return {
      ...m,
      totalQuantity: isDiscreteUnit(m.unit) ? Math.ceil(exact) : Math.ceil(exact * 100) / 100,
      exactQuantity: Math.round(exact * 10000) / 10000,
      totalCost: Math.round(m.totalCost * 100) / 100,
      totalPrice: Math.round(m.totalPrice * 100) / 100,
    }
  })

  return {
    materials: materials.sort((a: any, b: any) => a.name.localeCompare(b.name)),
    totals: {
      totalCost: materials.reduce((sum: number, m: any) => sum + m.totalCost, 0),
      totalPrice: materials.reduce((sum: number, m: any) => sum + m.totalPrice, 0),
      materialCount: materials.length,
    },
  }
}

export function createTakeoffsService(d: CrmDeps) {
  const { db } = d

  // ── assemblies ─────────────────────────────────────────────────────────────────────────────────

  async function getAssembly(assemblyId: string, companyId: string) {
    const assembly = await q.findAssembly(db, assemblyId, companyId)
    if (!assembly) return null
    assembly.materials = await q.assemblyMaterialsWithItem(db, assemblyId)
    return assembly
  }

  async function createAssembly(companyId: string, data: any) {
    const assembly = await q.insertAssembly(db, companyId, data)
    if (data.materials?.length) {
      for (const mat of data.materials) await q.insertAssemblyMaterial(db, assembly.id, mat)
    }
    return getAssembly(assembly.id, companyId)
  }

  async function getAssemblies(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
    const assemblies = await q.listAssemblies(db, companyId, { category, active })
    for (const assembly of assemblies) assembly.materials = await q.assemblyMaterials(db, assembly.id)
    return assemblies
  }

  async function updateAssembly(assemblyId: string, companyId: string, data: any) {
    await q.updateAssemblyFields(db, assemblyId, companyId, data)
  }

  async function seedDefaultAssemblies(companyId: string) {
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
      if (!(await q.findAssemblyIdByName(db, companyId, assembly.name))) await createAssembly(companyId, assembly)
    }
  }

  // ── sheets ─────────────────────────────────────────────────────────────────────────────────────

  const createTakeoffSheet = (companyId: string, data: any) => q.insertTakeoffSheet(db, companyId, data)
  const getProjectTakeoffs = (projectId: string, companyId: string) => q.listProjectTakeoffs(db, projectId, companyId)

  async function getTakeoffSheet(sheetId: string, companyId: string) {
    const sheet = await q.findSheetWithProject(db, sheetId, companyId)
    if (!sheet) return null
    sheet.items = await q.sheetItems(db, sheetId)
    for (const item of sheet.items) item.calculatedMaterials = await q.calculatedMaterials(db, item.id)
    return sheet
  }

  // ── items ──────────────────────────────────────────────────────────────────────────────────────

  /** Work out an item's materials from its assembly; the measurement is stored, not the order (T32 L8). */
  async function calculateItemMaterials(itemId: string) {
    const item = await q.findItemWithAssembly(db, itemId)
    if (!item) return
    const materials = await q.assemblyMaterials(db, item.assemblyId)
    await q.deleteCalculatedMaterials(db, itemId)

    const wasteFactor = 1 + (item.wasteFactor || 0) / 100
    for (const mat of materials) {
      const baseQuantity = item.measurementValue * mat.quantityPer
      const quantityWithWaste = baseQuantity * wasteFactor
      const measured = Math.round(quantityWithWaste * 10000) / 10000
      const totalCost = measured * Number(mat.unitCost || 0)
      const totalPrice = measured * Number(mat.unitPrice || 0)
      await q.insertCalculatedMaterial(db, itemId, {
        materialName: mat.name, unit: mat.unit, baseQuantity, wasteQuantity: quantityWithWaste - baseQuantity,
        totalQuantity: measured, unitCost: mat.unitCost, unitPrice: mat.unitPrice, totalCost, totalPrice,
        inventoryItemId: mat.inventoryItemId,
      })
    }
  }

  async function getTakeoffItem(itemId: string) {
    const item = await q.findItemWithAssembly(db, itemId)
    if (!item) return null
    item.calculatedMaterials = await q.calculatedMaterials(db, itemId)
    return item
  }

  async function addTakeoffItem(sheetId: string, companyId: string, data: any) {
    const assembly = await getAssembly(data.assemblyId, companyId)
    if (!assembly) throw notFound('Assembly not found')
    const measurementValue = calculateMeasurement(data, assembly.measurementType)
    const item = await q.insertTakeoffItem(db, sheetId, {
      assemblyId: data.assemblyId, name: data.name || assembly.name, location: data.location || null,
      measurementType: assembly.measurementType, length: data.length || 0, width: data.width || 0, height: data.height || 0,
      quantity: data.quantity || 1, measurementValue, wasteFactor: data.wasteFactor ?? assembly.wasteFactor,
      notes: data.notes || null, sortOrder: data.sortOrder || 0,
    })
    await calculateItemMaterials(item.id)
    return getTakeoffItem(item.id)
  }

  async function updateTakeoffItem(itemId: string, companyId: string, data: any) {
    const item = await q.findItemWithCompany(db, itemId)
    if (!item || item.companyId !== companyId) throw notFound('Item not found')
    const merged = { ...item, ...data }
    const measurementValue = calculateMeasurement(merged, item.assembly?.measurementType || 'area')
    await q.updateTakeoffItemFields(db, itemId, companyId, measurementValue, data)
    await calculateItemMaterials(itemId)
    return getTakeoffItem(itemId)
  }

  async function deleteTakeoffItem(itemId: string, companyId: string) {
    const item = await q.findItemOwner(db, itemId)
    if (!item || item.companyId !== companyId) throw notFound('Item not found')
    await q.deleteCalculatedMaterials(db, itemId)
    await q.deleteTakeoffItemRow(db, itemId)
  }

  // ── totals ─────────────────────────────────────────────────────────────────────────────────────

  async function getSheetMaterialTotals(sheetId: string, companyId: string) {
    const sheet = await q.findSheet(db, sheetId, companyId)
    if (!sheet) throw notFound('Sheet not found')
    return aggregateMaterials(await q.sheetCalculatedMaterials(db, sheetId))
  }

  async function getProjectMaterialTotals(projectId: string, companyId: string) {
    return aggregateMaterials(await q.projectCalculatedMaterials(db, projectId, companyId))
  }

  /**
   * A JOB purchase order (the one the Purchase Orders screen, the vendor portal and the commitment total read), as a
   * draft, numbered in the PO-00001 sequence inside its insert's transaction; lines priced at the order quantity with
   * the unit cost rounded first, so quantity × unitCost is the line total (T32 L8, T58k).
   */
  async function exportToPurchaseOrder(sheetId: string, companyId: string, { vendorId }: { vendorId: string }) {
    const { materials } = await getSheetMaterialTotals(sheetId, companyId)
    const sheet = await q.findSheetWithProjectName(db, sheetId, companyId)

    const lines = materials.map((m: any, i: number) => {
      const unitCost = Math.round((m.exactQuantity > 0 ? m.totalCost / m.exactQuantity : 0) * 100) / 100
      const quantity = m.totalQuantity
      return {
        description: `${m.name}${m.unit ? ` (${m.unit})` : ''}`,
        quantity: String(quantity),
        unitCost: unitCost.toFixed(2),
        total: (quantity * unitCost).toFixed(2),
        sortOrder: i,
      }
    })
    const subtotal = lines.reduce((s: number, l: any) => s + Number(l.total), 0)

    const po = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, purchaseOrder, purchaseOrder.number, purchaseOrder.companyId, companyId, { prefix: 'PO', pad: 5 })
      const [row] = await tx.insert(purchaseOrder).values({
        companyId,
        number,
        vendorId,
        projectId: sheet.projectId || null,
        status: 'draft',
        notes: `Generated from takeoff: ${sheet.name}`,
        subtotal: subtotal.toFixed(2),
        taxRate: '0',
        taxAmount: '0.00',
        total: subtotal.toFixed(2),
      }).returning()
      if (lines.length) {
        await tx.insert(purchaseOrderLine).values(lines.map((l: any) => ({ ...l, purchaseOrderId: row.id })))
      }
      return row
    })

    return { ...po, lines }
  }

  return {
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
}

export type TakeoffsService = ReturnType<typeof createTakeoffsService>
