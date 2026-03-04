/**
 * Two-Way SMS Service
 * 
 * Customer communication via SMS:
 * - Send/receive text messages
 * - Conversation threads
 * - Templates
 * - Auto-responders
 * - Job status updates
 */

import { PrismaClient } from '@prisma/client';
import twilio from 'twilio';

const prisma = new PrismaClient();

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// ============================================
// SENDING MESSAGES
// ============================================

/**
 * Send SMS to a contact
 */
export async function sendSMS(companyId, {
  contactId,
  toPhone,
  message,
  userId,
  jobId,
  templateId,
}) {
  // Get contact phone if not provided
  if (!toPhone && contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact?.phone) throw new Error('Contact has no phone number');
    toPhone = contact.phone;
  }

  if (!toPhone) throw new Error('Phone number required');

  // Format phone number
  const formattedPhone = formatPhoneNumber(toPhone);

  // Get or create conversation
  let conversation = await prisma.smsConversation.findFirst({
    where: {
      companyId,
      phone: formattedPhone,
    },
  });

  if (!conversation) {
    conversation = await prisma.smsConversation.create({
      data: {
        companyId,
        phone: formattedPhone,
        contactId,
        status: 'active',
      },
    });
  }

  // Send via Twilio
  let twilioResponse;
  let status = 'sent';
  let errorMessage = null;

  try {
    twilioResponse = await twilioClient.messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE,
      statusCallback: `${process.env.API_BASE_URL}/api/sms/webhook/status`,
    });
  } catch (error) {
    status = 'failed';
    errorMessage = error.message;
    console.error('Twilio send error:', error);
  }

  // Save message
  const smsMessage = await prisma.smsMessage.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: 'outbound',
      phone: formattedPhone,
      message,
      status,
      errorMessage,
      twilioSid: twilioResponse?.sid,
      contactId,
      userId,
      jobId,
      templateId,
    },
  });

  // Update conversation
  await prisma.smsConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      lastMessage: message.substring(0, 100),
    },
  });

  return smsMessage;
}

/**
 * Handle incoming SMS (Twilio webhook)
 */
export async function handleIncomingSMS(data) {
  const { From, Body, MessageSid, To } = data;

  // Find company by Twilio number
  const company = await prisma.company.findFirst({
    where: { twilioPhone: To },
  });

  if (!company) {
    console.error('No company found for Twilio number:', To);
    return;
  }

  const formattedPhone = formatPhoneNumber(From);

  // Find or create conversation
  let conversation = await prisma.smsConversation.findFirst({
    where: {
      companyId: company.id,
      phone: formattedPhone,
    },
  });

  // Try to find contact by phone
  const contact = await prisma.contact.findFirst({
    where: {
      companyId: company.id,
      OR: [
        { phone: formattedPhone },
        { phone: From },
        { phone: { contains: formattedPhone.slice(-10) } },
      ],
    },
  });

  if (!conversation) {
    conversation = await prisma.smsConversation.create({
      data: {
        companyId: company.id,
        phone: formattedPhone,
        contactId: contact?.id,
        status: 'active',
      },
    });
  }

  // Save incoming message
  const message = await prisma.smsMessage.create({
    data: {
      companyId: company.id,
      conversationId: conversation.id,
      direction: 'inbound',
      phone: formattedPhone,
      message: Body,
      status: 'received',
      twilioSid: MessageSid,
      contactId: contact?.id,
    },
  });

  // Update conversation
  await prisma.smsConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      lastMessage: Body.substring(0, 100),
      unreadCount: { increment: 1 },
      contactId: contact?.id,
    },
  });

  // Check for auto-responders
  await processAutoResponders(company.id, conversation, Body);

  // Emit socket event for real-time update
  // global.io?.to(`company:${company.id}`).emit('sms:received', message);

  return message;
}

/**
 * Handle message status update (Twilio webhook)
 */
export async function handleStatusUpdate(data) {
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = data;

  await prisma.smsMessage.updateMany({
    where: { twilioSid: MessageSid },
    data: {
      status: MessageStatus,
      errorMessage: ErrorMessage || null,
    },
  });
}

// ============================================
// CONVERSATIONS
// ============================================

/**
 * Get conversations
 */
export async function getConversations(companyId, { 
  status = 'active', 
  unreadOnly = false,
  search,
  page = 1, 
  limit = 50 
} = {}) {
  const where = { companyId };

  if (status) where.status = status;
  if (unreadOnly) where.unreadCount = { gt: 0 };
  if (search) {
    where.OR = [
      { phone: { contains: search } },
      { contact: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.smsConversation.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.smsConversation.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get conversation with messages
 */
export async function getConversation(conversationId, companyId) {
  const conversation = await prisma.smsConversation.findFirst({
    where: { id: conversationId, companyId },
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          user: { select: { firstName: true, lastName: true } },
          job: { select: { id: true, title: true, number: true } },
        },
      },
    },
  });

  // Mark as read
  if (conversation) {
    await prisma.smsConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
  }

  return conversation;
}

/**
 * Archive conversation
 */
export async function archiveConversation(conversationId, companyId) {
  return prisma.smsConversation.updateMany({
    where: { id: conversationId, companyId },
    data: { status: 'archived' },
  });
}

/**
 * Link conversation to contact
 */
export async function linkToContact(conversationId, companyId, contactId) {
  return prisma.smsConversation.updateMany({
    where: { id: conversationId, companyId },
    data: { contactId },
  });
}

// ============================================
// TEMPLATES
// ============================================

/**
 * Create SMS template
 */
export async function createTemplate(companyId, data) {
  return prisma.smsTemplate.create({
    data: {
      companyId,
      name: data.name,
      message: data.message,
      category: data.category,
      active: true,
    },
  });
}

/**
 * Get templates
 */
export async function getTemplates(companyId, { category } = {}) {
  return prisma.smsTemplate.findMany({
    where: {
      companyId,
      active: true,
      ...(category ? { category } : {}),
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Update template
 */
export async function updateTemplate(templateId, companyId, data) {
  return prisma.smsTemplate.updateMany({
    where: { id: templateId, companyId },
    data,
  });
}

/**
 * Delete template
 */
export async function deleteTemplate(templateId, companyId) {
  return prisma.smsTemplate.updateMany({
    where: { id: templateId, companyId },
    data: { active: false },
  });
}

/**
 * Apply template variables
 */
export function applyTemplateVariables(template, variables) {
  let message = template;
  
  const replacements = {
    '{{customer_name}}': variables.customerName || '',
    '{{first_name}}': variables.firstName || '',
    '{{company_name}}': variables.companyName || '',
    '{{job_title}}': variables.jobTitle || '',
    '{{job_date}}': variables.jobDate || '',
    '{{job_time}}': variables.jobTime || '',
    '{{tech_name}}': variables.techName || '',
    '{{amount}}': variables.amount || '',
    '{{link}}': variables.link || '',
  };

  for (const [key, value] of Object.entries(replacements)) {
    message = message.replace(new RegExp(key, 'g'), value);
  }

  return message;
}

// ============================================
// AUTO-RESPONDERS
// ============================================

/**
 * Create auto-responder
 */
export async function createAutoResponder(companyId, data) {
  return prisma.smsAutoResponder.create({
    data: {
      companyId,
      name: data.name,
      trigger: data.trigger, // keyword, after_hours, new_conversation
      keywords: data.keywords, // JSON array for keyword triggers
      message: data.message,
      afterHoursOnly: data.afterHoursOnly || false,
      active: true,
    },
  });
}

/**
 * Get auto-responders
 */
export async function getAutoResponders(companyId) {
  return prisma.smsAutoResponder.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
  });
}

/**
 * Process auto-responders for incoming message
 */
async function processAutoResponders(companyId, conversation, message) {
  const responders = await prisma.smsAutoResponder.findMany({
    where: { companyId, active: true },
  });

  for (const responder of responders) {
    let shouldRespond = false;

    // Check trigger conditions
    switch (responder.trigger) {
      case 'keyword':
        const keywords = responder.keywords || [];
        const lowerMessage = message.toLowerCase();
        shouldRespond = keywords.some(kw => lowerMessage.includes(kw.toLowerCase()));
        break;

      case 'new_conversation':
        // Check if this is first message in conversation
        const msgCount = await prisma.smsMessage.count({
          where: { conversationId: conversation.id },
        });
        shouldRespond = msgCount <= 1;
        break;

      case 'after_hours':
        shouldRespond = isAfterHours();
        break;
    }

    // Check after hours restriction
    if (responder.afterHoursOnly && !isAfterHours()) {
      shouldRespond = false;
    }

    if (shouldRespond) {
      // Send auto-response (with slight delay to feel natural)
      setTimeout(async () => {
        await sendSMS(companyId, {
          toPhone: conversation.phone,
          message: responder.message,
        });
      }, 2000);

      break; // Only send one auto-response
    }
  }
}

/**
 * Check if current time is after business hours
 */
function isAfterHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  // Weekend
  if (day === 0 || day === 6) return true;

  // Before 8am or after 6pm
  if (hour < 8 || hour >= 18) return true;

  return false;
}

// ============================================
// BULK SMS
// ============================================

/**
 * Send bulk SMS to multiple contacts
 */
export async function sendBulkSMS(companyId, {
  contactIds,
  message,
  templateId,
  userId,
}) {
  const results = { sent: 0, failed: 0, errors: [] };

  for (const contactId of contactIds) {
    try {
      await sendSMS(companyId, {
        contactId,
        message,
        templateId,
        userId,
      });
      results.sent++;
    } catch (error) {
      results.failed++;
      results.errors.push({ contactId, error: error.message });
    }

    // Rate limiting - small delay between messages
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

// ============================================
// JOB NOTIFICATIONS
// ============================================

/**
 * Send job status update
 */
export async function sendJobUpdate(companyId, jobId, updateType) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: true,
      company: true,
      assignedUsers: { include: { user: true } },
    },
  });

  if (!job?.contact?.phone) return null;

  const templates = {
    scheduled: `Hi {{first_name}}, your appointment with {{company_name}} is confirmed for {{job_date}} at {{job_time}}. Reply CONFIRM to confirm or RESCHEDULE to change.`,
    on_way: `Good news! {{tech_name}} from {{company_name}} is on the way and should arrive in approximately 15-20 minutes.`,
    started: `{{tech_name}} has arrived and started work on your {{job_title}}. We'll notify you when complete.`,
    completed: `Your service is complete! Thank you for choosing {{company_name}}. We'd love your feedback: {{link}}`,
    reminder: `Reminder: Your appointment with {{company_name}} is tomorrow at {{job_time}}. Reply CONFIRM or RESCHEDULE.`,
  };

  const template = templates[updateType];
  if (!template) return null;

  const techName = job.assignedUsers?.[0]?.user
    ? `${job.assignedUsers[0].user.firstName}`
    : 'Your technician';

  const message = applyTemplateVariables(template, {
    firstName: job.contact.name?.split(' ')[0] || 'there',
    companyName: job.company.name,
    jobTitle: job.title,
    jobDate: job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : '',
    jobTime: job.scheduledDate ? new Date(job.scheduledDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
    techName,
    link: `${process.env.CUSTOMER_PORTAL_URL}/review/${job.id}`,
  });

  return sendSMS(companyId, {
    contactId: job.contact.id,
    message,
    jobId,
  });
}

// ============================================
// UTILITIES
// ============================================

/**
 * Format phone number to E.164
 */
function formatPhoneNumber(phone) {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Assume US if 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already has country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Return with + if not present
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Get unread count for company
 */
export async function getUnreadCount(companyId) {
  const result = await prisma.smsConversation.aggregate({
    where: { companyId, status: 'active' },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount || 0;
}

export default {
  sendSMS,
  handleIncomingSMS,
  handleStatusUpdate,
  getConversations,
  getConversation,
  archiveConversation,
  linkToContact,
  createTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
  applyTemplateVariables,
  createAutoResponder,
  getAutoResponders,
  sendBulkSMS,
  sendJobUpdate,
  getUnreadCount,
};
