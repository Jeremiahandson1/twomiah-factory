import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { createHmac } from 'crypto'
import { db } from '../../db/index.ts'
import { users, clients, timeEntries, schedules } from '../../db/schema.ts'
import { eq, and, isNull, sql } from 'drizzle-orm'

// XML-escape strings to prevent malformed TwiML
function xmlEscape(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Twilio signature validation middleware
// Verifies X-Twilio-Signature header to prevent spoofed webhook requests
async function validateTwilioSignature(c: Context, next: Next) {
  // Skip validation in development
  if (process.env.NODE_ENV !== 'production') return next()

  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.warn('TWILIO_AUTH_TOKEN not set — skipping signature validation')
    return next()
  }

  const signature = c.req.header('X-Twilio-Signature')
  if (!signature) {
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">Request validation failed.</Say></Response>`, 403)
  }

  // Build the full URL Twilio used to sign
  const url = c.req.url
  const body = await c.req.parseBody()

  // Sort POST params and concatenate
  const sortedParams = Object.keys(body).sort().reduce((acc, key) => acc + key + body[key], '')
  const data = url + sortedParams

  const expectedSignature = createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')

  if (signature !== expectedSignature) {
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">Request validation failed.</Say></Response>`, 403)
  }

  return next()
}

const app = new Hono()
app.use('*', validateTwilioSignature)

// POST /api/ivr/voice — Twilio voice webhook (incoming call)
// Returns TwiML to greet and gather caregiver PIN
app.post('/voice', (c) => {
  c.header('Content-Type', 'text/xml')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="4" action="/api/ivr/verify-pin" method="POST" timeout="10">
    <Say voice="alice">Welcome to {{COMPANY_NAME}}. Please enter your 4-digit PIN followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">We didn't receive any input. Goodbye.</Say>
</Response>`)
})

// POST /api/ivr/verify-pin — Verify caregiver PIN, ask for action
app.post('/verify-pin', async (c) => {
  try {
    const body = await c.req.parseBody()
    const pin = body['Digits'] as string
    const callerPhone = (body['From'] as string) || ''

    // Look up caregiver by PIN first, then fall back to phone number
    let [caregiver] = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
    })
      .from(users)
      .where(and(
        eq(users.role, 'caregiver'),
        eq(users.isActive, true),
        eq(users.ivrPin, pin),
      ))
      .limit(1)

    // Fallback: match by phone number if PIN lookup failed and caller phone is available
    if (!caregiver && callerPhone) {
      // Normalize: strip non-digits and compare last 10 digits
      const normalizedCaller = callerPhone.replace(/\D/g, '').slice(-10)
      if (normalizedCaller.length === 10) {
        const allCaregivers = await db.select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          phone: users.phone,
        })
          .from(users)
          .where(and(
            eq(users.role, 'caregiver'),
            eq(users.isActive, true),
          ))

        caregiver = allCaregivers.find(cg => {
          if (!cg.phone) return false
          const normalizedCg = cg.phone.replace(/\D/g, '').slice(-10)
          return normalizedCg === normalizedCaller
        })
      }
    }

    if (!caregiver) {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid PIN. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`)
    }

    // Check if they have an active shift (clocked in but not out)
    const [activeEntry] = await db.select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.caregiverId, caregiver.id),
        isNull(timeEntries.endTime),
        sql`DATE(${timeEntries.startTime}) = CURRENT_DATE`,
      ))
      .limit(1)

    if (activeEntry) {
      // They're clocked in — ask to clock out
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" action="/api/ivr/clock-out?caregiverId=${caregiver.id}&amp;timeEntryId=${activeEntry.id}" method="POST" timeout="10">
    <Say voice="alice">Hello ${xmlEscape(caregiver.firstName)}. You are currently clocked in. Press 1 to clock out, or press 2 to cancel.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`)
    }

    // Not clocked in — ask for client code
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="3" action="/api/ivr/clock-in?caregiverId=${caregiver.id}" method="POST" timeout="15">
    <Say voice="alice">Hello ${xmlEscape(caregiver.firstName)}. To clock in, please enter your 3-digit client code followed by the pound sign.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`)
  } catch (error: any) {
    console.error('IVR verify-pin error:', error)
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`)
  }
})

// POST /api/ivr/clock-in — Create time entry via phone
app.post('/clock-in', async (c) => {
  try {
    const body = await c.req.parseBody()
    const clientCode = body['Digits'] as string
    const caregiverId = c.req.query('caregiverId')

    if (!caregiverId) {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">System error. Missing caregiver. Goodbye.</Say></Response>`)
    }

    // Look up client by IVR code
    const [client] = await db.select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
      .from(clients)
      .where(and(
        eq(clients.ivrCode, clientCode),
        eq(clients.isActive, true),
      ))
      .limit(1)

    if (!client) {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid client code. Please try again.</Say>
  <Redirect method="POST">/api/ivr/voice</Redirect>
</Response>`)
    }

    // Find matching schedule for allotted minutes
    let allottedMinutes: number | null = null
    try {
      const [sched] = await db.select({
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      })
        .from(schedules)
        .where(and(
          eq(schedules.caregiverId, caregiverId),
          eq(schedules.clientId, client.id),
          eq(schedules.isActive, true),
        ))
        .limit(1)

      if (sched?.startTime && sched?.endTime) {
        const startMs = new Date(sched.startTime).getTime()
        const endMs = new Date(sched.endTime).getTime()
        const diff = Math.round((endMs - startMs) / 60000)
        // Handle overnight shifts (negative diff) and unreasonable values
        allottedMinutes = diff > 0 && diff <= 1440 ? diff : Math.abs(diff) <= 1440 ? Math.abs(diff) : null
      }
    } catch { /* ignore */ }

    // Create time entry
    const [entry] = await db.insert(timeEntries).values({
      caregiverId,
      clientId: client.id,
      startTime: new Date(),
      allottedMinutes,
      notes: 'Clocked in via IVR phone call',
    }).returning()

    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You are now clocked in for ${xmlEscape(client.firstName)} ${xmlEscape(client.lastName)}. Have a great shift. Goodbye.</Say>
</Response>`)
  } catch (error: any) {
    console.error('IVR clock-in error:', error)
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`)
  }
})

// POST /api/ivr/clock-out — End time entry via phone
app.post('/clock-out', async (c) => {
  try {
    const body = await c.req.parseBody()
    const digit = body['Digits'] as string
    const caregiverId = c.req.query('caregiverId')
    const timeEntryId = c.req.query('timeEntryId')

    if (digit !== '1') {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">Clock out cancelled. Goodbye.</Say></Response>`)
    }

    if (!timeEntryId || !caregiverId) {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">No active shift found. Goodbye.</Say></Response>`)
    }

    const [entry] = await db.select().from(timeEntries).where(
      and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, caregiverId!))
    )
    if (!entry) {
      c.header('Content-Type', 'text/xml')
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">No active shift found. Goodbye.</Say></Response>`)
    }

    const now = new Date()
    const durationMinutes = Math.round((now.getTime() - new Date(entry.startTime).getTime()) / 60000)
    const allottedMinutes = entry.allottedMinutes
    const billableMinutes = allottedMinutes ? Math.min(durationMinutes, allottedMinutes) : durationMinutes
    const discrepancyMinutes = allottedMinutes ? durationMinutes - allottedMinutes : null

    await db.update(timeEntries)
      .set({
        endTime: now,
        durationMinutes,
        billableMinutes,
        discrepancyMinutes,
        isComplete: true,
        notes: (entry.notes || '') + ' | Clocked out via IVR phone call',
        updatedAt: now,
      })
      .where(eq(timeEntries.id, timeEntryId))

    const hours = (durationMinutes / 60).toFixed(1)
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You are now clocked out. Total time: ${hours} hours. Thank you. Goodbye.</Say>
</Response>`)
  } catch (error: any) {
    console.error('IVR clock-out error:', error)
    c.header('Content-Type', 'text/xml')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">A system error occurred. Please try again later.</Say></Response>`)
  }
})

export default app
