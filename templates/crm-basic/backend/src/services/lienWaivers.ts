/**
 * Lien Waiver Service
 *
 * Construction payment compliance:
 * - Conditional vs Unconditional waivers
 * - Track by subcontractor/vendor
 * - Link to payments/draws
 * - Compliance status per project
 */

import { db } from '../../db/index.ts'
import { contact, project, document } from '../../db/schema.ts'
import { eq, and, desc, count, sql, lte, inArray } from 'drizzle-orm'

// NOTE: The Drizzle schema does not have a dedicated lienWaiver table.
// This service uses the document table with type='lien_waiver' and metadata in json fields,
// or you should add a lienWaiver table to the schema.
// For now, we model the logic using raw SQL for the lien_waiver concept.
// If a lienWaiver table is added, replace `sql` calls with proper table references.

// Waiver types
export const WAIVER_TYPES = {
  CONDITIONAL_PARTIAL: 'conditional_partial',
  UNCONDITIONAL_PARTIAL: 'unconditional_partial',
  CONDITIONAL_FINAL: 'conditional_final',
  UNCONDITIONAL_FINAL: 'unconditional_final',
}

export const WAIVER_STATUS = {
  DRAFT: 'draft',
  REQUESTED: 'requested',
  RECEIVED: 'received',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

// ============================================
// WAIVER MANAGEMENT
// ============================================

// Since lienWaiver table is not in the schema, we use raw SQL.
// Add the table to schema.ts for proper Drizzle integration.

/**
 * Create lien waiver request
 */
export async function createWaiverRequest(companyId: string, data: any) {
  const result = await db.execute(sql`
    INSERT INTO lien_waiver (
      company_id, project_id, vendor_id, vendor_name, vendor_type,
      waiver_type, through_date, amount_previous, amount_current, amount_total,
      invoice_id, draw_id, status, requested_at, due_date, notes
    ) VALUES (
      ${companyId}, ${data.projectId}, ${data.vendorId}, ${data.vendorName}, ${data.vendorType},
      ${data.waiverType}, ${data.throughDate ? new Date(data.throughDate) : null},
      ${data.amountPrevious || 0}, ${data.amountCurrent || 0},
      ${(data.amountPrevious || 0) + (data.amountCurrent || 0)},
      ${data.invoiceId || null}, ${data.drawId || null},
      'requested', NOW(), ${data.dueDate ? new Date(data.dueDate) : null}, ${data.notes || null}
    )
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/**
 * Get waivers for a project
 */
export async function getProjectWaivers(projectId: string, companyId: string, { status, vendorId }: { status?: string; vendorId?: string } = {}) {
  let query = sql`
    SELECT lw.*, c.id as vendor_contact_id, c.name as vendor_contact_name, c.company as vendor_company
    FROM lien_waiver lw
    LEFT JOIN contact c ON lw.vendor_id = c.id
    WHERE lw.project_id = ${projectId} AND lw.company_id = ${companyId}
  `
  if (status) query = sql`${query} AND lw.status = ${status}`
  if (vendorId) query = sql`${query} AND lw.vendor_id = ${vendorId}`
  query = sql`${query} ORDER BY lw.status ASC, lw.due_date ASC`

  const result = await db.execute(query)
  return result.rows ?? result
}

/**
 * Get all waivers for a company
 */
export async function getAllWaivers(companyId: string, { status, projectId, page = 1, limit = 50 }: { status?: string; projectId?: string; page?: number; limit?: number } = {}) {
  let whereExtra = sql``
  if (status) whereExtra = sql`${whereExtra} AND lw.status = ${status}`
  if (projectId) whereExtra = sql`${whereExtra} AND lw.project_id = ${projectId}`

  const [waivers, countResult] = await Promise.all([
    db.execute(sql`
      SELECT lw.*, c.id as vendor_contact_id, c.name as vendor_contact_name,
             p.id as project_id_ref, p.name as project_name, p.number as project_number
      FROM lien_waiver lw
      LEFT JOIN contact c ON lw.vendor_id = c.id
      LEFT JOIN project p ON lw.project_id = p.id
      WHERE lw.company_id = ${companyId} ${whereExtra}
      ORDER BY lw.created_at DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `),
    db.execute(sql`
      SELECT COUNT(*) as total FROM lien_waiver lw
      WHERE lw.company_id = ${companyId} ${whereExtra}
    `),
  ])

  const total = Number((countResult.rows?.[0] as any)?.total ?? 0)

  return {
    data: waivers.rows ?? waivers,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Upload signed waiver
 */
export async function uploadSignedWaiver(waiverId: string, companyId: string, { documentUrl, signedDate, notarized = false }: { documentUrl: string; signedDate?: string; notarized?: boolean }) {
  const result = await db.execute(sql`
    UPDATE lien_waiver SET
      document_url = ${documentUrl},
      signed_date = ${signedDate ? new Date(signedDate) : new Date()},
      notarized = ${notarized},
      status = 'received',
      received_at = NOW()
    WHERE id = ${waiverId} AND company_id = ${companyId}
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/**
 * Approve waiver
 */
export async function approveWaiver(waiverId: string, companyId: string, { approvedById, notes }: { approvedById: string; notes?: string }) {
  const result = await db.execute(sql`
    UPDATE lien_waiver SET
      status = 'approved',
      approved_at = NOW(),
      approved_by_id = ${approvedById},
      approval_notes = ${notes || null}
    WHERE id = ${waiverId} AND company_id = ${companyId} AND status = 'received'
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/**
 * Reject waiver
 */
export async function rejectWaiver(waiverId: string, companyId: string, { rejectedById, reason }: { rejectedById: string; reason?: string }) {
  const result = await db.execute(sql`
    UPDATE lien_waiver SET
      status = 'rejected',
      rejected_at = NOW(),
      rejected_by_id = ${rejectedById},
      rejection_reason = ${reason || null}
    WHERE id = ${waiverId} AND company_id = ${companyId}
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

// ============================================
// COMPLIANCE TRACKING
// ============================================

/**
 * Get compliance status for a project
 */
export async function getProjectCompliance(projectId: string, companyId: string) {
  const waiverResult = await db.execute(sql`
    SELECT lw.*, c.id as vendor_contact_id, c.name as vendor_contact_name
    FROM lien_waiver lw
    LEFT JOIN contact c ON lw.vendor_id = c.id
    WHERE lw.project_id = ${projectId} AND lw.company_id = ${companyId}
  `)

  const waivers = (waiverResult.rows ?? waiverResult) as any[]

  // Group by vendor
  const byVendor: Record<string, any> = {}

  for (const waiver of waivers) {
    const vendorKey = waiver.vendor_id || waiver.vendor_name
    if (!byVendor[vendorKey]) {
      byVendor[vendorKey] = {
        vendorId: waiver.vendor_id,
        vendorName: waiver.vendor_contact_name || waiver.vendor_name,
        waivers: [],
        totalPaid: 0,
        totalWaived: 0,
        hasOutstanding: false,
        hasFinal: false,
      }
    }

    byVendor[vendorKey].waivers.push(waiver)

    if (waiver.status === 'approved') {
      byVendor[vendorKey].totalWaived += Number(waiver.amount_total)
    }

    if (['requested', 'received'].includes(waiver.status)) {
      byVendor[vendorKey].hasOutstanding = true
    }

    if (waiver.waiver_type?.includes('final') && waiver.status === 'approved') {
      byVendor[vendorKey].hasFinal = true
    }
  }

  const vendors = Object.values(byVendor)

  // Summary stats
  const summary = {
    totalWaivers: waivers.length,
    approved: waivers.filter((w: any) => w.status === 'approved').length,
    pending: waivers.filter((w: any) => ['requested', 'received'].includes(w.status)).length,
    rejected: waivers.filter((w: any) => w.status === 'rejected').length,

    vendorCount: vendors.length,
    vendorsComplete: vendors.filter(v => v.hasFinal).length,
    vendorsWithOutstanding: vendors.filter(v => v.hasOutstanding).length,

    isCompliant: vendors.every(v => !v.hasOutstanding),
    canClose: vendors.every(v => v.hasFinal && !v.hasOutstanding),
  }

  return { vendors, summary, waivers }
}

/**
 * Get outstanding waivers (overdue)
 */
export async function getOutstandingWaivers(companyId: string, { projectId }: { projectId?: string } = {}) {
  let projectFilter = sql``
  if (projectId) projectFilter = sql` AND lw.project_id = ${projectId}`

  const result = await db.execute(sql`
    SELECT lw.*, c.id as vendor_contact_id, c.name as vendor_contact_name,
           c.email as vendor_email, c.phone as vendor_phone,
           p.id as project_id_ref, p.name as project_name, p.number as project_number
    FROM lien_waiver lw
    LEFT JOIN contact c ON lw.vendor_id = c.id
    LEFT JOIN project p ON lw.project_id = p.id
    WHERE lw.company_id = ${companyId}
      AND lw.status = 'requested'
      AND lw.due_date < NOW()
      ${projectFilter}
    ORDER BY lw.due_date ASC
  `)

  return result.rows ?? result
}

/**
 * Generate waiver document (PDF content)
 */
export function generateWaiverContent(waiver: any, company: any) {
  const isFinal = waiver.waiverType?.includes('final') || waiver.waiver_type?.includes('final')
  const isConditional = waiver.waiverType?.includes('conditional') || waiver.waiver_type?.includes('conditional')

  return {
    title: isConditional
      ? `Conditional ${isFinal ? 'Final' : 'Partial'} Lien Waiver`
      : `Unconditional ${isFinal ? 'Final' : 'Partial'} Lien Waiver`,

    projectName: waiver.project?.name || waiver.project_name,
    projectAddress: waiver.project?.address || waiver.project_address,

    claimantName: waiver.vendor?.name || waiver.vendorName || waiver.vendor_name,

    throughDate: waiver.throughDate || waiver.through_date,
    amountPrevious: waiver.amountPrevious || waiver.amount_previous,
    amountCurrent: waiver.amountCurrent || waiver.amount_current,
    amountTotal: waiver.amountTotal || waiver.amount_total,

    isConditional,
    isFinal,

    legalText: isConditional
      ? `Upon receipt of payment in the sum of $${waiver.amountCurrent || waiver.amount_current}, the undersigned waives and releases any and all lien or claim of lien against the above-described property.`
      : `The undersigned has received payment in full for all labor, services, equipment, or material furnished to the above-described property and hereby waives and releases any and all lien or claim of lien.`,
  }
}

export default {
  WAIVER_TYPES,
  WAIVER_STATUS,
  createWaiverRequest,
  getProjectWaivers,
  getAllWaivers,
  uploadSignedWaiver,
  approveWaiver,
  rejectWaiver,
  getProjectCompliance,
  getOutstandingWaivers,
  generateWaiverContent,
}
