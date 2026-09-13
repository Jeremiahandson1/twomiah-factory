/**
 * Tasks/To-Do Service
 *
 * Simple task management.
 *
 * Every query is parameterized (Drizzle `sql` bound values); the sort column and direction are allow-listed. Previously
 * getTasks/updateTask/getTaskStats built SQL by string interpolation and ran it through sql.raw — an authenticated user
 * could inject via ?status=/?search=/?sortBy= and a JSON body (proven live: `?status=x' OR '1'='1` returned every row),
 * and an apostrophe in a title 500'd the update. UPDATE/DELETE now also carry company_id in the WHERE, not just a prior
 * SELECT.
 */

import { db } from '../../db/index.ts'
import { user, project, job, contact } from '../../db/schema.ts'
import { eq, and, sql, count } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

const SORT_COLUMNS: Record<string, string> = {
  due_date: 'due_date', dueDate: 'due_date', created_at: 'created_at', createdAt: 'created_at',
  priority: 'priority', status: 'status', title: 'title',
}

/**
 * Create a task
 */
export async function createTask({
  companyId,
  createdById,
  title,
  description,
  dueDate,
  priority = 'medium',
  assignedToId,
  projectId,
  jobId,
  contactId,
  checklist = [],
}: {
  companyId: string
  createdById: string
  title: string
  description?: string
  dueDate?: string
  priority?: string
  assignedToId?: string
  projectId?: string
  jobId?: string
  contactId?: string
  checklist?: string[]
}) {
  const checklistJson = checklist.map((item, i) => ({
    id: `item-${i}`,
    text: item,
    completed: false,
  }))

  const [task] = rows(await db.execute(sql`
    INSERT INTO task (id, company_id, created_by_id, title, description, due_date, priority, assigned_to_id, project_id, job_id, contact_id, checklist, status)
    VALUES (${createId()}, ${companyId}, ${createdById}, ${title}, ${description || null}, ${dueDate ? new Date(dueDate) : null}, ${priority}, ${assignedToId || null}, ${projectId || null}, ${jobId || null}, ${contactId || null}, ${JSON.stringify(checklistJson)}, 'pending')
    RETURNING *
  `))

  return task
}

/**
 * Get tasks with filters
 */
export async function getTasks(
  companyId: string,
  {
    assignedToId,
    createdById,
    projectId,
    jobId,
    contactId,
    status,
    priority,
    dueBefore,
    dueAfter,
    search,
    page = 1,
    limit = 50,
    sortBy = 'due_date',
    sortOrder = 'asc',
  }: {
    assignedToId?: string
    createdById?: string
    projectId?: string
    jobId?: string
    contactId?: string
    status?: string
    priority?: string
    dueBefore?: string
    dueAfter?: string
    search?: string
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: string
  } = {}
) {
  const conditions = [sql`t.company_id = ${companyId}`]
  if (assignedToId) conditions.push(sql`t.assigned_to_id = ${assignedToId}`)
  if (createdById) conditions.push(sql`t.created_by_id = ${createdById}`)
  if (projectId) conditions.push(sql`t.project_id = ${projectId}`)
  if (jobId) conditions.push(sql`t.job_id = ${jobId}`)
  if (contactId) conditions.push(sql`t.contact_id = ${contactId}`)
  if (status) conditions.push(sql`t.status = ${status}`)
  if (priority) conditions.push(sql`t.priority = ${priority}`)
  if (dueBefore) conditions.push(sql`t.due_date <= ${new Date(dueBefore)}`)
  if (dueAfter) conditions.push(sql`t.due_date >= ${new Date(dueAfter)}`)
  if (search) { const like = `%${search}%`; conditions.push(sql`(t.title ILIKE ${like} OR t.description ILIKE ${like})`) }
  const where = sql.join(conditions, sql` AND `)

  // Allow-listed identifier + direction — never interpolate request text into the query shape.
  const sortCol = SORT_COLUMNS[sortBy] || 'due_date'
  const order = String(sortOrder).toLowerCase() === 'desc' ? sql`DESC` : sql`ASC`
  const pageN = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1
  const limitN = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(200, Math.floor(Number(limit))) : 50
  const offset = (pageN - 1) * limitN

  const data = rows(await db.execute(sql`
    SELECT t.*,
      json_build_object('id', au.id, 'firstName', au.first_name, 'lastName', au.last_name) as assigned_to,
      json_build_object('id', cu.id, 'firstName', cu.first_name, 'lastName', cu.last_name) as created_by,
      json_build_object('id', p.id, 'name', p.name, 'number', p.number) as project,
      json_build_object('id', j.id, 'title', j.title, 'number', j.number) as job,
      json_build_object('id', c.id, 'name', c.name) as contact
    FROM task t
    LEFT JOIN "user" au ON au.id = t.assigned_to_id
    LEFT JOIN "user" cu ON cu.id = t.created_by_id
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN job j ON j.id = t.job_id
    LEFT JOIN contact c ON c.id = t.contact_id
    WHERE ${where}
    ORDER BY ${sql.raw('t.' + sortCol)} ${order} NULLS LAST
    LIMIT ${limitN} OFFSET ${offset}
  `))

  const [{ count: total }] = rows(await db.execute(sql`SELECT count(*)::int as count FROM task t WHERE ${where}`))

  // Raw SQL returns snake_case (due_date, created_at, assigned_to_id, …); the UI
  // reads camelCase, so a task's date showed blank. Convert top-level keys.
  const toCamel = (s: string) => s.replace(/_([a-z])/g, (_m: string, ch: string) => ch.toUpperCase())
  const camelData = (data as any[]).map((row) => {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v
    return out
  })

  return {
    data: camelData,
    pagination: { page: pageN, limit: limitN, total, pages: Math.ceil(total / limitN) },
  }
}

/**
 * Get a single task
 */
export async function getTask(taskId: string, companyId: string) {
  const [task] = rows(await db.execute(sql`
    SELECT t.*,
      json_build_object('id', au.id, 'firstName', au.first_name, 'lastName', au.last_name, 'email', au.email) as assigned_to,
      json_build_object('id', cu.id, 'firstName', cu.first_name, 'lastName', cu.last_name) as created_by,
      json_build_object('id', p.id, 'name', p.name, 'number', p.number) as project,
      json_build_object('id', j.id, 'title', j.title, 'number', j.number) as job,
      json_build_object('id', c.id, 'name', c.name) as contact
    FROM task t
    LEFT JOIN "user" au ON au.id = t.assigned_to_id
    LEFT JOIN "user" cu ON cu.id = t.created_by_id
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN job j ON j.id = t.job_id
    LEFT JOIN contact c ON c.id = t.contact_id
    WHERE t.id = ${taskId} AND t.company_id = ${companyId}
  `))

  return task || null
}

/**
 * Update a task
 */
export async function updateTask(taskId: string, companyId: string, data: any) {
  const [existing] = rows(await db.execute(sql`
    SELECT * FROM task WHERE id = ${taskId} AND company_id = ${companyId}
  `))
  if (!existing) return null

  const sets: any[] = []
  if (data.title !== undefined) sets.push(sql`title = ${data.title}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.dueDate !== undefined) sets.push(sql`due_date = ${data.dueDate ? new Date(data.dueDate) : null}`)
  if (data.priority !== undefined) sets.push(sql`priority = ${data.priority}`)
  if (data.status !== undefined) {
    sets.push(sql`status = ${data.status}`)
    sets.push(sql`completed_at = ${data.status === 'completed' ? new Date() : null}`)
  }
  if (data.assignedToId !== undefined) sets.push(sql`assigned_to_id = ${data.assignedToId || null}`)
  if (data.projectId !== undefined) sets.push(sql`project_id = ${data.projectId || null}`)
  if (data.jobId !== undefined) sets.push(sql`job_id = ${data.jobId || null}`)
  if (data.contactId !== undefined) sets.push(sql`contact_id = ${data.contactId || null}`)
  if (data.checklist !== undefined) sets.push(sql`checklist = ${JSON.stringify(data.checklist)}`)

  if (sets.length === 0) return existing

  const [updated] = rows(await db.execute(sql`
    UPDATE task SET ${sql.join(sets, sql`, `)} WHERE id = ${taskId} AND company_id = ${companyId} RETURNING *
  `))

  return updated
}

/**
 * Toggle task completion
 */
export async function toggleTaskComplete(taskId: string, companyId: string) {
  const [task] = rows(await db.execute(sql`
    SELECT * FROM task WHERE id = ${taskId} AND company_id = ${companyId}
  `))
  if (!task) return null

  const newStatus = task.status === 'completed' ? 'pending' : 'completed'

  const [updated] = rows(await db.execute(sql`
    UPDATE task SET status = ${newStatus}, completed_at = ${newStatus === 'completed' ? new Date() : null}
    WHERE id = ${taskId} AND company_id = ${companyId} RETURNING *
  `))

  return updated
}

/**
 * Toggle checklist item
 */
export async function toggleChecklistItem(taskId: string, companyId: string, itemId: string) {
  const [task] = rows(await db.execute(sql`
    SELECT * FROM task WHERE id = ${taskId} AND company_id = ${companyId}
  `))
  if (!task) return null

  const checklist = (task.checklist || []).map((item: any) => {
    if (item.id === itemId) {
      return { ...item, completed: !item.completed }
    }
    return item
  })

  const [updated] = rows(await db.execute(sql`
    UPDATE task SET checklist = ${JSON.stringify(checklist)} WHERE id = ${taskId} AND company_id = ${companyId} RETURNING *
  `))

  return updated
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string, companyId: string): Promise<boolean> {
  const [task] = rows(await db.execute(sql`
    SELECT id FROM task WHERE id = ${taskId} AND company_id = ${companyId}
  `))
  if (!task) return false

  await db.execute(sql`DELETE FROM task WHERE id = ${taskId} AND company_id = ${companyId}`)
  return true
}

/**
 * Get tasks due soon
 */
export async function getUpcomingTasks(companyId: string, userId: string, { days = 7 }: { days?: number } = {}) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + days)

  return rows(await db.execute(sql`
    SELECT t.*, json_build_object('name', p.name) as project, json_build_object('title', j.title) as job
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN job j ON j.id = t.job_id
    WHERE t.company_id = ${companyId} AND t.assigned_to_id = ${userId}
      AND t.status != 'completed'
      AND t.due_date <= ${dueDate}
      AND t.due_date >= ${new Date()}
    ORDER BY t.due_date ASC
    LIMIT 10
  `))
}

/**
 * Get overdue tasks
 */
export async function getOverdueTasks(companyId: string, userId: string) {
  return rows(await db.execute(sql`
    SELECT t.*, json_build_object('name', p.name) as project, json_build_object('title', j.title) as job
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN job j ON j.id = t.job_id
    WHERE t.company_id = ${companyId} AND t.assigned_to_id = ${userId}
      AND t.status != 'completed'
      AND t.due_date < ${new Date()}
    ORDER BY t.due_date ASC
  `))
}

/**
 * Get task stats for a user
 */
export async function getTaskStats(companyId: string, userId: string) {
  const scope = sql`company_id = ${companyId} AND assigned_to_id = ${userId}`
  const now = new Date()
  const [totalRes, completedRes, pendingRes, overdueRes] = await Promise.all([
    db.execute(sql`SELECT count(*)::int as count FROM task WHERE ${scope}`),
    db.execute(sql`SELECT count(*)::int as count FROM task WHERE ${scope} AND status = 'completed'`),
    db.execute(sql`SELECT count(*)::int as count FROM task WHERE ${scope} AND status != 'completed'`),
    db.execute(sql`SELECT count(*)::int as count FROM task WHERE ${scope} AND status != 'completed' AND due_date < ${now}`),
  ])
  const total = rows(totalRes)[0]?.count || 0
  const completed = rows(completedRes)[0]?.count || 0
  const pending = rows(pendingRes)[0]?.count || 0
  const overdue = rows(overdueRes)[0]?.count || 0

  return { total, completed, pending, overdue }
}

export default {
  createTask,
  getTasks,
  getTask,
  updateTask,
  toggleTaskComplete,
  toggleChecklistItem,
  deleteTask,
  getUpcomingTasks,
  getOverdueTasks,
  getTaskStats,
}
