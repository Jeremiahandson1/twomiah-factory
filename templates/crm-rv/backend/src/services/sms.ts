import { db } from '../../db/index.ts'
import { message, company as companyTable, contact as contactTable } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import logger from './logger.ts'

/**
 * SMS service — Twilio over the REST API (no SDK dependency).
 *
 * Each tenant brings their own Twilio number + credentials (stored on the
 * company row: twilioAccountSid / twilioAuthToken / twilioPhoneNumber). Every
 * send is logged to the `message` table so the unified inbox has a complete,
 * dealership-owned record. Shared by the inbox route, the sequence runner, and
 * service status texts.
 */

export type TwilioCreds = {
  accountSid: string | null
  authToken: string | null
  fromNumber: string | null
}

export function getCompanyTwilio(company: any): TwilioCreds {
  return {
    accountSid: company?.twilioAccountSid || null,
    authToken: company?.twilioAuthToken || null,
    fromNumber: company?.twilioPhoneNumber || null,
  }
}

export function isTwilioConfigured(creds: TwilioCreds): boolean {
  return !!(creds.accountSid && creds.authToken && creds.fromNumber)
}

/** Replace {{firstName}} / {{name}} / {{companyName}} tokens in a template body. */
export function renderTemplate(body: string, contact?: any, company?: any): string {
  const name = contact?.name || ''
  const firstName = name.split(' ')[0] || ''
  return (body || '')
    .replace(/\{\{\s*firstName\s*\}\}/g, firstName)
    .replace(/\{\{\s*name\s*\}\}/g, name)
    .replace(/\{\{\s*companyName\s*\}\}/g, company?.name || '')
}

/** Low-level Twilio send via REST. Throws on failure. */
async function twilioSend(creds: TwilioCreds, to: string, body: string, mediaUrls: string[] = []): Promise<{ sid: string; status: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid!)}/Messages.json`
  const form = new URLSearchParams()
  form.set('To', to)
  form.set('From', creds.fromNumber!)
  form.set('Body', body)
  for (const m of mediaUrls) form.append('MediaUrl', m)

  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.message || `Twilio error ${res.status}`)
    return { sid: data.sid, status: data.status || 'sent' }
  } catch (err: any) {
    clearTimeout(timeout)
    throw err
  }
}

export type SendArgs = {
  companyId: string
  to: string
  body: string
  contactId?: string | null
  userId?: string | null
  mediaUrls?: string[]
  source?: 'manual' | 'sequence' | 'service_status'
  /** Pre-loaded company row to avoid a re-query (optional). */
  company?: any
}

/**
 * Send an SMS and log it to the unified inbox. Always writes a `message` row —
 * status 'sent'/'queued' on success, 'failed' (with errorMessage) otherwise —
 * so the inbox reflects reality even when Twilio isn't configured. Returns the
 * inserted message row. Never throws for a send failure (the row carries the error).
 */
export async function sendAndLog(args: SendArgs) {
  const company = args.company || (await db.select().from(companyTable).where(eq(companyTable.id, args.companyId)).limit(1))[0]
  const creds = getCompanyTwilio(company)
  const mediaUrls = args.mediaUrls || []
  const channel = mediaUrls.length > 0 ? 'mms' : 'sms'

  let status = 'queued'
  let twilioSid: string | null = null
  let errorMessage: string | null = null

  if (!isTwilioConfigured(creds)) {
    status = 'failed'
    errorMessage = 'Twilio is not configured for this dealership (add SID, auth token and phone number in Settings).'
  } else {
    try {
      const result = await twilioSend(creds, args.to, args.body, mediaUrls)
      status = result.status === 'failed' || result.status === 'undelivered' ? 'failed' : 'sent'
      twilioSid = result.sid
    } catch (err: any) {
      status = 'failed'
      errorMessage = err?.message || 'SMS send failed'
      logger.warn?.('SMS send failed', { companyId: args.companyId, error: errorMessage })
    }
  }

  const [row] = await db.insert(message).values({
    id: createId(),
    direction: 'outbound',
    body: args.body,
    status,
    channel,
    mediaUrls,
    fromNumber: creds.fromNumber,
    toNumber: args.to,
    twilioSid,
    errorMessage,
    source: args.source || 'manual',
    contactId: args.contactId || null,
    userId: args.userId || null,
    companyId: args.companyId,
  }).returning()

  return row
}

/** Record an inbound message (from the Twilio webhook), matching to a contact by phone. */
export async function recordInbound(args: { companyId: string; from: string; to: string; body: string; twilioSid?: string; mediaUrls?: string[] }) {
  // Best-effort match an existing contact by phone (last 10 digits).
  const digits = (s: string) => (s || '').replace(/\D/g, '').slice(-10)
  const fromDigits = digits(args.from)
  let contactId: string | null = null
  if (fromDigits) {
    const rows = await db.select({ id: contactTable.id, phone: contactTable.phone, mobile: contactTable.mobile })
      .from(contactTable).where(eq(contactTable.companyId, args.companyId))
    const match = rows.find(r => digits(r.phone || '') === fromDigits || digits(r.mobile || '') === fromDigits)
    contactId = match?.id || null
  }

  const [row] = await db.insert(message).values({
    id: createId(),
    direction: 'inbound',
    body: args.body,
    status: 'received',
    channel: (args.mediaUrls && args.mediaUrls.length > 0) ? 'mms' : 'sms',
    mediaUrls: args.mediaUrls || [],
    fromNumber: args.from,
    toNumber: args.to,
    twilioSid: args.twilioSid || null,
    source: 'manual',
    contactId,
    companyId: args.companyId,
  }).returning()

  return row
}
