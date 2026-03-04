/**
 * Selections Management Service
 * 
 * Let clients choose finishes, fixtures, colors, and options:
 * - Selection categories (Flooring, Cabinets, Countertops, etc.)
 * - Options with pricing (allowances and upgrades)
 * - Client portal for making selections
 * - Approval workflow
 * - Auto-create change orders for upgrades
 * - Deadline tracking
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// SELECTION CATEGORIES
// ============================================

/**
 * Create selection category template
 */
export async function createCategory(companyId, data) {
  return prisma.selectionCategory.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      sortOrder: data.sortOrder || 0,
      icon: data.icon,
      defaultAllowance: data.defaultAllowance || 0,
      active: true,
    },
  });
}

/**
 * Get categories
 */
export async function getCategories(companyId) {
  return prisma.selectionCategory.findMany({
    where: { companyId, active: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Seed default categories
 */
export async function seedDefaultCategories(companyId) {
  const defaults = [
    { name: 'Flooring', icon: 'grid', sortOrder: 1 },
    { name: 'Cabinets', icon: 'cabinet', sortOrder: 2 },
    { name: 'Countertops', icon: 'layers', sortOrder: 3 },
    { name: 'Appliances', icon: 'refrigerator', sortOrder: 4 },
    { name: 'Plumbing Fixtures', icon: 'droplet', sortOrder: 5 },
    { name: 'Lighting', icon: 'lightbulb', sortOrder: 6 },
    { name: 'Hardware', icon: 'door', sortOrder: 7 },
    { name: 'Paint Colors', icon: 'palette', sortOrder: 8 },
    { name: 'Tile', icon: 'square', sortOrder: 9 },
    { name: 'Windows & Doors', icon: 'window', sortOrder: 10 },
  ];

  for (const cat of defaults) {
    await prisma.selectionCategory.upsert({
      where: {
        companyId_name: { companyId, name: cat.name },
      },
      create: { companyId, ...cat, active: true },
      update: {},
    });
  }
}

// ============================================
// SELECTION OPTIONS (Product Library)
// ============================================

/**
 * Create selection option
 */
export async function createOption(companyId, data) {
  return prisma.selectionOption.create({
    data: {
      companyId,
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      manufacturer: data.manufacturer,
      model: data.model,
      sku: data.sku,
      
      // Pricing
      price: data.price || 0,
      cost: data.cost || 0,
      unit: data.unit || 'each', // each, sqft, linear ft, etc.
      
      // Media
      imageUrl: data.imageUrl,
      images: data.images || [], // Multiple images
      specSheet: data.specSheet, // PDF link
      
      // Availability
      leadTimeDays: data.leadTimeDays || 0,
      inStock: data.inStock ?? true,
      
      active: true,
    },
  });
}

/**
 * Get options
 */
export async function getOptions(companyId, { categoryId, search, active = true } = {}) {
  const where = { companyId };
  if (categoryId) where.categoryId = categoryId;
  if (active !== null) where.active = active;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { manufacturer: { contains: search, mode: 'insensitive' } },
      { model: { contains: search, mode: 'insensitive' } },
    ];
  }

  return prisma.selectionOption.findMany({
    where,
    include: { category: { select: { name: true } } },
    orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
}

// ============================================
// PROJECT SELECTIONS
// ============================================

/**
 * Create selection requirement for a project
 */
export async function createProjectSelection(companyId, data) {
  return prisma.projectSelection.create({
    data: {
      companyId,
      projectId: data.projectId,
      categoryId: data.categoryId,
      
      name: data.name,
      description: data.description,
      location: data.location, // "Master Bath", "Kitchen", etc.
      
      // Budget
      allowance: data.allowance || 0, // Included in contract
      quantity: data.quantity || 1,
      unit: data.unit || 'each',
      
      // Deadline
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      
      // Status
      status: 'pending', // pending, selected, approved, ordered, received
      
      // Options available for this selection
      availableOptions: data.optionIds || [],
    },
    include: {
      category: true,
    },
  });
}

/**
 * Get project selections
 */
export async function getProjectSelections(projectId, companyId) {
  const selections = await prisma.projectSelection.findMany({
    where: { projectId, companyId },
    include: {
      category: true,
      selectedOption: true,
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { location: 'asc' }],
  });

  // Calculate upgrade/credit for each
  return selections.map(sel => {
    let priceDiff = 0;
    if (sel.selectedOption) {
      const totalPrice = sel.selectedOption.price * sel.quantity;
      priceDiff = totalPrice - sel.allowance;
    }
    return {
      ...sel,
      priceDifference: priceDiff,
      isUpgrade: priceDiff > 0,
      isCredit: priceDiff < 0,
    };
  });
}

/**
 * Get selections summary for a project
 */
export async function getSelectionsSummary(projectId, companyId) {
  const selections = await getProjectSelections(projectId, companyId);

  const summary = {
    total: selections.length,
    pending: 0,
    selected: 0,
    approved: 0,
    ordered: 0,
    received: 0,
    totalAllowance: 0,
    totalSelected: 0,
    netDifference: 0,
    overdue: 0,
  };

  const now = new Date();

  for (const sel of selections) {
    summary[sel.status]++;
    summary.totalAllowance += sel.allowance || 0;
    
    if (sel.selectedOption) {
      summary.totalSelected += sel.selectedOption.price * sel.quantity;
    }
    
    summary.netDifference += sel.priceDifference || 0;
    
    if (sel.dueDate && new Date(sel.dueDate) < now && sel.status === 'pending') {
      summary.overdue++;
    }
  }

  return summary;
}

/**
 * Client makes a selection
 */
export async function makeSelection(selectionId, companyId, { optionId, notes, selectedBy }) {
  const selection = await prisma.projectSelection.findFirst({
    where: { id: selectionId, companyId },
    include: { category: true },
  });

  if (!selection) throw new Error('Selection not found');

  const option = await prisma.selectionOption.findUnique({
    where: { id: optionId },
  });

  if (!option) throw new Error('Option not found');

  // Calculate price difference
  const totalPrice = option.price * selection.quantity;
  const priceDiff = totalPrice - (selection.allowance || 0);

  const updated = await prisma.projectSelection.update({
    where: { id: selectionId },
    data: {
      selectedOptionId: optionId,
      status: 'selected',
      selectedAt: new Date(),
      selectedById: selectedBy,
      clientNotes: notes,
      priceDifference: priceDiff,
    },
    include: {
      category: true,
      selectedOption: true,
      project: { select: { id: true, name: true } },
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      companyId,
      entityType: 'selection',
      entityId: selectionId,
      action: 'selected',
      description: `Selected ${option.name} for ${selection.name}`,
      metadata: { optionId, priceDiff },
    },
  });

  return updated;
}

/**
 * Approve selection (creates change order if upgrade)
 */
export async function approveSelection(selectionId, companyId, { approvedBy, createChangeOrder = true }) {
  const selection = await prisma.projectSelection.findFirst({
    where: { id: selectionId, companyId },
    include: {
      selectedOption: true,
      project: true,
      category: true,
    },
  });

  if (!selection) throw new Error('Selection not found');
  if (!selection.selectedOptionId) throw new Error('No option selected');

  // Update status
  await prisma.projectSelection.update({
    where: { id: selectionId },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: approvedBy,
    },
  });

  // Create change order if there's an upgrade
  let changeOrder = null;
  if (createChangeOrder && selection.priceDifference > 0) {
    changeOrder = await prisma.changeOrder.create({
      data: {
        companyId,
        projectId: selection.projectId,
        title: `Selection Upgrade: ${selection.name}`,
        description: `Upgrade from allowance to ${selection.selectedOption.name}\n\nLocation: ${selection.location || 'N/A'}\nQuantity: ${selection.quantity} ${selection.unit}`,
        amount: selection.priceDifference,
        status: 'pending',
        selectionId: selectionId,
      },
    });
  }

  // Credit change order if under allowance
  if (createChangeOrder && selection.priceDifference < 0) {
    changeOrder = await prisma.changeOrder.create({
      data: {
        companyId,
        projectId: selection.projectId,
        title: `Selection Credit: ${selection.name}`,
        description: `Credit for selecting ${selection.selectedOption.name} under allowance`,
        amount: selection.priceDifference, // Negative
        status: 'pending',
        selectionId: selectionId,
      },
    });
  }

  return { selection, changeOrder };
}

/**
 * Mark selection as ordered
 */
export async function markOrdered(selectionId, companyId, { orderedBy, orderNumber, expectedDate }) {
  return prisma.projectSelection.update({
    where: { id: selectionId },
    data: {
      status: 'ordered',
      orderedAt: new Date(),
      orderNumber,
      expectedDelivery: expectedDate ? new Date(expectedDate) : null,
    },
  });
}

/**
 * Mark selection as received
 */
export async function markReceived(selectionId, companyId, { receivedBy, notes }) {
  return prisma.projectSelection.update({
    where: { id: selectionId },
    data: {
      status: 'received',
      receivedAt: new Date(),
      receivedNotes: notes,
    },
  });
}

// ============================================
// CLIENT PORTAL
// ============================================

/**
 * Get selections for client portal
 */
export async function getClientSelections(projectId, contactId) {
  // Verify contact has access to project
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      contactId: contactId,
    },
  });

  if (!project) throw new Error('Access denied');

  const selections = await prisma.projectSelection.findMany({
    where: { projectId },
    include: {
      category: true,
      selectedOption: true,
    },
    orderBy: [{ dueDate: 'asc' }, { category: { sortOrder: 'asc' } }],
  });

  // Get available options for pending selections
  const enriched = await Promise.all(
    selections.map(async (sel) => {
      let options = [];
      if (sel.status === 'pending' || sel.status === 'selected') {
        if (sel.availableOptions?.length > 0) {
          options = await prisma.selectionOption.findMany({
            where: { id: { in: sel.availableOptions } },
          });
        } else {
          // Show all options in category
          options = await prisma.selectionOption.findMany({
            where: { categoryId: sel.categoryId, active: true },
            take: 50,
          });
        }
      }

      return {
        ...sel,
        availableOptionsList: options.map(opt => ({
          ...opt,
          totalPrice: opt.price * sel.quantity,
          priceDiff: (opt.price * sel.quantity) - (sel.allowance || 0),
        })),
      };
    })
  );

  return enriched;
}

/**
 * Client submits selection from portal
 */
export async function clientMakeSelection(projectId, selectionId, contactId, { optionId, notes }) {
  // Verify access
  const project = await prisma.project.findFirst({
    where: { id: projectId, contactId },
  });
  if (!project) throw new Error('Access denied');

  const selection = await prisma.projectSelection.findFirst({
    where: { id: selectionId, projectId },
  });
  if (!selection) throw new Error('Selection not found');
  if (selection.status !== 'pending' && selection.status !== 'selected') {
    throw new Error('Selection cannot be changed');
  }

  return makeSelection(selectionId, project.companyId, {
    optionId,
    notes,
    selectedBy: contactId,
  });
}

// ============================================
// REPORTS
// ============================================

/**
 * Get selections due soon
 */
export async function getSelectionsDueSoon(companyId, { days = 7 } = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  return prisma.projectSelection.findMany({
    where: {
      companyId,
      status: 'pending',
      dueDate: { lte: dueDate },
    },
    include: {
      project: { select: { id: true, name: true } },
      category: true,
    },
    orderBy: { dueDate: 'asc' },
  });
}

/**
 * Get overdue selections
 */
export async function getOverdueSelections(companyId) {
  return prisma.projectSelection.findMany({
    where: {
      companyId,
      status: 'pending',
      dueDate: { lt: new Date() },
    },
    include: {
      project: { select: { id: true, name: true, contact: { select: { name: true, email: true } } } },
      category: true,
    },
    orderBy: { dueDate: 'asc' },
  });
}

export default {
  createCategory,
  getCategories,
  seedDefaultCategories,
  createOption,
  getOptions,
  createProjectSelection,
  getProjectSelections,
  getSelectionsSummary,
  makeSelection,
  approveSelection,
  markOrdered,
  markReceived,
  getClientSelections,
  clientMakeSelection,
  getSelectionsDueSoon,
  getOverdueSelections,
};
