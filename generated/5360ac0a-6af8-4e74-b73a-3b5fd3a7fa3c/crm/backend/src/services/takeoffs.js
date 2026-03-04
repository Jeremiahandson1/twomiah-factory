/**
 * Material Takeoff Service
 * 
 * Calculate material quantities from plans:
 * - Assembly definitions (framing, drywall, etc.)
 * - Measurement types (area, linear, count)
 * - Takeoff sheets per project
 * - Link to estimates and budgets
 * - Waste factor calculations
 * - Export to purchase orders
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Measurement types
const MEASUREMENT_TYPES = {
  AREA: 'area',           // Square feet
  LINEAR: 'linear',       // Linear feet
  COUNT: 'count',         // Quantity/each
  VOLUME: 'volume',       // Cubic feet/yards
  BOARD_FEET: 'board_feet',
};

// ============================================
// ASSEMBLIES (Material Templates)
// ============================================

/**
 * Create assembly template
 * An assembly is a predefined collection of materials for a type of work
 * e.g., "Interior Wall Framing" includes studs, plates, nails per linear foot
 */
export async function createAssembly(companyId, data) {
  const assembly = await prisma.takeoffAssembly.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      category: data.category, // framing, drywall, electrical, plumbing, roofing, etc.
      measurementType: data.measurementType || 'area',
      
      // Default waste factor (percentage)
      wasteFactor: data.wasteFactor || 10,
      
      active: true,
    },
  });

  // Add materials to assembly
  if (data.materials?.length) {
    for (const mat of data.materials) {
      await prisma.assemblyMaterial.create({
        data: {
          assemblyId: assembly.id,
          name: mat.name,
          description: mat.description,
          
          // Quantity per unit of measurement
          // e.g., for wall framing: 1 stud per 16" = 0.75 studs per linear foot
          quantityPer: mat.quantityPer || 1,
          unit: mat.unit || 'each',
          
          // Pricing
          unitCost: mat.unitCost || 0,
          unitPrice: mat.unitPrice || 0,
          
          // Link to inventory item if available
          inventoryItemId: mat.inventoryItemId,
        },
      });
    }
  }

  return getAssembly(assembly.id, companyId);
}

/**
 * Get assembly with materials
 */
export async function getAssembly(assemblyId, companyId) {
  return prisma.takeoffAssembly.findFirst({
    where: { id: assemblyId, companyId },
    include: {
      materials: {
        include: {
          inventoryItem: { select: { id: true, name: true, sku: true, unitCost: true } },
        },
      },
    },
  });
}

/**
 * Get all assemblies
 */
export async function getAssemblies(companyId, { category, active = true } = {}) {
  return prisma.takeoffAssembly.findMany({
    where: {
      companyId,
      ...(category ? { category } : {}),
      ...(active !== null ? { active } : {}),
    },
    include: {
      materials: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Update assembly
 */
export async function updateAssembly(assemblyId, companyId, data) {
  return prisma.takeoffAssembly.updateMany({
    where: { id: assemblyId, companyId },
    data,
  });
}

/**
 * Seed common assemblies
 */
export async function seedDefaultAssemblies(companyId) {
  const defaults = [
    {
      name: 'Interior Wall Framing (2x4)',
      category: 'framing',
      measurementType: 'linear',
      wasteFactor: 10,
      materials: [
        { name: '2x4x8 Stud', quantityPer: 0.75, unit: 'each', unitCost: 4.50 },
        { name: '2x4x10 Plate', quantityPer: 0.25, unit: 'each', unitCost: 5.50 },
        { name: '16d Framing Nails', quantityPer: 0.5, unit: 'lb', unitCost: 3.00 },
      ],
    },
    {
      name: 'Drywall (1/2")',
      category: 'drywall',
      measurementType: 'area',
      wasteFactor: 12,
      materials: [
        { name: '1/2" Drywall 4x8', quantityPer: 0.03125, unit: 'sheet', unitCost: 12.00 },
        { name: 'Drywall Screws', quantityPer: 0.05, unit: 'lb', unitCost: 8.00 },
        { name: 'Joint Compound', quantityPer: 0.01, unit: 'bucket', unitCost: 15.00 },
        { name: 'Drywall Tape', quantityPer: 0.1, unit: 'roll', unitCost: 4.00 },
      ],
    },
    {
      name: 'Asphalt Shingles',
      category: 'roofing',
      measurementType: 'area',
      wasteFactor: 15,
      materials: [
        { name: 'Architectural Shingles', quantityPer: 0.01, unit: 'bundle', unitCost: 35.00 },
        { name: 'Roofing Felt (15#)', quantityPer: 0.005, unit: 'roll', unitCost: 20.00 },
        { name: 'Roofing Nails', quantityPer: 0.02, unit: 'lb', unitCost: 4.00 },
        { name: 'Drip Edge', quantityPer: 0.1, unit: 'piece', unitCost: 8.00 },
      ],
    },
    {
      name: 'Concrete Slab (4")',
      category: 'concrete',
      measurementType: 'area',
      wasteFactor: 5,
      materials: [
        { name: 'Ready Mix Concrete', quantityPer: 0.0123, unit: 'yard', unitCost: 150.00 },
        { name: 'Wire Mesh 6x6', quantityPer: 0.01, unit: 'sheet', unitCost: 45.00 },
        { name: 'Rebar #4', quantityPer: 0.25, unit: 'piece', unitCost: 8.00 },
        { name: 'Vapor Barrier', quantityPer: 0.01, unit: 'roll', unitCost: 75.00 },
      ],
    },
    {
      name: 'Interior Paint',
      category: 'paint',
      measurementType: 'area',
      wasteFactor: 10,
      materials: [
        { name: 'Interior Latex Paint', quantityPer: 0.003, unit: 'gallon', unitCost: 35.00 },
        { name: 'Primer', quantityPer: 0.002, unit: 'gallon', unitCost: 25.00 },
      ],
    },
  ];

  for (const assembly of defaults) {
    const existing = await prisma.takeoffAssembly.findFirst({
      where: { companyId, name: assembly.name },
    });
    
    if (!existing) {
      await createAssembly(companyId, assembly);
    }
  }
}

// ============================================
// TAKEOFF SHEETS
// ============================================

/**
 * Create takeoff sheet for project
 */
export async function createTakeoffSheet(companyId, data) {
  return prisma.takeoffSheet.create({
    data: {
      companyId,
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      
      // Reference document
      planReference: data.planReference, // Page number, drawing name, etc.
      planUrl: data.planUrl, // Link to uploaded plan
      
      status: 'draft', // draft, complete, approved
    },
    include: {
      items: true,
    },
  });
}

/**
 * Get takeoff sheets for project
 */
export async function getProjectTakeoffs(projectId, companyId) {
  return prisma.takeoffSheet.findMany({
    where: { projectId, companyId },
    include: {
      items: {
        include: {
          assembly: { select: { name: true, category: true } },
        },
      },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get takeoff sheet with full details
 */
export async function getTakeoffSheet(sheetId, companyId) {
  return prisma.takeoffSheet.findFirst({
    where: { id: sheetId, companyId },
    include: {
      items: {
        include: {
          assembly: {
            include: { materials: true },
          },
          calculatedMaterials: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      project: { select: { id: true, name: true } },
    },
  });
}

// ============================================
// TAKEOFF ITEMS (Measurements)
// ============================================

/**
 * Add measurement to takeoff sheet
 */
export async function addTakeoffItem(sheetId, companyId, data) {
  // Get assembly for calculations
  const assembly = await getAssembly(data.assemblyId, companyId);
  if (!assembly) throw new Error('Assembly not found');

  // Create takeoff item
  const item = await prisma.takeoffItem.create({
    data: {
      sheetId,
      assemblyId: data.assemblyId,
      
      name: data.name || assembly.name,
      location: data.location, // "Living Room", "Master Bedroom", etc.
      
      // Measurements
      measurementType: assembly.measurementType,
      
      // For area: length x width
      // For linear: just length
      // For count: just quantity
      length: data.length || 0,
      width: data.width || 0,
      height: data.height || 0,
      quantity: data.quantity || 1,
      
      // Calculate measurement value
      measurementValue: calculateMeasurement(data, assembly.measurementType),
      
      // Override waste factor if needed
      wasteFactor: data.wasteFactor ?? assembly.wasteFactor,
      
      notes: data.notes,
      sortOrder: data.sortOrder || 0,
    },
  });

  // Calculate materials for this item
  await calculateItemMaterials(item.id, companyId);

  return getTakeoffItem(item.id);
}

/**
 * Calculate measurement value based on type
 */
function calculateMeasurement(data, measurementType) {
  switch (measurementType) {
    case 'area':
      return (data.length || 0) * (data.width || 0);
    case 'linear':
      return data.length || 0;
    case 'count':
      return data.quantity || 1;
    case 'volume':
      return (data.length || 0) * (data.width || 0) * (data.height || 0);
    default:
      return data.quantity || 0;
  }
}

/**
 * Calculate materials for a takeoff item
 */
async function calculateItemMaterials(itemId, companyId) {
  const item = await prisma.takeoffItem.findUnique({
    where: { id: itemId },
    include: {
      assembly: { include: { materials: true } },
    },
  });

  if (!item) return;

  // Clear existing calculations
  await prisma.takeoffCalculatedMaterial.deleteMany({
    where: { itemId },
  });

  // Calculate each material
  const wasteFactor = 1 + (item.wasteFactor || 0) / 100;

  for (const mat of item.assembly.materials) {
    const baseQuantity = item.measurementValue * mat.quantityPer;
    const quantityWithWaste = baseQuantity * wasteFactor;
    const roundedQuantity = Math.ceil(quantityWithWaste * 100) / 100;
    
    const totalCost = roundedQuantity * Number(mat.unitCost || 0);
    const totalPrice = roundedQuantity * Number(mat.unitPrice || 0);

    await prisma.takeoffCalculatedMaterial.create({
      data: {
        itemId,
        materialName: mat.name,
        unit: mat.unit,
        
        baseQuantity,
        wasteQuantity: quantityWithWaste - baseQuantity,
        totalQuantity: roundedQuantity,
        
        unitCost: mat.unitCost,
        unitPrice: mat.unitPrice,
        totalCost,
        totalPrice,
        
        inventoryItemId: mat.inventoryItemId,
      },
    });
  }
}

/**
 * Get takeoff item
 */
async function getTakeoffItem(itemId) {
  return prisma.takeoffItem.findUnique({
    where: { id: itemId },
    include: {
      assembly: true,
      calculatedMaterials: true,
    },
  });
}

/**
 * Update takeoff item
 */
export async function updateTakeoffItem(itemId, companyId, data) {
  const item = await prisma.takeoffItem.findUnique({
    where: { id: itemId },
    include: { sheet: true, assembly: true },
  });

  if (!item || item.sheet.companyId !== companyId) {
    throw new Error('Item not found');
  }

  const measurementValue = calculateMeasurement(
    { ...item, ...data },
    item.assembly.measurementType
  );

  await prisma.takeoffItem.update({
    where: { id: itemId },
    data: {
      ...data,
      measurementValue,
    },
  });

  // Recalculate materials
  await calculateItemMaterials(itemId, companyId);

  return getTakeoffItem(itemId);
}

/**
 * Delete takeoff item
 */
export async function deleteTakeoffItem(itemId, companyId) {
  const item = await prisma.takeoffItem.findUnique({
    where: { id: itemId },
    include: { sheet: true },
  });

  if (!item || item.sheet.companyId !== companyId) {
    throw new Error('Item not found');
  }

  await prisma.takeoffItem.delete({ where: { id: itemId } });
}

// ============================================
// TOTALS AND SUMMARIES
// ============================================

/**
 * Get material totals for a takeoff sheet
 */
export async function getSheetMaterialTotals(sheetId, companyId) {
  const sheet = await prisma.takeoffSheet.findFirst({
    where: { id: sheetId, companyId },
    include: {
      items: {
        include: { calculatedMaterials: true },
      },
    },
  });

  if (!sheet) throw new Error('Sheet not found');

  // Aggregate materials by name
  const materialTotals = {};

  for (const item of sheet.items) {
    for (const mat of item.calculatedMaterials) {
      const key = mat.materialName;
      if (!materialTotals[key]) {
        materialTotals[key] = {
          name: mat.materialName,
          unit: mat.unit,
          totalQuantity: 0,
          totalCost: 0,
          totalPrice: 0,
          inventoryItemId: mat.inventoryItemId,
        };
      }
      materialTotals[key].totalQuantity += Number(mat.totalQuantity);
      materialTotals[key].totalCost += Number(mat.totalCost);
      materialTotals[key].totalPrice += Number(mat.totalPrice);
    }
  }

  // Round quantities
  const materials = Object.values(materialTotals).map(m => ({
    ...m,
    totalQuantity: Math.ceil(m.totalQuantity * 100) / 100,
    totalCost: Math.round(m.totalCost * 100) / 100,
    totalPrice: Math.round(m.totalPrice * 100) / 100,
  }));

  // Calculate grand totals
  const totals = {
    totalCost: materials.reduce((sum, m) => sum + m.totalCost, 0),
    totalPrice: materials.reduce((sum, m) => sum + m.totalPrice, 0),
    materialCount: materials.length,
  };

  return { materials, totals };
}

/**
 * Get material totals for entire project
 */
export async function getProjectMaterialTotals(projectId, companyId) {
  const sheets = await prisma.takeoffSheet.findMany({
    where: { projectId, companyId },
    include: {
      items: {
        include: { calculatedMaterials: true },
      },
    },
  });

  const materialTotals = {};

  for (const sheet of sheets) {
    for (const item of sheet.items) {
      for (const mat of item.calculatedMaterials) {
        const key = mat.materialName;
        if (!materialTotals[key]) {
          materialTotals[key] = {
            name: mat.materialName,
            unit: mat.unit,
            totalQuantity: 0,
            totalCost: 0,
            totalPrice: 0,
            inventoryItemId: mat.inventoryItemId,
          };
        }
        materialTotals[key].totalQuantity += Number(mat.totalQuantity);
        materialTotals[key].totalCost += Number(mat.totalCost);
        materialTotals[key].totalPrice += Number(mat.totalPrice);
      }
    }
  }

  const materials = Object.values(materialTotals).map(m => ({
    ...m,
    totalQuantity: Math.ceil(m.totalQuantity * 100) / 100,
    totalCost: Math.round(m.totalCost * 100) / 100,
    totalPrice: Math.round(m.totalPrice * 100) / 100,
  }));

  return {
    materials: materials.sort((a, b) => a.name.localeCompare(b.name)),
    totals: {
      totalCost: materials.reduce((sum, m) => sum + m.totalCost, 0),
      totalPrice: materials.reduce((sum, m) => sum + m.totalPrice, 0),
      materialCount: materials.length,
    },
  };
}

// ============================================
// EXPORT
// ============================================

/**
 * Export materials to purchase order
 */
export async function exportToPurchaseOrder(sheetId, companyId, { vendorId }) {
  const { materials, totals } = await getSheetMaterialTotals(sheetId, companyId);
  
  const sheet = await prisma.takeoffSheet.findFirst({
    where: { id: sheetId, companyId },
    include: { project: true },
  });

  // Create purchase order
  const po = await prisma.purchaseOrder.create({
    data: {
      companyId,
      projectId: sheet.projectId,
      vendorId,
      
      status: 'draft',
      notes: `Generated from takeoff: ${sheet.name}`,
      
      subtotal: totals.totalCost,
      total: totals.totalCost,
    },
  });

  // Add line items
  for (const mat of materials) {
    await prisma.purchaseOrderItem.create({
      data: {
        purchaseOrderId: po.id,
        inventoryItemId: mat.inventoryItemId,
        
        description: mat.name,
        quantity: mat.totalQuantity,
        unit: mat.unit,
        unitCost: mat.totalCost / mat.totalQuantity,
        total: mat.totalCost,
      },
    });
  }

  return po;
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
};
