/**
 * Claims Generation Engine
 *
 * Creates claims from verified EVV visits, handles authorization
 * burn-down, payer routing, and batch processing.
 */

import { db } from '../../db/index.ts'
import { eq, and, between, isNull, sql, lte, gte, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import {
  evvVisits, clients, users, caregiverProfiles, authorizations,
  referralSources, referralSourceRates, serviceCodes,
  claims, claimStatusHistory, notifications,
} from '../../db/schema.ts'
import { routeClaim } from './payerRouter.ts'
import logger from './logger.ts'

/**
 * Generate a claim from a verified EVV visit
 */
export async function generateClaimFromEVV(evvVisitId: string, userId: string) {
  // Get full EVV visit with related data
  const visitRows = await db
    .select({
      visit: evvVisits,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      medicaidId: clients.medicaidId,
      mcoMemberId: clients.mcoMemberId,
      dateOfBirth: clients.dateOfBirth,
      gender: clients.gender,
      clientAddress: clients.address,
      clientCity: clients.city,
      clientState: clients.state,
      clientZip: clients.zip,
      referredById: clients.referredById,
      primaryDiagnosisCode: clients.primaryDiagnosisCode,
      cgFirstName: users.firstName,
      cgLastName: users.lastName,
      caregiverNpi: caregiverProfiles.npiNumber,
      taxonomyCode: caregiverProfiles.taxonomyCode,
      authNumber: authorizations.authNumber,
      authorizedUnits: authorizations.authorizedUnits,
      usedUnits: authorizations.usedUnits,
      authEndDate: authorizations.endDate,
      lowUnitsAlertThreshold: authorizations.lowUnitsAlertThreshold,
      payerName: referralSources.name,
      payerType: referralSources.payerType,
      payerIdNumber: referralSources.payerIdNumber,
      ediPayerId: referralSources.ediPayerId,
      submissionMethod: referralSources.submissionMethod,
    })
    .from(evvVisits)
    .innerJoin(clients, eq(evvVisits.clientId, clients.id))
    .innerJoin(users, eq(evvVisits.caregiverId, users.id))
    .leftJoin(caregiverProfiles, eq(caregiverProfiles.caregiverId, users.id))
    .leftJoin(authorizations, eq(evvVisits.authorizationId, authorizations.id))
    .leftJoin(referralSources, eq(clients.referredById, referralSources.id))
    .where(eq(evvVisits.id, evvVisitId))

  if (!visitRows.length) {
    throw new Error('EVV visit not found')
  }

  const row = visitRows[0]
  const visit = row.visit

  // Check if claim already exists for this visit
  const existing = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.evvVisitId, evvVisitId))

  if (existing.length) {
    throw new Error('Claim already exists for this EVV visit')
  }

  // Route the claim
  const route = routeClaim({
    payer_type: row.payerType,
    payer_id_number: row.payerIdNumber,
    name: row.payerName,
    submission_method: row.submissionMethod,
  })

  // Calculate charge amount from units and rate
  const units = parseFloat(String(visit.unitsOfService || 0))
  let chargeAmount = 0

  // Look up rate from referral_source_rates
  if (row.referredById) {
    const rateRows = await db
      .select({ rateAmount: referralSourceRates.rateAmount })
      .from(referralSourceRates)
      .where(and(
        eq(referralSourceRates.referralSourceId, row.referredById),
        eq(referralSourceRates.isActive, true),
      ))
      .limit(1)

    if (rateRows.length && rateRows[0].rateAmount) {
      chargeAmount = units * parseFloat(rateRows[0].rateAmount)
    }
  }

  // If no rate found, try service_codes table
  if (chargeAmount === 0) {
    const scRows = await db
      .select({ ratePerUnit: serviceCodes.ratePerUnit })
      .from(serviceCodes)
      .where(and(
        eq(serviceCodes.code, visit.serviceCode || 'T1019'),
        eq(serviceCodes.isActive, true),
      ))
      .limit(1)

    if (scRows.length && scRows[0].ratePerUnit) {
      chargeAmount = units * parseFloat(scRows[0].ratePerUnit)
    }
  }

  const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`
  const claimId = createId()

  const [newClaim] = await db.insert(claims).values({
    id: claimId,
    evvVisitId,
    clientId: visit.clientId,
    caregiverId: visit.caregiverId,
    authorizationId: visit.authorizationId,
    payerId: row.referredById,
    payerType: row.payerType,
    claimNumber,
    serviceCode: visit.serviceCode || 'T1019',
    serviceDate: visit.serviceDate,
    unitsBilled: String(units),
    billedAmount: String(chargeAmount),
    submissionMethod: route.method,
    status: 'pending',
  }).returning()

  // Log status history
  await db.insert(claimStatusHistory).values({
    id: createId(),
    claimId,
    status: 'pending',
    notes: 'Claim generated from EVV visit',
    createdBy: userId,
  })

  return { claim: newClaim, route }
}

/**
 * Batch generate claims from all verified EVV visits in a date range
 */
export async function batchGenerateClaims(startDate: string, endDate: string, userId: string) {
  const visits = await db
    .select({ id: evvVisits.id })
    .from(evvVisits)
    .leftJoin(claims, eq(claims.evvVisitId, evvVisits.id))
    .where(and(
      between(evvVisits.serviceDate, startDate, endDate),
      eq(evvVisits.isVerified, true),
      inArray(evvVisits.sandataStatus, ['ready', 'submitted', 'accepted']),
      isNull(claims.id),
    ))

  const results = { generated: 0, skipped: 0, errors: [] as { visitId: string; error: string }[] }

  for (const visit of visits) {
    try {
      await generateClaimFromEVV(visit.id, userId)
      results.generated++
    } catch (e: any) {
      results.skipped++
      results.errors.push({ visitId: visit.id, error: e.message })
    }
  }

  return results
}

/**
 * Check authorization before claim submission
 * Returns { canSubmit, warnings, blockers }
 */
export async function checkAuthorizationForSubmission(claimId: string) {
  const rows = await db
    .select({
      unitsBilled: claims.unitsBilled,
      authorizationId: claims.authorizationId,
      authorizedUnits: authorizations.authorizedUnits,
      usedUnits: authorizations.usedUnits,
      authEndDate: authorizations.endDate,
      lowUnitsAlertThreshold: authorizations.lowUnitsAlertThreshold,
      authStatus: authorizations.status,
    })
    .from(claims)
    .leftJoin(authorizations, eq(claims.authorizationId, authorizations.id))
    .where(eq(claims.id, claimId))

  if (!rows.length) return { canSubmit: false, blockers: ['Claim not found'], warnings: [] }

  const c = rows[0]
  const warnings: string[] = []
  const blockers: string[] = []

  if (!c.authorizationId) {
    warnings.push('No authorization linked to this claim')
    return { canSubmit: true, warnings, blockers }
  }

  const remaining = parseFloat(c.authorizedUnits || '0') - parseFloat(c.usedUnits || '0')
  const unitsToBill = parseFloat(c.unitsBilled || '0')
  const totalAuth = parseFloat(c.authorizedUnits || '0')

  if (remaining <= 0 || c.authStatus === 'exhausted') {
    blockers.push('Authorization has no remaining units. Request a renewal before submitting.')
  }

  if (unitsToBill > remaining && remaining > 0) {
    blockers.push(`Claim requires ${unitsToBill} units but only ${remaining.toFixed(1)} remain on authorization.`)
  }

  if (remaining > 0 && remaining < totalAuth * 0.1) {
    warnings.push(`Only ${remaining.toFixed(1)} units remaining (${((remaining / totalAuth) * 100).toFixed(0)}% of ${totalAuth}). Consider requesting renewal.`)
  }

  if (c.authEndDate) {
    const daysUntilExpiry = Math.ceil((new Date(c.authEndDate).getTime() - Date.now()) / 86400000)
    if (daysUntilExpiry <= 0) {
      blockers.push('Authorization has expired.')
    } else if (daysUntilExpiry <= 30) {
      warnings.push(`Authorization expires in ${daysUntilExpiry} days.`)
    }
  }

  return {
    canSubmit: blockers.length === 0,
    warnings,
    blockers,
    remainingUnits: remaining,
    unitsToBill,
  }
}

/**
 * Update authorization used_units after claim submission
 */
export async function deductAuthorizationUnits(claimId: string) {
  const rows = await db
    .select({
      unitsBilled: claims.unitsBilled,
      authorizationId: claims.authorizationId,
      clientId: claims.clientId,
      authorizedUnits: authorizations.authorizedUnits,
      usedUnits: authorizations.usedUnits,
      lowUnitsAlertThreshold: authorizations.lowUnitsAlertThreshold,
      authNumber: authorizations.authNumber,
      authEndDate: authorizations.endDate,
    })
    .from(claims)
    .innerJoin(authorizations, eq(claims.authorizationId, authorizations.id))
    .where(eq(claims.id, claimId))

  if (!rows.length) return

  const c = rows[0]
  const unitsBilled = parseFloat(c.unitsBilled || '0')
  if (unitsBilled <= 0 || !c.authorizationId) return

  // Update authorization
  await db.execute(sql`
    UPDATE authorizations SET
      used_units = used_units + ${unitsBilled},
      status = CASE
        WHEN used_units + ${unitsBilled} >= authorized_units THEN 'exhausted'
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = ${c.authorizationId}
  `)

  // Check and send alerts
  const newUsed = parseFloat(c.usedUnits || '0') + unitsBilled
  const remaining = parseFloat(c.authorizedUnits || '0') - newUsed
  const threshold = parseFloat(c.lowUnitsAlertThreshold || '20')
  const totalAuth = parseFloat(c.authorizedUnits || '0')

  if (remaining <= threshold || remaining <= totalAuth * 0.1) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))

    const clientInfo = await db
      .select({ firstName: clients.firstName, lastName: clients.lastName })
      .from(clients)
      .where(eq(clients.id, c.clientId!))

    const clientName = clientInfo[0] ? `${clientInfo[0].firstName} ${clientInfo[0].lastName}` : 'Client'

    let alertTitle: string
    let alertMessage: string
    if (remaining <= 0) {
      alertTitle = 'Authorization Exhausted'
      alertMessage = `${clientName}: Authorization #${c.authNumber || 'N/A'} has been exhausted. No units remaining. Renewal required.`
    } else {
      alertTitle = 'Low Authorization Units'
      alertMessage = `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${c.authNumber || 'N/A'} (expires ${c.authEndDate ? new Date(c.authEndDate).toLocaleDateString() : 'N/A'})`
    }

    for (const admin of admins) {
      await db.insert(notifications).values({
        id: createId(),
        userId: admin.id,
        type: 'authorization_alert',
        title: alertTitle,
        message: alertMessage,
      })
    }

    logger.warn('Authorization alert', { claimId, remaining, threshold, alertTitle })
  }
}
