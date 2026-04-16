/**
 * Selections Management Service
 *
 * Let clients choose finishes, fixtures, colors, and options.
 *
 * NOTE: The schema does not include selectionCategory / selectionOption /
 * projectSelection / changeOrder (with selectionId) tables. This module uses
 * raw SQL via Drizzle's sql helper for those tables.
 */

import { db } from '../../db/index.ts'
import { project, changeOrder } from '../../db/schema.ts'
import { eq, and, lte, asc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

// ============================================
// SELECTION CATEGORIES
// ============================================

/**
 * Create selection category template
 */
export async function createCategory(companyId: string, data: any) {
  const [row] = rows(await db.execute(sql`
    INSERT INTO selection_category (id, company_id, name, description, sort_order, icon, default_allowance, active)
    VALUES (${createId()}, ${companyId}, ${data.name}, ${data.description || null}, ${data.sortOrder || 0}, ${data.icon || null}, ${data.defaultAllowance || 0}, true)
    RETURNING *
  `))
  return row
}

/**
 * Get categories
 */
export async function getCategories(companyId: string) {
  return rows(await db.execute(sql`
    SELECT * FROM selection_category WHERE company_id = ${companyId} AND active = true ORDER BY sort_order ASC
  `))
}

/**
 * Seed default categories
 */
export async function seedDefaultCategories(companyId: string) {
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
  ]

  for (const cat of defaults) {
    await db.execute(sql`
      INSERT INTO selection_category (id, company_id, name, icon, sort_order, active)
      VALUES (${createId()}, ${companyId}, ${cat.name}, ${cat.icon}, ${cat.sortOrder}, true)
      ON CONFLICT (company_id, name) DO NOTHING
    `)
  }
}

// ============================================
// SELECTION OPTIONS (Product Library)
// ============================================

/**
 * Create selection option
 */
export async function createOption(companyId: string, data: any) {
  const [row] = rows(await db.execute(sql`
    INSERT INTO selection_option (id, company_id, category_id, name, description, manufacturer, model, sku, price, cost, unit, image_url, images, spec_sheet, lead_time_days, in_stock, active)
    VALUES (${createId()}, ${companyId}, ${data.categoryId}, ${data.name}, ${data.description || null}, ${data.manufacturer || null}, ${data.model || null}, ${data.sku || null}, ${data.price || 0}, ${data.cost || 0}, ${data.unit || 'each'}, ${data.imageUrl || null}, ${JSON.stringify(data.images || [])}, ${data.specSheet || null}, ${data.leadTimeDays || 0}, ${data.inStock ?? true}, true)
    RETURNING *
  `))
  return row
}

/**
 * Get options
 */
export async function getOptions(
  companyId: string,
  { categoryId, search, active = true }: { categoryId?: string; search?: string; active?: boolean | null } = {}
) {
  const conditions: string[] = [`so.company_id = '${companyId}'`]
  if (categoryId) conditions.push(`so.category_id = '${categoryId}'`)
  if (active !== null) conditions.push(`so.active = ${active}`)
  if (search) {
    conditions.push(`(so.name ILIKE '%${search}%' OR so.manufacturer ILIKE '%${search}%' OR so.model ILIKE '%${search}%')`)
  }

  return rows(await db.execute(sql.raw(`
    SELECT so.*, json_build_object('name', sc.name) as category
    FROM selection_option so
    LEFT JOIN selection_category sc ON sc.id = so.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY sc.sort_order ASC, so.name ASC
  `)))
}

// ============================================
// PROJECT SELECTIONS
// ============================================

/**
 * Create selection requirement for a project
 */
export async function createProjectSelection(companyId: string, data: any) {
  const [row] = rows(await db.execute(sql`
    INSERT INTO project_selection (id, company_id, project_id, category_id, name, description, location, allowance, status, notes)
    VALUES (${createId()}, ${companyId}, ${data.projectId}, ${data.categoryId || null}, ${data.name}, ${data.description || null}, ${data.location || null}, ${data.allowance || 0}, 'pending', ${data.notes || null})
    RETURNING *
  `))
  return row
}

/**
 * Get project selections
 */
export async function getProjectSelections(projectId: string, companyId: string) {
  const selections = rows(await db.execute(sql`
    SELECT ps.*, row_to_json(sc.*) as category, row_to_json(so.*) as selected_option
    FROM project_selection ps
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    WHERE ps.project_id = ${projectId} AND ps.company_id = ${companyId}
    ORDER BY sc.sort_order ASC, ps.location ASC
  `))

  return selections.map((sel: any) => {
    let priceDiff = 0
    if (sel.selected_option) {
      const totalPrice = sel.selected_option.price * sel.quantity
      priceDiff = totalPrice - (sel.allowance || 0)
    }
    return {
      ...sel,
      priceDifference: priceDiff,
      isUpgrade: priceDiff > 0,
      isCredit: priceDiff < 0,
    }
  })
}

/**
 * Get selections summary for a project
 */
export async function getSelectionsSummary(projectId: string, companyId: string) {
  const selections = await getProjectSelections(projectId, companyId)

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
  } as any

  const now = new Date()

  for (const sel of selections) {
    summary[sel.status]++
    summary.totalAllowance += sel.allowance || 0

    if (sel.selected_option) {
      summary.totalSelected += sel.selected_option.price * sel.quantity
    }

    summary.netDifference += sel.priceDifference || 0

    if (sel.due_date && new Date(sel.due_date) < now && sel.status === 'pending') {
      summary.overdue++
    }
  }

  return summary
}

/**
 * Client makes a selection
 */
export async function makeSelection(
  selectionId: string,
  companyId: string,
  { optionId, notes, selectedBy }: { optionId: string; notes?: string; selectedBy?: string }
) {
  const [selection] = rows(await db.execute(sql`
    SELECT * FROM project_selection WHERE id = ${selectionId} AND company_id = ${companyId}
  `))
  if (!selection) throw new Error('Selection not found')

  const [option] = rows(await db.execute(sql`
    SELECT * FROM selection_option WHERE id = ${optionId}
  `))
  if (!option) throw new Error('Option not found')

  const totalPrice = option.price * selection.quantity
  const priceDiff = totalPrice - (selection.allowance || 0)

  const [updated] = rows(await db.execute(sql`
    UPDATE project_selection SET
      selected_option_id = ${optionId},
      status = 'selected',
      selected_at = ${new Date()},
      selected_by_id = ${selectedBy || null},
      client_notes = ${notes || null},
      price_difference = ${priceDiff}
    WHERE id = ${selectionId}
    RETURNING *
  `))

  return updated
}

/**
 * Approve selection (creates change order if upgrade)
 */
export async function approveSelection(
  selectionId: string,
  companyId: string,
  { approvedBy, createChangeOrder: shouldCreate = true }: { approvedBy: string; createChangeOrder?: boolean }
) {
  const [selection] = rows(await db.execute(sql`
    SELECT ps.*, row_to_json(so.*) as selected_option, row_to_json(p.*) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.id = ${selectionId} AND ps.company_id = ${companyId}
  `))
  if (!selection) throw new Error('Selection not found')
  if (!selection.selected_option_id) throw new Error('No option selected')

  await db.execute(sql`
    UPDATE project_selection SET status = 'approved', approved_at = ${new Date()}, approved_by_id = ${approvedBy}
    WHERE id = ${selectionId}
  `)

  let co = null
  if (shouldCreate && selection.price_difference !== 0) {
    const title = selection.price_difference > 0
      ? `Selection Upgrade: ${selection.name}`
      : `Selection Credit: ${selection.name}`
    const description = selection.price_difference > 0
      ? `Upgrade from allowance to ${selection.selected_option?.name}\n\nLocation: ${selection.location || 'N/A'}\nQuantity: ${selection.quantity} ${selection.unit}`
      : `Credit for selecting ${selection.selected_option?.name} under allowance`

    ;[co] = await db
      .insert(changeOrder)
      .values({
        companyId,
        projectId: selection.project_id,
        number: `CO-SEL-${Date.now()}`,
        title,
        description,
        amount: String(selection.price_difference),
        status: 'pending',
      })
      .returning()
  }

  return { selection, changeOrder: co }
}

/**
 * Mark selection as ordered
 */
export async function markOrdered(
  selectionId: string,
  companyId: string,
  { orderNumber, expectedDate }: { orderedBy?: string; orderNumber?: string; expectedDate?: string }
) {
  const [row] = rows(await db.execute(sql`
    UPDATE project_selection SET
      status = 'ordered',
      ordered_at = ${new Date()},
      order_number = ${orderNumber || null},
      expected_delivery = ${expectedDate ? new Date(expectedDate) : null}
    WHERE id = ${selectionId} AND company_id = ${companyId}
    RETURNING *
  `))
  return row
}

/**
 * Mark selection as received
 */
export async function markReceived(
  selectionId: string,
  companyId: string,
  { notes }: { receivedBy?: string; notes?: string }
) {
  const [row] = rows(await db.execute(sql`
    UPDATE project_selection SET
      status = 'received',
      received_at = ${new Date()},
      received_notes = ${notes || null}
    WHERE id = ${selectionId} AND company_id = ${companyId}
    RETURNING *
  `))
  return row
}

// ============================================
// CLIENT PORTAL
// ============================================

/**
 * Get selections for client portal
 */
export async function getClientSelections(projectId: string, contactId: string) {
  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.contactId, contactId)))

  if (!proj) throw new Error('Access denied')

  const selections = rows(await db.execute(sql`
    SELECT ps.*, row_to_json(sc.*) as category, row_to_json(so.*) as selected_option
    FROM project_selection ps
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    WHERE ps.project_id = ${projectId}
    ORDER BY ps.due_date ASC NULLS LAST, sc.sort_order ASC
  `))

  const enriched = await Promise.all(
    selections.map(async (sel: any) => {
      let options: any[] = []
      if (sel.status === 'pending' || sel.status === 'selected') {
        const availableOptions = sel.available_options || []
        if (availableOptions.length > 0) {
          options = rows(await db.execute(sql`
            SELECT * FROM selection_option WHERE id = ANY(${availableOptions}::text[])
          `))
        } else {
          options = rows(await db.execute(sql`
            SELECT * FROM selection_option WHERE category_id = ${sel.category_id} AND active = true LIMIT 50
          `))
        }
      }

      return {
        ...sel,
        availableOptionsList: options.map((opt: any) => ({
          ...opt,
          totalPrice: opt.price * sel.quantity,
          priceDiff: opt.price * sel.quantity - (sel.allowance || 0),
        })),
      }
    })
  )

  return enriched
}

/**
 * Client submits selection from portal
 */
export async function clientMakeSelection(
  projectId: string,
  selectionId: string,
  contactId: string,
  { optionId, notes }: { optionId: string; notes?: string }
) {
  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.contactId, contactId)))

  if (!proj) throw new Error('Access denied')

  const [selection] = rows(await db.execute(sql`
    SELECT * FROM project_selection WHERE id = ${selectionId} AND project_id = ${projectId}
  `))
  if (!selection) throw new Error('Selection not found')
  if (selection.status !== 'pending' && selection.status !== 'selected') {
    throw new Error('Selection cannot be changed')
  }

  return makeSelection(selectionId, proj.companyId, { optionId, notes, selectedBy: contactId })
}

// ============================================
// REPORTS
// ============================================

/**
 * Get selections due soon
 */
export async function getSelectionsDueSoon(companyId: string, { days = 7 }: { days?: number } = {}) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + days)

  return rows(await db.execute(sql`
    SELECT ps.*, json_build_object('id', p.id, 'name', p.name) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.company_id = ${companyId} AND ps.status = 'pending' AND ps.due_date <= ${dueDate}
    ORDER BY ps.due_date ASC
  `))
}

/**
 * Get overdue selections
 */
export async function getOverdueSelections(companyId: string) {
  return rows(await db.execute(sql`
    SELECT ps.*, json_build_object('id', p.id, 'name', p.name) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.company_id = ${companyId} AND ps.status = 'pending' AND ps.due_date < ${new Date()}
    ORDER BY ps.due_date ASC
  `))
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
}
