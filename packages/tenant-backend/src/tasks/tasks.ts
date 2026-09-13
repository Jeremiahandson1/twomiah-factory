/**
 * Tasks / To-Do — ONE implementation for every CRM that mounts /api/tasks (crm, crm-vet).
 * Vendored into each template as ../shared; the template's routes/tasks.ts wires in db + authenticate.
 *
 * Every query is parameterized (Drizzle `sql` bound values); the sort column and direction are allow-listed.
 * Previously each template shipped its own copy where getTasks/updateTask/getTaskStats built SQL by string
 * interpolation and ran it through sql.raw — an authenticated user could inject via ?status=/?search=/?sortBy=
 * and a JSON body (proven live: `?status=x' OR '1'='1` returned every row), and an apostrophe in a title 500'd
 * the update. That was fixed in place in PR #88; this module makes it a single shared source. UPDATE/DELETE
 * carry company_id in the WHERE, not just a prior SELECT.
 */
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

export interface TasksServiceDeps { db: any }
export interface TasksRoutesDeps {
  service: TasksService
  authenticate: any
  requirePermission: (permission: string) => any
}

const MANAGER_ROLES = new Set(['owner', 'admin', 'manager'])

/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

const SORT_COLUMNS: Record<string, string> = {
  due_date: 'due_date', dueDate: 'due_date', created_at: 'created_at', createdAt: 'created_at',
  priority: 'priority', status: 'status', title: 'title',
}

export function createTasksService(deps: TasksServiceDeps) {
  const { db } = deps

  /** Create a task */
  async function createTask({
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

  /** Get tasks with filters */
  async function getTasks(
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

  /** Get a single task */
  async function getTask(taskId: string, companyId: string) {
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

  /** Update a task */
  async function updateTask(taskId: string, companyId: string, data: any) {
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

  /** Toggle task completion */
  async function toggleTaskComplete(taskId: string, companyId: string) {
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

  /** Toggle checklist item */
  async function toggleChecklistItem(taskId: string, companyId: string, itemId: string) {
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

  /** Delete a task */
  async function deleteTask(taskId: string, companyId: string): Promise<boolean> {
    const [task] = rows(await db.execute(sql`
      SELECT id FROM task WHERE id = ${taskId} AND company_id = ${companyId}
    `))
    if (!task) return false

    await db.execute(sql`DELETE FROM task WHERE id = ${taskId} AND company_id = ${companyId}`)
    return true
  }

  /** Get tasks due soon */
  async function getUpcomingTasks(companyId: string, userId: string, { days = 7 }: { days?: number } = {}) {
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

  /** Get overdue tasks */
  async function getOverdueTasks(companyId: string, userId: string) {
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

  /** Get task stats for a user */
  async function getTaskStats(companyId: string, userId: string) {
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

  return {
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
}

export type TasksService = ReturnType<typeof createTasksService>

export function createTasksRoutes(deps: TasksRoutesDeps) {
  const { service, authenticate, requirePermission } = deps
  const app = new Hono()
  app.use('*', authenticate)

  const isManager = (u: any) => MANAGER_ROLES.has(u?.role)
  // Own-or-manager: below manager, you may only change a task you're assigned to or created.
  const canTouch = (u: any, task: any) =>
    isManager(u) || task?.assigned_to_id === u?.userId || task?.created_by_id === u?.userId

  // Get tasks
  app.get('/', requirePermission('tasks:read'), async (c) => {
    const user = c.get('user') as any
    const assignedToId = c.req.query('assignedToId')
    const projectId = c.req.query('projectId')
    const jobId = c.req.query('jobId')
    const contactId = c.req.query('contactId')
    const status = c.req.query('status')
    const priority = c.req.query('priority')
    const dueBefore = c.req.query('dueBefore')
    const dueAfter = c.req.query('dueAfter')
    const search = c.req.query('search')
    const page = c.req.query('page')
    const limit = c.req.query('limit')
    const sortBy = c.req.query('sortBy')
    const sortOrder = c.req.query('sortOrder')
    const mine = c.req.query('mine')

    const filters = {
      assignedToId: mine === 'true' ? user.userId : assignedToId,
      projectId,
      jobId,
      contactId,
      status,
      priority,
      dueBefore,
      dueAfter,
      search,
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 50,
      sortBy,
      sortOrder,
    }

    try {
      const result = await service.getTasks(user.companyId, filters)
      return c.json(result || { data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } })
    } catch (e: any) {
      if (e.message?.includes('relation') && e.message?.includes('does not exist')) {
        return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } })
      }
      throw e
    }
  })

  // Get my upcoming tasks
  app.get('/upcoming', requirePermission('tasks:read'), async (c) => {
    const user = c.get('user') as any
    const days = c.req.query('days') || '7'
    try {
      const result = await service.getUpcomingTasks(user.companyId, user.userId, { days: parseInt(days) })
      return c.json(result || [])
    } catch (e: any) {
      if (e.message?.includes('relation') && e.message?.includes('does not exist')) return c.json([])
      throw e
    }
  })

  // Get my overdue tasks
  app.get('/overdue', requirePermission('tasks:read'), async (c) => {
    const user = c.get('user') as any
    try {
      const result = await service.getOverdueTasks(user.companyId, user.userId)
      return c.json(result || [])
    } catch (e: any) {
      if (e.message?.includes('relation') && e.message?.includes('does not exist')) return c.json([])
      throw e
    }
  })

  // Get my task stats
  app.get('/stats', requirePermission('tasks:read'), async (c) => {
    const user = c.get('user') as any
    try {
      const result = await service.getTaskStats(user.companyId, user.userId)
      return c.json(result || { total: 0, completed: 0, pending: 0, overdue: 0 })
    } catch (e: any) {
      if (e.message?.includes('relation') && e.message?.includes('does not exist')) {
        return c.json({ total: 0, completed: 0, pending: 0, overdue: 0 })
      }
      throw e
    }
  })

  // Get single task
  app.get('/:id', requirePermission('tasks:read'), async (c) => {
    const user = c.get('user') as any
    const task = await service.getTask(c.req.param('id'), user.companyId)
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.json(task)
  })

  // Create task
  app.post('/', requirePermission('tasks:create'), async (c) => {
    const user = c.get('user') as any
    const {
      title, description, dueDate, priority,
      assignedToId, projectId, jobId, contactId, checklist,
    } = await c.req.json()

    if (!title?.trim()) {
      return c.json({ error: 'Title is required' }, 400)
    }

    const task = await service.createTask({
      companyId: user.companyId,
      createdById: user.userId,
      title: title.trim(),
      description,
      dueDate,
      priority,
      assignedToId: assignedToId || user.userId,
      projectId,
      jobId,
      contactId,
      checklist,
    })

    return c.json(task, 201)
  })

  // Update task
  app.put('/:id', requirePermission('tasks:update'), async (c) => {
    const user = c.get('user') as any
    const existing = await service.getTask(c.req.param('id'), user.companyId)
    if (!existing) return c.json({ error: 'Task not found' }, 404)
    if (!canTouch(user, existing)) return c.json({ error: 'You can only edit tasks assigned to you or that you created' }, 403)
    const body = await c.req.json()
    const task = await service.updateTask(c.req.param('id'), user.companyId, body)
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.json(task)
  })

  // Toggle task complete
  app.post('/:id/toggle', requirePermission('tasks:update'), async (c) => {
    const user = c.get('user') as any
    const existing = await service.getTask(c.req.param('id'), user.companyId)
    if (!existing) return c.json({ error: 'Task not found' }, 404)
    if (!canTouch(user, existing)) return c.json({ error: 'You can only change tasks assigned to you or that you created' }, 403)
    const task = await service.toggleTaskComplete(c.req.param('id'), user.companyId)
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.json(task)
  })

  // Toggle checklist item
  app.post('/:id/checklist/:itemId/toggle', requirePermission('tasks:update'), async (c) => {
    const user = c.get('user') as any
    const existing = await service.getTask(c.req.param('id'), user.companyId)
    if (!existing) return c.json({ error: 'Task not found' }, 404)
    if (!canTouch(user, existing)) return c.json({ error: 'You can only change tasks assigned to you or that you created' }, 403)
    const task = await service.toggleChecklistItem(
      c.req.param('id'),
      user.companyId,
      c.req.param('itemId')
    )
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.json(task)
  })

  // Delete task
  app.delete('/:id', requirePermission('tasks:update'), async (c) => {
    const user = c.get('user') as any
    const existing = await service.getTask(c.req.param('id'), user.companyId)
    if (!existing) return c.json({ error: 'Task not found' }, 404)
    if (!canTouch(user, existing)) return c.json({ error: 'You can only delete tasks assigned to you or that you created' }, 403)
    const deleted = await service.deleteTask(c.req.param('id'), user.companyId)
    if (!deleted) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.body(null, 204)
  })

  return app
}
