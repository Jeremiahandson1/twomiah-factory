/**
 * AI Receptionist Service
 *
 * Handles:
 * - Rule CRUD (persisted to DB)
 * - Settings management
 * - Twilio recording → OpenAI Whisper transcription
 * - GPT-4o-mini call summarization + smart reply generation
 * - Rule evaluation engine → auto-reply via SMS/email
 */

import { db } from '../../db/index.ts'
import { aiReceptionistRule, aiReceptionistSettings, callLog, company, contact } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL

// ─── Rule CRUD ──────────────────────────────────────────────────────────────────

export async function getRules(companyId: string) {
  return db.select().from(aiReceptionistRule)
    .where(eq(aiReceptionistRule.companyId, companyId))
    .orderBy(desc(aiReceptionistRule.createdAt))
}

export async function createRule(companyId: string, data: {
  name: string
  trigger: string
  channel: string
  messageTemplate: string
  delayMinutes?: number
  isActive?: boolean
  keywordMatch?: string
}) {
  const [rule] = await db.insert(aiReceptionistRule).values({
    id: createId(),
    companyId,
    name: data.name,
    trigger: data.trigger,
    channel: data.channel,
    messageTemplate: data.messageTemplate,
    delayMinutes: data.delayMinutes || 0,
    isActive: data.isActive !== false,
    keywordMatch: data.keywordMatch,
  }).returning()
  return rule
}

export async function updateRule(ruleId: string, companyId: string, data: Partial<{
  name: string
  trigger: string
  channel: string
  messageTemplate: string
  delayMinutes: number
  isActive: boolean
  keywordMatch: string
}>) {
  const [rule] = await db.update(aiReceptionistRule)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(aiReceptionistRule.id, ruleId), eq(aiReceptionistRule.companyId, companyId)))
    .returning()
  return rule
}

export async function deleteRule(ruleId: string, companyId: string) {
  await db.delete(aiReceptionistRule)
    .where(and(eq(aiReceptionistRule.id, ruleId), eq(aiReceptionistRule.companyId, companyId)))
}

// ─── Settings ───────────────────────────────────────────────────────────────────

export async function getSettings(companyId: string) {
  const [settings] = await db.select().from(aiReceptionistSettings)
    .where(eq(aiReceptionistSettings.companyId, companyId))
    .limit(1)

  if (!settings) {
    return {
      companyId,
      isEnabled: false,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      timezone: 'America/Chicago',
      greetingText: null,
      forwardingNumber: null,
    }
  }
  return settings
}

export async function upsertSettings(companyId: string, data: Partial<{
  isEnabled: boolean
  businessHoursStart: string
  businessHoursEnd: string
  timezone: string
  greetingText: string
  forwardingNumber: string
}>) {
  const existing = await db.select().from(aiReceptionistSettings)
    .where(eq(aiReceptionistSettings.companyId, companyId))
    .limit(1)

  if (existing.length > 0) {
    const [updated] = await db.update(aiReceptionistSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(aiReceptionistSettings.companyId, companyId))
      .returning()
    return updated
  } else {
    const [created] = await db.insert(aiReceptionistSettings).values({
      companyId,
      isEnabled: data.isEnabled ?? false,
      businessHoursStart: data.businessHoursStart || '09:00',
      businessHoursEnd: data.businessHoursEnd || '17:00',
      timezone: data.timezone || 'America/Chicago',
      greetingText: data.greetingText,
      forwardingNumber: data.forwardingNumber,
    }).returning()
    return created
  }
}

// ─── OpenAI Integration ─────────────────────────────────────────────────────────

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeRecording(recordingUrl: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.log('[AIReceptionist] OPENAI_API_KEY not set — skipping transcription')
    return null
  }

  try {
    // Download the recording audio
    const audioResponse = await fetch(recordingUrl)
    if (!audioResponse.ok) {
      console.error('[AIReceptionist] Failed to download recording:', audioResponse.status)
      return null
    }

    const audioBuffer = await audioResponse.arrayBuffer()
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' })

    // Send to OpenAI Whisper
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.wav')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })

    if (!whisperResponse.ok) {
      console.error('[AIReceptionist] Whisper API error:', whisperResponse.status)
      return null
    }

    const result = await whisperResponse.json()
    return result.text || null
  } catch (err: any) {
    console.error('[AIReceptionist] Transcription error:', err.message)
    return null
  }
}

/**
 * Summarize a call transcription and generate a smart reply using GPT-4o-mini
 */
export async function summarizeAndGenerateReply(
  transcription: string,
  companyName: string,
  industry: string,
  callerName?: string,
): Promise<{ summary: string; suggestedReply: string } | null> {
  if (!OPENAI_API_KEY) return null

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant for a ${industry} company. Analyze voicemail transcriptions and generate professional auto-replies. Do not include any names, phone numbers, or personal identifiers in your response.`,
          },
          {
            role: 'user',
            content: `Voicemail transcription from a customer:\n\n"${transcription}"\n\nProvide:\n1. A brief summary (1-2 sentences) of what the caller wants\n2. A professional SMS auto-reply (under 160 chars) acknowledging their call and letting them know someone will follow up\n\nRespond in JSON format: { "summary": "...", "suggestedReply": "..." }`,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      console.error('[AIReceptionist] GPT API error:', response.status)
      return null
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content || ''

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return null
  } catch (err: any) {
    console.error('[AIReceptionist] Summary error:', err.message)
    return null
  }
}

// ─── Rule Evaluation Engine ─────────────────────────────────────────────────────

/**
 * Evaluate all active rules against incoming call data and trigger auto-replies
 */
export async function evaluateRules(companyId: string, callData: {
  callLogId: string
  callerNumber?: string
  callerName?: string
  callerEmail?: string
  status: string // completed, missed, voicemail
  transcription?: string
  duration?: number
}) {
  // Get settings and check if enabled
  const settings = await getSettings(companyId)
  if (!settings.isEnabled) return

  // Get company info for personalization
  const [comp] = await db.select({ name: company.name, settings: company.settings })
    .from(company).where(eq(company.id, companyId)).limit(1)
  const companyName = comp?.name || 'our company'

  // Get active rules
  const rules = await db.select().from(aiReceptionistRule)
    .where(and(eq(aiReceptionistRule.companyId, companyId), eq(aiReceptionistRule.isActive, true)))

  const now = new Date()
  const isAfterHours = checkAfterHours(now, settings.businessHoursStart, settings.businessHoursEnd, settings.timezone)

  for (const rule of rules) {
    let shouldTrigger = false

    switch (rule.trigger) {
      case 'after_hours':
        shouldTrigger = isAfterHours && (callData.status === 'missed' || callData.status === 'voicemail')
        break
      case 'missed_call':
        shouldTrigger = callData.status === 'missed'
        break
      case 'voicemail':
        shouldTrigger = callData.status === 'voicemail'
        break
      case 'new_lead':
        // Trigger on first-time callers
        if (callData.callerNumber) {
          const [existing] = await db.select({ id: contact.id }).from(contact)
            .where(and(eq(contact.companyId, companyId), eq(contact.phone, callData.callerNumber)))
            .limit(1)
          shouldTrigger = !existing
        }
        break
      case 'keyword':
        if (callData.transcription && rule.keywordMatch) {
          const keywords = rule.keywordMatch.toLowerCase().split(',').map(k => k.trim())
          shouldTrigger = keywords.some(kw => callData.transcription!.toLowerCase().includes(kw))
        }
        break
      case 'booking_request':
        if (callData.transcription) {
          const bookingKeywords = ['appointment', 'schedule', 'book', 'available', 'estimate', 'quote']
          shouldTrigger = bookingKeywords.some(kw => callData.transcription!.toLowerCase().includes(kw))
        }
        break
    }

    if (!shouldTrigger) continue

    // Personalize message
    const message = personalizeMessage(rule.messageTemplate, {
      companyName,
      callerName: callData.callerName,
    })

    // Schedule or send immediately
    if (rule.delayMinutes > 0) {
      // For delayed messages, use setTimeout (in production, use a job queue)
      setTimeout(() => {
        sendAutoReply(rule.channel, callData.callerNumber, callData.callerEmail, message, companyId)
      }, rule.delayMinutes * 60 * 1000)
      console.log(`[AIReceptionist] Scheduled ${rule.channel} reply in ${rule.delayMinutes}min for rule "${rule.name}"`)
    } else {
      await sendAutoReply(rule.channel, callData.callerNumber, callData.callerEmail, message, companyId)
      console.log(`[AIReceptionist] Sent ${rule.channel} reply for rule "${rule.name}"`)
    }

    // Mark call as AI-responded
    await db.execute(sql`UPDATE call_log SET ai_response_sent = true WHERE id = ${callData.callLogId}`)
  }
}

/**
 * Check if current time is outside business hours
 */
function checkAfterHours(now: Date, startStr: string, endStr: string, timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const localTime = formatter.format(now)
    const [h, m] = localTime.split(':').map(Number)
    const currentMinutes = h * 60 + m

    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    const startMinutes = sh * 60 + sm
    const endMinutes = eh * 60 + em

    return currentMinutes < startMinutes || currentMinutes > endMinutes
  } catch {
    return false
  }
}

/**
 * Personalize a message template with variables
 */
function personalizeMessage(template: string, vars: { companyName: string; callerName?: string }): string {
  return template
    .replace(/\{\{company\}\}/gi, vars.companyName)
    .replace(/\{\{name\}\}/gi, vars.callerName || 'there')
}

/**
 * Send auto-reply via SMS and/or email
 */
async function sendAutoReply(
  channel: string,
  phone?: string,
  email?: string,
  message?: string,
  companyId?: string,
) {
  if (!message) return

  if ((channel === 'sms' || channel === 'both') && phone) {
    await sendSMS(phone, message)
  }

  if ((channel === 'email' || channel === 'both') && email) {
    await sendEmail(email, 'We received your call', message)
  }
}

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('[AIReceptionist] Twilio not configured — skipping SMS')
    return
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: TWILIO_PHONE_NUMBER,
        Body: body,
      }),
    })

    if (!response.ok) {
      console.error('[AIReceptionist] SMS send failed:', response.status)
    }
  } catch (err: any) {
    console.error('[AIReceptionist] SMS error:', err.message)
  }
}

async function sendEmail(to: string, subject: string, body: string) {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    console.log('[AIReceptionist] SendGrid not configured — skipping email')
    return
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM_EMAIL },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    })

    if (!response.ok) {
      console.error('[AIReceptionist] Email send failed:', response.status)
    }
  } catch (err: any) {
    console.error('[AIReceptionist] Email error:', err.message)
  }
}

// ─── Twilio Recording Webhook Pipeline ──────────────────────────────────────────

/**
 * Process a Twilio recording webhook:
 * 1. Download + transcribe recording via Whisper
 * 2. Summarize + generate smart reply via GPT-4o-mini
 * 3. Evaluate rules and trigger auto-replies
 */
export async function processRecordingWebhook(companyId: string, payload: {
  CallSid: string
  RecordingUrl: string
  RecordingStatus: string
  From?: string
  To?: string
}) {
  if (payload.RecordingStatus !== 'completed') return

  const recordingUrl = payload.RecordingUrl + '.wav'

  // Find the call log entry by provider ID
  const callRows = await db.execute(sql`
    SELECT id, caller_number, caller_name, contact_id, status
    FROM call_log
    WHERE company_id = ${companyId} AND provider_id = ${payload.CallSid}
    LIMIT 1
  `)
  const callRow = (Array.isArray(callRows) ? callRows : callRows?.rows)?.[0] as any
  if (!callRow) {
    console.log('[AIReceptionist] No call log found for CallSid:', payload.CallSid)
    return
  }

  // Step 1: Transcribe
  const transcription = await transcribeRecording(recordingUrl)
  if (transcription) {
    await db.execute(sql`
      UPDATE call_log SET transcription = ${transcription}, recording_url = ${recordingUrl}
      WHERE id = ${callRow.id}
    `)
  }

  // Step 2: Summarize
  if (transcription) {
    const [comp] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const result = await summarizeAndGenerateReply(transcription, comp?.name || 'our company', 'service', callRow.caller_name)
    if (result?.summary) {
      await db.execute(sql`UPDATE call_log SET ai_summary = ${result.summary} WHERE id = ${callRow.id}`)
    }
  }

  // Step 3: Look up caller email if we have a contact
  let callerEmail: string | undefined
  if (callRow.contact_id) {
    const [c] = await db.select({ email: contact.email }).from(contact).where(eq(contact.id, callRow.contact_id)).limit(1)
    callerEmail = c?.email || undefined
  }

  // Step 4: Evaluate rules
  await evaluateRules(companyId, {
    callLogId: callRow.id,
    callerNumber: callRow.caller_number,
    callerName: callRow.caller_name,
    callerEmail,
    status: callRow.status,
    transcription: transcription || undefined,
  })
}

export default {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  getSettings,
  upsertSettings,
  transcribeRecording,
  summarizeAndGenerateReply,
  evaluateRules,
  processRecordingWebhook,
}
