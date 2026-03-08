/**
 * Advanced Project Scheduling Service
 *
 * Gantt chart with dependencies:
 * - Task dependencies (finish-to-start, start-to-start, etc.)
 * - Critical path calculation
 * - Auto-scheduling based on dependencies
 * - Resource leveling
 * - Baseline tracking
 *
 * NOTE: The schema does not include projectTask / taskDependency / projectBaseline tables.
 * This module uses raw SQL via Drizzle's sql helper for those tables.
 */

import { db } from '../../db/index.ts'
import { project, user } from '../../db/schema.ts'
import { eq, and, asc, sql } from 'drizzle-orm'

// Dependency types
export const DEPENDENCY_TYPES = {
  FS: 'finish_to_start',
  SS: 'start_to_start',
  FF: 'finish_to_finish',
  SF: 'start_to_finish',
} as const

// ============================================
// PROJECT PHASES/TASKS
// ============================================

/**
 * Create project phase/task
 */
export async function createTask(companyId: string, data: any) {
  const [task] = (await db.execute(sql`
    INSERT INTO project_task (company_id, project_id, parent_id, name, description, start_date, end_date, duration, percent_complete, is_milestone, assigned_to_id, sort_order, wbs_code, constraint_type, constraint_date, baseline_start, baseline_end, color)
    VALUES (${companyId}, ${data.projectId}, ${data.parentId || null}, ${data.name}, ${data.description || null}, ${data.startDate ? new Date(data.startDate) : null}, ${data.endDate ? new Date(data.endDate) : null}, ${data.duration || 1}, ${data.percentComplete || 0}, ${data.isMilestone || false}, ${data.assignedToId || null}, ${data.sortOrder || 0}, ${data.wbsCode || null}, ${data.constraint || 'asap'}, ${data.constraintDate ? new Date(data.constraintDate) : null}, ${data.startDate ? new Date(data.startDate) : null}, ${data.endDate ? new Date(data.endDate) : null}, ${data.color || null})
    RETURNING *
  `)) as any[]

  await recalculateSchedule(data.projectId)

  return task
}

/**
 * Update task
 */
export async function updateTask(taskId: string, companyId: string, data: any) {
  const updates: any = { ...data }
  if (data.startDate) updates.start_date = new Date(data.startDate)
  if (data.endDate) updates.end_date = new Date(data.endDate)
  if (data.constraintDate) updates.constraint_date = new Date(data.constraintDate)

  // Build parameterized updates
  let hasUpdates = false
  if (data.name !== undefined) { await db.execute(sql`UPDATE project_task SET name = ${data.name} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.description !== undefined) { await db.execute(sql`UPDATE project_task SET description = ${data.description} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.startDate) { await db.execute(sql`UPDATE project_task SET start_date = ${new Date(data.startDate).toISOString()} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.endDate) { await db.execute(sql`UPDATE project_task SET end_date = ${new Date(data.endDate).toISOString()} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.duration !== undefined) { await db.execute(sql`UPDATE project_task SET duration = ${data.duration} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.percentComplete !== undefined) { await db.execute(sql`UPDATE project_task SET percent_complete = ${data.percentComplete} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.assignedToId !== undefined) { await db.execute(sql`UPDATE project_task SET assigned_to_id = ${data.assignedToId || null} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }
  if (data.sortOrder !== undefined) { await db.execute(sql`UPDATE project_task SET sort_order = ${data.sortOrder} WHERE id = ${taskId} AND company_id = ${companyId}`); hasUpdates = true }

  if (!hasUpdates) return null

  const result = await db.execute(sql`SELECT * FROM project_task WHERE id = ${taskId} AND company_id = ${companyId}`)
  const [task] = (result as any).rows || result as any[]

  if (task) {
    await recalculateSchedule(task.project_id)
  }

  return task
}

/**
 * Get tasks for project (Gantt data)
 */
export async function getProjectTasks(projectId: string, companyId: string) {
  const tasks = (await db.execute(sql`
    SELECT pt.*,
      json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name) as assigned_to
    FROM project_task pt
    LEFT JOIN "user" u ON u.id = pt.assigned_to_id
    WHERE pt.project_id = ${projectId} AND pt.company_id = ${companyId}
    ORDER BY pt.sort_order ASC, pt.start_date ASC
  `)) as any[]

  // Get dependencies
  const deps = (await db.execute(sql`
    SELECT * FROM task_dependency WHERE project_id = ${projectId}
  `)) as any[]

  // Attach dependencies
  const depsMap = new Map<string, any[]>()
  const succsMap = new Map<string, any[]>()
  for (const dep of deps) {
    if (!depsMap.has(dep.successor_id)) depsMap.set(dep.successor_id, [])
    depsMap.get(dep.successor_id)!.push(dep)
    if (!succsMap.has(dep.predecessor_id)) succsMap.set(dep.predecessor_id, [])
    succsMap.get(dep.predecessor_id)!.push(dep)
  }

  for (const task of tasks) {
    task.predecessors = depsMap.get(task.id) || []
    task.successors = succsMap.get(task.id) || []
  }

  // Build hierarchy
  const taskMap = new Map(tasks.map((t: any) => [t.id, { ...t, children: [] as any[] }]))
  const rootTasks: any[] = []

  for (const task of tasks) {
    if (task.parent_id && taskMap.has(task.parent_id)) {
      taskMap.get(task.parent_id)!.children.push(taskMap.get(task.id))
    } else {
      rootTasks.push(taskMap.get(task.id))
    }
  }

  return rootTasks
}

/**
 * Get flat task list for schedule calculations
 */
async function getTasksFlat(projectId: string) {
  const tasks = (await db.execute(sql`
    SELECT * FROM project_task WHERE project_id = ${projectId} ORDER BY sort_order ASC
  `)) as any[]

  const deps = (await db.execute(sql`
    SELECT * FROM task_dependency WHERE project_id = ${projectId}
  `)) as any[]

  const predsMap = new Map<string, any[]>()
  const succsMap = new Map<string, any[]>()
  for (const dep of deps) {
    if (!predsMap.has(dep.successor_id)) predsMap.set(dep.successor_id, [])
    predsMap.get(dep.successor_id)!.push(dep)
    if (!succsMap.has(dep.predecessor_id)) succsMap.set(dep.predecessor_id, [])
    succsMap.get(dep.predecessor_id)!.push(dep)
  }

  for (const task of tasks) {
    task.predecessors = predsMap.get(task.id) || []
    task.successors = succsMap.get(task.id) || []
  }

  return tasks
}

// ============================================
// DEPENDENCIES
// ============================================

/**
 * Add dependency between tasks
 */
export async function addDependency(companyId: string, data: any) {
  const hasCycle = await checkCircularDependency(data.predecessorId, data.successorId, data.projectId)
  if (hasCycle) {
    throw new Error('Cannot create circular dependency')
  }

  const [dependency] = (await db.execute(sql`
    INSERT INTO task_dependency (company_id, project_id, predecessor_id, successor_id, type, lag_days)
    VALUES (${companyId}, ${data.projectId}, ${data.predecessorId}, ${data.successorId}, ${data.type || 'finish_to_start'}, ${data.lagDays || 0})
    RETURNING *
  `)) as any[]

  await recalculateSchedule(data.projectId)

  return dependency
}

/**
 * Remove dependency
 */
export async function removeDependency(dependencyId: string, companyId: string) {
  const [dep] = (await db.execute(sql`
    SELECT * FROM task_dependency WHERE id = ${dependencyId} AND company_id = ${companyId}
  `)) as any[]

  if (!dep) throw new Error('Dependency not found')

  await db.execute(sql`DELETE FROM task_dependency WHERE id = ${dependencyId}`)
  await recalculateSchedule(dep.project_id)
}

/**
 * Check for circular dependencies
 */
async function checkCircularDependency(predecessorId: string, successorId: string, projectId: string): Promise<boolean> {
  const visited = new Set<string>()
  const stack = [predecessorId]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === successorId) return true
    if (visited.has(current)) continue

    visited.add(current)

    const deps = (await db.execute(sql`
      SELECT predecessor_id FROM task_dependency WHERE successor_id = ${current} AND project_id = ${projectId}
    `)) as any[]

    for (const dep of deps) {
      stack.push(dep.predecessor_id)
    }
  }

  return false
}

// ============================================
// SCHEDULE CALCULATIONS
// ============================================

/**
 * Recalculate project schedule based on dependencies
 */
export async function recalculateSchedule(projectId: string) {
  const tasks = await getTasksFlat(projectId)
  if (tasks.length === 0) return

  const predecessorMap = new Map<string, any[]>()
  const successorMap = new Map<string, any[]>()

  for (const task of tasks) {
    predecessorMap.set(task.id, task.predecessors || [])
    successorMap.set(task.id, task.successors || [])
  }

  // Topological sort
  const sorted = topologicalSort(tasks, predecessorMap)

  // Forward pass
  const earlyDates = new Map<string, { earlyStart: Date; earlyFinish: Date }>()
  const [proj] = await db.select({ startDate: project.startDate }).from(project).where(eq(project.id, projectId))
  const projectStart = proj?.startDate || new Date()

  for (const task of sorted) {
    let earlyStart = new Date(projectStart)

    if (task.constraint_type === 'must_start_on' && task.constraint_date) {
      earlyStart = new Date(task.constraint_date)
    }

    const preds = predecessorMap.get(task.id) || []
    for (const pred of preds) {
      const predDates = earlyDates.get(pred.predecessor_id)
      if (!predDates) continue

      let predDate: Date
      switch (pred.type) {
        case 'finish_to_start':
          predDate = new Date(predDates.earlyFinish)
          break
        case 'start_to_start':
          predDate = new Date(predDates.earlyStart)
          break
        case 'finish_to_finish':
          predDate = new Date(predDates.earlyFinish)
          predDate.setDate(predDate.getDate() - (task.duration || 1))
          break
        case 'start_to_finish':
          predDate = new Date(predDates.earlyStart)
          predDate.setDate(predDate.getDate() - (task.duration || 1))
          break
        default:
          predDate = new Date(predDates.earlyFinish)
      }

      if (pred.lag_days) {
        predDate.setDate(predDate.getDate() + pred.lag_days)
      }

      if (predDate > earlyStart) {
        earlyStart = predDate
      }
    }

    const earlyFinish = new Date(earlyStart)
    earlyFinish.setDate(earlyFinish.getDate() + (task.duration || 1) - 1)

    earlyDates.set(task.id, { earlyStart, earlyFinish })
  }

  // Backward pass
  const lateDates = new Map<string, { lateStart: Date; lateFinish: Date }>()
  const projectEnd = Math.max(...Array.from(earlyDates.values()).map((d) => d.earlyFinish.getTime()))

  for (let i = sorted.length - 1; i >= 0; i--) {
    const task = sorted[i]
    let lateFinish = new Date(projectEnd)

    if (task.constraint_type === 'must_finish_on' && task.constraint_date) {
      lateFinish = new Date(task.constraint_date)
    }

    const succs = successorMap.get(task.id) || []
    for (const succ of succs) {
      const succDates = lateDates.get(succ.successor_id)
      if (!succDates) continue

      let succDate: Date
      switch (succ.type) {
        case 'finish_to_start':
          succDate = new Date(succDates.lateStart)
          succDate.setDate(succDate.getDate() - 1)
          break
        case 'start_to_start':
          succDate = new Date(succDates.lateStart)
          succDate.setDate(succDate.getDate() + (task.duration || 1) - 1)
          break
        default:
          succDate = new Date(succDates.lateStart)
          succDate.setDate(succDate.getDate() - 1)
      }

      if (succ.lag_days) {
        succDate.setDate(succDate.getDate() - succ.lag_days)
      }

      if (succDate < lateFinish) {
        lateFinish = succDate
      }
    }

    const lateStart = new Date(lateFinish)
    lateStart.setDate(lateStart.getDate() - (task.duration || 1) + 1)

    lateDates.set(task.id, { lateStart, lateFinish })
  }

  // Update tasks
  for (const task of tasks) {
    const early = earlyDates.get(task.id)
    const late = lateDates.get(task.id)

    if (early && late) {
      const totalFloat = Math.round(
        (late.lateStart.getTime() - early.earlyStart.getTime()) / (1000 * 60 * 60 * 24)
      )
      const isCritical = totalFloat === 0

      await db.execute(sql`
        UPDATE project_task SET
          start_date = ${early.earlyStart},
          end_date = ${early.earlyFinish},
          early_start = ${early.earlyStart},
          early_finish = ${early.earlyFinish},
          late_start = ${late.lateStart},
          late_finish = ${late.lateFinish},
          total_float = ${totalFloat},
          is_critical = ${isCritical}
        WHERE id = ${task.id}
      `)
    }
  }
}

/**
 * Topological sort of tasks
 */
function topologicalSort(tasks: any[], predecessorMap: Map<string, any[]>): any[] {
  const sorted: any[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(task: any) {
    if (visited.has(task.id)) return
    if (visiting.has(task.id)) {
      throw new Error('Circular dependency detected')
    }

    visiting.add(task.id)

    const preds = predecessorMap.get(task.id) || []
    for (const pred of preds) {
      const predTask = tasks.find((t) => t.id === pred.predecessor_id)
      if (predTask) visit(predTask)
    }

    visiting.delete(task.id)
    visited.add(task.id)
    sorted.push(task)
  }

  for (const task of tasks) {
    visit(task)
  }

  return sorted
}

// ============================================
// CRITICAL PATH
// ============================================

/**
 * Get critical path tasks
 */
export async function getCriticalPath(projectId: string, companyId: string) {
  return (await db.execute(sql`
    SELECT * FROM project_task
    WHERE project_id = ${projectId} AND company_id = ${companyId} AND is_critical = true
    ORDER BY start_date ASC
  `)) as any[]
}

// ============================================
// BASELINE
// ============================================

/**
 * Set baseline for project
 */
export async function setBaseline(projectId: string, companyId: string) {
  const tasks = (await db.execute(sql`
    SELECT * FROM project_task WHERE project_id = ${projectId} AND company_id = ${companyId}
  `)) as any[]

  for (const task of tasks) {
    await db.execute(sql`
      UPDATE project_task SET baseline_start = ${task.start_date}, baseline_end = ${task.end_date}, baseline_duration = ${task.duration}
      WHERE id = ${task.id}
    `)
  }

  await db.execute(sql`
    INSERT INTO project_baseline (company_id, project_id, name, created_at, task_snapshots)
    VALUES (${companyId}, ${projectId}, ${'Baseline ' + new Date().toLocaleDateString()}, ${new Date()}, ${JSON.stringify(tasks.map((t: any) => ({ taskId: t.id, startDate: t.start_date, endDate: t.end_date, duration: t.duration })))})
  `)

  return { success: true, tasksUpdated: tasks.length }
}

/**
 * Get schedule variance from baseline
 */
export async function getScheduleVariance(projectId: string, companyId: string) {
  const tasks = (await db.execute(sql`
    SELECT * FROM project_task WHERE project_id = ${projectId} AND company_id = ${companyId}
  `)) as any[]

  return tasks.map((task: any) => {
    const startVariance =
      task.baseline_start && task.start_date
        ? Math.round(
            (new Date(task.start_date).getTime() - new Date(task.baseline_start).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null

    const endVariance =
      task.baseline_end && task.end_date
        ? Math.round(
            (new Date(task.end_date).getTime() - new Date(task.baseline_end).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null

    return {
      ...task,
      startVariance,
      endVariance,
      isDelayed: (startVariance ?? 0) > 0 || (endVariance ?? 0) > 0,
    }
  })
}

// ============================================
// GANTT DATA EXPORT
// ============================================

/**
 * Get Gantt chart data in standard format
 */
export async function getGanttData(projectId: string, companyId: string) {
  const tasks = await getProjectTasks(projectId, companyId)
  const [proj] = await db.select().from(project).where(eq(project.id, projectId))

  const flattenTasks = (tasks: any[], level = 0): any[] => {
    const result: any[] = []
    for (const task of tasks) {
      result.push({
        id: task.id,
        name: task.name,
        start: task.start_date,
        end: task.end_date,
        duration: task.duration,
        progress: task.percent_complete,
        dependencies: (task.predecessors || []).map((p: any) => ({
          id: p.predecessor_id,
          type: p.type,
          lag: p.lag_days,
        })),
        assignee: task.assigned_to?.firstName
          ? `${task.assigned_to.firstName} ${task.assigned_to.lastName}`
          : null,
        isMilestone: task.is_milestone,
        isCritical: task.is_critical,
        level,
        color: task.color,
        parentId: task.parent_id,
      })

      if (task.children?.length > 0) {
        result.push(...flattenTasks(task.children, level + 1))
      }
    }
    return result
  }

  return {
    project: {
      id: proj.id,
      name: proj.name,
      startDate: proj.startDate,
      endDate: proj.endDate,
    },
    tasks: flattenTasks(tasks),
  }
}

export default {
  createTask,
  updateTask,
  getProjectTasks,
  addDependency,
  removeDependency,
  recalculateSchedule,
  getCriticalPath,
  setBaseline,
  getScheduleVariance,
  getGanttData,
  DEPENDENCY_TYPES,
}
