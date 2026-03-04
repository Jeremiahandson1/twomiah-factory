/**
 * Tasks/To-Do Service
 * 
 * Simple task management:
 * - Create tasks with due dates
 * - Assign to users
 * - Link to projects/jobs
 * - Priority levels
 * - Checklists
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}) {
  return prisma.task.create({
    data: {
      companyId,
      createdById,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : null,
      priority,
      assignedToId,
      projectId,
      jobId,
      contactId,
      checklist: checklist.map((item, i) => ({
        id: `item-${i}`,
        text: item,
        completed: false,
      })),
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      project: { select: { id: true, name: true, number: true } },
      job: { select: { id: true, title: true, number: true } },
      contact: { select: { id: true, name: true } },
    },
  });
}

/**
 * Get tasks with filters
 */
export async function getTasks(companyId, {
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
  sortBy = 'dueDate',
  sortOrder = 'asc',
} = {}) {
  const where = { companyId };

  if (assignedToId) where.assignedToId = assignedToId;
  if (createdById) where.createdById = createdById;
  if (projectId) where.projectId = projectId;
  if (jobId) where.jobId = jobId;
  if (contactId) where.contactId = contactId;
  if (status) where.status = status;
  if (priority) where.priority = priority;

  if (dueBefore || dueAfter) {
    where.dueDate = {};
    if (dueBefore) where.dueDate.lte = new Date(dueBefore);
    if (dueAfter) where.dueDate.gte = new Date(dueAfter);
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true, number: true } },
        job: { select: { id: true, title: true, number: true } },
        contact: { select: { id: true, name: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get a single task
 */
export async function getTask(taskId, companyId) {
  return prisma.task.findFirst({
    where: { id: taskId, companyId },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      project: { select: { id: true, name: true, number: true } },
      job: { select: { id: true, title: true, number: true } },
      contact: { select: { id: true, name: true } },
    },
  });
}

/**
 * Update a task
 */
export async function updateTask(taskId, companyId, data) {
  const task = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!task) return null;

  const updateData = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === 'completed') {
      updateData.completedAt = new Date();
    } else {
      updateData.completedAt = null;
    }
  }
  if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId || null;
  if (data.projectId !== undefined) updateData.projectId = data.projectId || null;
  if (data.jobId !== undefined) updateData.jobId = data.jobId || null;
  if (data.contactId !== undefined) updateData.contactId = data.contactId || null;
  if (data.checklist !== undefined) updateData.checklist = data.checklist;

  return prisma.task.update({
    where: { id: taskId },
    data: updateData,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      project: { select: { id: true, name: true } },
      job: { select: { id: true, title: true } },
    },
  });
}

/**
 * Toggle task completion
 */
export async function toggleTaskComplete(taskId, companyId) {
  const task = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!task) return null;

  const newStatus = task.status === 'completed' ? 'pending' : 'completed';

  return prisma.task.update({
    where: { id: taskId },
    data: {
      status: newStatus,
      completedAt: newStatus === 'completed' ? new Date() : null,
    },
  });
}

/**
 * Toggle checklist item
 */
export async function toggleChecklistItem(taskId, companyId, itemId) {
  const task = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!task) return null;

  const checklist = (task.checklist || []).map(item => {
    if (item.id === itemId) {
      return { ...item, completed: !item.completed };
    }
    return item;
  });

  return prisma.task.update({
    where: { id: taskId },
    data: { checklist },
  });
}

/**
 * Delete a task
 */
export async function deleteTask(taskId, companyId) {
  const task = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!task) return false;

  await prisma.task.delete({ where: { id: taskId } });
  return true;
}

/**
 * Get tasks due soon (for dashboard/notifications)
 */
export async function getUpcomingTasks(companyId, userId, { days = 7 } = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  return prisma.task.findMany({
    where: {
      companyId,
      assignedToId: userId,
      status: { not: 'completed' },
      dueDate: {
        lte: dueDate,
        gte: new Date(),
      },
    },
    include: {
      project: { select: { name: true } },
      job: { select: { title: true } },
    },
    orderBy: { dueDate: 'asc' },
    take: 10,
  });
}

/**
 * Get overdue tasks
 */
export async function getOverdueTasks(companyId, userId) {
  return prisma.task.findMany({
    where: {
      companyId,
      assignedToId: userId,
      status: { not: 'completed' },
      dueDate: { lt: new Date() },
    },
    include: {
      project: { select: { name: true } },
      job: { select: { title: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
}

/**
 * Get task stats for a user
 */
export async function getTaskStats(companyId, userId) {
  const [total, completed, pending, overdue] = await Promise.all([
    prisma.task.count({ where: { companyId, assignedToId: userId } }),
    prisma.task.count({ where: { companyId, assignedToId: userId, status: 'completed' } }),
    prisma.task.count({ where: { companyId, assignedToId: userId, status: { not: 'completed' } } }),
    prisma.task.count({
      where: {
        companyId,
        assignedToId: userId,
        status: { not: 'completed' },
        dueDate: { lt: new Date() },
      },
    }),
  ]);

  return { total, completed, pending, overdue };
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
};
