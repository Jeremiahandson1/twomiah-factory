/**
 * Time Tracking Service
 * 
 * Track time spent on jobs and projects.
 * Supports:
 * - Clock in/out
 * - Manual time entries
 * - Break tracking
 * - Reports by user/project/date
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Start a time entry (clock in)
 */
export async function clockIn({ userId, companyId, jobId, projectId, notes }) {
  // Check for existing active entry
  const activeEntry = await prisma.timeEntry.findFirst({
    where: {
      userId,
      companyId,
      endTime: null,
    },
  });

  if (activeEntry) {
    throw new Error('Already clocked in. Please clock out first.');
  }

  return prisma.timeEntry.create({
    data: {
      userId,
      companyId,
      jobId: jobId || null,
      projectId: projectId || null,
      startTime: new Date(),
      notes,
      status: 'active',
    },
    include: {
      job: { select: { title: true, number: true } },
      project: { select: { name: true, number: true } },
    },
  });
}

/**
 * Stop a time entry (clock out)
 */
export async function clockOut(entryId, { notes, breakMinutes } = {}) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error('Time entry not found');
  }

  if (entry.endTime) {
    throw new Error('Already clocked out');
  }

  const endTime = new Date();
  const totalMinutes = Math.round((endTime - entry.startTime) / 60000);
  const workedMinutes = totalMinutes - (breakMinutes || entry.breakMinutes || 0);

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      endTime,
      totalMinutes,
      breakMinutes: breakMinutes || entry.breakMinutes || 0,
      workedMinutes,
      notes: notes || entry.notes,
      status: 'completed',
    },
    include: {
      job: { select: { title: true, number: true } },
      project: { select: { name: true, number: true } },
    },
  });
}

/**
 * Get current active entry for a user
 */
export async function getActiveEntry(userId, companyId) {
  return prisma.timeEntry.findFirst({
    where: {
      userId,
      companyId,
      endTime: null,
    },
    include: {
      job: { select: { id: true, title: true, number: true } },
      project: { select: { id: true, name: true, number: true } },
    },
  });
}

/**
 * Create a manual time entry
 */
export async function createManualEntry({
  userId,
  companyId,
  jobId,
  projectId,
  date,
  startTime,
  endTime,
  breakMinutes = 0,
  notes,
  hourlyRate,
}) {
  // Parse date and times
  const entryDate = new Date(date);
  
  // Combine date with times
  const start = parseTimeToDate(entryDate, startTime);
  const end = parseTimeToDate(entryDate, endTime);

  if (end <= start) {
    throw new Error('End time must be after start time');
  }

  const totalMinutes = Math.round((end - start) / 60000);
  const workedMinutes = totalMinutes - breakMinutes;

  return prisma.timeEntry.create({
    data: {
      userId,
      companyId,
      jobId: jobId || null,
      projectId: projectId || null,
      date: entryDate,
      startTime: start,
      endTime: end,
      totalMinutes,
      breakMinutes,
      workedMinutes,
      notes,
      hourlyRate: hourlyRate || null,
      status: 'completed',
      isManual: true,
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      job: { select: { title: true, number: true } },
      project: { select: { name: true, number: true } },
    },
  });
}

/**
 * Update a time entry
 */
export async function updateEntry(entryId, companyId, data) {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, companyId },
  });

  if (!entry) {
    return null;
  }

  const updateData = {};

  if (data.jobId !== undefined) updateData.jobId = data.jobId || null;
  if (data.projectId !== undefined) updateData.projectId = data.projectId || null;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.breakMinutes !== undefined) updateData.breakMinutes = data.breakMinutes;
  if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate;
  if (data.billable !== undefined) updateData.billable = data.billable;
  if (data.approved !== undefined) {
    updateData.approved = data.approved;
    updateData.approvedAt = data.approved ? new Date() : null;
    updateData.approvedById = data.approvedById || null;
  }

  // Recalculate worked minutes if break changed
  if (data.breakMinutes !== undefined && entry.totalMinutes) {
    updateData.workedMinutes = entry.totalMinutes - data.breakMinutes;
  }

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: updateData,
    include: {
      user: { select: { firstName: true, lastName: true } },
      job: { select: { title: true, number: true } },
      project: { select: { name: true, number: true } },
    },
  });
}

/**
 * Delete a time entry
 */
export async function deleteEntry(entryId, companyId) {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, companyId },
  });

  if (!entry) {
    return false;
  }

  await prisma.timeEntry.delete({ where: { id: entryId } });
  return true;
}

/**
 * Get time entries with filters
 */
export async function getEntries({
  companyId,
  userId,
  jobId,
  projectId,
  startDate,
  endDate,
  status,
  approved,
  page = 1,
  limit = 50,
}) {
  const where = { companyId };

  if (userId) where.userId = userId;
  if (jobId) where.jobId = jobId;
  if (projectId) where.projectId = projectId;
  if (status) where.status = status;
  if (approved !== undefined) where.approved = approved;

  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.startTime.lte = end;
    }
  }

  const [data, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        job: { select: { id: true, title: true, number: true } },
        project: { select: { id: true, name: true, number: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startTime: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.timeEntry.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get time summary by user for a date range
 */
export async function getUserSummary(companyId, { startDate, endDate }) {
  const where = {
    companyId,
    status: 'completed',
    startTime: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  };

  const entries = await prisma.timeEntry.groupBy({
    by: ['userId'],
    where,
    _sum: {
      workedMinutes: true,
    },
    _count: true,
  });

  // Get user details
  const userIds = entries.map(e => e.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const userMap = new Map(users.map(u => [u.id, u]));

  return entries.map(e => ({
    user: userMap.get(e.userId),
    totalMinutes: e._sum.workedMinutes || 0,
    totalHours: Math.round((e._sum.workedMinutes || 0) / 60 * 100) / 100,
    entryCount: e._count,
  }));
}

/**
 * Get time summary by project for a date range
 */
export async function getProjectSummary(companyId, { startDate, endDate }) {
  const where = {
    companyId,
    status: 'completed',
    projectId: { not: null },
    startTime: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  };

  const entries = await prisma.timeEntry.groupBy({
    by: ['projectId'],
    where,
    _sum: {
      workedMinutes: true,
    },
    _count: true,
  });

  // Get project details
  const projectIds = entries.map(e => e.projectId).filter(Boolean);
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true, number: true },
  });

  const projectMap = new Map(projects.map(p => [p.id, p]));

  return entries.map(e => ({
    project: projectMap.get(e.projectId),
    totalMinutes: e._sum.workedMinutes || 0,
    totalHours: Math.round((e._sum.workedMinutes || 0) / 60 * 100) / 100,
    entryCount: e._count,
  }));
}

/**
 * Get weekly timesheet for a user
 */
export async function getWeeklyTimesheet(userId, companyId, weekStart) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      companyId,
      status: 'completed',
      startTime: {
        gte: start,
        lt: end,
      },
    },
    include: {
      job: { select: { title: true, number: true } },
      project: { select: { name: true, number: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  // Group by day
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + i);
    
    const dayEntries = entries.filter(e => {
      const entryDate = new Date(e.startTime);
      return entryDate.toDateString() === dayDate.toDateString();
    });

    const totalMinutes = dayEntries.reduce((sum, e) => sum + (e.workedMinutes || 0), 0);

    days.push({
      date: dayDate,
      dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
      entries: dayEntries,
      totalMinutes,
      totalHours: Math.round(totalMinutes / 60 * 100) / 100,
    });
  }

  const weekTotal = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return {
    weekStart: start,
    weekEnd: end,
    days,
    totalMinutes: weekTotal,
    totalHours: Math.round(weekTotal / 60 * 100) / 100,
  };
}

/**
 * Approve time entries
 */
export async function approveEntries(entryIds, companyId, approvedById) {
  const result = await prisma.timeEntry.updateMany({
    where: {
      id: { in: entryIds },
      companyId,
    },
    data: {
      approved: true,
      approvedAt: new Date(),
      approvedById,
    },
  });

  return result.count;
}

/**
 * Helper: Parse time string to date
 */
function parseTimeToDate(date, timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Format minutes as hours:minutes
 */
export function formatDuration(minutes) {
  if (!minutes) return '0:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

export default {
  clockIn,
  clockOut,
  getActiveEntry,
  createManualEntry,
  updateEntry,
  deleteEntry,
  getEntries,
  getUserSummary,
  getProjectSummary,
  getWeeklyTimesheet,
  approveEntries,
  formatDuration,
};
