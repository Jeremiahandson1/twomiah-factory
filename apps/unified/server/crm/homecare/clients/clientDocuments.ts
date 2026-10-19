// Client signable documents — the staff side. Moved from templates/crm-homecare/backend/src/routes/clientDocuments.ts.
//
// The agency keeps its standard paperwork as templates, sends a copy to a client, and the client signs it in the portal
// (the portal's endpoints are the portals group's). What gets signed is the snapshot on the document row, never the
// template. Nothing here is legal advice: the seeded templates are skeletons that say, in the text itself, that the
// agency must replace them with its own terms. They are seeded per company on its first read.
//
// Permissions: reading is care-clients:read; sending, reminding, voiding and editing templates were admin-only:
// care-clients:create / update / delete.
//
// Fixed in the move: GET / and GET /:id had no role check at all — any signed-in caregiver could list every client's
// documents, and GET /:id answered with the client's whole row (the encrypted SSN, the portal password hash and portal
// token, the insurance card photos). A caregiver now reads only the documents of the clients they serve (the one rule,
// core/caregiverAccess.ts), and the client on the certificate view never carries those fields.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { auditLogs, clientDocuments, clientDocumentTemplates, clients, company } from '../../../db/schema/index.ts'
import { clientIdsServedBy, lockFor } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { body, who, whole, NOT_YOUR_CLIENT, type ClientAccess } from './shared.ts'

// A calendar day ('2026-10-21') as 10/21/2026 — read as text, so no zone can move it a day.
const usDate = (ymd: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd instanceof Date ? ymd.toISOString() : String(ymd ?? ''))
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''
}

// Skeleton paperwork every home care agency needs. Seeded once per company, then owned and edited by the agency —
// deliberately explicit that the placeholder text is not usable as-is.
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

function fillPlaceholders(text: string, ctx: Record<string, string>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => (name in ctx ? ctx[name] : whole))
}

/** The client without its secrets and card photos (the certificate view names the client; it never needs these). */
function safeClient(row: any) {
  if (!row) return null
  const { ssnEncrypted: _s, portalPasswordHash: _ph, portalToken: _pt, insuranceCardFront: _f, insuranceCardBack: _b, ...rest } = row
  return rest
}

export function createClientDocumentRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const read = requirePermission('care-clients:read')
  const ipOf = (c: any) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null

  async function ensureDefaultTemplates(companyId: string) {
    await db.transaction(async (tx: any) => {
      await lockFor(tx, `client_document_templates:${companyId}`)
      const [any] = await tx.select({ id: clientDocumentTemplates.id }).from(clientDocumentTemplates)
        .where(eq(clientDocumentTemplates.companyId, companyId)).limit(1)
      if (any) return
      for (const t of DEFAULT_TEMPLATES) await tx.insert(clientDocumentTemplates).values({ ...t, companyId }).onConflictDoNothing()
    })
  }

  /** A clinical audit row for the paper trail, with the IP; a missing audit row never loses the document or its signature. */
  async function writeAudit(companyId: string, userId: string, action: string, recordId: string, data: unknown, ip: string | null) {
    try {
      await db.insert(auditLogs).values({ companyId, userId, action, tableName: 'client_documents', recordId, newData: data as any, ipAddress: ip })
    } catch (err: any) {
      d.logger.error('[clientDocuments] audit write failed', { error: err?.message })
    }
  }

  /** The portal link, the agency's name and the email for a client's "waiting to be signed" notice. */
  const portalUrl = (token: string) => `${process.env.FRONTEND_URL || ''}/portal?token=${token}`

  // ── Templates ──
  app.get('/templates', read, async (c) => {
    const { companyId } = who(c)
    await ensureDefaultTemplates(companyId)
    return whole(c, await db.select().from(clientDocumentTemplates)
      .where(eq(clientDocumentTemplates.companyId, companyId)).orderBy(asc(clientDocumentTemplates.sortOrder)))
  })

  app.post('/templates', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const title = typeof b?.title === 'string' ? b.title.trim() : ''
    const text = typeof b?.body === 'string' ? b.body.trim() : ''
    if (!title || !text) return fail(c, 400, 'A title and document text are required')
    const key = (typeof b?.key === 'string' && b.key.trim()) ? b.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') : 'custom_' + Date.now()
    const [row] = await db.insert(clientDocumentTemplates).values({
      companyId, key, title, body: text, requiresRelationship: b?.requiresRelationship !== false, sortOrder: Number(b?.sortOrder) || 99,
    }).returning()
    return one(c, row, 201)
  })

  app.put('/templates/:id', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof b?.title === 'string' && b.title.trim()) updates.title = b.title.trim()
    if (typeof b?.body === 'string' && b.body.trim()) updates.body = b.body.trim()
    if (typeof b?.isActive === 'boolean') updates.isActive = b.isActive
    if (typeof b?.requiresRelationship === 'boolean') updates.requiresRelationship = b.requiresRelationship
    if (b?.sortOrder !== undefined) updates.sortOrder = Number(b.sortOrder) || 0
    const [row] = await db.update(clientDocumentTemplates).set(updates as any)
      .where(and(eq(clientDocumentTemplates.id, c.req.param('id')), eq(clientDocumentTemplates.companyId, companyId))).returning()
    // Documents already sent keep their own snapshot, so this cannot change anything a client has signed.
    return row ? one(c, row) : fail(c, 404, 'Template not found')
  })

  app.delete('/templates/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    await db.delete(clientDocumentTemplates).where(and(eq(clientDocumentTemplates.id, c.req.param('id')), eq(clientDocumentTemplates.companyId, companyId)))
    return done(c)
  })

  // ── Documents ──
  app.get('/', read, async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.query('clientId')
    const status = c.req.query('status')
    const conditions: any[] = [eq(clientDocuments.companyId, companyId)]
    if (clientId) conditions.push(eq(clientDocuments.clientId, clientId))
    if (status) conditions.push(eq(clientDocuments.status, status))
    if (!access.office(user)) {
      const served = await clientIdsServedBy(db, companyId, me)
      if (!served.length) return whole(c, [])
      conditions.push(inArray(clientDocuments.clientId, served))
    }
    const rows = await db.select({
      id: clientDocuments.id, clientId: clientDocuments.clientId, documentKey: clientDocuments.documentKey, title: clientDocuments.title,
      status: clientDocuments.status, sentAt: clientDocuments.sentAt, viewedAt: clientDocuments.viewedAt, signedAt: clientDocuments.signedAt,
      signedBy: clientDocuments.signedBy, signerRelationship: clientDocuments.signerRelationship, declinedAt: clientDocuments.declinedAt,
      declineReason: clientDocuments.declineReason, voidedAt: clientDocuments.voidedAt,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
    }).from(clientDocuments).leftJoin(clients, eq(clientDocuments.clientId, clients.id))
      .where(and(...conditions)).orderBy(desc(clientDocuments.sentAt)).limit(500)
    return whole(c, rows)
  })

  // Full record including the signature evidence — the certificate view.
  app.get('/:id', read, async (c) => {
    const { user, companyId } = who(c)
    const [row] = await db.select().from(clientDocuments).where(and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Document not found')
    if (!(await access.maySeeClient(user, row.clientId))) return fail(c, 403, NOT_YOUR_CLIENT)
    const [client] = await db.select().from(clients).where(and(eq(clients.id, row.clientId), eq(clients.companyId, companyId))).limit(1)
    return one(c, { ...row, client: safeClient(client) })
  })

  // Send a document to a client for signing.
  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const clientId = typeof b?.clientId === 'string' ? b.clientId : ''
    const templateId = typeof b?.templateId === 'string' ? b.templateId : ''
    if (!clientId || !templateId) return fail(c, 400, 'Pick a client and a document')
    const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!client) return fail(c, 404, 'Client not found')
    const [template] = await db.select().from(clientDocumentTemplates)
      .where(and(eq(clientDocumentTemplates.id, templateId), eq(clientDocumentTemplates.companyId, companyId))).limit(1)
    if (!template) return fail(c, 404, 'Document template not found')
    const [agency] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const filled = fillPlaceholders(template.body, {
      CLIENT_NAME: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      AGENCY_NAME: agency?.name || 'our agency',
      START_DATE: usDate(client.startDate) || 'the agreed start date',
      DATE: usDate(await core.time.today(companyId)), // the agency's today — the server's UTC day is tomorrow after 7 PM Central
      RATE: client.privatePayRate ? String(client.privatePayRate) : 'the agreed rate',
    })
    const [row] = await db.insert(clientDocuments).values({
      companyId, clientId, templateId, documentKey: template.key, title: template.title, body: filled, status: 'sent', createdById: me || null,
    }).returning()
    await writeAudit(companyId, me || 'system', 'client_document.sent', row.id, { clientId, documentKey: template.key, title: template.title }, ipOf(c))

    // Tell them it is waiting. Portal access is the delivery mechanism, so a client without it gets the document but no
    // email — say which happened rather than implying it was delivered.
    let emailed = false
    let emailNote: string | null = null
    const email = client.portalEmail || client.email
    if (!email) {
      emailNote = 'This client has no email address on file, so no notification was sent.'
    } else if (!client.portalEnabled || !client.portalToken) {
      emailNote = 'Portal access is not enabled for this client, so no notification was sent. Enable the portal, then use Send reminder.'
    } else {
      try {
        await core.email.sendDocumentSignatureRequest(email, {
          contactName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
          companyName: agency?.name || 'your care agency',
          documentTitle: template.title,
          portalUrl: portalUrl(client.portalToken),
        })
        emailed = true
      } catch (err: any) {
        emailNote = 'Saved, but the notification email failed: ' + (err?.message || 'unknown error')
      }
    }
    return one(c, { ...row, emailed, emailNote }, 201)
  })

  // Nudge — the same email again, only while the document is still outstanding.
  app.post('/:id/remind', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select().from(clientDocuments).where(and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Document not found')
    if (row.status === 'signed') return fail(c, 400, 'That document is already signed')
    if (row.status === 'void') return fail(c, 400, 'That document was voided')
    const [client] = await db.select().from(clients).where(and(eq(clients.id, row.clientId), eq(clients.companyId, companyId))).limit(1)
    const email = client?.portalEmail || client?.email
    if (!email) return fail(c, 400, 'This client has no email address on file')
    if (!client?.portalEnabled || !client?.portalToken) return fail(c, 400, 'Portal access is not enabled for this client')
    const [agency] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    await core.email.sendDocumentSignatureRequest(email, {
      contactName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      companyName: agency?.name || 'your care agency',
      documentTitle: row.title,
      portalUrl: portalUrl(client.portalToken),
    })
    return one(c, { success: true, sentTo: email })
  })

  // Void — withdraw a document. A signed one stays signed: the record of what somebody agreed to is not ours to erase.
  app.post('/:id/void', requirePermission('care-clients:delete'), async (c) => {
    const { companyId, me } = who(c)
    const scope = and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.companyId, companyId))
    const [existing] = await db.select().from(clientDocuments).where(scope).limit(1)
    if (!existing) return fail(c, 404, 'Document not found')
    if (existing.status === 'signed') return fail(c, 400, 'A signed document cannot be voided. Send a replacement instead.')
    const [row] = await db.update(clientDocuments).set({ status: 'void', voidedAt: new Date(), updatedAt: new Date() }).where(scope).returning()
    await writeAudit(companyId, me || 'system', 'client_document.voided', row.id, { title: row.title }, ipOf(c))
    return one(c, row)
  })

  return app
}
