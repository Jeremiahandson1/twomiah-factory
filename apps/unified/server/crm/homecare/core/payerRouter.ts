/**
 * Payer Routing Engine. Moved from templates/crm-homecare/backend/src/services/payerRouter.ts. Pure.
 *
 * Determines submission method and destination based on the payer's (referral_sources) payer_type and
 * payer_id_number. Wisconsin MCO / payer routing rules:
 * - My Choice Wisconsin (MCFC-CW), Inclusa, Lakeland Care → WPS via EDI 837
 * - IRIS FEA                        → IRIS FEA export (CSV)
 * - ForwardHealth (FFS)             → ForwardHealth EDI 837
 * - HMO                             → HMO-specific export
 * - Private Pay                     → Invoice only (no claim)
 *
 * Change: the payer and the claim records are read in camelCase (payerType, claimPortal, clientFirstName …), as the
 * unified reads return them.
 */

import type { ProviderInfo } from './edi837Generator.ts'

interface PayerRoute {
  method: string
  destination: string
  name: string
}

type PayerRouteMap = Record<string, Record<string, PayerRoute>>

export const PAYER_ROUTES: PayerRouteMap = {
  MCO: {
    'MCFC-CW':  { method: 'edi837', destination: 'WPS Clearinghouse', name: 'My Choice Wisconsin' },
    'INCLUSA':  { method: 'edi837', destination: 'WPS Clearinghouse', name: 'Inclusa' },
    'LAKELAND': { method: 'edi837', destination: 'WPS Clearinghouse', name: 'Lakeland Care' },
    '_default': { method: 'edi837', destination: 'WPS Clearinghouse', name: 'MCO' },
  },
  mco_family_care: {
    '_default': { method: 'edi837', destination: 'WPS Clearinghouse', name: 'MCO Family Care' },
  },
  IRIS: {
    '_default': { method: 'iris_export', destination: 'IRIS FEA Portal', name: 'IRIS' },
  },
  FFS: {
    '_default': { method: 'edi837', destination: 'ForwardHealth Direct', name: 'ForwardHealth' },
  },
  medicaid: {
    '_default': { method: 'edi837', destination: 'ForwardHealth Direct', name: 'ForwardHealth Medicaid' },
  },
  HMO: {
    '_default': { method: 'hmo_export', destination: 'HMO Portal', name: 'HMO' },
  },
  managed_care: {
    '_default': { method: 'edi837', destination: 'Payer Direct', name: 'Managed Care' },
  },
  va: {
    '_default': { method: 'edi837', destination: 'VA Claims', name: 'Veterans Affairs' },
  },
  private_pay: {
    '_default': { method: 'invoice_only', destination: 'N/A', name: 'Private Pay' },
  },
} as const

export interface ReferralSourceInput {
  payerType?: string | null
  payerIdNumber?: string | null
  name?: string | null
  submissionMethod?: string | null
  /** referral_sources.claim_portal — this payer's insurer-portal export (e.g. MIDAS), when set */
  claimPortal?: unknown
}

/** The portal name from a payer's claim_portal setting, or null when it has none. */
function portalNameOf(v: unknown): string | null {
  let o: any = v
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return null } }
  const name = o && typeof o === 'object' && typeof o.name === 'string' ? o.name.trim() : ''
  return name || null
}

export interface RouteResult {
  method: string
  destination: string
  payerName: string
}

/** Route a claim to the correct submission method/destination. */
export function routeClaim(referralSource: ReferralSourceInput | null | undefined): RouteResult {
  if (!referralSource) {
    return { method: 'manual', destination: 'Unknown', payerName: 'Unknown' }
  }

  // A payer configured with an insurer-portal export submits through that portal.
  const portal = portalNameOf(referralSource.claimPortal)
  if (portal) {
    return { method: 'portal_export', destination: `${portal} Portal`, payerName: referralSource.name || portal }
  }

  const payerType = (referralSource.payerType || 'other').toUpperCase()
  const payerIdNum = (referralSource.payerIdNumber || '').toUpperCase()

  const typeRoutes = PAYER_ROUTES[payerType] || PAYER_ROUTES[referralSource.payerType || '']

  if (typeRoutes) {
    const specificRoute = typeRoutes[payerIdNum]
    if (specificRoute) {
      return {
        method: specificRoute.method,
        destination: specificRoute.destination,
        payerName: specificRoute.name,
      }
    }
    const defaultRoute = typeRoutes['_default']
    if (defaultRoute) {
      return {
        method: defaultRoute.method,
        destination: defaultRoute.destination,
        payerName: referralSource.name || defaultRoute.name,
      }
    }
  }

  if (referralSource.submissionMethod === 'edi') {
    return { method: 'edi837', destination: 'Clearinghouse', payerName: referralSource.name || 'Unknown' }
  }

  return { method: 'manual', destination: 'Manual Submission', payerName: referralSource.name || 'Unknown' }
}

export interface ClaimExportRecord {
  clientFirstName?: string | null
  clientFirst?: string | null
  clientLastName?: string | null
  clientLast?: string | null
  medicaidId?: string | null
  mcoMemberId?: string | null
  serviceDate?: string | null
  procedureCode?: string | null
  modifier?: string | null
  unitsBilled?: string | number | null
  units?: string | number | null
  chargeAmount?: string | number | null
  authNumber?: string | null
  authorizationNumber?: string | null
  caregiverFirstName?: string | null
  caregiverFirst?: string | null
  caregiverLastName?: string | null
  caregiverLast?: string | null
  caregiverNpi?: string | null
  npiNumber?: string | null
  evvWorkerId?: string | null
  feaOrganization?: string | null
}

/**
 * Generate an insurer-portal upload packet CSV (CVHC's MIDAS upload packet for My Choice Wisconsin; the title names
 * whichever portal the payer is configured with). No "Generated <time>" line: an exported document carries its
 * content's dates only.
 */
export function generateMidasExport(claims: ClaimExportRecord[], provider: ProviderInfo, portalName = 'MIDAS'): string {
  const headers = [
    'Client Name', 'Medicaid ID', 'MCO Member ID',
    'Service Date', 'Procedure Code', 'Modifier', 'Units',
    'Charge Amount', 'Provider NPI', 'Provider Medicaid ID',
    'Authorization Number', 'Rendering Provider',
  ]

  const rows = claims.map(c => [
    `${c.clientFirstName || c.clientFirst || ''} ${c.clientLastName || c.clientLast || ''}`.trim(),
    c.medicaidId || '',
    c.mcoMemberId || '',
    c.serviceDate ? new Date(c.serviceDate).toLocaleDateString('en-US') : '',
    c.procedureCode || 'T1019',
    c.modifier || '',
    String(c.unitsBilled || c.units || ''),
    parseFloat(String(c.chargeAmount || 0)).toFixed(2),
    provider.npi || '',
    provider.medicaidId || '',
    c.authNumber || c.authorizationNumber || '',
    `${c.caregiverFirstName || c.caregiverFirst || ''} ${c.caregiverLastName || c.caregiverLast || ''}`.trim(),
  ])

  const csvRows = [
    `"${portalName} Upload Packet - ${provider.agencyName}"`,
    '',
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    '',
    `"Total Claims: ${claims.length}"`,
    `"Total Charges: $${claims.reduce((sum, c) => sum + parseFloat(String(c.chargeAmount || 0)), 0).toFixed(2)}"`,
  ]

  return csvRows.join('\n')
}

/** Generate IRIS FEA export CSV. */
export function generateIRISExport(claims: ClaimExportRecord[]): string {
  const headers = [
    'member_id', 'worker_id', 'service_date', 'procedure_code',
    'units', 'amount', 'authorization_number', 'fea_organization',
  ]

  const rows = claims.map(c => [
    c.medicaidId || c.mcoMemberId || '',
    c.caregiverNpi || c.npiNumber || c.evvWorkerId || '',
    c.serviceDate ? new Date(c.serviceDate).toISOString().split('T')[0] : '',
    c.procedureCode || 'T1019',
    String(c.unitsBilled || c.units || ''),
    parseFloat(String(c.chargeAmount || 0)).toFixed(2),
    c.authNumber || c.authorizationNumber || '',
    c.feaOrganization || '',
  ])

  return [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')
}

/** Generate HMO-specific export. */
export function generateHMOExport(claims: ClaimExportRecord[], provider: ProviderInfo): string {
  return generateMidasExport(claims, provider)
}
