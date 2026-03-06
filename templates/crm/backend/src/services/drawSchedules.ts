/**
 * Draw Schedules Service (Drizzle)
 *
 * AIA-style progress billing for construction loans:
 * - Schedule of Values (SOV)
 * - Draw requests with percent complete
 * - Retainage tracking
 * - G702/G703 document generation
 *
 * NOTE: scheduleOfValues, sOVLineItem, drawRequest, drawLineItem tables are
 * not in the current Drizzle schema. This uses raw SQL for those tables.
 * Add them to db/schema.ts for full query-builder support.
 */

import { db } from '../../db/index.ts';
import { project } from '../../db/schema.ts';
import { eq, and, sql } from 'drizzle-orm';

// ============================================
// SCHEDULE OF VALUES (SOV)
// ============================================

/**
 * Create Schedule of Values for a project
 */
export async function createScheduleOfValues(companyId: string, projectId: string, data: {
  contractAmount: number;
  retainagePercent?: number;
  lineItems: Array<{
    itemNumber?: string;
    description: string;
    scheduledValue: number;
  }>;
}) {
  // Verify project
  const [proj] = await db.select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.companyId, companyId)))
    .limit(1);

  if (!proj) throw new Error('Project not found');

  // Create SOV
  const sovResult = await db.execute(sql`
    INSERT INTO schedule_of_values (id, company_id, project_id, contract_amount, retainage_percent, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${companyId}, ${projectId}, ${data.contractAmount}, ${data.retainagePercent || 10}, 'draft', NOW(), NOW())
    RETURNING *
  `);
  const sov = ((sovResult as any).rows || sovResult)[0];

  // Create line items
  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i];
    await db.execute(sql`
      INSERT INTO sov_line_item (id, company_id, schedule_of_values_id, item_number, description, scheduled_value, sort_order, created_at)
      VALUES (gen_random_uuid(), ${companyId}, ${sov.id}, ${item.itemNumber || String(i + 1).padStart(3, '0')}, ${item.description}, ${item.scheduledValue}, ${i}, NOW())
    `);
  }

  // Fetch the created SOV with line items
  const lineItemsResult = await db.execute(sql`
    SELECT * FROM sov_line_item WHERE schedule_of_values_id = ${sov.id} ORDER BY sort_order ASC
  `);

  return {
    ...sov,
    lineItems: (lineItemsResult as any).rows || lineItemsResult,
  };
}

/**
 * Get Schedule of Values for a project
 */
export async function getScheduleOfValues(projectId: string, companyId: string) {
  const sovResult = await db.execute(sql`
    SELECT * FROM schedule_of_values WHERE project_id = ${projectId} AND company_id = ${companyId} LIMIT 1
  `);
  const sovRows = (sovResult as any).rows || sovResult;
  const sov = sovRows[0];

  if (!sov) return null;

  const lineItemsResult = await db.execute(sql`
    SELECT * FROM sov_line_item WHERE schedule_of_values_id = ${sov.id} ORDER BY sort_order ASC
  `);
  const lineItems = (lineItemsResult as any).rows || lineItemsResult;

  const drawsResult = await db.execute(sql`
    SELECT * FROM draw_request WHERE schedule_of_values_id = ${sov.id} ORDER BY draw_number ASC
  `);
  const draws = (drawsResult as any).rows || drawsResult;

  // Get draw line items for all draws
  for (const draw of draws as any[]) {
    const drawLineItemsResult = await db.execute(sql`
      SELECT * FROM draw_line_item WHERE draw_request_id = ${draw.id}
    `);
    draw.lineItems = (drawLineItemsResult as any).rows || drawLineItemsResult;
  }

  // Calculate totals for each line item
  const lineItemsWithProgress = (lineItems as any[]).map((item: any) => {
    const drawLineItems = (draws as any[]).flatMap((d: any) =>
      (d.lineItems as any[]).filter((li: any) => li.sov_line_item_id === item.id)
    );

    const totalCompleted = drawLineItems.reduce(
      (sum: number, d: any) => sum + Number(d.completed_this_period || 0), 0
    );

    const scheduledValue = Number(item.scheduled_value);
    const percentComplete = scheduledValue > 0 ? (totalCompleted / scheduledValue) * 100 : 0;

    return {
      ...item,
      totalCompleted,
      percentComplete: Math.round(percentComplete * 10) / 10,
      remaining: scheduledValue - totalCompleted,
    };
  });

  const totals = {
    contractAmount: Number(sov.contract_amount),
    totalBilled: lineItemsWithProgress.reduce((sum: number, i: any) => sum + i.totalCompleted, 0),
    totalRemaining: lineItemsWithProgress.reduce((sum: number, i: any) => sum + i.remaining, 0),
    percentComplete: 0,
  };

  totals.percentComplete = totals.contractAmount > 0
    ? Math.round((totals.totalBilled / totals.contractAmount) * 1000) / 10
    : 0;

  return {
    ...sov,
    lineItems: lineItemsWithProgress,
    draws,
    totals,
  };
}

/**
 * Update SOV line item
 */
export async function updateSOVLineItem(lineItemId: string, companyId: string, data: Record<string, unknown>) {
  const sets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    sets.push(`${colName} = '${value}'`);
  }
  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE sov_line_item SET ${sets.join(', ')} WHERE id = '${lineItemId}' AND company_id = '${companyId}'`));
  }
}

/**
 * Add line item to SOV
 */
export async function addSOVLineItem(sovId: string, companyId: string, data: {
  itemNumber?: string;
  description: string;
  scheduledValue: number;
}) {
  // Get current max sort order
  const maxResult = await db.execute(sql`
    SELECT MAX(sort_order)::int as max_order, COUNT(*)::int as cnt FROM sov_line_item WHERE schedule_of_values_id = ${sovId}
  `);
  const maxRow = ((maxResult as any).rows || maxResult)[0];
  const maxOrder = maxRow?.max_order || 0;
  const lineCount = maxRow?.cnt || 0;

  const result = await db.execute(sql`
    INSERT INTO sov_line_item (id, company_id, schedule_of_values_id, item_number, description, scheduled_value, sort_order, created_at)
    VALUES (gen_random_uuid(), ${companyId}, ${sovId}, ${data.itemNumber || String(lineCount + 1).padStart(3, '0')}, ${data.description}, ${data.scheduledValue}, ${maxOrder + 1}, NOW())
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

// ============================================
// DRAW REQUESTS
// ============================================

/**
 * Create a new draw request
 */
export async function createDrawRequest(companyId: string, sovId: string, data: {
  periodFrom?: string;
  periodTo?: string;
  lineItems: Array<{
    sovLineItemId: string;
    completedThisPeriod?: number;
  }>;
}) {
  // Get SOV
  const sovResult = await db.execute(sql`
    SELECT * FROM schedule_of_values WHERE id = ${sovId} AND company_id = ${companyId} LIMIT 1
  `);
  const sov = ((sovResult as any).rows || sovResult)[0];
  if (!sov) throw new Error('Schedule of Values not found');

  // Get next draw number
  const lastDrawResult = await db.execute(sql`
    SELECT draw_number FROM draw_request WHERE schedule_of_values_id = ${sovId} ORDER BY draw_number DESC LIMIT 1
  `);
  const lastDraw = ((lastDrawResult as any).rows || lastDrawResult)[0];
  const nextDrawNumber = (lastDraw?.draw_number || 0) + 1;

  // Create draw
  const drawResult = await db.execute(sql`
    INSERT INTO draw_request (id, company_id, schedule_of_values_id, project_id, draw_number, period_from, period_to, status, gross_amount, retainage_amount, net_amount, created_at, updated_at)
    VALUES (gen_random_uuid(), ${companyId}, ${sovId}, ${sov.project_id}, ${nextDrawNumber},
      ${data.periodFrom ? new Date(data.periodFrom) : null},
      ${data.periodTo ? new Date(data.periodTo) : new Date()},
      'draft', 0, 0, 0, NOW(), NOW())
    RETURNING *
  `);
  const draw = ((drawResult as any).rows || drawResult)[0];

  // Create draw line items
  for (const item of data.lineItems) {
    await db.execute(sql`
      INSERT INTO draw_line_item (id, company_id, draw_request_id, sov_line_item_id, completed_this_period, created_at)
      VALUES (gen_random_uuid(), ${companyId}, ${draw.id}, ${item.sovLineItemId}, ${item.completedThisPeriod || 0}, NOW())
    `);
  }

  // Calculate totals
  const totals = calculateDrawTotals(data.lineItems, Number(sov.retainage_percent));

  // Update draw with totals
  await db.execute(sql`
    UPDATE draw_request SET gross_amount = ${totals.grossAmount}, retainage_amount = ${totals.retainageAmount}, net_amount = ${totals.netAmount}
    WHERE id = ${draw.id}
  `);

  return { ...draw, ...totals };
}

/**
 * Update draw request line items
 */
export async function updateDrawRequest(drawId: string, companyId: string, data: {
  periodFrom?: string;
  periodTo?: string;
  lineItems?: Array<{ id: string; completedThisPeriod: number }>;
}) {
  const drawResult = await db.execute(sql`
    SELECT dr.*, sov.retainage_percent
    FROM draw_request dr
    JOIN schedule_of_values sov ON dr.schedule_of_values_id = sov.id
    WHERE dr.id = ${drawId} AND dr.company_id = ${companyId}
    LIMIT 1
  `);
  const draw = ((drawResult as any).rows || drawResult)[0];
  if (!draw) throw new Error('Draw request not found');
  if (draw.status === 'approved') throw new Error('Cannot modify approved draw');

  // Update line items
  for (const item of data.lineItems || []) {
    await db.execute(sql`
      UPDATE draw_line_item SET completed_this_period = ${item.completedThisPeriod}
      WHERE id = ${item.id} AND company_id = ${companyId}
    `);
  }

  // Recalculate totals
  const lineItemsResult = await db.execute(sql`
    SELECT * FROM draw_line_item WHERE draw_request_id = ${drawId}
  `);
  const lineItems = ((lineItemsResult as any).rows || lineItemsResult) as any[];
  const totals = calculateDrawTotals(
    lineItems.map((li: any) => ({ completedThisPeriod: Number(li.completed_this_period) })),
    Number(draw.retainage_percent),
  );

  await db.execute(sql`
    UPDATE draw_request SET
      gross_amount = ${totals.grossAmount},
      retainage_amount = ${totals.retainageAmount},
      net_amount = ${totals.netAmount},
      period_from = ${data.periodFrom ? new Date(data.periodFrom) : draw.period_from},
      period_to = ${data.periodTo ? new Date(data.periodTo) : draw.period_to},
      updated_at = NOW()
    WHERE id = ${drawId}
  `);

  return { success: true };
}

/**
 * Calculate draw totals
 */
function calculateDrawTotals(lineItems: Array<{ completedThisPeriod?: number }>, retainagePercent: number) {
  const grossAmount = lineItems.reduce(
    (sum, item) => sum + Number(item.completedThisPeriod || 0), 0
  );

  const retainageRate = Number(retainagePercent || 10) / 100;
  const retainageAmount = grossAmount * retainageRate;
  const netAmount = grossAmount - retainageAmount;

  return {
    grossAmount: Math.round(grossAmount * 100) / 100,
    retainageAmount: Math.round(retainageAmount * 100) / 100,
    netAmount: Math.round(netAmount * 100) / 100,
  };
}

/**
 * Submit draw for approval
 */
export async function submitDrawRequest(drawId: string, companyId: string) {
  const drawResult = await db.execute(sql`
    SELECT id FROM draw_request WHERE id = ${drawId} AND company_id = ${companyId} AND status = 'draft' LIMIT 1
  `);
  const rows = (drawResult as any).rows || drawResult;
  if (rows.length === 0) throw new Error('Draw not found or already submitted');

  const result = await db.execute(sql`
    UPDATE draw_request SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
    WHERE id = ${drawId}
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

/**
 * Approve draw request
 */
export async function approveDrawRequest(drawId: string, companyId: string, { approvedById, notes }: { approvedById: string; notes?: string }) {
  const drawResult = await db.execute(sql`
    SELECT id FROM draw_request WHERE id = ${drawId} AND company_id = ${companyId} AND status = 'submitted' LIMIT 1
  `);
  const rows = (drawResult as any).rows || drawResult;
  if (rows.length === 0) throw new Error('Draw not found or not submitted');

  const result = await db.execute(sql`
    UPDATE draw_request SET status = 'approved', approved_at = NOW(), approved_by_id = ${approvedById}, approval_notes = ${notes || null}, updated_at = NOW()
    WHERE id = ${drawId}
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

/**
 * Reject draw request
 */
export async function rejectDrawRequest(drawId: string, companyId: string, { rejectedById, reason }: { rejectedById: string; reason?: string }) {
  await db.execute(sql`
    UPDATE draw_request SET status = 'rejected', rejected_at = NOW(), rejected_by_id = ${rejectedById}, rejection_reason = ${reason || null}, updated_at = NOW()
    WHERE id = ${drawId} AND company_id = ${companyId}
  `);
}

/**
 * Get all draws for a project
 */
export async function getProjectDraws(projectId: string, companyId: string) {
  const result = await db.execute(sql`
    SELECT dr.*
    FROM draw_request dr
    WHERE dr.project_id = ${projectId} AND dr.company_id = ${companyId}
    ORDER BY dr.draw_number ASC
  `);
  const draws = (result as any).rows || result;

  for (const draw of draws as any[]) {
    const liResult = await db.execute(sql`
      SELECT dli.*, sli.item_number, sli.description as sov_description
      FROM draw_line_item dli
      LEFT JOIN sov_line_item sli ON dli.sov_line_item_id = sli.id
      WHERE dli.draw_request_id = ${draw.id}
    `);
    draw.lineItems = (liResult as any).rows || liResult;
  }

  return draws;
}

/**
 * Get single draw with full details
 */
export async function getDrawRequest(drawId: string, companyId: string) {
  const drawResult = await db.execute(sql`
    SELECT dr.*,
      p.id as project_id_ref, p.name as project_name, p.number as project_number, p.address as project_address
    FROM draw_request dr
    LEFT JOIN project p ON dr.project_id = p.id
    WHERE dr.id = ${drawId} AND dr.company_id = ${companyId}
    LIMIT 1
  `);
  const draw = ((drawResult as any).rows || drawResult)[0];
  if (!draw) return null;

  // Get SOV with line items
  const sovResult = await db.execute(sql`
    SELECT * FROM schedule_of_values WHERE id = ${draw.schedule_of_values_id} LIMIT 1
  `);
  const sov = ((sovResult as any).rows || sovResult)[0];

  const sovLineItemsResult = await db.execute(sql`
    SELECT * FROM sov_line_item WHERE schedule_of_values_id = ${sov.id} ORDER BY sort_order ASC
  `);
  sov.lineItems = (sovLineItemsResult as any).rows || sovLineItemsResult;

  // Get draw line items
  const drawLineItemsResult = await db.execute(sql`
    SELECT dli.*, sli.item_number, sli.description as sov_description, sli.scheduled_value
    FROM draw_line_item dli
    LEFT JOIN sov_line_item sli ON dli.sov_line_item_id = sli.id
    WHERE dli.draw_request_id = ${drawId}
  `);
  draw.lineItems = (drawLineItemsResult as any).rows || drawLineItemsResult;
  draw.scheduleOfValues = sov;

  return draw;
}

// ============================================
// G702/G703 GENERATION
// ============================================

/**
 * Generate G702 (Application and Certificate for Payment) data
 */
export async function generateG702Data(drawId: string, companyId: string) {
  const draw = await getDrawRequest(drawId, companyId);
  if (!draw) throw new Error('Draw not found');

  const sov = draw.scheduleOfValues;

  // Get all previous approved draws
  const prevResult = await db.execute(sql`
    SELECT * FROM draw_request
    WHERE schedule_of_values_id = ${sov.id} AND draw_number < ${draw.draw_number} AND status = 'approved'
  `);
  const allDraws = (prevResult as any).rows || prevResult;

  const previousGross = (allDraws as any[]).reduce((sum: number, d: any) => sum + Number(d.gross_amount || 0), 0);
  const previousRetainage = (allDraws as any[]).reduce((sum: number, d: any) => sum + Number(d.retainage_amount || 0), 0);
  const previousNet = (allDraws as any[]).reduce((sum: number, d: any) => sum + Number(d.net_amount || 0), 0);

  return {
    applicationNumber: draw.draw_number,
    periodTo: draw.period_to,
    projectName: draw.project_name,
    projectAddress: draw.project_address,

    originalContractSum: Number(sov.contract_amount),
    netChangeByChangeOrders: 0,
    contractSumToDate: Number(sov.contract_amount),

    totalCompletedAndStored: previousGross + Number(draw.gross_amount),
    retainagePercent: Number(sov.retainage_percent),
    totalRetainage: previousRetainage + Number(draw.retainage_amount),

    totalEarnedLessRetainage: (previousGross + Number(draw.gross_amount)) - (previousRetainage + Number(draw.retainage_amount)),
    lessPreviousCertificates: previousNet,
    currentPaymentDue: Number(draw.net_amount),

    balanceToFinish: Number(sov.contract_amount) - (previousGross + Number(draw.gross_amount)),
  };
}

/**
 * Generate G703 (Continuation Sheet) data
 */
export async function generateG703Data(drawId: string, companyId: string) {
  const draw = await getDrawRequest(drawId, companyId);
  if (!draw) throw new Error('Draw not found');

  const sov = draw.scheduleOfValues;

  // Get all approved draws before this one
  const prevResult = await db.execute(sql`
    SELECT dr.id, dli.*
    FROM draw_request dr
    JOIN draw_line_item dli ON dli.draw_request_id = dr.id
    WHERE dr.schedule_of_values_id = ${sov.id} AND dr.draw_number < ${draw.draw_number} AND dr.status = 'approved'
  `);
  const previousDrawLineItems = (prevResult as any).rows || prevResult;

  const lineItems = (sov.lineItems as any[]).map((sovItem: any) => {
    const previousWork = (previousDrawLineItems as any[])
      .filter((li: any) => li.sov_line_item_id === sovItem.id)
      .reduce((sum: number, li: any) => sum + Number(li.completed_this_period || 0), 0);

    const currentItem = (draw.lineItems as any[]).find((li: any) => li.sov_line_item_id === sovItem.id);
    const thisPeriod = Number(currentItem?.completed_this_period || 0);

    const totalCompleted = previousWork + thisPeriod;
    const scheduledValue = Number(sovItem.scheduled_value);
    const percentComplete = scheduledValue > 0 ? (totalCompleted / scheduledValue) * 100 : 0;
    const balanceToFinish = scheduledValue - totalCompleted;

    return {
      itemNumber: sovItem.item_number,
      description: sovItem.description,
      scheduledValue,
      previousWork,
      thisPeriod,
      materialsStored: 0,
      totalCompleted,
      percentComplete: Math.round(percentComplete * 10) / 10,
      balanceToFinish,
      retainage: totalCompleted * (Number(sov.retainage_percent) / 100),
    };
  });

  const grandTotals = lineItems.reduce((totals, item) => ({
    scheduledValue: totals.scheduledValue + item.scheduledValue,
    previousWork: totals.previousWork + item.previousWork,
    thisPeriod: totals.thisPeriod + item.thisPeriod,
    materialsStored: totals.materialsStored + item.materialsStored,
    totalCompleted: totals.totalCompleted + item.totalCompleted,
    balanceToFinish: totals.balanceToFinish + item.balanceToFinish,
    retainage: totals.retainage + item.retainage,
  }), {
    scheduledValue: 0, previousWork: 0, thisPeriod: 0, materialsStored: 0,
    totalCompleted: 0, balanceToFinish: 0, retainage: 0,
  });

  (grandTotals as any).percentComplete = grandTotals.scheduledValue > 0
    ? Math.round((grandTotals.totalCompleted / grandTotals.scheduledValue) * 1000) / 10
    : 0;

  return {
    applicationNumber: draw.draw_number,
    periodTo: draw.period_to,
    lineItems,
    grandTotals,
  };
}

export default {
  createScheduleOfValues,
  getScheduleOfValues,
  updateSOVLineItem,
  addSOVLineItem,
  createDrawRequest,
  updateDrawRequest,
  submitDrawRequest,
  approveDrawRequest,
  rejectDrawRequest,
  getProjectDraws,
  getDrawRequest,
  generateG702Data,
  generateG703Data,
};
