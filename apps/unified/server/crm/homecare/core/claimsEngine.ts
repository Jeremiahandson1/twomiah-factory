/**
 * Claims Generation Engine — moved from templates/crm-homecare/backend/src/services/claimsEngine.ts (ported there from
 * CVHC services/claimsEngine.js). Its SQL is in server/data/homecareClaims.ts (and the payer-rate read is the invoice
 * engine's, server/data/homecareBilling.ts referralSourceRateFor — the same query the template wrote twice).
 *
 * Creates claims from EVV visits, handles authorization burn-down, payer routing, and batch processing:
 *   · UNITS come from the time entry's CLEAN billable minutes (billable_minutes / 15, to 2dp), not the raw
 *     units_of_service. Raw duration is the fallback only when billable minutes are absent.
 *   · An HOURLY payer rate is a quarter per 15-minute unit; a per-unit rate is used as it is. The rate is the one
 *     effective on the service date.
 *   · Claims are generated as DRAFTS; a visit is claimable when its time entry is complete with billable time, the
 *     client's payer is a claim payer (not private pay), and it is not already claimed.
 *   · Unit deduction is IDEMPOTENT: units_deducted_at is claimed with one conditional UPDATE.
 *
 * Changes: every read and write is the company's (companyId first; every row written carries it); the low-units alert
 * goes to the company's own office; rows are camelCase (the claim returned by generateClaimFromEVV is the query
 * builder's row).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { claims, claimStatusHistory, serviceCodes, notifications, user, clients } from '../../../db/schema/index.ts'
import { referralSourceRateFor } from '../../../data/homecareBilling.ts'
import {
  evvVisitForClaim, claimableEvvVisitIds, claimUsageFacts, claimAuthorizationFacts, claimDeductionFacts,
  stampUnitsDeducted, addAuthorizationUsedUnits,
} from '../../../data/homecareClaims.ts'
import { notFound } from '../../../http/errors.ts'
import type { CrmDeps } from '../../deps.ts'
import { routeClaim } from './payerRouter.ts'
import { normalizeAuthUnit, toAuthUnits, AUTH_UNIT_LABEL } from './authUnits.ts'

/** Units and charge for one visit — pure, so the arithmetic can be asserted on its own. */
export function claimUnitsAndCharge(input: {
  billableMinutes: number | string | null | undefined
  durationMinutes?: number | string | null
  unitsOfService?: number | string | null
  payerRate?: { rateAmount: number | string; rateType?: string | null } | null
  serviceCodeRatePerUnit?: number | string | null
}) {
  const billableMinutes = input.billableMinutes != null
    ? parseFloat(String(input.billableMinutes))
    : parseFloat(String(input.durationMinutes || (Number(input.unitsOfService || 0) * 15) || 0))
  const units = Math.round((billableMinutes / 15) * 100) / 100
  let charge = 0
  if (input.payerRate) {
    const rate = parseFloat(String(input.payerRate.rateAmount))
    const perUnit = (input.payerRate.rateType || 'hourly') === 'hourly' ? rate / 4 : rate
    charge = units * perUnit
  }
  if (charge === 0 && input.serviceCodeRatePerUnit) charge = units * parseFloat(String(input.serviceCodeRatePerUnit))
  return { units, charge: Math.round(charge * 100) / 100 }
}

export function createClaimsEngine(d: CrmDeps) {
  /** Generate a (draft) claim from one of the company's EVV visits. */
  async function generateClaimFromEVV(companyId: string, evvVisitId: string, userId: string) {
    const visit = await evvVisitForClaim(d.db, companyId, evvVisitId)
    if (!visit) throw notFound('EVV visit not found')
    // A training (shadow) shift is paid through payroll and never billed — no claim either.
    if (visit.isTraining === true) throw new Error('This visit is a training shift — training shifts are never billed.')

    const existing = await d.db.select({ id: claims.id }).from(claims)
      .where(and(eq(claims.companyId, companyId), eq(claims.evvVisitId, evvVisitId)))
    if (existing.length) throw new Error('Claim already exists for this EVV visit')

    const route = routeClaim({
      payerType: visit.payerType,
      payerIdNumber: visit.payerIdNumber,
      name: visit.payerName,
      submissionMethod: visit.submissionMethod,
      claimPortal: visit.claimPortal,
    })

    // The rate in force on the service date, preferring the client's care type — the same choice invoicing makes.
    let payerRate: { rateAmount: string; rateType: string | null } | null = null
    if (visit.referredById) {
      payerRate = await referralSourceRateFor(d.db, companyId, visit.referredById, visit.careTypeId ?? null, visit.serviceDateText, visit.serviceDateText)
    }
    const serviceCode = visit.serviceCode || 'T1019'
    const [sc] = await d.db.select({ ratePerUnit: serviceCodes.ratePerUnit }).from(serviceCodes)
      .where(and(eq(serviceCodes.companyId, companyId), eq(serviceCodes.code, serviceCode), eq(serviceCodes.isActive, true))).limit(1)
    const { units, charge } = claimUnitsAndCharge({
      billableMinutes: visit.billableMinutes,
      durationMinutes: visit.durationMinutes,
      unitsOfService: visit.unitsOfService,
      payerRate,
      serviceCodeRatePerUnit: sc?.ratePerUnit ?? null,
    })

    const claimId = createId()
    const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
    const [claim] = await d.db.insert(claims).values({
      id: claimId,
      companyId,
      evvVisitId,
      clientId: visit.clientId,
      caregiverId: visit.caregiverId,
      authorizationId: visit.authorizationId || null,
      payerId: visit.referredById || null,
      payerType: visit.payerType || null,
      claimNumber,
      serviceCode,
      modifier: visit.modifier || null,
      diagnosisCode: visit.primaryDiagnosisCode || 'Z7689',
      serviceDate: visit.serviceDateText,
      serviceDateFrom: visit.serviceDateText,
      serviceDateTo: visit.serviceDateText,
      placeOfService: '12',
      unitsBilled: String(units),
      billedAmount: String(charge),
      submissionMethod: route.method,
      status: 'draft',
      createdById: userId,
    }).returning()

    await d.db.insert(claimStatusHistory).values({ companyId, claimId, status: 'draft', notes: 'Claim generated from EVV visit', createdBy: userId })

    return { claim, route }
  }

  /** Batch generate draft claims for every claimable EVV visit of the company in a date range. */
  async function batchGenerateClaims(companyId: string, startDate: string, endDate: string, userId: string) {
    const visitIds = await claimableEvvVisitIds(d.db, companyId, startDate, endDate)
    const results = { generated: 0, skipped: 0, errors: [] as { visitId: string; error: string }[] }
    for (const id of visitIds) {
      try {
        await generateClaimFromEVV(companyId, id, userId)
        results.generated++
      } catch (e: any) {
        results.skipped++
        results.errors.push({ visitId: id, error: e.message })
      }
    }
    return results
  }

  /**
   * What one claim uses of its authorization, in the authorization's unit (core/authUnits.ts). unitsBilled is 15-minute
   * units. A claim from an EVV visit is one visit on one day; a claim made from an invoice covers each distinct visit
   * (day + scheduled start + caregiver) and day on its lines; anything else counts one visit per service day of its span.
   */
  async function claimAuthUsage(companyId: string, claimId: string): Promise<{ quarterHours: number; visits: number; days: number }> {
    const c = await claimUsageFacts(d.db, companyId, claimId)
    if (!c) return { quarterHours: 0, visits: 0, days: 0 }
    const quarterHours = parseFloat(c.unitsBilled || '0') || 0
    if (c.evvVisitId) return { quarterHours, visits: 1, days: 1 }
    if (c.invoiceId && Number(c.invoiceDays) > 0) return { quarterHours, visits: Number(c.invoiceVisits) || Number(c.invoiceDays), days: Number(c.invoiceDays) }
    const span = Math.max(1, Number(c.spanDays) || 1)
    return { quarterHours, visits: span, days: span }
  }

  /** Check authorization before claim submission: { canSubmit, warnings, blockers, … }. */
  async function checkAuthorizationForSubmission(companyId: string, claimId: string) {
    const c = await claimAuthorizationFacts(d.db, companyId, claimId)
    if (!c) return { canSubmit: false, blockers: ['Claim not found'], warnings: [] as string[] }

    const warnings: string[] = []
    const blockers: string[] = []
    if (!c.authorizationId) {
      warnings.push('No authorization linked to this claim')
      return { canSubmit: true, warnings, blockers }
    }
    // Both sides in the AUTHORIZATION's unit: the claim's 15-minute units are converted first.
    const unit = normalizeAuthUnit(c.unitType) ?? '15min'
    const unitName = AUTH_UNIT_LABEL[unit]
    const remaining = parseFloat(c.authorizedUnits || '0') - parseFloat(c.usedUnits || '0')
    const unitsToBill = toAuthUnits(unit, await claimAuthUsage(companyId, claimId))
    const totalAuth = parseFloat(c.authorizedUnits || '0')
    if (remaining <= 0 || c.authStatus === 'exhausted') blockers.push('Authorization has no remaining units. Request a renewal before submitting.')
    if (unitsToBill > remaining && remaining > 0) blockers.push(`Claim requires ${unitsToBill} ${unitName} but only ${remaining.toFixed(1)} remain on authorization.`)
    if (remaining > 0 && remaining < totalAuth * 0.1) warnings.push(`Only ${remaining.toFixed(1)} ${unitName} remaining (${((remaining / totalAuth) * 100).toFixed(0)}% of ${totalAuth}). Consider requesting renewal.`)
    if (c.endDate) {
      const daysUntilExpiry = Math.ceil((new Date(c.endDate + 'T23:59:59Z').getTime() - Date.now()) / 86400000)
      if (daysUntilExpiry <= 0) blockers.push('Authorization has expired.')
      else if (daysUntilExpiry <= 30) warnings.push(`Authorization expires in ${daysUntilExpiry} days.`)
    }
    return { canSubmit: blockers.length === 0, warnings, blockers, remainingUnits: remaining, unitsToBill, unitType: unit }
  }

  /**
   * Take a submitted claim's units off its authorization — once. units_deducted_at is claimed with one conditional
   * UPDATE, so a retry (or two concurrent submits) deducts nothing the second time. Returns true when THIS call deducted.
   */
  async function deductAuthorizationUnits(companyId: string, claimId: string): Promise<boolean> {
    const c = await claimDeductionFacts(d.db, companyId, claimId)
    if (!c) return false
    if (!(parseFloat(c.unitsBilled || '0') > 0) || !c.authorizationId || c.unitsDeductedAt) return false
    // The claim bills 15-minute units; the authorization counts in its own unit_type.
    const units = toAuthUnits(c.unitType, await claimAuthUsage(companyId, claimId))
    if (units <= 0) return false

    if (!(await stampUnitsDeducted(d.db, companyId, claimId))) return false
    await addAuthorizationUsedUnits(d.db, companyId, c.authorizationId, units)

    const remaining = parseFloat(c.authorizedUnits || '0') - (parseFloat(c.usedUnits || '0') + units)
    const threshold = parseFloat(c.lowUnitsAlertThreshold || '20')
    const totalAuth = parseFloat(c.authorizedUnits || '0')
    if (remaining <= threshold || remaining <= totalAuth * 0.1) {
      const admins: { id: string }[] = await d.db.select({ id: user.id }).from(user)
        .where(and(eq(user.companyId, companyId), inArray(user.role, ['admin', 'owner']), eq(user.isActive, true)))
      const [ci] = await d.db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients)
        .where(and(eq(clients.id, c.clientId), eq(clients.companyId, companyId))).limit(1)
      const clientName = ci ? `${ci.firstName} ${ci.lastName}` : 'Client'
      const title = remaining <= 0 ? 'Authorization Exhausted' : 'Low Authorization Units'
      const message = remaining <= 0
        ? `${clientName}: Authorization #${c.authNumber || 'N/A'} has been exhausted. No units remaining. Renewal required.`
        : `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${c.authNumber || 'N/A'} (expires ${c.endDate || 'N/A'})`
      for (const a of admins) {
        await d.db.insert(notifications).values({ companyId, userId: a.id, type: 'authorization_alert', title, message, isRead: false })
      }
      d.logger.warn('Authorization alert', { claimId, remaining, threshold, title })
    }
    return true
  }

  return { generateClaimFromEVV, batchGenerateClaims, claimAuthUsage, checkAuthorizationForSubmission, deductAuthorizationUnits, claimUnitsAndCharge }
}

export type ClaimsEngine = ReturnType<typeof createClaimsEngine>
