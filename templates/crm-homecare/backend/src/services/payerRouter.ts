/**
 * Payer Routing Engine
 *
 * Determines submission method and destination based on
 * referral_source payer_type and payer_id_number.
 *
 * Wisconsin MCO / Payer routing rules:
 * - My Choice Wisconsin (MCFC-CW)  → WPS via EDI 837
 * - Inclusa                         → WPS via EDI 837
 * - Lakeland Care                   → WPS via EDI 837
 * - IRIS FEA                        → IRIS FEA export (CSV)
 * - ForwardHealth (FFS)             → ForwardHealth EDI 837
 * - HMO                             → HMO-specific export
 * - Private Pay                     → Invoice only (no claim)
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
  payer_type?: string | null
  payer_id_number?: string | null
  name?: string | null
  submission_method?: string | null
}

export interface RouteResult {
  method: string
  destination: string
  payerName: string
}

/**
 * Route a claim to the correct submission method/destination
 */
export function routeClaim(referralSource: ReferralSourceInput | null | undefined): RouteResult {
  if (!referralSource) {
    return { method: 'manual', destination: 'Unknown', payerName: 'Unknown' }
  }

  const payerType = (referralSource.payer_type || 'other').toUpperCase()
  const payerIdNum = (referralSource.payer_id_number || '').toUpperCase()

  const typeRoutes = PAYER_ROUTES[payerType] || PAYER_ROUTES[referralSource.payer_type || '']

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

  if (referralSource.submission_method === 'edi') {
    return { method: 'edi837', destination: 'Clearinghouse', payerName: referralSource.name || 'Unknown' }
  }

  if (/my\s*choice/i.test(referralSource.name || '')) {
    return { method: 'midas_export', destination: 'MIDAS Portal', payerName: 'My Choice Wisconsin' }
  }

  return { method: 'manual', destination: 'Manual Submission', payerName: referralSource.name || 'Unknown' }
}

interface ClaimExportRecord {
  client_first_name?: string
  client_first?: string
  client_last_name?: string
  client_last?: string
  medicaid_id?: string
  mco_member_id?: string
  service_date?: string
  procedure_code?: string
  modifier?: string
  units_billed?: string | number
  units?: string | number
  charge_amount?: string | number
  auth_number?: string
  authorization_number?: string
  caregiver_first_name?: string
  caregiver_first?: string
  caregiver_last_name?: string
  caregiver_last?: string
  caregiver_npi?: string
  npi_number?: string
  evv_worker_id?: string
  fea_organization?: string
}

/**
 * Generate MIDAS upload packet CSV for My Choice Wisconsin
 */
export function generateMidasExport(claims: ClaimExportRecord[], provider: ProviderInfo): string {
  const headers = [
    'Client Name', 'Medicaid ID', 'MCO Member ID',
    'Service Date', 'Procedure Code', 'Modifier', 'Units',
    'Charge Amount', 'Provider NPI', 'Provider Medicaid ID',
    'Authorization Number', 'Rendering Provider',
  ]

  const rows = claims.map(c => [
    `${c.client_first_name || c.client_first || ''} ${c.client_last_name || c.client_last || ''}`.trim(),
    c.medicaid_id || '',
    c.mco_member_id || '',
    c.service_date ? new Date(c.service_date).toLocaleDateString('en-US') : '',
    c.procedure_code || 'T1019',
    c.modifier || '',
    String(c.units_billed || c.units || ''),
    parseFloat(String(c.charge_amount || 0)).toFixed(2),
    provider.npi || '',
    provider.medicaidId || '',
    c.auth_number || c.authorization_number || '',
    `${c.caregiver_first_name || c.caregiver_first || ''} ${c.caregiver_last_name || c.caregiver_last || ''}`.trim(),
  ])

  const csvRows = [
    `"MIDAS Upload Packet - ${provider.agencyName}"`,
    `"Generated: ${new Date().toLocaleString()}"`,
    '',
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    '',
    `"Total Claims: ${claims.length}"`,
    `"Total Charges: $${claims.reduce((sum, c) => sum + parseFloat(String(c.charge_amount || 0)), 0).toFixed(2)}"`,
  ]

  return csvRows.join('\n')
}

/**
 * Generate IRIS FEA export CSV
 */
export function generateIRISExport(claims: ClaimExportRecord[]): string {
  const headers = [
    'member_id', 'worker_id', 'service_date', 'procedure_code',
    'units', 'amount', 'authorization_number', 'fea_organization',
  ]

  const rows = claims.map(c => [
    c.medicaid_id || c.mco_member_id || '',
    c.caregiver_npi || c.npi_number || c.evv_worker_id || '',
    c.service_date ? new Date(c.service_date).toISOString().split('T')[0] : '',
    c.procedure_code || 'T1019',
    String(c.units_billed || c.units || ''),
    parseFloat(String(c.charge_amount || 0)).toFixed(2),
    c.auth_number || c.authorization_number || '',
    c.fea_organization || '',
  ])

  return [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')
}

/**
 * Generate HMO-specific export
 */
export function generateHMOExport(claims: ClaimExportRecord[], provider: ProviderInfo): string {
  return generateMidasExport(claims, provider)
}
