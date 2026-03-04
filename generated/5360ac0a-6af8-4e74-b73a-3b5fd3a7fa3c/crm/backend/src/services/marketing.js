/**
 * Marketing Automation Service
 * 
 * Email campaigns and drip sequences:
 * - Email templates
 * - Campaign management
 * - Drip sequences (automated followups)
 * - Audience segmentation
 * - Performance tracking
 * - Integration with SendGrid/Mailchimp
 */

import { PrismaClient } from '@prisma/client';
import sgMail from '@sendgrid/mail';

const prisma = new PrismaClient();

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ============================================
// EMAIL TEMPLATES
// ============================================

/**
 * Create email template
 */
export async function createTemplate(companyId, data) {
  return prisma.emailTemplate.create({
    data: {
      companyId,
      name: data.name,
      subject: data.subject,
      body: data.body,
      category: data.category, // followup, promotion, newsletter, reminder
      designJson: data.designJson, // For drag-drop editor
      active: true,
    },
  });
}

/**
 * Get templates
 */
export async function getTemplates(companyId, { category, active = true } = {}) {
  return prisma.emailTemplate.findMany({
    where: {
      companyId,
      ...(category ? { category } : {}),
      ...(active !== null ? { active } : {}),
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Update template
 */
export async function updateTemplate(templateId, companyId, data) {
  return prisma.emailTemplate.updateMany({
    where: { id: templateId, companyId },
    data,
  });
}

/**
 * Duplicate template
 */
export async function duplicateTemplate(templateId, companyId) {
  const original = await prisma.emailTemplate.findFirst({
    where: { id: templateId, companyId },
  });

  if (!original) throw new Error('Template not found');

  return prisma.emailTemplate.create({
    data: {
      companyId,
      name: `${original.name} (Copy)`,
      subject: original.subject,
      body: original.body,
      category: original.category,
      designJson: original.designJson,
      active: true,
    },
  });
}

// ============================================
// CAMPAIGNS
// ============================================

/**
 * Create campaign
 */
export async function createCampaign(companyId, data) {
  return prisma.emailCampaign.create({
    data: {
      companyId,
      name: data.name,
      subject: data.subject,
      body: data.body,
      templateId: data.templateId,
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      replyTo: data.replyTo,
      
      // Audience
      audienceType: data.audienceType || 'all', // all, segment, list
      audienceFilter: data.audienceFilter, // JSON filter criteria
      
      // Scheduling
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
      
      status: 'draft',
    },
  });
}

/**
 * Get campaigns
 */
export async function getCampaigns(companyId, { status, page = 1, limit = 50 } = {}) {
  const where = { companyId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.emailCampaign.findMany({
      where,
      include: {
        template: { select: { name: true } },
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.emailCampaign.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get campaign with stats
 */
export async function getCampaign(campaignId, companyId) {
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: campaignId, companyId },
    include: {
      template: true,
      recipients: {
        take: 100,
        include: {
          contact: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!campaign) return null;

  // Calculate stats
  const stats = await prisma.emailRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: true,
  });

  return {
    ...campaign,
    stats: {
      total: campaign.recipients.length,
      sent: stats.find(s => s.status === 'sent')?._count || 0,
      delivered: stats.find(s => s.status === 'delivered')?._count || 0,
      opened: stats.find(s => s.status === 'opened')?._count || 0,
      clicked: stats.find(s => s.status === 'clicked')?._count || 0,
      bounced: stats.find(s => s.status === 'bounced')?._count || 0,
      unsubscribed: stats.find(s => s.status === 'unsubscribed')?._count || 0,
    },
  };
}

/**
 * Update campaign
 */
export async function updateCampaign(campaignId, companyId, data) {
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: campaignId, companyId },
  });

  if (!campaign || campaign.status === 'sent') {
    throw new Error('Cannot update sent campaign');
  }

  return prisma.emailCampaign.update({
    where: { id: campaignId },
    data,
  });
}

/**
 * Send campaign
 */
export async function sendCampaign(campaignId, companyId) {
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: campaignId, companyId },
  });

  if (!campaign || campaign.status === 'sent') {
    throw new Error('Campaign already sent or not found');
  }

  // Get recipients based on audience
  const contacts = await getAudienceContacts(companyId, campaign.audienceType, campaign.audienceFilter);

  // Create recipient records
  await prisma.emailRecipient.createMany({
    data: contacts.map(c => ({
      campaignId,
      contactId: c.id,
      email: c.email,
      status: 'pending',
    })),
  });

  // Update campaign status
  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { status: 'sending', sentAt: new Date() },
  });

  // Send emails (in batches)
  const recipients = await prisma.emailRecipient.findMany({
    where: { campaignId, status: 'pending' },
    include: { contact: true },
  });

  for (const recipient of recipients) {
    try {
      await sendEmail({
        to: recipient.email,
        subject: personalizeContent(campaign.subject, recipient.contact),
        html: personalizeContent(campaign.body, recipient.contact),
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
      });

      await prisma.emailRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', sentAt: new Date() },
      });
    } catch (error) {
      await prisma.emailRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', errorMessage: error.message },
      });
    }
  }

  // Update campaign status
  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { status: 'sent' },
  });

  return { sent: recipients.length };
}

/**
 * Schedule campaign
 */
export async function scheduleCampaign(campaignId, companyId, scheduledFor) {
  return prisma.emailCampaign.updateMany({
    where: { id: campaignId, companyId, status: 'draft' },
    data: {
      status: 'scheduled',
      scheduledFor: new Date(scheduledFor),
    },
  });
}

// ============================================
// DRIP SEQUENCES (Automated Followups)
// ============================================

/**
 * Create drip sequence
 */
export async function createSequence(companyId, data) {
  return prisma.dripSequence.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      trigger: data.trigger, // new_customer, quote_sent, invoice_paid, manual
      active: false,
      steps: {
        create: data.steps.map((step, index) => ({
          stepNumber: index + 1,
          delayDays: step.delayDays || 0,
          delayHours: step.delayHours || 0,
          subject: step.subject,
          body: step.body,
          templateId: step.templateId,
        })),
      },
    },
    include: { steps: true },
  });
}

/**
 * Get sequences
 */
export async function getSequences(companyId) {
  return prisma.dripSequence.findMany({
    where: { companyId },
    include: {
      steps: { orderBy: { stepNumber: 'asc' } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Enroll contact in sequence
 */
export async function enrollInSequence(sequenceId, contactId, companyId) {
  const sequence = await prisma.dripSequence.findFirst({
    where: { id: sequenceId, companyId, active: true },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!sequence || sequence.steps.length === 0) {
    throw new Error('Sequence not found or has no steps');
  }

  // Check if already enrolled
  const existing = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId, contactId, status: 'active' },
  });

  if (existing) {
    throw new Error('Contact already enrolled in this sequence');
  }

  // Calculate when first email should send
  const firstStep = sequence.steps[0];
  const nextEmailAt = new Date();
  nextEmailAt.setDate(nextEmailAt.getDate() + (firstStep.delayDays || 0));
  nextEmailAt.setHours(nextEmailAt.getHours() + (firstStep.delayHours || 0));

  return prisma.sequenceEnrollment.create({
    data: {
      sequenceId,
      contactId,
      currentStep: 1,
      status: 'active',
      nextEmailAt,
    },
  });
}

/**
 * Process pending drip emails (called by cron)
 */
export async function processDripEmails() {
  const due = await prisma.sequenceEnrollment.findMany({
    where: {
      status: 'active',
      nextEmailAt: { lte: new Date() },
    },
    include: {
      sequence: { include: { steps: true } },
      contact: true,
    },
  });

  let sent = 0;

  for (const enrollment of due) {
    const step = enrollment.sequence.steps.find(s => s.stepNumber === enrollment.currentStep);
    if (!step) {
      // Sequence complete
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      continue;
    }

    try {
      // Send email
      await sendEmail({
        to: enrollment.contact.email,
        subject: personalizeContent(step.subject, enrollment.contact),
        html: personalizeContent(step.body, enrollment.contact),
      });

      // Get next step
      const nextStep = enrollment.sequence.steps.find(s => s.stepNumber === enrollment.currentStep + 1);

      if (nextStep) {
        // Schedule next email
        const nextEmailAt = new Date();
        nextEmailAt.setDate(nextEmailAt.getDate() + (nextStep.delayDays || 0));
        nextEmailAt.setHours(nextEmailAt.getHours() + (nextStep.delayHours || 0));

        await prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            currentStep: enrollment.currentStep + 1,
            nextEmailAt,
            lastEmailAt: new Date(),
          },
        });
      } else {
        // Sequence complete
        await prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            lastEmailAt: new Date(),
          },
        });
      }

      sent++;
    } catch (error) {
      console.error('Failed to send drip email:', error);
    }
  }

  return { processed: due.length, sent };
}

// ============================================
// AUDIENCE SEGMENTATION
// ============================================

/**
 * Get contacts based on audience criteria
 */
async function getAudienceContacts(companyId, audienceType, filter) {
  let where = { companyId, email: { not: null } };

  if (audienceType === 'segment' && filter) {
    // Apply filter criteria
    const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter;
    
    if (parsed.tags?.length) {
      where.tags = { hasSome: parsed.tags };
    }
    if (parsed.type) {
      where.type = parsed.type;
    }
    if (parsed.createdAfter) {
      where.createdAt = { gte: new Date(parsed.createdAfter) };
    }
    if (parsed.hasJobInLast) {
      // Contacts with jobs in last N days
      // This would need a subquery
    }
  }

  return prisma.contact.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
    },
  });
}

// ============================================
// EMAIL TRACKING
// ============================================

/**
 * Track email open
 */
export async function trackOpen(recipientId) {
  await prisma.emailRecipient.update({
    where: { id: recipientId },
    data: {
      status: 'opened',
      openedAt: new Date(),
      openCount: { increment: 1 },
    },
  });
}

/**
 * Track email click
 */
export async function trackClick(recipientId, url) {
  await prisma.emailRecipient.update({
    where: { id: recipientId },
    data: {
      status: 'clicked',
      clickedAt: new Date(),
      clickCount: { increment: 1 },
    },
  });

  // Log click
  await prisma.emailClick.create({
    data: {
      recipientId,
      url,
    },
  });
}

/**
 * Handle unsubscribe
 */
export async function handleUnsubscribe(recipientId, contactId) {
  await prisma.emailRecipient.update({
    where: { id: recipientId },
    data: { status: 'unsubscribed' },
  });

  // Update contact
  await prisma.contact.update({
    where: { id: contactId },
    data: { emailOptOut: true, emailOptOutDate: new Date() },
  });

  // Cancel any active sequence enrollments
  await prisma.sequenceEnrollment.updateMany({
    where: { contactId, status: 'active' },
    data: { status: 'unsubscribed' },
  });
}

// ============================================
// HELPERS
// ============================================

async function sendEmail({ to, subject, html, fromName, fromEmail }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Email would be sent:', { to, subject });
    return;
  }

  await sgMail.send({
    to,
    from: {
      email: fromEmail || process.env.DEFAULT_FROM_EMAIL,
      name: fromName || process.env.DEFAULT_FROM_NAME,
    },
    subject,
    html,
  });
}

function personalizeContent(content, contact) {
  if (!content) return content;

  const replacements = {
    '{{name}}': contact.name || 'there',
    '{{firstName}}': contact.firstName || contact.name?.split(' ')[0] || 'there',
    '{{lastName}}': contact.lastName || '',
    '{{email}}': contact.email || '',
    '{{company}}': contact.company || '',
  };

  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key, 'g'), value);
  }

  return result;
}

/**
 * Get marketing stats
 */
export async function getMarketingStats(companyId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [campaigns, sequences, recentSends] = await Promise.all([
    prisma.emailCampaign.count({ where: { companyId } }),
    prisma.dripSequence.count({ where: { companyId, active: true } }),
    prisma.emailRecipient.count({
      where: {
        campaign: { companyId },
        sentAt: { gte: thirtyDaysAgo },
      },
    }),
  ]);

  return {
    totalCampaigns: campaigns,
    activeSequences: sequences,
    emailsSent30Days: recentSends,
  };
}

export default {
  createTemplate,
  getTemplates,
  updateTemplate,
  duplicateTemplate,
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  sendCampaign,
  scheduleCampaign,
  createSequence,
  getSequences,
  enrollInSequence,
  processDripEmails,
  trackOpen,
  trackClick,
  handleUnsubscribe,
  getMarketingStats,
};
