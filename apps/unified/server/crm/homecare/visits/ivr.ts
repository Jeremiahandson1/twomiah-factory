// /api/ivr — the phone line: a caregiver with no smartphone clocks in and out by calling the agency's number. Twilio's
// voice webhooks, answered in TwiML. Moved from templates/crm-homecare/backend/src/routes/ivr.ts.
//
// Mounted public: every request proves it IS Twilio before it runs (the shared verifyTwilioRequest — the https /
// forwarded-host / port-less forms Twilio signed, a timing-safe compare; with no token, refused in production and
// allowed outside it). The token is the company's own Twilio account or the platform's TWILIO_AUTH_TOKEN.
//
// Changes from the template:
//   · the agency is the database's one company (one company per tenant database, SPEC §2), as the template read its
//     only `agencies` row; every read and write is that company's, and the greeting says its name (the template had a
//     {{COMPANY_NAME}} placeholder filled at generation);
//   · a caregiver is anyone whose role normalises to the field rung (`caregiver` on a moved tenant, `field` on a new
//     one), not the string 'caregiver';
//   · "are you clocked in today?" is today on the AGENCY's clock (the template asked the database's UTC date, so a call
//     after 7 PM Central about a visit clocked in before it found no open visit and offered a second clock-in);
//   · a clock-out of a visit already closed changes nothing (a Twilio retry used to stretch it to the second call).
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor } from '@twomiah/tenant-backend'
import { company, user, clients, timeEntries, schedules } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { openEntryToday } from '../../../data/homecareVisits.ts'
import { isCaregiver, isPrivatePayer, payerOf } from './shared.ts'
import { decideBilling } from '../core/punchRules.ts'

// EVV: Telephony visits must report the originating phone number, which Sandata matches against the client's phone on
// file. Twilio's caller id, last 10 digits.
function callerDigits(from: unknown): string {
  return String(from || '').replace(/\D/g, '').slice(-10)
}

// XML-escape strings to prevent malformed TwiML
function xmlEscape(str: string | null | undefined): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const twiml = (c: Context, body: string, status: 200 | 403 = 200) => {
  c.header('Content-Type', 'text/xml')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, status)
}
const say = (c: Context, words: string) => twiml(c, `<Response><Say voice="alice">${words}</Say></Response>`)

type Env = { Variables: { agency: any } }

export function createIvrRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<Env>()

  // Twilio signature validation — every IVR request proves it IS Twilio before it runs. The company is read here and
  // handed to the handlers.
  app.use('*', async (c: Context<Env>, next: Next) => {
    const params = await parseTwilioBody(c)
    const [agency] = await db.select().from(company).orderBy(asc(company.createdAt), asc(company.id)).limit(1)
    const v = verifyTwilioRequest(c, params, twilioConfigFor(agency || null).authToken)
    if (!v.ok || !agency) {
      d.logger.warn('[webhook] refused Twilio IVR request', { reason: v.reason || 'no company' })
      return twiml(c, '<Response><Say voice="alice">Request validation failed.</Say></Response>', 403)
    }
    c.set('agency', agency)
    await next()
  })

  /** Active caregivers of the company, optionally only those with this PIN. */
  async function caregivers(companyId: string, pin?: string) {
    const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role })
      .from(user)
      .where(and(eq(user.companyId, companyId), eq(user.isActive, true), ...(pin !== undefined ? [eq(user.ivrPin, pin)] : [])))
    return rows.filter((u: any) => isCaregiver(d, u))
  }

  // POST /api/ivr/voice — Twilio voice webhook (incoming call): greet and gather the caregiver's PIN
  app.post('/voice', (c) => {
    const agency = c.get('agency')
    return twiml(c, `<Response>
  <Gather input="dtmf" numDigits="4" action="/api/ivr/verify-pin" method="POST" timeout="10">
    <Say voice="alice">Welcome to ${xmlEscape(agency.name)}. Please enter your 4-digit PIN followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">We didn't receive any input. Goodbye.</Say>
</Response>`)
  })

  // POST /api/ivr/verify-pin — verify the caregiver's PIN, ask for the action
  app.post('/verify-pin', async (c) => {
    try {
      const companyId = c.get('agency').id as string
      const body = await c.req.parseBody()
      const pin = String(body['Digits'] ?? '')
      const callerPhone = String(body['From'] ?? '')

      // Look up the caregiver by PIN first, then fall back to the caller's number.
      let caregiver: any = pin ? (await caregivers(companyId, pin))[0] : undefined
      if (!caregiver && callerPhone) {
        const normalizedCaller = callerPhone.replace(/\D/g, '').slice(-10)
        if (normalizedCaller.length === 10) {
          caregiver = (await caregivers(companyId)).find((cg: any) => cg.phone && cg.phone.replace(/\D/g, '').slice(-10) === normalizedCaller)
        }
      }

      if (!caregiver) {
        return twiml(c, `<Response>
  <Say voice="alice">Invalid PIN. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`)
      }

      // Clocked in today (on the agency's clock) and not out?
      const tz = await core.time.timezone(companyId)
      const today = await core.time.today(companyId, tz)
      const activeEntry = await openEntryToday(db, companyId, caregiver.id, today, tz)

      if (activeEntry) {
        return twiml(c, `<Response>
  <Gather input="dtmf" numDigits="1" action="/api/ivr/clock-out?caregiverId=${encodeURIComponent(caregiver.id)}&amp;timeEntryId=${encodeURIComponent(activeEntry.id)}" method="POST" timeout="10">
    <Say voice="alice">Hello ${xmlEscape(caregiver.firstName)}. You are currently clocked in. Press 1 to clock out, or press 2 to cancel.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`)
      }

      // Not clocked in — ask for the client code
      return twiml(c, `<Response>
  <Gather input="dtmf" numDigits="3" action="/api/ivr/clock-in?caregiverId=${encodeURIComponent(caregiver.id)}" method="POST" timeout="15">
    <Say voice="alice">Hello ${xmlEscape(caregiver.firstName)}. To clock in, please enter your 3-digit client code followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`)
    } catch (error: any) {
      d.logger.error('IVR verify-pin error', { error: error?.message })
      return say(c, 'A system error occurred. Please try again later.')
    }
  })

  // POST /api/ivr/clock-in — a time entry by phone
  app.post('/clock-in', async (c) => {
    try {
      const companyId = c.get('agency').id as string
      const body = await c.req.parseBody()
      const clientCode = String(body['Digits'] ?? '')
      const caregiverId = c.req.query('caregiverId')
      if (!caregiverId) return say(c, 'System error. Missing caregiver. Goodbye.')
      const [cg] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, caregiverId), eq(user.companyId, companyId))).limit(1)
      if (!cg) return say(c, 'System error. Missing caregiver. Goodbye.')

      const [client] = await db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.ivrCode, clientCode), eq(clients.isActive, true)))
        .limit(1)
      if (!client) {
        return twiml(c, `<Response>
  <Say voice="alice">Invalid client code. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`)
      }

      // A matching schedule's length is the visit's allotted minutes.
      let allottedMinutes: number | null = null
      try {
        const [sched] = await db.select({ startTime: schedules.startTime, endTime: schedules.endTime }).from(schedules)
          .where(and(eq(schedules.companyId, companyId), eq(schedules.caregiverId, caregiverId), eq(schedules.clientId, client.id), eq(schedules.isActive, true)))
          .limit(1)
        if (sched?.startTime && sched?.endTime) {
          const diff = Math.round((new Date(sched.endTime).getTime() - new Date(sched.startTime).getTime()) / 60000)
          // Overnight shifts (a negative difference) and unreasonable values.
          allottedMinutes = diff > 0 && diff <= 1440 ? diff : Math.abs(diff) <= 1440 ? Math.abs(diff) : null
        }
      } catch { /* no schedule length: an unscheduled punch */ }

      const [entry] = await db.insert(timeEntries).values({
        companyId, caregiverId, clientId: client.id, startTime: new Date(), allottedMinutes, notes: 'Clocked in via IVR phone call',
      }).returning()

      // Separate best-effort update so the punch above never depends on it.
      try {
        const from = callerDigits(body['From'])
        if (from) await db.update(timeEntries).set({ originPhone: from }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId)))
      } catch (opErr: any) { d.logger.error('[IVR clock-in] origin_phone', { error: opErr?.message }) }

      return say(c, `You are now clocked in for ${xmlEscape(client.firstName)} ${xmlEscape(client.lastName)}. Have a great shift. Goodbye.`)
    } catch (error: any) {
      d.logger.error('IVR clock-in error', { error: error?.message })
      return say(c, 'A system error occurred. Please try again later.')
    }
  })

  // POST /api/ivr/clock-out — end the time entry by phone
  app.post('/clock-out', async (c) => {
    try {
      const companyId = c.get('agency').id as string
      const body = await c.req.parseBody()
      const digit = String(body['Digits'] ?? '')
      const caregiverId = c.req.query('caregiverId')
      const timeEntryId = c.req.query('timeEntryId')

      if (digit !== '1') return say(c, 'Clock out cancelled. Goodbye.')
      if (!timeEntryId || !caregiverId) return say(c, 'No active shift found. Goodbye.')

      const [entry] = await db.select().from(timeEntries)
        .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, caregiverId), eq(timeEntries.companyId, companyId))).limit(1)
      // A visit already closed (a retried webhook, a second call) is not closed again.
      if (!entry || entry.endTime) return say(c, 'No active shift found. Goodbye.')

      const now = new Date()
      // The app's own billing rule (core/punchRules.ts decideBilling), as the app's clock-out applies it: private pay
      // bills the clock, any other payer the schedule, and a visit far off its schedule waits for the office's OK. The
      // template's phone line billed min(actual, scheduled) and flagged nothing (found in the move).
      const payer = await payerOf(db, companyId, entry.clientId)
      const dec = decideBilling({ durationSeconds: (now.getTime() - new Date(entry.startTime).getTime()) / 1000, allottedMinutes: entry.allottedMinutes, isPrivatePay: isPrivatePayer(payer) })

      // Required tasks (care_required_tasks): a caller cannot be shown a list of tasks, so the call is never refused. The visit is closed as
      // it was told to be and flagged for the office to review, with the tasks named (the same flag the app's offline clock-out uses).
      const openRequired = await core.requiredTasks.pendingFor(companyId, entry)
      const flag = openRequired.length
        ? { needsApproval: true, approvalReason: [dec.approvalReason, `Clocked out by phone with required tasks not done: ${openRequired.map((t) => t.taskName).join('; ')}`].filter(Boolean).join(' · ') }
        : { needsApproval: dec.needsApproval, approvalReason: dec.approvalReason }

      await db.update(timeEntries).set({
        endTime: now, durationMinutes: dec.durationMinutes, billableMinutes: dec.billableMinutes, discrepancyMinutes: dec.discrepancyMinutes,
        needsApproval: flag.needsApproval, approvalReason: flag.approvalReason, isComplete: true,
        notes: (entry.notes || '') + ' | Clocked out via IVR phone call', updatedAt: now,
      }).where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId), isNull(timeEntries.endTime)))

      // EVV Telephony caller id (see clock-in) — fills only if the clock-in didn't capture it.
      try {
        const from = callerDigits(body['From'])
        if (from) await db.update(timeEntries).set({ originPhone: from })
          .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId), isNull(timeEntries.originPhone)))
      } catch (opErr: any) { d.logger.error('[IVR clock-out] origin_phone', { error: opErr?.message }) }

      // Phone-closed visits get their EVV record exactly like app clock-outs do.
      await core.evvVisits.createEVVFromTimeEntry(companyId, timeEntryId)

      return say(c, `You are now clocked out. Total time: ${(dec.durationMinutes / 60).toFixed(1)} hours. Thank you. Goodbye.`)
    } catch (error: any) {
      d.logger.error('IVR clock-out error', { error: error?.message })
      return say(c, 'A system error occurred. Please try again later.')
    }
  })

  return app
}
