/**
 * Tasks/To-Do Service
 *
 * Simple task management.
 *
 * NOTE: The schema does not include a `task` table. This module uses raw SQL
 * via Drizzle's sql helper for the task table.
 */

import { db } from '../../db/index.ts'
import { user, project, job, contact } from '../../db/schema.ts'
import { eq, and, sql, count, lte, gte, not, desc, asc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
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
  const conditions: string[] = [`t.company_id = '${companyId}'`]

  if (assignedToId) conditions.push(`t.assigned_to_id = '${assignedToId}'`)
  if (createdById) conditions.push(`t.created_by_id = '${createdById}'`)
  if (projectId) conditions.push(`t.project_id = '${projectId}'`)
  if (jobId) conditions.push(`t.job_id = '${jobId}'`)
  if (contactId) conditions.push(`t.contact_id = '${contactId}'`)
  if (status) conditions.push(`t.status = '${status}'`)
  if (priority) conditions.push(`t.priority = '${priority}'`)
  if (dueBefore) conditions.push(`t.due_date <= '${new Date(dueBefore).toISOString()}'`)
  if (dueAfter) conditions.push(`t.due_date >= '${new Date(dueAfter).toISOString()}'`)
  if (search) conditions.push(`(t.title ILIKE '%${search}%' OR t.description ILIKE '%${search}%')`)

  const where = conditions.join(' AND ')
  const offset = (page - 1) * limit

  // Map sort fields
  const sortCol = sortBy === 'dueDate' ? 'due_date' : sortBy
  const order = sortOrder === 'desc' ? 'DESC' : 'ASC'

  const data = rows(await db.execute(sql.raw(`
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
    ORDER BY t.${sortCol} ${order} NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `)))

  const [{ count: total }] = rows(await db.execute(sql.raw(`SELECT count(*)::int as count FROM task t WHERE ${where}`)))

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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

  const sets: string[] = []

  if (data.title !== undefined) sets.push(`title = '${data.title}'`)
  if (data.description !== undefined) sets.push(`description = '${data.description}'`)
  if (data.dueDate !== undefined) sets.push(`due_date = ${data.dueDate ? `'${new Date(data.dueDate).toISOString()}'` : 'NULL'}`)
  if (data.priority !== undefined) sets.push(`priority = '${data.priority}'`)
  if (data.status !== undefined) {
    sets.push(`status = '${data.status}'`)
    if (data.status === 'completed') {
      sets.push(`completed_at = '${new Date().toISOString()}'`)
    } else {
      sets.push(`completed_at = NULL`)
    }
  }
  if (data.assignedToId !== undefined) sets.push(`assigned_to_id = ${data.assignedToId ? `'${data.assignedToId}'` : 'NULL'}`)
  if (data.projectId !== undefined) sets.push(`project_id = ${data.projectId ? `'${data.projectId}'` : 'NULL'}`)
  if (data.jobId !== undefined) sets.push(`job_id = ${data.jobId ? `'${data.jobId}'` : 'NULL'}`)
  if (data.contactId !== undefined) sets.push(`contact_id = ${data.contactId ? `'${data.contactId}'` : 'NULL'}`)
  if (data.checklist !== undefined) sets.push(`checklist = '${JSON.stringify(data.checklist)}'`)

  if (sets.length === 0) return existing

  const [updated] = rows(await db.execute(sql.raw(`
    UPDATE task SET ${sets.join(', ')} WHERE id = '${taskId}' RETURNING *
  `)))

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
    WHERE id = ${taskId} RETURNING *
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
    UPDATE task SET checklist = ${JSON.stringify(checklist)} WHERE id = ${taskId} RETURNING *
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

  await db.execute(sql`DELETE FROM task WHERE id = ${taskId}`)
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
  const base = `company_id = '${companyId}' AND assigned_to_id = '${userId}'`

  const [totalRes, completedRes, pendingRes, overdueRes] = await Promise.all([
    db.execute(sql.raw(`SELECT count(*)::int as count FROM task WHERE ${base}`)),
    db.execute(sql.raw(`SELECT count(*)::int as count FROM task WHERE ${base} AND status = 'completed'`)),
    db.execute(sql.raw(`SELECT count(*)::int as count FROM task WHERE ${base} AND status != 'completed'`)),
    db.execute(sql.raw(`SELECT count(*)::int as count FROM task WHERE ${base} AND status != 'completed' AND due_date < '${new Date().toISOString()}'`)),
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
