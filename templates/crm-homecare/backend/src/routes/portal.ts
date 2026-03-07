/**
 * Home Care Client Portal Routes
 *
 * Admin routes: manage portal access for clients
 * Portal routes: token-based auth for client/family access
 */

import { Hono } from 'hono'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  clients,
  agencies,
  schedules,
  timeEntries,
  invoices,
  invoiceLineItems,
  clientAssignments,
  clientEmergencyContacts,
  authorizations,
  users,
  clientNotifications,
  portalMessageThreads,
  portalMessages,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'
import type { Context, Next } from 'hono'

const app = new Hono()

// =============================================
// ADMIN ROUTES (require staff auth)
// =============================================

// Enable portal for a client
app.post('/contacts/:clientId/enable', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const email = foundClient.portalEmail || foundClient.email
  if (!email) {
    return c.json({ error: 'Client must have an email (or portal email) to enable portal access' }, 400)
  }

  // Generate token (valid for 90 days)
  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      portalEmail: email,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Disable portal for a client
app.post('/contacts/:clientId/disable', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  await db
    .update(clients)
    .set({
      portalEnabled: false,
      portalToken: null,
      portalTokenExp: null,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  return c.json({ success: true })
})

// Regenerate portal token
app.post('/contacts/:clientId/regenerate', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Send portal invite email
app.post('/contacts/:clientId/send-link', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const email = foundClient.portalEmail || foundClient.email
  if (!email) {
    return c.json({ error: 'Client has no email address' }, 400)
  }

  if (!foundClient.portalEnabled || !foundClient.portalToken) {
    return c.json({ error: 'Portal access not enabled for this client' }, 400)
  }

  // Get agency info
  const [agency] = await db.select().from(agencies).limit(1)

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${foundClient.portalToken}`

  await emailService.sendPortalInvite(email, {
    contactName: `${foundClient.firstName} ${foundClient.lastName}`,
    companyName: agency?.name || '{{COMPANY_NAME}}',
    portalUrl,
  })

  return c.json({ success: true, sentTo: email })
})

// Get portal status for a client
app.get('/contacts/:clientId/status', authenticate, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({
    enabled: foundClient.portalEnabled,
    hasToken: !!foundClient.portalToken,
    expiresAt: foundClient.portalTokenExp,
    lastVisit: foundClient.lastPortalVisit,
    portalEmail: foundClient.portalEmail,
    portalUrl: foundClient.portalToken
      ? `${process.env.FRONTEND_URL || ''}/portal?token=${foundClient.portalToken}`
      : null,
  })
})

// Admin: create invite (used by EditClientModal)
app.post('/admin/invite', authenticate, requireAdmin, async (c) => {
  const { clientId, email } = await c.req.json()

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      portalEmail: email || foundClient.email,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const setupUrl = `${process.env.FRONTEND_URL || ''}/portal/setup?token=${portalToken}`

  // Try to send email, but don't fail if it errors
  try {
    const [agency] = await db.select().from(agencies).limit(1)
    await emailService.sendPortalSetupInvite(email || foundClient.email!, {
      contactName: `${foundClient.firstName} ${foundClient.lastName}`,
      companyName: agency?.name || '{{COMPANY_NAME}}',
      setupUrl,
    })
  } catch (err) {
    logger.warn('Failed to send portal invite email', { error: (err as Error).message })
  }

  return c.json({ success: true, inviteUrl: setupUrl })
})

// Admin: toggle portal access
app.put('/admin/clients/:clientId/toggle', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')
  const { enabled } = await c.req.json()

  await db
    .update(clients)
    .set({
      portalEnabled: !!enabled,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  return c.json({ success: true })
})

// Admin: list portal-enabled clients
app.get('/admin/clients', authenticate, async (c) => {
  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      email: clients.email,
      portalEmail: clients.portalEmail,
      portalEnabled: clients.portalEnabled,
      lastPortalVisit: clients.lastPortalVisit,
      portalTokenExp: clients.portalTokenExp,
    })
    .from(clients)
    .where(eq(clients.isActive, true))
    .orderBy(clients.lastName)

  return c.json(rows)
})

// =============================================
// PORTAL AUTH: Login with email + password
// =============================================

app.post('/login', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.portalEmail, email.toLowerCase()),
        eq(clients.portalEnabled, true),
      )
    )
    .limit(1)

  if (!foundClient || !foundClient.portalPasswordHash) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const valid = await bcrypt.compare(password, foundClient.portalPasswordHash)
  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  // Check token expiry
  if (foundClient.portalTokenExp && new Date() > new Date(foundClient.portalTokenExp)) {
    return c.json({ error: 'Portal access has expired. Please contact your care coordinator.' }, 401)
  }

  // Update last visit
  await db
    .update(clients)
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
    .where(eq(clients.id, foundClient.id))

  const token = jwt.sign(
    {
      clientId: foundClient.id,
      role: 'client',
      firstName: foundClient.firstName,
      lastName: foundClient.lastName,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '30d' }
  )

  return c.json({
    token,
    client: {
      id: foundClient.id,
      firstName: foundClient.firstName,
      lastName: foundClient.lastName,
    },
  })
})

// Set password (from invite link)
app.post('/set-password', async (c) => {
  const { token, password } = await c.req.json()

  if (!token || !password) {
    return c.json({ error: 'Token and password required' }, 400)
  }

  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.portalToken, token),
        eq(clients.portalEnabled, true),
      )
    )
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Invalid or expired invite link' }, 400)
  }

  const portalPasswordHash = await bcrypt.hash(password, 10)

  await db
    .update(clients)
    .set({
      portalPasswordHash,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, foundClient.id))

  return c.json({ success: true })
})

// Generate portal access link (legacy compatibility)
app.post('/generate-link', authenticate, async (c) => {
  const { clientId } = await c.req.json()

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const url = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`
  return c.json({ token: portalToken, url })
})

// =============================================
// PORTAL MIDDLEWARE: Validate token from header or JWT
// =============================================

async function portalAuth(c: Context, next: Next) {
  // Try x-portal-token header first (DB-stored token)
  const headerToken = c.req.header('x-portal-token')

  // Try Authorization header (JWT from login)
  const authHeader = c.req.header('authorization')
  const bearerToken = authHeader?.split(' ')[1]

  if (headerToken) {
    // DB-stored token auth
    const [foundClient] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.portalToken, headerToken),
          eq(clients.portalEnabled, true),
        )
      )
      .limit(1)

    if (!foundClient) {
      return c.json({ error: 'Invalid or expired portal link' }, 401)
    }

    if (foundClient.portalTokenExp && new Date() > new Date(foundClient.portalTokenExp)) {
      return c.json({ error: 'Portal link has expired. Please contact your care coordinator.' }, 401)
    }

    // Update last visit
    await db
      .update(clients)
      .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
      .where(eq(clients.id, foundClient.id))

    c.set('portalClientId', foundClient.id)
    c.set('portalClient', foundClient)
    await next()
    return
  }

  if (bearerToken) {
    // JWT auth (from login)
    try {
      const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET!) as any
      if (decoded.role !== 'client' || !decoded.clientId) {
        return c.json({ error: 'Invalid portal token' }, 401)
      }

      const [foundClient] = await db
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.id, decoded.clientId),
            eq(clients.portalEnabled, true),
          )
        )
        .limit(1)

      if (!foundClient) {
        return c.json({ error: 'Portal access disabled' }, 401)
      }

      // Update last visit
      await db
        .update(clients)
        .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
        .where(eq(clients.id, foundClient.id))

      c.set('portalClientId', foundClient.id)
      c.set('portalClient', foundClient)
      await next()
      return
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }
  }

  return c.json({ error: 'Portal authentication required' }, 401)
}

// =============================================
// PORTAL ROUTES: Token-based URL pattern
// =============================================

// Portal home: client profile + summary
app.get('/portal/me', portalAuth, async (c) => {
  const client = c.get('portalClient') as any
  const clientId = client.id

  // Visit count
  const [visitResult] = await db
    .select({ value: count() })
    .from(timeEntries)
    .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true)))

  // Upcoming visits
  const [upcomingResult] = await db
    .select({ value: count() })
    .from(schedules)
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isActive, true)))

  // Outstanding balance
  const [balanceResult] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.total}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, clientId),
        sql`${invoices.paymentStatus} IN ('pending', 'overdue')`
      )
    )

  // Unread notifications
  const [unreadResult] = await db
    .select({ value: count() })
    .from(clientNotifications)
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  // Unread messages
  const unreadThreads = await db
    .select()
    .from(portalMessageThreads)
    .where(
      and(
        eq(portalMessageThreads.clientId, clientId),
        eq(portalMessageThreads.status, 'open'),
      )
    )

  const unreadMessageCount = unreadThreads.filter(t => {
    if (!t.clientLastReadAt) return true
    return new Date(t.lastMessageAt) > new Date(t.clientLastReadAt)
  }).length

  return c.json({
    id: client.id,
    first_name: client.firstName,
    last_name: client.lastName,
    email: client.portalEmail || client.email,
    phone: client.phone,
    address: client.address,
    city: client.city,
    state: client.state,
    zip: client.zip,
    summary: {
      totalVisits: visitResult.value,
      upcomingSchedules: upcomingResult.value,
      outstandingBalance: Number(balanceResult?.total || 0),
      unreadNotifications: unreadResult.value,
      unreadMessages: unreadMessageCount,
    },
  })
})

// Schedule (upcoming visits)
app.get('/portal/visits', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select({
    id: schedules.id,
    scheduled_date: schedules.effectiveDate,
    start_time: sql<string>`to_char(${schedules.startTime}, 'HH24:MI')`,
    end_time: sql<string>`to_char(${schedules.endTime}, 'HH24:MI')`,
    status: sql<string>`'scheduled'`,
    notes: schedules.notes,
    caregiver_first_name: users.firstName,
    caregiver_last_name: users.lastName,
    caregiver_phone: users.phone,
  })
    .from(schedules)
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isActive, true)))
    .orderBy(schedules.effectiveDate)
  return c.json(rows)
})

// Visit history (paginated)
app.get('/portal/history', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50)
  const offset = parseInt(c.req.query('offset') || '0')

  const rows = await db.select({
    id: timeEntries.id,
    caregiver_id: timeEntries.caregiverId,
    client_id: timeEntries.clientId,
    start_time: timeEntries.startTime,
    end_time: timeEntries.endTime,
    duration_minutes: timeEntries.durationMinutes,
    is_complete: timeEntries.isComplete,
    notes: timeEntries.notes,
    created_at: timeEntries.createdAt,
    caregiver_first_name: users.firstName,
    caregiver_last_name: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true)))
    .orderBy(desc(timeEntries.startTime))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

// Invoices
app.get('/portal/invoices', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const invoiceRows = await db.select()
    .from(invoices)
    .where(eq(invoices.clientId, clientId))
    .orderBy(desc(invoices.createdAt))
    .limit(20)

  const results = await Promise.all(invoiceRows.map(async (inv) => {
    const lineItems = await db.select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, inv.id))
    return { ...inv, lineItems }
  }))

  return c.json(results)
})

// Caregivers
app.get('/portal/caregivers', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select({
    assignment_id: clientAssignments.id,
    first_name: users.firstName,
    last_name: users.lastName,
    phone: users.phone,
    certifications: users.certifications,
    hours_per_week: clientAssignments.hoursPerWeek,
  })
    .from(clientAssignments)
    .innerJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))

  return c.json(rows)
})

// =============================================
// STRIPE PAYMENT
// =============================================

app.post('/portal/invoices/:invoiceId/pay', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const invoiceId = c.req.param('invoiceId')

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Online payments are not configured' }, 400)
  }

  const [inv] = await db.select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, clientId)))
    .limit(1)

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  if (inv.paymentStatus === 'paid') {
    return c.json({ error: 'Invoice already paid' }, 400)
  }

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })

  const amountCents = Math.round(Number(inv.total) * 100)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId,
    },
    description: `Invoice ${inv.invoiceNumber}`,
  })

  // Store the payment intent ID on the invoice
  await db
    .update(invoices)
    .set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() } as any)
    .where(eq(invoices.id, invoiceId))

  return c.json({
    clientSecret: paymentIntent.client_secret,
    amount: amountCents,
    invoiceNumber: inv.invoiceNumber,
  })
})

// =============================================
// INVOICE PDF
// =============================================

app.get('/portal/invoices/:invoiceId/pdf', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const invoiceId = c.req.param('invoiceId')

  const [inv] = await db.select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, clientId)))
    .limit(1)

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  const lineItems = await db.select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))

  const [agency] = await db.select().from(agencies).limit(1)

  const { generateInvoicePDF } = await import('../services/pdf.ts')
  const pdfBuffer = await generateInvoicePDF({ ...inv, lineItems }, agency, client)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`,
    },
  })
})

// =============================================
// CARE PLAN
// =============================================

app.get('/portal/care-plan', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any

  // Get authorizations
  const auths = await db.select()
    .from(authorizations)
    .where(and(eq(authorizations.clientId, clientId), eq(authorizations.status, 'active')))
    .orderBy(desc(authorizations.startDate))

  // Get emergency contacts
  const emergencyContacts = await db.select()
    .from(clientEmergencyContacts)
    .where(eq(clientEmergencyContacts.clientId, clientId))

  // Get assigned caregivers
  const assignedCaregivers = await db.select({
    id: clientAssignments.id,
    firstName: users.firstName,
    lastName: users.lastName,
    phone: users.phone,
    hoursPerWeek: clientAssignments.hoursPerWeek,
  })
    .from(clientAssignments)
    .innerJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))

  return c.json({
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      address: client.address,
      city: client.city,
      state: client.state,
      zip: client.zip,
      phone: client.phone,
      serviceType: client.serviceType,
      medicalConditions: client.medicalConditions || [],
      allergies: client.allergies || [],
      medications: client.medications || [],
      notes: client.notes,
      insuranceProvider: client.insuranceProvider,
      primaryDiagnosisCode: client.primaryDiagnosisCode,
    },
    authorizations: auths.map(a => ({
      id: a.id,
      authNumber: a.authNumber,
      procedureCode: a.procedureCode,
      authorizedUnits: Number(a.authorizedUnits),
      usedUnits: Number(a.usedUnits),
      unitType: a.unitType,
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
      remainingUnits: Number(a.authorizedUnits) - Number(a.usedUnits),
    })),
    emergencyContacts,
    caregivers: assignedCaregivers,
  })
})

// =============================================
// MESSAGING
// =============================================

// List message threads
app.get('/portal/messages', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  const threads = await db.select()
    .from(portalMessageThreads)
    .where(eq(portalMessageThreads.clientId, clientId))
    .orderBy(desc(portalMessageThreads.lastMessageAt))

  // Get last message for each thread
  const results = await Promise.all(threads.map(async (thread) => {
    const [lastMessage] = await db.select()
      .from(portalMessages)
      .where(eq(portalMessages.threadId, thread.id))
      .orderBy(desc(portalMessages.createdAt))
      .limit(1)

    const [msgCount] = await db
      .select({ value: count() })
      .from(portalMessages)
      .where(eq(portalMessages.threadId, thread.id))

    const hasUnread = !thread.clientLastReadAt ||
      new Date(thread.lastMessageAt) > new Date(thread.clientLastReadAt)

    return {
      ...thread,
      lastMessage: lastMessage || null,
      messageCount: msgCount.value,
      hasUnread,
    }
  }))

  return c.json(results)
})

// Create new message thread
app.post('/portal/messages', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const { subject, body } = await c.req.json()

  if (!subject?.trim() || !body?.trim()) {
    return c.json({ error: 'Subject and message body are required' }, 400)
  }

  const [thread] = await db.insert(portalMessageThreads).values({
    clientId,
    subject: subject.trim(),
    lastMessageAt: new Date(),
    clientLastReadAt: new Date(),
  }).returning()

  const [message] = await db.insert(portalMessages).values({
    threadId: thread.id,
    senderType: 'client',
    senderName: `${client.firstName} ${client.lastName}`,
    body: body.trim(),
  }).returning()

  return c.json({ thread, message })
})

// Get thread messages
app.get('/portal/messages/:threadId', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const threadId = c.req.param('threadId')

  const [thread] = await db.select()
    .from(portalMessageThreads)
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))
    .limit(1)

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const msgs = await db.select()
    .from(portalMessages)
    .where(eq(portalMessages.threadId, threadId))
    .orderBy(portalMessages.createdAt)

  return c.json({ thread, messages: msgs })
})

// Reply to thread
app.post('/portal/messages/:threadId', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const threadId = c.req.param('threadId')
  const { body } = await c.req.json()

  if (!body?.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  const [thread] = await db.select()
    .from(portalMessageThreads)
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))
    .limit(1)

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const [message] = await db.insert(portalMessages).values({
    threadId,
    senderType: 'client',
    senderName: `${client.firstName} ${client.lastName}`,
    body: body.trim(),
  }).returning()

  // Update thread timestamps
  await db
    .update(portalMessageThreads)
    .set({
      lastMessageAt: new Date(),
      clientLastReadAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(portalMessageThreads.id, threadId))

  return c.json(message)
})

// Mark thread as read
app.post('/portal/messages/:threadId/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const threadId = c.req.param('threadId')

  await db
    .update(portalMessageThreads)
    .set({ clientLastReadAt: new Date(), updatedAt: new Date() })
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))

  return c.json({ success: true })
})

// =============================================
// NOTIFICATIONS
// =============================================

app.get('/portal/notifications', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  const rows = await db.select()
    .from(clientNotifications)
    .where(eq(clientNotifications.clientId, clientId))
    .orderBy(desc(clientNotifications.createdAt))
    .limit(50)

  return c.json(rows)
})

app.post('/portal/notifications/:id/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const notifId = c.req.param('id')

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.id, notifId), eq(clientNotifications.clientId, clientId)))

  return c.json({ success: true })
})

// Also support PUT for backwards compat with existing frontend
app.put('/portal/notifications/:id/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const notifId = c.req.param('id')

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.id, notifId), eq(clientNotifications.clientId, clientId)))

  return c.json({ success: true })
})

app.post('/portal/notifications/read-all', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  return c.json({ success: true })
})

// Also support PUT for backwards compat
app.put('/portal/notifications/read-all', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  return c.json({ success: true })
})

export default app
