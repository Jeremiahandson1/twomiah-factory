/**
 * Google Reviews Automation Service
 * 
 * Automate review requests after job completion:
 * - Send review requests via SMS/email
 * - Track review request status
 * - Generate direct Google review links
 * - Monitor review responses
 * - Intelligent timing and follow-ups
 */

import { PrismaClient } from '@prisma/client';
import email from './email.js';

const prisma = new PrismaClient();

// Twilio for SMS (optional)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  try {
    const twilio = await import('twilio');
    twilioClient = twilio.default(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (e) {
    console.log('Twilio not available');
  }
}

/**
 * Generate Google review link for a business
 */
export function generateGoogleReviewLink(placeId) {
  // Direct link to leave a review
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}

/**
 * Get company's Google review settings
 */
export async function getReviewSettings(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      googlePlaceId: true,
      googleBusinessName: true,
      reviewRequestDelay: true, // Hours after job completion
      reviewFollowUpDelay: true, // Days for follow-up
      reviewRequestEnabled: true,
      reviewSmsEnabled: true,
      reviewEmailEnabled: true,
      reviewMinimumJobValue: true, // Only request for jobs above this
    },
  });

  return {
    googlePlaceId: company?.googlePlaceId || null,
    googleBusinessName: company?.googleBusinessName || null,
    reviewRequestDelay: company?.reviewRequestDelay || 2, // 2 hours default
    reviewFollowUpDelay: company?.reviewFollowUpDelay || 3, // 3 days default
    reviewRequestEnabled: company?.reviewRequestEnabled ?? true,
    reviewSmsEnabled: company?.reviewSmsEnabled ?? true,
    reviewEmailEnabled: company?.reviewEmailEnabled ?? true,
    reviewMinimumJobValue: company?.reviewMinimumJobValue || 0,
    reviewLink: company?.googlePlaceId 
      ? generateGoogleReviewLink(company.googlePlaceId) 
      : null,
  };
}

/**
 * Update review settings
 */
export async function updateReviewSettings(companyId, settings) {
  return prisma.company.update({
    where: { id: companyId },
    data: {
      googlePlaceId: settings.googlePlaceId,
      googleBusinessName: settings.googleBusinessName,
      reviewRequestDelay: settings.reviewRequestDelay,
      reviewFollowUpDelay: settings.reviewFollowUpDelay,
      reviewRequestEnabled: settings.reviewRequestEnabled,
      reviewSmsEnabled: settings.reviewSmsEnabled,
      reviewEmailEnabled: settings.reviewEmailEnabled,
      reviewMinimumJobValue: settings.reviewMinimumJobValue,
    },
  });
}

/**
 * Send review request for a job
 */
export async function sendReviewRequest(jobId, { channel = 'both' } = {}) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: true,
      company: true,
    },
  });

  if (!job) {
    throw new Error('Job not found');
  }

  if (!job.contact) {
    throw new Error('Job has no contact');
  }

  const settings = await getReviewSettings(job.companyId);
  
  if (!settings.googlePlaceId) {
    throw new Error('Google Place ID not configured');
  }

  // Check if already requested
  const existing = await prisma.reviewRequest.findFirst({
    where: { jobId, status: { not: 'cancelled' } },
  });

  if (existing) {
    throw new Error('Review already requested for this job');
  }

  const reviewLink = generateGoogleReviewLink(settings.googlePlaceId);
  const results = { sms: null, email: null };

  // Create review request record
  const request = await prisma.reviewRequest.create({
    data: {
      companyId: job.companyId,
      jobId,
      contactId: job.contactId,
      status: 'sent',
      sentAt: new Date(),
      reviewLink,
      channel,
    },
  });

  // Send SMS
  if ((channel === 'sms' || channel === 'both') && settings.reviewSmsEnabled && job.contact.phone) {
    try {
      results.sms = await sendReviewSms(job.contact.phone, {
        contactName: job.contact.name?.split(' ')[0] || 'there',
        companyName: job.company.name,
        reviewLink,
        shortLink: await createShortLink(reviewLink, request.id),
      });
      
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { smsSentAt: new Date(), smsStatus: 'sent' },
      });
    } catch (error) {
      console.error('SMS send error:', error);
      results.sms = { error: error.message };
    }
  }

  // Send Email
  if ((channel === 'email' || channel === 'both') && settings.reviewEmailEnabled && job.contact.email) {
    try {
      results.email = await sendReviewEmail(job.contact.email, {
        contactName: job.contact.name || 'Valued Customer',
        companyName: job.company.name,
        jobTitle: job.title,
        reviewLink,
      });
      
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { emailSentAt: new Date(), emailStatus: 'sent' },
      });
    } catch (error) {
      console.error('Email send error:', error);
      results.email = { error: error.message };
    }
  }

  return {
    requestId: request.id,
    reviewLink,
    results,
  };
}

/**
 * Send review request SMS
 */
async function sendReviewSms(phoneNumber, { contactName, companyName, reviewLink, shortLink }) {
  if (!twilioClient) {
    throw new Error('SMS not configured');
  }

  const message = `Hi ${contactName}! Thanks for choosing ${companyName}. ` +
    `We'd love to hear about your experience. ` +
    `Leave us a quick review: ${shortLink || reviewLink}`;

  const result = await twilioClient.messages.create({
    body: message,
    from: TWILIO_PHONE_NUMBER,
    to: phoneNumber,
  });

  return { messageId: result.sid, status: result.status };
}

/**
 * Send review request email
 */
async function sendReviewEmail(emailAddress, { contactName, companyName, jobTitle, reviewLink }) {
  const subject = `How was your experience with ${companyName}?`;
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Thank you, ${contactName}!</h2>
      
      <p>We hope you're satisfied with the work we did on <strong>${jobTitle}</strong>.</p>
      
      <p>Your feedback helps us improve and helps other customers find quality service. 
         Would you take a moment to share your experience?</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${reviewLink}" 
           style="display: inline-block; padding: 15px 30px; background: #f97316; 
                  color: white; text-decoration: none; border-radius: 8px; 
                  font-weight: bold;">
          Leave a Review ⭐
        </a>
      </div>
      
      <p style="color: #666; font-size: 14px;">
        It only takes a minute and means the world to our team.
      </p>
      
      <p>Thanks again for choosing ${companyName}!</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      
      <p style="color: #999; font-size: 12px;">
        If you have any concerns about your service, please reply to this email 
        and we'll make it right.
      </p>
    </div>
  `;

  return email.sendEmail({
    to: emailAddress,
    subject,
    html,
  });
}

/**
 * Create short link for tracking (uses your domain)
 */
async function createShortLink(url, requestId) {
  // You could integrate with a URL shortener here
  // For now, return original URL
  // Could be: `${process.env.APP_URL}/r/${requestId}`
  return url;
}

/**
 * Schedule review request after job completion
 */
export async function scheduleReviewRequest(jobId) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { company: true },
  });

  if (!job) return null;

  const settings = await getReviewSettings(job.companyId);
  
  if (!settings.reviewRequestEnabled) {
    return null;
  }

  // Check minimum job value
  if (settings.reviewMinimumJobValue > 0 && job.value < settings.reviewMinimumJobValue) {
    return null;
  }

  // Calculate send time
  const sendAt = new Date();
  sendAt.setHours(sendAt.getHours() + settings.reviewRequestDelay);

  // Create scheduled request
  return prisma.reviewRequest.create({
    data: {
      companyId: job.companyId,
      jobId,
      contactId: job.contactId,
      status: 'scheduled',
      scheduledFor: sendAt,
      reviewLink: settings.reviewLink,
    },
  });
}

/**
 * Process scheduled review requests (run via cron)
 */
export async function processScheduledRequests() {
  const now = new Date();
  
  const scheduled = await prisma.reviewRequest.findMany({
    where: {
      status: 'scheduled',
      scheduledFor: { lte: now },
    },
    include: {
      job: { include: { contact: true, company: true } },
    },
  });

  const results = [];
  
  for (const request of scheduled) {
    try {
      await sendReviewRequest(request.jobId);
      results.push({ id: request.id, status: 'sent' });
    } catch (error) {
      results.push({ id: request.id, status: 'error', error: error.message });
    }
  }

  return results;
}

/**
 * Send follow-up for unanswered requests
 */
export async function sendFollowUp(requestId) {
  const request = await prisma.reviewRequest.findUnique({
    where: { id: requestId },
    include: {
      job: { include: { contact: true, company: true } },
    },
  });

  if (!request || request.status === 'completed' || request.followUpSentAt) {
    return null;
  }

  // Send follow-up
  const result = await sendReviewRequest(request.jobId, { channel: request.channel });

  await prisma.reviewRequest.update({
    where: { id: requestId },
    data: { 
      followUpSentAt: new Date(),
      followUpCount: { increment: 1 },
    },
  });

  return result;
}

/**
 * Mark review as completed (clicked/submitted)
 */
export async function markReviewCompleted(requestId, { clicked = false, reviewed = false } = {}) {
  return prisma.reviewRequest.update({
    where: { id: requestId },
    data: {
      status: reviewed ? 'completed' : 'clicked',
      clickedAt: clicked ? new Date() : undefined,
      completedAt: reviewed ? new Date() : undefined,
    },
  });
}

/**
 * Get review request stats
 */
export async function getReviewStats(companyId, { startDate, endDate } = {}) {
  const where = { companyId };
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [total, sent, clicked, completed] = await Promise.all([
    prisma.reviewRequest.count({ where }),
    prisma.reviewRequest.count({ where: { ...where, status: 'sent' } }),
    prisma.reviewRequest.count({ where: { ...where, status: 'clicked' } }),
    prisma.reviewRequest.count({ where: { ...where, status: 'completed' } }),
  ]);

  return {
    total,
    sent,
    clicked,
    completed,
    clickRate: total > 0 ? ((clicked + completed) / total * 100).toFixed(1) : 0,
    conversionRate: total > 0 ? (completed / total * 100).toFixed(1) : 0,
  };
}

/**
 * Get review requests for a company
 */
export async function getReviewRequests(companyId, { status, limit = 50, page = 1 } = {}) {
  const where = { companyId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.reviewRequest.findMany({
      where,
      include: {
        job: { select: { id: true, title: true, number: true } },
        contact: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reviewRequest.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export default {
  generateGoogleReviewLink,
  getReviewSettings,
  updateReviewSettings,
  sendReviewRequest,
  scheduleReviewRequest,
  processScheduledRequests,
  sendFollowUp,
  markReviewCompleted,
  getReviewStats,
  getReviewRequests,
};
