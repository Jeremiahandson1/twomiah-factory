/**
 * Advanced Project Scheduling Service
 * 
 * Gantt chart with dependencies:
 * - Task dependencies (finish-to-start, start-to-start, etc.)
 * - Critical path calculation
 * - Auto-scheduling based on dependencies
 * - Resource leveling
 * - Baseline tracking
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Dependency types
const DEPENDENCY_TYPES = {
  FS: 'finish_to_start',  // Task B starts when Task A finishes (most common)
  SS: 'start_to_start',   // Task B starts when Task A starts
  FF: 'finish_to_finish', // Task B finishes when Task A finishes
  SF: 'start_to_finish',  // Task B finishes when Task A starts (rare)
};

// ============================================
// PROJECT PHASES/TASKS
// ============================================

/**
 * Create project phase/task
 */
export async function createTask(companyId, data) {
  const task = await prisma.projectTask.create({
    data: {
      companyId,
      projectId: data.projectId,
      parentId: data.parentId, // For subtasks
      
      name: data.name,
      description: data.description,
      
      // Dates
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      duration: data.duration || 1, // Days
      
      // Progress
      percentComplete: data.percentComplete || 0,
      
      // Type
      isMilestone: data.isMilestone || false,
      
      // Assignment
      assignedToId: data.assignedToId,
      
      // Order for display
      sortOrder: data.sortOrder || 0,
      wbsCode: data.wbsCode, // Work breakdown structure code
      
      // Scheduling
      constraint: data.constraint || 'asap', // asap, alap, must_start_on, must_finish_on
      constraintDate: data.constraintDate ? new Date(data.constraintDate) : null,
      
      // Baseline (for tracking variance)
      baselineStart: data.startDate ? new Date(data.startDate) : null,
      baselineEnd: data.endDate ? new Date(data.endDate) : null,
      
      // Color for Gantt
      color: data.color,
    },
  });

  // Recalculate project schedule
  await recalculateSchedule(data.projectId);

  return task;
}

/**
 * Update task
 */
export async function updateTask(taskId, companyId, data) {
  const task = await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      constraintDate: data.constraintDate ? new Date(data.constraintDate) : undefined,
    },
  });

  // Recalculate schedule
  await recalculateSchedule(task.projectId);

  return task;
}

/**
 * Get tasks for project (Gantt data)
 */
export async function getProjectTasks(projectId, companyId) {
  const tasks = await prisma.projectTask.findMany({
    where: { projectId, companyId },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      predecessors: {
        include: { predecessor: { select: { id: true, name: true } } },
      },
      successors: {
        include: { successor: { select: { id: true, name: true } } },
      },
      children: {
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }],
  });

  // Build hierarchy
  const taskMap = new Map(tasks.map(t => [t.id, { ...t, children: [] }]));
  const rootTasks = [];

  for (const task of tasks) {
    if (task.parentId && taskMap.has(task.parentId)) {
      taskMap.get(task.parentId).children.push(taskMap.get(task.id));
    } else {
      rootTasks.push(taskMap.get(task.id));
    }
  }

  return rootTasks;
}

/**
 * Get flat task list for schedule calculations
 */
async function getTasksFlat(projectId) {
  return prisma.projectTask.findMany({
    where: { projectId },
    include: {
      predecessors: true,
      successors: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
}

// ============================================
// DEPENDENCIES
// ============================================

/**
 * Add dependency between tasks
 */
export async function addDependency(companyId, data) {
  // Validate no circular dependency
  const hasCycle = await checkCircularDependency(
    data.predecessorId,
    data.successorId,
    data.projectId
  );
  
  if (hasCycle) {
    throw new Error('Cannot create circular dependency');
  }

  const dependency = await prisma.taskDependency.create({
    data: {
      companyId,
      projectId: data.projectId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type || 'finish_to_start',
      lagDays: data.lagDays || 0, // Positive = delay, negative = lead
    },
  });

  // Recalculate schedule
  await recalculateSchedule(data.projectId);

  return dependency;
}

/**
 * Remove dependency
 */
export async function removeDependency(dependencyId, companyId) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, companyId },
  });
  
  if (!dep) throw new Error('Dependency not found');

  await prisma.taskDependency.delete({ where: { id: dependencyId } });

  // Recalculate schedule
  await recalculateSchedule(dep.projectId);
}

/**
 * Check for circular dependencies
 */
async function checkCircularDependency(predecessorId, successorId, projectId) {
  // If adding predecessorId as predecessor of successorId,
  // check if successorId is already a predecessor of predecessorId (directly or indirectly)
  
  const visited = new Set();
  const stack = [predecessorId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === successorId) return true;
    if (visited.has(current)) continue;
    
    visited.add(current);

    const deps = await prisma.taskDependency.findMany({
      where: { successorId: current, projectId },
      select: { predecessorId: true },
    });

    for (const dep of deps) {
      stack.push(dep.predecessorId);
    }
  }

  return false;
}

// ============================================
// SCHEDULE CALCULATIONS
// ============================================

/**
 * Recalculate project schedule based on dependencies
 */
export async function recalculateSchedule(projectId) {
  const tasks = await getTasksFlat(projectId);
  
  if (tasks.length === 0) return;

  // Build adjacency list
  const predecessorMap = new Map(); // taskId -> [dependency info]
  const successorMap = new Map();   // taskId -> [dependency info]
  
  for (const task of tasks) {
    predecessorMap.set(task.id, []);
    successorMap.set(task.id, []);
  }

  for (const task of tasks) {
    for (const pred of task.predecessors) {
      predecessorMap.get(task.id).push(pred);
    }
    for (const succ of task.successors) {
      successorMap.get(task.id).push(succ);
    }
  }

  // Topological sort
  const sorted = topologicalSort(tasks, predecessorMap);

  // Forward pass - calculate early start/early finish
  const earlyDates = new Map();
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const projectStart = project?.startDate || new Date();

  for (const task of sorted) {
    let earlyStart = new Date(projectStart);

    // Check constraint
    if (task.constraint === 'must_start_on' && task.constraintDate) {
      earlyStart = new Date(task.constraintDate);
    }

    // Check predecessors
    const preds = predecessorMap.get(task.id);
    for (const pred of preds) {
      const predDates = earlyDates.get(pred.predecessorId);
      if (!predDates) continue;

      let predDate;
      switch (pred.type) {
        case 'finish_to_start':
          predDate = new Date(predDates.earlyFinish);
          break;
        case 'start_to_start':
          predDate = new Date(predDates.earlyStart);
          break;
        case 'finish_to_finish':
          predDate = new Date(predDates.earlyFinish);
          predDate.setDate(predDate.getDate() - task.duration);
          break;
        case 'start_to_finish':
          predDate = new Date(predDates.earlyStart);
          predDate.setDate(predDate.getDate() - task.duration);
          break;
        default:
          predDate = new Date(predDates.earlyFinish);
      }

      // Add lag
      if (pred.lagDays) {
        predDate.setDate(predDate.getDate() + pred.lagDays);
      }

      if (predDate > earlyStart) {
        earlyStart = predDate;
      }
    }

    const earlyFinish = new Date(earlyStart);
    earlyFinish.setDate(earlyFinish.getDate() + (task.duration || 1) - 1);

    earlyDates.set(task.id, {
      earlyStart,
      earlyFinish,
    });
  }

  // Backward pass - calculate late start/late finish
  const lateDates = new Map();
  const projectEnd = Math.max(...Array.from(earlyDates.values()).map(d => d.earlyFinish.getTime()));

  for (let i = sorted.length - 1; i >= 0; i--) {
    const task = sorted[i];
    let lateFinish = new Date(projectEnd);

    // Check constraint
    if (task.constraint === 'must_finish_on' && task.constraintDate) {
      lateFinish = new Date(task.constraintDate);
    }

    // Check successors
    const succs = successorMap.get(task.id);
    for (const succ of succs) {
      const succDates = lateDates.get(succ.successorId);
      if (!succDates) continue;

      let succDate;
      switch (succ.type) {
        case 'finish_to_start':
          succDate = new Date(succDates.lateStart);
          succDate.setDate(succDate.getDate() - 1);
          break;
        case 'start_to_start':
          succDate = new Date(succDates.lateStart);
          succDate.setDate(succDate.getDate() + task.duration - 1);
          break;
        default:
          succDate = new Date(succDates.lateStart);
          succDate.setDate(succDate.getDate() - 1);
      }

      // Subtract lag
      if (succ.lagDays) {
        succDate.setDate(succDate.getDate() - succ.lagDays);
      }

      if (succDate < lateFinish) {
        lateFinish = succDate;
      }
    }

    const lateStart = new Date(lateFinish);
    lateStart.setDate(lateStart.getDate() - (task.duration || 1) + 1);

    lateDates.set(task.id, {
      lateStart,
      lateFinish,
    });
  }

  // Update tasks with calculated dates
  for (const task of tasks) {
    const early = earlyDates.get(task.id);
    const late = lateDates.get(task.id);

    if (early && late) {
      const totalFloat = Math.round((late.lateStart - early.earlyStart) / (1000 * 60 * 60 * 24));
      const isCritical = totalFloat === 0;

      await prisma.projectTask.update({
        where: { id: task.id },
        data: {
          startDate: early.earlyStart,
          endDate: early.earlyFinish,
          earlyStart: early.earlyStart,
          earlyFinish: early.earlyFinish,
          lateStart: late.lateStart,
          lateFinish: late.lateFinish,
          totalFloat,
          isCritical,
        },
      });
    }
  }
}

/**
 * Topological sort of tasks
 */
function topologicalSort(tasks, predecessorMap) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(task) {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) {
      throw new Error('Circular dependency detected');
    }

    visiting.add(task.id);

    const preds = predecessorMap.get(task.id) || [];
    for (const pred of preds) {
      const predTask = tasks.find(t => t.id === pred.predecessorId);
      if (predTask) visit(predTask);
    }

    visiting.delete(task.id);
    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

// ============================================
// CRITICAL PATH
// ============================================

/**
 * Get critical path tasks
 */
export async function getCriticalPath(projectId, companyId) {
  return prisma.projectTask.findMany({
    where: {
      projectId,
      companyId,
      isCritical: true,
    },
    orderBy: { startDate: 'asc' },
  });
}

// ============================================
// BASELINE
// ============================================

/**
 * Set baseline for project
 */
export async function setBaseline(projectId, companyId) {
  const tasks = await prisma.projectTask.findMany({
    where: { projectId, companyId },
  });

  for (const task of tasks) {
    await prisma.projectTask.update({
      where: { id: task.id },
      data: {
        baselineStart: task.startDate,
        baselineEnd: task.endDate,
        baselineDuration: task.duration,
      },
    });
  }

  // Log baseline creation
  await prisma.projectBaseline.create({
    data: {
      companyId,
      projectId,
      name: `Baseline ${new Date().toLocaleDateString()}`,
      createdAt: new Date(),
      taskSnapshots: tasks.map(t => ({
        taskId: t.id,
        startDate: t.startDate,
        endDate: t.endDate,
        duration: t.duration,
      })),
    },
  });

  return { success: true, tasksUpdated: tasks.length };
}

/**
 * Get schedule variance from baseline
 */
export async function getScheduleVariance(projectId, companyId) {
  const tasks = await prisma.projectTask.findMany({
    where: { projectId, companyId },
  });

  return tasks.map(task => {
    const startVariance = task.baselineStart && task.startDate
      ? Math.round((task.startDate - task.baselineStart) / (1000 * 60 * 60 * 24))
      : null;
    
    const endVariance = task.baselineEnd && task.endDate
      ? Math.round((task.endDate - task.baselineEnd) / (1000 * 60 * 60 * 24))
      : null;

    return {
      ...task,
      startVariance, // Positive = late, negative = early
      endVariance,
      isDelayed: startVariance > 0 || endVariance > 0,
    };
  });
}

// ============================================
// GANTT DATA EXPORT
// ============================================

/**
 * Get Gantt chart data in standard format
 */
export async function getGanttData(projectId, companyId) {
  const tasks = await getProjectTasks(projectId, companyId);
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  const flattenTasks = (tasks, level = 0) => {
    const result = [];
    for (const task of tasks) {
      result.push({
        id: task.id,
        name: task.name,
        start: task.startDate,
        end: task.endDate,
        duration: task.duration,
        progress: task.percentComplete,
        dependencies: task.predecessors.map(p => ({
          id: p.predecessorId,
          type: p.type,
          lag: p.lagDays,
        })),
        assignee: task.assignedTo 
          ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` 
          : null,
        isMilestone: task.isMilestone,
        isCritical: task.isCritical,
        level,
        color: task.color,
        parentId: task.parentId,
      });
      
      if (task.children?.length > 0) {
        result.push(...flattenTasks(task.children, level + 1));
      }
    }
    return result;
  };

  return {
    project: {
      id: project.id,
      name: project.name,
      startDate: project.startDate,
      endDate: project.endDate,
    },
    tasks: flattenTasks(tasks),
  };
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
};
