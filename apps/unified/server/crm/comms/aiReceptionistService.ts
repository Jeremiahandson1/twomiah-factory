// The AI receptionist: its rules and settings, Twilio recording → OpenAI Whisper transcription, a GPT summary, and
// the rule engine that answers a missed call by text or email. Moved from templates/crm/backend/src/services/
// aiReceptionist.ts; its raw SQL on the call log is in server/data/aiReceptionist.ts.
//
// Home care's copy (templates/crm-homecare services/aiReceptionist.ts) differed only in who a caller is — a client of
// the agency (a "new lead" is a number no client has; the reply's email is the client's) — and the summary's line of
// business. That is CrmSettings.callers ('clients'), read here.
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { aiReceptionistRule, aiReceptionistSettings, clients, company, contact } from '../../db/schema/index.ts'
import * as q from '../../data/aiReceptionist.ts'
import { companyRowTimeZone, formatPhoneE164 } from '@twomiah/tenant-backend'
import { clientByPhone } from '../../data/calltracking.ts'
import { createCalltrackingService } from './calltrackingService.ts'
import type { CrmDeps } from '../deps.ts'

/**
 * The fields a rule or the settings may be changed through — nothing else reaches .set(), so a PUT carrying
 * companyId, id or createdAt cannot move the row to another tenant or rewrite its history. (10/16)
 */
export const RULE_FIELDS = ['name', 'trigger', 'channel', 'messageTemplate', 'delayMinutes', 'isActive', 'keywordMatch'] as const
// No 'timezone': the receptionist keeps time on the business's one clock (Settings › Company), read in getSettings.
export const SETTINGS_FIELDS = ['isEnabled', 'businessHoursStart', 'businessHoursEnd', 'greetingText', 'forwardingNumber'] as const
function allowedOnly<K extends string>(data: unknown, keys: readonly K[]): Partial<Record<K, any>> {
  const src = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const out: Partial<Record<K, any>> = {}
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) out[k] = src[k]
  return out
}

/** Outside business hours, in the company's time zone? */
function checkAfterHours(now: Date, startStr: string, endStr: string, timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })
    const [h, m] = formatter.format(now).split(':').map(Number)
    const currentMinutes = h * 60 + m
    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    return currentMinutes < sh * 60 + sm || currentMinutes > eh * 60 + em
  } catch {
    return false
  }
}

function personalizeMessage(template: string, vars: { companyName: string; callerName?: string }): string {
  return template
    .replace(/\{\{company\}\}/gi, vars.companyName)
    .replace(/\{\{name\}\}/gi, vars.callerName || 'there')
}

export function createAiReceptionistService(d: CrmDeps) {
  const { db, logger } = d
  /** Callers are home-care clients (CrmSettings.callers). */
  const callersAreClients = d.settings?.callers === 'clients'
  // The call log is call tracking's: a call the line answers is logged the way a tracked call is.
  const calltracking = createCalltrackingService(d)
  // The providers' keys, read when used (the template read them once at import).
  const env = () => ({
    openai: process.env.OPENAI_API_KEY,
  })

  // ── Rules ──
  async function getRules(companyId: string) {
    return db.select().from(aiReceptionistRule)
      .where(eq(aiReceptionistRule.companyId, companyId))
      .orderBy(desc(aiReceptionistRule.createdAt))
  }

  async function createRule(companyId: string, data: { name: string; trigger: string; channel: string; messageTemplate: string; delayMinutes?: number; isActive?: boolean; keywordMatch?: string }) {
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

  async function updateRule(ruleId: string, companyId: string, data: Record<string, unknown>) {
    const [rule] = await db.update(aiReceptionistRule)
      .set({ ...allowedOnly(data, RULE_FIELDS), updatedAt: new Date() })
      .where(and(eq(aiReceptionistRule.id, ruleId), eq(aiReceptionistRule.companyId, companyId)))
      .returning()
    return rule
  }

  /** Whether a rule of this company's was there to delete. */
  async function deleteRule(ruleId: string, companyId: string): Promise<boolean> {
    const gone = await db.delete(aiReceptionistRule)
      .where(and(eq(aiReceptionistRule.id, ruleId), eq(aiReceptionistRule.companyId, companyId)))
      .returning({ id: aiReceptionistRule.id })
    return gone.length > 0
  }

  // ── Settings ──
  /**
   * ONE CLOCK: "after hours" is judged on the business's own time zone (company.timezone, else its state's —
   * companyRowTimeZone), the one Settings › Company sets. The receptionist kept a zone of its own, defaulting to Chicago
   * whatever the business (coordinator 10/23). Its column is no longer read; migration 0027 moved a saved one onto a
   * company that had none.
   */
  async function clockOf(companyId: string): Promise<string> {
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    return companyRowTimeZone(co)
  }

  async function getSettings(companyId: string) {
    const timezone = await clockOf(companyId)
    const [settings] = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, companyId)).limit(1)
    if (!settings) {
      return { companyId, isEnabled: false, businessHoursStart: '09:00', businessHoursEnd: '17:00', timezone, greetingText: null, forwardingNumber: null }
    }
    return { ...settings, timezone }
  }

  async function upsertSettings(companyId: string, data: Partial<{ isEnabled: boolean; businessHoursStart: string; businessHoursEnd: string; timezone: string; greetingText: string; forwardingNumber: string }>) {
    const existing = await db.select().from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, companyId)).limit(1)
    if (existing.length > 0) {
      const [updated] = await db.update(aiReceptionistSettings)
        .set({ ...allowedOnly(data, SETTINGS_FIELDS), updatedAt: new Date() })
        .where(eq(aiReceptionistSettings.companyId, companyId))
        .returning()
      return { ...updated, timezone: await clockOf(companyId) }
    }
    const [created] = await db.insert(aiReceptionistSettings).values({
      companyId,
      isEnabled: data.isEnabled ?? false,
      businessHoursStart: data.businessHoursStart || '09:00',
      businessHoursEnd: data.businessHoursEnd || '17:00',
      greetingText: data.greetingText,
      forwardingNumber: data.forwardingNumber,
    }).returning()
    return { ...created, timezone: await clockOf(companyId) }
  }

  // ── OpenAI ──

  /** Transcribe a recording with OpenAI Whisper; null when it can't (no key, unreadable audio, an API error). */
  async function transcribeRecording(recordingUrl: string): Promise<string | null> {
    const key = env().openai
    if (!key) {
      logger.info('[AIReceptionist] OPENAI_API_KEY not set — skipping transcription')
      return null
    }
    try {
      const audioResponse = await fetch(recordingUrl)
      if (!audioResponse.ok) {
        logger.error('[AIReceptionist] Failed to download recording', { status: audioResponse.status })
        return null
      }
      const audioBlob = new Blob([await audioResponse.arrayBuffer()], { type: 'audio/wav' })
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.wav')
      formData.append('model', 'whisper-1')
      formData.append('language', 'en')
      const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
      })
      if (!whisperResponse.ok) {
        logger.error('[AIReceptionist] Whisper API error', { status: whisperResponse.status })
        return null
      }
      const result: any = await whisperResponse.json()
      return result.text || null
    } catch (err: any) {
      logger.error('[AIReceptionist] Transcription error', { error: err?.message })
      return null
    }
  }

  /** A short summary of a voicemail and a suggested SMS reply (GPT-4o-mini); null when it can't. */
  async function summarizeAndGenerateReply(transcription: string, _companyName: string, industry: string, _callerName?: string): Promise<{ summary: string; suggestedReply: string } | null> {
    const key = env().openai
    if (!key) return null
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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
        logger.error('[AIReceptionist] GPT API error', { status: response.status })
        return null
      }
      const result: any = await response.json()
      const content = result.choices?.[0]?.message?.content || ''
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) return JSON.parse(jsonMatch[0])
      return null
    } catch (err: any) {
      logger.error('[AIReceptionist] Summary error', { error: err?.message })
      return null
    }
  }

  // ── Replies ──
  // Through the business's one texting service: its own registered sender, a STOP honoured, the wallet metered, the
  // reply kept in Messages. This posted to Twilio directly from the platform's shared number (2026-10-21).
  async function sendSMS(companyId: string, to: string, body: string) {
    try {
      const r: any = await d.services.sms.sendSMS(companyId, { toPhone: to, message: body })
      if (r?.refused) logger.info('[AIReceptionist] SMS not sent', { reason: r.errorMessage })
      else if (r?.status === 'failed') logger.error('[AIReceptionist] SMS send failed', { error: r.errorMessage })
    } catch (err: any) {
      logger.error('[AIReceptionist] SMS error', { error: err?.message })
    }
  }

  /** Through the app's one email service. */
  async function sendEmail(to: string, subject: string, body: string) {
    try {
      const result: any = await d.services.emailService.sendRaw({ to, subject, html: `<pre style="font-family:inherit;white-space:pre-wrap">${body}</pre>` })
      if (!result?.success) logger.error('[AIReceptionist] Notification email failed')
    } catch (error: any) {
      logger.error('[AIReceptionist] Failed to send email', { error: error?.message })
    }
  }

  async function sendAutoReply(companyId: string, channel: string, phone?: string, email?: string, message?: string) {
    if (!message) return
    if ((channel === 'sms' || channel === 'both') && phone) await sendSMS(companyId, phone, message)
    if ((channel === 'email' || channel === 'both') && email) await sendEmail(email, 'We received your call', message)
  }

  // ── The rule engine ──

  /** Every active rule against a call; the matching ones reply by text and/or email. */
  async function evaluateRules(companyId: string, callData: {
    callLogId: string; callerNumber?: string; callerName?: string; callerEmail?: string; status: string; transcription?: string; duration?: number
    /**
     * The caller was already answered for this call (the missed-call rules ran when nobody picked up): only what a
     * voicemail adds runs now — the voicemail, keyword and booking rules — so one call is not replied to twice.
     */
    alreadyAnswered?: boolean
  }) {
    const settings: any = await getSettings(companyId)
    if (!settings.isEnabled) return

    const [comp] = await db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const companyName = comp?.name || 'our company'
    const rules = await db.select().from(aiReceptionistRule)
      .where(and(eq(aiReceptionistRule.companyId, companyId), eq(aiReceptionistRule.isActive, true)))
    const isAfterHours = checkAfterHours(new Date(), settings.businessHoursStart, settings.businessHoursEnd, settings.timezone)

    const VOICEMAIL_ONLY = new Set(['voicemail', 'keyword', 'booking_request'])
    for (const rule of rules as any[]) {
      if (callData.alreadyAnswered && !VOICEMAIL_ONLY.has(rule.trigger)) continue
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
          if (callData.callerNumber) {
            const existing = callersAreClients
              ? await clientByPhone(db, companyId, callData.callerNumber)
              : (await db.select({ id: contact.id }).from(contact)
                .where(and(eq(contact.companyId, companyId), eq(contact.phone, callData.callerNumber))).limit(1))[0]
            shouldTrigger = !existing
          }
          break
        case 'keyword':
          if (callData.transcription && rule.keywordMatch) {
            const keywords = rule.keywordMatch.toLowerCase().split(',').map((k: string) => k.trim())
            shouldTrigger = keywords.some((kw: string) => callData.transcription!.toLowerCase().includes(kw))
          }
          break
        case 'booking_request':
          if (callData.transcription) {
            const bookingKeywords = ['appointment', 'schedule', 'book', 'available', 'estimate', 'quote']
            shouldTrigger = bookingKeywords.some((kw) => callData.transcription!.toLowerCase().includes(kw))
          }
          break
      }
      if (!shouldTrigger) continue

      const message = personalizeMessage(rule.messageTemplate, { companyName, callerName: callData.callerName })
      if (rule.delayMinutes > 0) {
        // A per-call delay, held in memory as the template did (lost on a restart; a job queue would keep it).
        setTimeout(() => { sendAutoReply(companyId, rule.channel, callData.callerNumber, callData.callerEmail, message) }, rule.delayMinutes * 60 * 1000)
        logger.info(`[AIReceptionist] Scheduled ${rule.channel} reply in ${rule.delayMinutes}min for rule "${rule.name}"`)
      } else {
        await sendAutoReply(companyId, rule.channel, callData.callerNumber, callData.callerEmail, message)
        logger.info(`[AIReceptionist] Sent ${rule.channel} reply for rule "${rule.name}"`)
      }
      await q.markCallAiResponded(db, callData.callLogId)
    }
  }

  /** Twilio's recording callback: transcribe, summarise, then run the rules. */
  async function processRecordingWebhook(companyId: string, payload: { CallSid: string; RecordingUrl: string; RecordingStatus: string; From?: string; To?: string }) {
    if (payload.RecordingStatus !== 'completed') return
    const recordingUrl = payload.RecordingUrl + '.wav'
    const callRow = await q.findCallByProviderId(db, companyId, payload.CallSid)
    if (!callRow) {
      logger.info('[AIReceptionist] No call log found for CallSid', { callSid: payload.CallSid })
      return
    }
    // A message was left: the call is a voicemail (the receptionist logged it 'missed' when nobody picked up).
    if (callRow.status === 'missed' || callRow.status === 'ringing') { await q.setCallStatus(db, callRow.id, 'voicemail'); callRow.status = 'voicemail' }
    const transcription = await transcribeRecording(recordingUrl)
    if (transcription) await q.setCallTranscription(db, callRow.id, transcription, recordingUrl)
    if (transcription) {
      const [comp] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
      const result = callersAreClients
        ? await summarizeAndGenerateReply(transcription, comp?.name || 'our agency', 'home care', callRow.callerName || undefined)
        : await summarizeAndGenerateReply(transcription, comp?.name || 'our company', 'service', callRow.callerName || undefined)
      if (result?.summary) await q.setCallSummary(db, callRow.id, result.summary)
    }
    let callerEmail: string | undefined
    if (callersAreClients && callRow.clientId) {
      const [c] = await db.select({ email: clients.email }).from(clients).where(and(eq(clients.id, callRow.clientId), eq(clients.companyId, companyId))).limit(1)
      callerEmail = c?.email || undefined
    } else if (callRow.contactId) {
      const [c] = await db.select({ email: contact.email }).from(contact).where(eq(contact.id, callRow.contactId)).limit(1)
      callerEmail = c?.email || undefined
    }
    await evaluateRules(companyId, {
      callLogId: callRow.id,
      callerNumber: callRow.callerNumber || undefined,
      callerName: callRow.callerName || undefined,
      callerEmail,
      status: callRow.status,
      transcription: transcription || undefined,
      alreadyAnswered: callRow.aiResponseSent,
    })
  }

  // ── The phone line (Twilio's voice webhooks, ./aiReceptionist.ts) ──
  // Twilio's voice URL for the business's number points at /webhook/voice: the call rings the forwarding number (the
  // business's own phone) for 20 seconds; nobody picks up — or there is no forwarding number — and the caller hears the
  // greeting and can leave a message. The voicemail is recorded, written out, and answered by the rules.

  /** What the caller hears before the beep: the greeting written on the Settings tab, else a plain one. */
  function greetingFor(settings: { greetingText?: string | null }, companyName: string): string {
    const own = String(settings.greetingText ?? '').trim()
    return own || `Thanks for calling ${companyName}. We can't take your call right now. Please leave a message after the tone and we'll get back to you.`
  }

  /** The number unanswered calls ring first, E.164, or null when none (or not a dialable number). */
  function forwardTo(settings: { forwardingNumber?: string | null }): string | null {
    const digits = String(settings.forwardingNumber ?? '').replace(/\D/g, '')
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) return formatPhoneE164(digits)
    return null
  }

  /** A call arriving: logged (call tracking's log, its first caller filed as call tracking does), then rung or greeted. */
  async function callArrived(companyId: string, p: Record<string, string>) {
    if (p.CallSid && !(await q.findCallByProviderId(db, companyId, p.CallSid))) {
      await calltracking.logCall(companyId, {
        trackingNumber: p.To, callerNumber: p.From, callerCity: p.FromCity, callerState: p.FromState,
        direction: 'inbound', status: 'ringing', providerId: p.CallSid,
      })
    }
    const settings: any = await getSettings(companyId)
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return { forwardTo: forwardTo(settings), greeting: greetingFor(settings, co?.name || 'us') }
  }

  /** The forwarded leg's outcome. Not picked up: the call is missed, the missed-call rules reply, and voicemail follows. */
  async function dialEnded(companyId: string, p: Record<string, string>): Promise<{ answered: boolean; greeting: string }> {
    const answered = p.DialCallStatus === 'completed' || p.DialCallStatus === 'answered'
    const callRow = p.CallSid ? await q.findCallByProviderId(db, companyId, p.CallSid) : null
    if (callRow) await q.setCallStatus(db, callRow.id, answered ? 'completed' : 'missed')
    const settings: any = await getSettings(companyId)
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!answered && callRow) {
      evaluateRules(companyId, { callLogId: callRow.id, callerNumber: callRow.callerNumber || p.From, callerName: callRow.callerName || undefined, status: 'missed' })
        .catch((err: any) => logger.error('[AIReceptionist] missed-call rules failed', { error: err?.message }))
    }
    return { answered, greeting: greetingFor(settings, co?.name || 'us') }
  }

  /** A manual re-transcribe of one of this company's calls (the call's stored recording). */
  async function transcribeExistingCall(companyId: string, callId: string) {
    const callRow = await q.findCallRecording(db, callId, companyId)
    if (!callRow) return { ok: false as const, error: 'Call not found' }
    if (!callRow.recordingUrl) return { ok: false as const, error: 'No recording on file for this call' }
    const transcription = await transcribeRecording(callRow.recordingUrl)
    if (!transcription) return { ok: false as const, error: 'Transcription unavailable (recording unreadable or OpenAI not configured)' }
    await q.setCallTranscription(db, callRow.id, transcription)
    let summary: string | null = null
    const [comp] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const result = await summarizeAndGenerateReply(transcription, comp?.name || 'our company', 'service', callRow.callerName || undefined)
    if (result?.summary) {
      summary = result.summary
      await q.setCallSummary(db, callRow.id, summary)
    }
    return { ok: true as const, transcription, summary }
  }

  return {
    getRules, createRule, updateRule, deleteRule, getSettings, upsertSettings, callArrived, dialEnded, forwardTo,
    transcribeRecording, transcribeExistingCall, summarizeAndGenerateReply, evaluateRules, processRecordingWebhook,
  }
}
