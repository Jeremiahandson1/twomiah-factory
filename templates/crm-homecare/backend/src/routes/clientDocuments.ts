// Client signable documents — staff side.
//
// The agency keeps its standard paperwork as templates, sends a copy to a
// client, and the client signs it in the portal (portal endpoints live in
// portal.ts, where portalAuth is). What gets signed is the snapshot on the
// document row, never the template.
//
// Nothing here is legal advice: the seeded templates are skeletons that say,
// in the text itself, that the agency must replace them with its own terms.

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { clientDocuments, clientDocumentTemplates, clients, agencies, auditLogs } from '../../db/schema.ts'
import { eq, desc, and, asc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import emailService from '../services/email.ts'

const app = new Hono()
app.use('*', authenticate)

// Skeleton paperwork every home care agency needs. Seeded once, then owned and
// edited by the agency — deliberately explicit that the placeholder text is
// not usable as-is.
const DEFAULT_TEMPLATES = [
  {
    key: 'service_agreement',
    title: 'Home Care Service Agreement',
    sortOrder: 1,
    body: `REPLACE THIS TEXT WITH YOUR AGENCY'S OWN SERVICE AGREEMENT BEFORE SENDING IT.

This agreement is between {{AGENCY_NAME}} ("the Agency") and {{CLIENT_NAME}} ("the Client"), beginning {{START_DATE}}.

1. Services. The Agency will provide the services described in the Client's care plan. Services may be adjusted by agreement between the Client and the Agency.

2. Rates and billing. Services are billed at the rate agreed with the Client. Invoices are issued for services delivered.

3. Scheduling and cancellation. The Client will give reasonable notice of a cancellation. The Agency will give notice of any change to a scheduled visit.

4. Caregiver assignment. The Agency assigns caregivers and may substitute a qualified caregiver when the assigned caregiver is unavailable.

5. Termination. Either party may end this agreement with written notice.

By signing, the Client (or their authorised representative) agrees to these terms.`,
  },
  {
    key: 'client_rights',
    title: 'Client Rights and Responsibilities',
    sortOrder: 2,
    body: `REPLACE THIS TEXT WITH THE RIGHTS STATEMENT REQUIRED IN YOUR STATE BEFORE SENDING IT.

As a client of {{AGENCY_NAME}} you have the right to:
- be treated with dignity and respect
- take part in planning your care and to be told of changes to it
- privacy and confidentiality of your records
- know the name and role of anyone providing your care
- refuse care and be told what that may mean for you
- raise a complaint without it affecting your care

You are responsible for:
- giving accurate information about your health and circumstances
- telling us about changes to your condition, medication or contacts
- providing a safe environment for the people who care for you
- telling us as early as you can when you need to cancel

Signed acknowledgment confirms you have received and understood this statement.`,
  },
  {
    key: 'hipaa_acknowledgment',
    title: 'Notice of Privacy Practices — Acknowledgment',
    sortOrder: 3,
    body: `REPLACE THIS TEXT WITH YOUR AGENCY'S OWN NOTICE OF PRIVACY PRACTICES ACKNOWLEDGMENT BEFORE SENDING IT.

I acknowledge that I have received the Notice of Privacy Practices of {{AGENCY_NAME}}, which describes how my health information may be used and disclosed and how I can get access to that information.

I understand that {{AGENCY_NAME}} may use and disclose my health information to provide my care, to obtain payment for that care, and for its health care operations.

Acknowledged on {{DATE}}.`,
  },
  {
    key: 'consent_to_care',
    title: 'Consent to Care',
    sortOrder: 4,
    body: `REPLACE THIS TEXT WITH YOUR AGENCY'S OWN CONSENT TO CARE BEFORE SENDING IT.

I consent to receive home care services from {{AGENCY_NAME}} as described in my care plan, beginning {{START_DATE}}.

I understand that:
- I may refuse any service at any time
- my care plan will be reviewed with me and may change as my needs change
- caregivers will document the care they provide

Consent given by {{CLIENT_NAME}} (or their authorised representative) on {{DATE}}.`,
  },
]

async function ensureDefaultTemplates() {
  const existing = await db.select({ id: clientDocumentTemplates.id }).from(clientDocumentTemplates).limit(1)
  if (existing.length > 0) return
  for (const t of DEFAULT_TEMPLATES) {
    await db.insert(clientDocumentTemplates).values(t as any).onConflictDoNothing()
  }
}

function fillPlaceholders(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => (name in ctx ? ctx[name] : whole))
}

async function writeAudit(userId: string, action: string, recordId: string, data: unknown, ip: string | null) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      tableName: 'client_documents',
      recordId,
      newData: data as any,
      ipAddress: ip,
    } as any)
  } catch (err) {
    // A missing audit row must never lose the customer's signature.
    console.error('[clientDocuments] audit write failed:', err)
  }
}

// ─── Templates ──────────────────────────────────────────────────────────────

app.get('/templates', async (c) => {
  try {
    await ensureDefaultTemplates()
    const rows = await db.select().from(clientDocumentTemplates).orderBy(asc(clientDocumentTemplates.sortOrder))
    return c.json({ data: rows })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not load templates' }, 500)
  }
})

app.post('/templates', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const text = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!title || !text) return c.json({ error: 'A title and document text are required' }, 400)

  const key = (typeof body?.key === 'string' && body.key.trim())
    ? body.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    : 'custom_' + Date.now()

  try {
    const [row] = await db.insert(clientDocumentTemplates).values({
      key,
      title,
      body: text,
      requiresRelationship: body?.requiresRelationship !== false,
      sortOrder: Number(body?.sortOrder) || 99,
    } as any).returning()
    return c.json(row, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not save that template' }, 500)
  }
})

app.put('/templates/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body?.title === 'string' && body.title.trim()) updates.title = body.title.trim()
  if (typeof body?.body === 'string' && body.body.trim()) updates.body = body.body.trim()
  if (typeof body?.isActive === 'boolean') updates.isActive = body.isActive
  if (typeof body?.requiresRelationship === 'boolean') updates.requiresRelationship = body.requiresRelationship
  if (body?.sortOrder !== undefined) updates.sortOrder = Number(body.sortOrder) || 0

  try {
    const [row] = await db.update(clientDocumentTemplates).set(updates as any)
      .where(eq(clientDocumentTemplates.id, id)).returning()
    if (!row) return c.json({ error: 'Template not found' }, 404)
    // Documents already sent keep their own snapshot, so this cannot change
    // anything a client has signed.
    return c.json(row)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not update that template' }, 500)
  }
})

app.delete('/templates/:id', requireAdmin, async (c) => {
  try {
    await db.delete(clientDocumentTemplates).where(eq(clientDocumentTemplates.id, c.req.param('id')))
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not delete that template' }, 500)
  }
})

// ─── Documents ──────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const clientId = c.req.query('clientId')
  const status = c.req.query('status')
  try {
    const conditions: any[] = []
    if (clientId) conditions.push(eq(clientDocuments.clientId, clientId))
    if (status) conditions.push(eq(clientDocuments.status, status))

    const rows = await db.select({
      id: clientDocuments.id,
      clientId: clientDocuments.clientId,
      documentKey: clientDocuments.documentKey,
      title: clientDocuments.title,
      status: clientDocuments.status,
      sentAt: clientDocuments.sentAt,
      viewedAt: clientDocuments.viewedAt,
      signedAt: clientDocuments.signedAt,
      signedBy: clientDocuments.signedBy,
      signerRelationship: clientDocuments.signerRelationship,
      declinedAt: clientDocuments.declinedAt,
      declineReason: clientDocuments.declineReason,
      voidedAt: clientDocuments.voidedAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(clientDocuments)
      .leftJoin(clients, eq(clientDocuments.clientId, clients.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(clientDocuments.sentAt))
      .limit(500)

    return c.json({ data: rows })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not load documents' }, 500)
  }
})

// Full record including the signature evidence — this is the certificate view.
app.get('/:id', async (c) => {
  try {
    const [row] = await db.select().from(clientDocuments).where(eq(clientDocuments.id, c.req.param('id'))).limit(1)
    if (!row) return c.json({ error: 'Document not found' }, 404)
    const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1)
    return c.json({ ...row, client: client || null })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not load that document' }, 500)
  }
})

// Send a document to a client for signing.
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const templateId = typeof body?.templateId === 'string' ? body.templateId : ''
  if (!clientId || !templateId) return c.json({ error: 'Pick a client and a document' }, 400)

  try {
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
    if (!client) return c.json({ error: 'Client not found' }, 404)

    const [template] = await db.select().from(clientDocumentTemplates)
      .where(eq(clientDocumentTemplates.id, templateId)).limit(1)
    if (!template) return c.json({ error: 'Document template not found' }, 404)

    const [agency] = await db.select().from(agencies).limit(1)

    const filled = fillPlaceholders(template.body, {
      CLIENT_NAME: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      AGENCY_NAME: agency?.name || 'our agency',
      START_DATE: client.startDate ? new Date(client.startDate as any).toLocaleDateString() : 'the agreed start date',
      DATE: new Date().toLocaleDateString(),
      RATE: client.privatePayRate ? String(client.privatePayRate) : 'the agreed rate',
    })

    const [row] = await db.insert(clientDocuments).values({
      clientId,
      templateId,
      documentKey: template.key,
      title: template.title,
      body: filled,
      status: 'sent',
      createdById: user?.id || null,
    } as any).returning()

    await writeAudit(user?.id || 'system', 'client_document.sent', row.id, {
      clientId, documentKey: template.key, title: template.title,
    }, c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null)

    // Tell them it is waiting. Portal access is the delivery mechanism, so a
    // client without it gets the document but no email — say which happened
    // rather than implying it was delivered.
    let emailed = false
    let emailNote: string | null = null
    const email = client.portalEmail || client.email
    if (!email) {
      emailNote = 'This client has no email address on file, so no notification was sent.'
    } else if (!client.portalEnabled || !client.portalToken) {
      emailNote = 'Portal access is not enabled for this client, so no notification was sent. Enable the portal, then use Send reminder.'
    } else {
      try {
        const [agencyRow] = [agency]
        await emailService.sendDocumentSignatureRequest(email, {
          contactName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
          companyName: agencyRow?.name || 'your care agency',
          documentTitle: template.title,
          portalUrl: `${process.env.FRONTEND_URL || ''}/portal?token=${client.portalToken}`,
        })
        emailed = true
      } catch (err: any) {
        emailNote = 'Saved, but the notification email failed: ' + (err?.message || 'unknown error')
      }
    }

    return c.json({ ...row, emailed, emailNote }, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not send that document' }, 500)
  }
})

// Nudge — same email again, only while the document is still outstanding.
app.post('/:id/remind', requireAdmin, async (c) => {
  try {
    const [row] = await db.select().from(clientDocuments).where(eq(clientDocuments.id, c.req.param('id'))).limit(1)
    if (!row) return c.json({ error: 'Document not found' }, 404)
    if (row.status === 'signed') return c.json({ error: 'That document is already signed' }, 400)
    if (row.status === 'void') return c.json({ error: 'That document was voided' }, 400)

    const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1)
    const email = client?.portalEmail || client?.email
    if (!email) return c.json({ error: 'This client has no email address on file' }, 400)
    if (!client?.portalEnabled || !client?.portalToken) {
      return c.json({ error: 'Portal access is not enabled for this client' }, 400)
    }

    const [agency] = await db.select().from(agencies).limit(1)
    await emailService.sendDocumentSignatureRequest(email, {
      contactName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      companyName: agency?.name || 'your care agency',
      documentTitle: row.title,
      portalUrl: `${process.env.FRONTEND_URL || ''}/portal?token=${client.portalToken}`,
    })
    return c.json({ success: true, sentTo: email })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not send that reminder' }, 500)
  }
})

// Void — withdraw a document. A signed one stays signed: the record of what
// somebody agreed to is not ours to erase.
app.post('/:id/void', requireAdmin, async (c) => {
  const user = c.get('user') as any
  try {
    const [existing] = await db.select().from(clientDocuments).where(eq(clientDocuments.id, c.req.param('id'))).limit(1)
    if (!existing) return c.json({ error: 'Document not found' }, 404)
    if (existing.status === 'signed') {
      return c.json({ error: 'A signed document cannot be voided. Send a replacement instead.' }, 400)
    }

    const [row] = await db.update(clientDocuments)
      .set({ status: 'void', voidedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(clientDocuments.id, existing.id)).returning()

    await writeAudit(user?.id || 'system', 'client_document.voided', row.id, { title: row.title },
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null)
    return c.json(row)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not void that document' }, 500)
  }
})

export default app
