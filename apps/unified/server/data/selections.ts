// Selections: the raw SQL of the CRM template's services/selections.ts (templates/crm/backend/src/services), one named
// function per statement. Every function returns camelCase rows (RULEBOOK §2). The joined rows (row_to_json /
// json_build_object) are camelised inside; `available_options` is a json column of the owner's data and is not.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { rowsOf, camelRow, camelRows } from '@twomiah/tenant-backend'

/** The aliases that are table rows, and so are safe to camelise inside. */
const NESTED = ['category', 'selected_option', 'project']

const first = (result: any, nested: string[] = []) => { const r = rowsOf(result)[0]; return r ? camelRow(r, nested) : null }

// ── categories ───────────────────────────────────────────────────────────────────────────────────

export async function insertCategory(db: any, companyId: string, data: any) {
  return first(await db.execute(sql`
    INSERT INTO selection_category (id, company_id, name, description, sort_order, icon, default_allowance, active)
    VALUES (${createId()}, ${companyId}, ${data.name}, ${data.description || null}, ${data.sortOrder || 0}, ${data.icon || null}, ${data.defaultAllowance || 0}, true)
    RETURNING *
  `))
}

export async function listActiveCategories(db: any, companyId: string) {
  return camelRows(await db.execute(sql`
    SELECT * FROM selection_category WHERE company_id = ${companyId} AND active = true ORDER BY sort_order ASC
  `))
}

export async function findCategoryIdByName(db: any, companyId: string, name: string): Promise<string | null> {
  const row = rowsOf(await db.execute(sql`
    SELECT id FROM selection_category WHERE company_id = ${companyId} AND name = ${name} LIMIT 1
  `))[0]
  return row ? row.id : null
}

/** A seeded category: name and order only. */
export async function insertSeedCategory(db: any, companyId: string, cat: { name: string; sortOrder: number }) {
  await db.execute(sql`
    INSERT INTO selection_category (id, company_id, name, sort_order, active)
    VALUES (${createId()}, ${companyId}, ${cat.name}, ${cat.sortOrder}, true)
  `)
}

// ── options ──────────────────────────────────────────────────────────────────────────────────────

export async function insertOption(db: any, companyId: string, data: any) {
  return first(await db.execute(sql`
    INSERT INTO selection_option (id, company_id, category_id, name, description, manufacturer, model, sku, price, cost, unit, image_url, images, spec_sheet, lead_time_days, in_stock, active)
    VALUES (${createId()}, ${companyId}, ${data.categoryId}, ${data.name}, ${data.description || null}, ${data.manufacturer || null}, ${data.model || null}, ${data.sku || null}, ${data.price || 0}, ${data.cost || 0}, ${data.unit || 'each'}, ${data.imageUrl || null}, ${JSON.stringify(data.images || [])}, ${data.specSheet || null}, ${data.leadTimeDays || 0}, ${data.inStock ?? true}, true)
    RETURNING *
  `))
}

export async function listOptions(db: any, companyId: string, { categoryId, search, active }: { categoryId?: string; search?: string; active: boolean | null }) {
  const conditions = [sql`so.company_id = ${companyId}`]
  if (categoryId) conditions.push(sql`so.category_id = ${categoryId}`)
  if (active !== null) conditions.push(sql`so.active = ${active}`)
  if (search) {
    const like = `%${search}%`
    conditions.push(sql`(so.name ILIKE ${like} OR so.manufacturer ILIKE ${like} OR so.model ILIKE ${like})`)
  }
  return camelRows(await db.execute(sql`
    SELECT so.*, json_build_object('name', sc.name) as category
    FROM selection_option so
    LEFT JOIN selection_category sc ON sc.id = so.category_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY sc.sort_order ASC, so.name ASC
  `), NESTED)
}

/**
 * One of the company's options by id. The template read it unscoped, so a selection could be made with another
 * company's option (its name and price) by sending that option's id.
 */
export async function findOption(db: any, optionId: string, companyId: string) {
  return first(await db.execute(sql`SELECT * FROM selection_option WHERE id = ${optionId} AND company_id = ${companyId}`))
}

/** Is this category the company's? An option is filed under one of the company's own categories only. */
export async function categoryIsCompanys(db: any, companyId: string, categoryId: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT 1 FROM selection_category WHERE id = ${categoryId} AND company_id = ${companyId} LIMIT 1`)).length > 0
}

export async function optionsByIds(db: any, ids: string[]) {
  return camelRows(await db.execute(sql`
    SELECT * FROM selection_option WHERE id = ANY(${ids}::text[])
  `))
}

export async function activeOptionsInCategory(db: any, categoryId: string) {
  return camelRows(await db.execute(sql`
    SELECT * FROM selection_option WHERE category_id = ${categoryId} AND active = true LIMIT 50
  `))
}

// ── project selections ───────────────────────────────────────────────────────────────────────────

export async function insertProjectSelection(db: any, companyId: string, data: any) {
  return first(await db.execute(sql`
    INSERT INTO project_selection (id, company_id, project_id, category_id, name, description, location, allowance, quantity, unit, due_date, status, notes)
    VALUES (${createId()}, ${companyId}, ${data.projectId}, ${data.categoryId || null}, ${data.name}, ${data.description || null}, ${data.location || null}, ${data.allowance || 0}, ${data.quantity ?? 1}, ${data.unit || 'each'}, ${data.dueDate ? new Date(data.dueDate) : null}, 'pending', ${data.notes || null})
    RETURNING *
  `))
}

/** A project's selections with their category and chosen option. */
export async function listProjectSelections(db: any, projectId: string, companyId: string) {
  return camelRows(await db.execute(sql`
    SELECT ps.*, row_to_json(sc.*) as category, row_to_json(so.*) as selected_option
    FROM project_selection ps
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    WHERE ps.project_id = ${projectId} AND ps.company_id = ${companyId}
    ORDER BY sc.sort_order ASC, ps.location ASC
  `), NESTED)
}

/** The portal's view of a project's selections: by due date, every one on the project. */
export async function listProjectSelectionsByDueDate(db: any, projectId: string) {
  return camelRows(await db.execute(sql`
    SELECT ps.*, row_to_json(sc.*) as category, row_to_json(so.*) as selected_option
    FROM project_selection ps
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    WHERE ps.project_id = ${projectId}
    ORDER BY ps.due_date ASC NULLS LAST, sc.sort_order ASC
  `), NESTED)
}

export async function findProjectSelection(db: any, selectionId: string, companyId: string) {
  return first(await db.execute(sql`
    SELECT * FROM project_selection WHERE id = ${selectionId} AND company_id = ${companyId}
  `))
}

export async function findProjectSelectionInProject(db: any, selectionId: string, projectId: string) {
  return first(await db.execute(sql`
    SELECT * FROM project_selection WHERE id = ${selectionId} AND project_id = ${projectId}
  `))
}

/** A selection with its chosen option, project and category. */
export async function findSelectionForApproval(db: any, selectionId: string, companyId: string) {
  return first(await db.execute(sql`
    SELECT ps.*, row_to_json(so.*) as selected_option, row_to_json(p.*) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN selection_option so ON so.id = ps.selected_option_id
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.id = ${selectionId} AND ps.company_id = ${companyId}
  `), NESTED)
}

export async function recordSelectionChoice(db: any, selectionId: string, v: { optionId: string; selectedBy: string | null; notes: string | null; priceDifference: number }) {
  return first(await db.execute(sql`
    UPDATE project_selection SET
      selected_option_id = ${v.optionId},
      status = 'selected',
      selected_at = ${new Date()},
      selected_by_id = ${v.selectedBy},
      client_notes = ${v.notes},
      price_difference = ${v.priceDifference}
    WHERE id = ${selectionId}
    RETURNING *
  `))
}

export async function markSelectionApproved(db: any, selectionId: string, approvedBy: string) {
  await db.execute(sql`
    UPDATE project_selection SET status = 'approved', approved_at = ${new Date()}, approved_by_id = ${approvedBy}
    WHERE id = ${selectionId}
  `)
}

export async function markSelectionOrdered(db: any, selectionId: string, companyId: string, v: { orderNumber: string | null; expectedDelivery: Date | null }) {
  return first(await db.execute(sql`
    UPDATE project_selection SET
      status = 'ordered',
      ordered_at = ${new Date()},
      order_number = ${v.orderNumber},
      expected_delivery = ${v.expectedDelivery}
    WHERE id = ${selectionId} AND company_id = ${companyId}
    RETURNING *
  `))
}

export async function markSelectionReceived(db: any, selectionId: string, companyId: string, notes: string | null) {
  return first(await db.execute(sql`
    UPDATE project_selection SET
      status = 'received',
      received_at = ${new Date()},
      received_notes = ${notes}
    WHERE id = ${selectionId} AND company_id = ${companyId}
    RETURNING *
  `))
}

// ── reports ──────────────────────────────────────────────────────────────────────────────────────

/** Pending selections due on or before `dueBy`, with their project and category. */
export async function pendingSelectionsDueBy(db: any, companyId: string, dueBy: Date) {
  return camelRows(await db.execute(sql`
    SELECT ps.*, json_build_object('id', p.id, 'name', p.name) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.company_id = ${companyId} AND ps.status = 'pending' AND ps.due_date <= ${dueBy}
    ORDER BY ps.due_date ASC
  `), NESTED)
}

/** Pending selections due before `now`, with their project and category. */
export async function pendingSelectionsDueBefore(db: any, companyId: string, now: Date) {
  return camelRows(await db.execute(sql`
    SELECT ps.*, json_build_object('id', p.id, 'name', p.name) as project, row_to_json(sc.*) as category
    FROM project_selection ps
    LEFT JOIN project p ON p.id = ps.project_id
    LEFT JOIN selection_category sc ON sc.id = ps.category_id
    WHERE ps.company_id = ${companyId} AND ps.status = 'pending' AND ps.due_date < ${now}
    ORDER BY ps.due_date ASC
  `), NESTED)
}
