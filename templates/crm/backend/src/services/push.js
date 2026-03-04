/**
 * Push Notifications Service
 * 
 * Uses Web Push API for browser notifications
 * Supports FCM (Firebase) or custom VAPID keys
 */

import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configure VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@twomiah-build.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/**
 * Save push subscription for a user
 */
export async function saveSubscription(userId, subscription) {
  // Check if subscription already exists
  const existing = await prisma.pushSubscription.findFirst({
    where: {
      userId,
      endpoint: subscription.endpoint,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.pushSubscription.create({
    data: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent,
    },
  });
}

/**
 * Remove push subscription
 */
export async function removeSubscription(userId, endpoint) {
  return prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
}

/**
 * Get all subscriptions for a user
 */
export async function getUserSubscriptions(userId) {
  return prisma.pushSubscription.findMany({
    where: { userId },
  });
}

/**
 * Send push notification to a user
 */
export async function sendToUser(userId, notification) {
  const subscriptions = await getUserSubscriptions(userId);
  
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    icon: notification.icon || '/icons/icon-192.png',
    badge: notification.badge || '/icons/icon-72.png',
    url: notification.url || '/',
    actions: notification.actions || [],
    data: notification.data || {},
  });

  const results = { sent: 0, failed: 0, errors: [] };

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      );
      results.sent++;
    } catch (error) {
      results.failed++;
      results.errors.push({ endpoint: sub.endpoint, error: error.message });

      // Remove invalid subscriptions
      if (error.statusCode === 410 || error.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      }
    }
  }

  return results;
}

/**
 * Send push notification to multiple users
 */
export async function sendToUsers(userIds, notification) {
  const results = { sent: 0, failed: 0 };

  for (const userId of userIds) {
    const result = await sendToUser(userId, notification);
    results.sent += result.sent;
    results.failed += result.failed;
  }

  return results;
}

/**
 * Send to all company users
 */
export async function sendToCompany(companyId, notification, { excludeUserId } = {}) {
  const users = await prisma.user.findMany({
    where: { 
      companyId,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });

  return sendToUsers(users.map(u => u.id), notification);
}

/**
 * Send notification for specific events
 */
export const NotificationEvents = {
  // Jobs
  async jobAssigned(job, assignee) {
    return sendToUser(assignee.id, {
      title: 'New Job Assigned',
      body: `You've been assigned to ${job.title}`,
      url: `/jobs/${job.id}`,
      data: { type: 'job_assigned', jobId: job.id },
    });
  },

  async jobStatusChanged(job, companyId) {
    return sendToCompany(companyId, {
      title: `Job ${job.status}`,
      body: `${job.title} is now ${job.status}`,
      url: `/jobs/${job.id}`,
      data: { type: 'job_status', jobId: job.id },
    });
  },

  // Quotes
  async quoteApproved(quote, companyId) {
    return sendToCompany(companyId, {
      title: 'Quote Approved!',
      body: `Quote ${quote.number} has been approved by the customer`,
      url: `/quotes/${quote.id}`,
      data: { type: 'quote_approved', quoteId: quote.id },
    });
  },

  // Invoices
  async invoicePaid(invoice, companyId) {
    return sendToCompany(companyId, {
      title: 'Payment Received!',
      body: `Invoice ${invoice.number} has been paid`,
      url: `/invoices/${invoice.id}`,
      data: { type: 'invoice_paid', invoiceId: invoice.id },
    });
  },

  async invoiceOverdue(invoice, companyId) {
    return sendToCompany(companyId, {
      title: 'Invoice Overdue',
      body: `Invoice ${invoice.number} is now overdue`,
      url: `/invoices/${invoice.id}`,
      data: { type: 'invoice_overdue', invoiceId: invoice.id },
    });
  },

  // Comments
  async newComment(comment, mentionedUserIds) {
    if (!mentionedUserIds?.length) return { sent: 0, failed: 0 };

    return sendToUsers(mentionedUserIds, {
      title: 'You were mentioned',
      body: `${comment.user?.firstName} mentioned you in a comment`,
      url: `/${comment.entityType}s/${comment.entityId}`,
      data: { type: 'mention', commentId: comment.id },
    });
  },

  // Tasks
  async taskAssigned(task, assigneeId) {
    return sendToUser(assigneeId, {
      title: 'New Task Assigned',
      body: task.title,
      url: `/tasks`,
      data: { type: 'task_assigned', taskId: task.id },
    });
  },

  async taskDueSoon(task) {
    return sendToUser(task.assignedToId, {
      title: 'Task Due Soon',
      body: `"${task.title}" is due ${formatDueDate(task.dueDate)}`,
      url: `/tasks`,
      data: { type: 'task_due', taskId: task.id },
    });
  },

  // Schedule
  async dailyReminder(userId, jobs) {
    if (jobs.length === 0) return { sent: 0, failed: 0 };

    return sendToUser(userId, {
      title: `${jobs.length} jobs scheduled today`,
      body: jobs.slice(0, 2).map(j => j.title).join(', ') + (jobs.length > 2 ? '...' : ''),
      url: '/schedule',
      data: { type: 'daily_reminder' },
    });
  },
};

/**
 * Get VAPID public key for client
 */
export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

/**
 * Generate VAPID keys (run once during setup)
 */
export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}

// Helper
function formatDueDate(date) {
  const d = new Date(date);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) {
    return 'today';
  } else if (d.toDateString() === tomorrow.toDateString()) {
    return 'tomorrow';
  } else {
    return d.toLocaleDateString();
  }
}

export default {
  saveSubscription,
  removeSubscription,
  getUserSubscriptions,
  sendToUser,
  sendToUsers,
  sendToCompany,
  NotificationEvents,
  getVapidPublicKey,
  generateVapidKeys,
};
