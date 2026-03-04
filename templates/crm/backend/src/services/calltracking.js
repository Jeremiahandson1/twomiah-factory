/**
 * Call Tracking Service
 * 
 * Track inbound calls for marketing attribution:
 * - Tracking phone numbers per marketing source
 * - Call logging and recording links
 * - Integration with CallRail, CallTrackingMetrics, etc.
 * - Attribution reporting
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Provider configuration
const PROVIDER = process.env.CALL_TRACKING_PROVIDER; // callrail, ctm, twilio
const CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
const CALLRAIL_ACCOUNT_ID = process.env.CALLRAIL_ACCOUNT_ID;

// ============================================
// TRACKING NUMBERS
// ============================================

/**
 * Create tracking number
 */
export async function createTrackingNumber(companyId, data) {
  return prisma.trackingNumber.create({
    data: {
      companyId,
      phoneNumber: data.phoneNumber,
      forwardTo: data.forwardTo, // Destination number
      source: data.source, // google_ads, facebook, yelp, website, direct_mail, etc.
      campaign: data.campaign,
      medium: data.medium, // cpc, organic, referral
      name: data.name,
      active: true,
      
      // Provider details
      providerId: data.providerId, // ID from CallRail/CTM
      provider: PROVIDER,
    },
  });
}

/**
 * Get tracking numbers
 */
export async function getTrackingNumbers(companyId, { source, active = true } = {}) {
  return prisma.trackingNumber.findMany({
    where: {
      companyId,
      ...(source ? { source } : {}),
      ...(active !== null ? { active } : {}),
    },
    include: {
      _count: { select: { calls: true } },
    },
    orderBy: { source: 'asc' },
  });
}

/**
 * Update tracking number
 */
export async function updateTrackingNumber(numberId, companyId, data) {
  return prisma.trackingNumber.updateMany({
    where: { id: numberId, companyId },
    data,
  });
}

// ============================================
// CALL LOGGING
// ============================================

/**
 * Log incoming call (from webhook)
 */
export async function logCall(companyId, data) {
  // Find tracking number
  const trackingNumber = await prisma.trackingNumber.findFirst({
    where: {
      companyId,
      phoneNumber: data.trackingNumber,
    },
  });

  // Try to match caller to contact
  const contact = await prisma.contact.findFirst({
    where: {
      companyId,
      phone: data.callerNumber,
    },
  });

  const call = await prisma.callLog.create({
    data: {
      companyId,
      trackingNumberId: trackingNumber?.id,
      contactId: contact?.id,
      
      // Call details
      callerNumber: data.callerNumber,
      callerName: data.callerName,
      callerCity: data.callerCity,
      callerState: data.callerState,
      
      // Attribution
      source: trackingNumber?.source || data.source,
      campaign: trackingNumber?.campaign || data.campaign,
      medium: trackingNumber?.medium || data.medium,
      keyword: data.keyword, // From Google Ads
      landingPage: data.landingPage,
      
      // Call info
      direction: data.direction || 'inbound',
      status: data.status || 'completed', // ringing, answered, completed, missed, voicemail
      duration: data.duration || 0, // seconds
      
      startTime: data.startTime ? new Date(data.startTime) : new Date(),
      endTime: data.endTime ? new Date(data.endTime) : null,
      
      // Recording
      recordingUrl: data.recordingUrl,
      transcription: data.transcription,
      
      // Tags
      tags: data.tags || [],
      notes: data.notes,
      
      // First time caller?
      firstTimeCaller: !contact,
      
      // Provider reference
      providerId: data.providerId,
    },
  });

  // If new caller, optionally create contact
  if (!contact && data.callerNumber && data.createContact !== false) {
    await prisma.contact.create({
      data: {
        companyId,
        name: data.callerName || 'Unknown Caller',
        phone: data.callerNumber,
        source: trackingNumber?.source || 'phone',
        notes: `First call: ${new Date().toLocaleDateString()}`,
      },
    });
  }

  return call;
}

/**
 * Get calls
 */
export async function getCalls(companyId, {
  source,
  status,
  startDate,
  endDate,
  contactId,
  firstTimeOnly,
  page = 1,
  limit = 50,
} = {}) {
  const where = { companyId };

  if (source) where.source = source;
  if (status) where.status = status;
  if (contactId) where.contactId = contactId;
  if (firstTimeOnly) where.firstTimeCaller = true;

  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime.gte = new Date(startDate);
    if (endDate) where.startTime.lte = new Date(endDate);
  }

  const [data, total] = await Promise.all([
    prisma.callLog.findMany({
      where,
      include: {
        trackingNumber: { select: { name: true, source: true } },
        contact: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.callLog.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get single call
 */
export async function getCall(callId, companyId) {
  return prisma.callLog.findFirst({
    where: { id: callId, companyId },
    include: {
      trackingNumber: true,
      contact: true,
    },
  });
}

/**
 * Update call (add notes, tags, etc.)
 */
export async function updateCall(callId, companyId, data) {
  return prisma.callLog.updateMany({
    where: { id: callId, companyId },
    data,
  });
}

/**
 * Tag call as lead/opportunity
 */
export async function tagCallAsLead(callId, companyId, { value, notes }) {
  await prisma.callLog.updateMany({
    where: { id: callId, companyId },
    data: {
      isLead: true,
      leadValue: value,
      tags: { push: 'lead' },
      notes,
    },
  });
}

// ============================================
// WEBHOOKS
// ============================================

/**
 * Handle CallRail webhook
 */
export async function handleCallRailWebhook(companyId, payload) {
  const data = {
    trackingNumber: payload.tracking_phone_number,
    callerNumber: payload.caller_phone_number,
    callerName: payload.caller_name,
    callerCity: payload.caller_city,
    callerState: payload.caller_state,
    
    source: payload.source,
    campaign: payload.campaign,
    medium: payload.medium,
    keyword: payload.keywords,
    landingPage: payload.landing_page_url,
    
    direction: payload.direction,
    status: mapCallRailStatus(payload.answered ? 'answered' : 'missed'),
    duration: payload.duration,
    
    startTime: payload.start_time,
    recordingUrl: payload.recording,
    
    providerId: payload.id,
  };

  return logCall(companyId, data);
}

function mapCallRailStatus(status) {
  const map = {
    answered: 'completed',
    missed: 'missed',
    voicemail: 'voicemail',
  };
  return map[status] || status;
}

/**
 * Handle Twilio webhook
 */
export async function handleTwilioWebhook(companyId, payload) {
  const data = {
    trackingNumber: payload.To,
    callerNumber: payload.From,
    callerCity: payload.FromCity,
    callerState: payload.FromState,
    
    direction: payload.Direction === 'inbound' ? 'inbound' : 'outbound',
    status: mapTwilioStatus(payload.CallStatus),
    duration: parseInt(payload.CallDuration) || 0,
    
    providerId: payload.CallSid,
    recordingUrl: payload.RecordingUrl,
  };

  return logCall(companyId, data);
}

function mapTwilioStatus(status) {
  const map = {
    completed: 'completed',
    busy: 'missed',
    'no-answer': 'missed',
    failed: 'failed',
  };
  return map[status] || status;
}

// ============================================
// REPORTING
// ============================================

/**
 * Get call attribution report
 */
export async function getAttributionReport(companyId, { startDate, endDate } = {}) {
  const where = { companyId };

  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime.gte = new Date(startDate);
    if (endDate) where.startTime.lte = new Date(endDate);
  }

  // Group by source
  const bySource = await prisma.callLog.groupBy({
    by: ['source'],
    where,
    _count: true,
    _sum: { duration: true },
  });

  // Calculate totals
  const totals = await prisma.callLog.aggregate({
    where,
    _count: true,
    _sum: { duration: true },
    _avg: { duration: true },
  });

  // First time callers
  const firstTimers = await prisma.callLog.count({
    where: { ...where, firstTimeCaller: true },
  });

  // Leads
  const leads = await prisma.callLog.count({
    where: { ...where, isLead: true },
  });

  const leadValue = await prisma.callLog.aggregate({
    where: { ...where, isLead: true },
    _sum: { leadValue: true },
  });

  return {
    bySource: bySource.map(s => ({
      source: s.source || 'unknown',
      calls: s._count,
      totalDuration: s._sum.duration || 0,
      avgDuration: s._count > 0 ? Math.round((s._sum.duration || 0) / s._count) : 0,
    })),
    totals: {
      totalCalls: totals._count,
      totalDuration: totals._sum.duration || 0,
      avgDuration: Math.round(totals._avg.duration || 0),
      firstTimeCallers: firstTimers,
      leads,
      leadValue: leadValue._sum.leadValue || 0,
    },
  };
}

/**
 * Get call volume by hour/day
 */
export async function getCallVolumeReport(companyId, { startDate, endDate, groupBy = 'day' } = {}) {
  const where = { companyId };

  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime.gte = new Date(startDate);
    if (endDate) where.startTime.lte = new Date(endDate);
  }

  const calls = await prisma.callLog.findMany({
    where,
    select: { startTime: true, duration: true, status: true },
  });

  // Group calls by time period
  const grouped = {};

  for (const call of calls) {
    let key;
    const date = new Date(call.startTime);

    if (groupBy === 'hour') {
      key = date.getHours();
    } else if (groupBy === 'dayOfWeek') {
      key = date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      key = date.toISOString().split('T')[0];
    }

    if (!grouped[key]) {
      grouped[key] = { calls: 0, answered: 0, missed: 0, duration: 0 };
    }

    grouped[key].calls++;
    if (call.status === 'completed') grouped[key].answered++;
    if (call.status === 'missed') grouped[key].missed++;
    grouped[key].duration += call.duration || 0;
  }

  return Object.entries(grouped).map(([period, data]) => ({
    period,
    ...data,
    avgDuration: data.answered > 0 ? Math.round(data.duration / data.answered) : 0,
    answerRate: data.calls > 0 ? Math.round(data.answered / data.calls * 100) : 0,
  }));
}

export default {
  createTrackingNumber,
  getTrackingNumbers,
  updateTrackingNumber,
  logCall,
  getCalls,
  getCall,
  updateCall,
  tagCallAsLead,
  handleCallRailWebhook,
  handleTwilioWebhook,
  getAttributionReport,
  getCallVolumeReport,
};
