/**
 * EDI 837P (Professional) Claim File Generator
 *
 * Generates valid ANSI X12 EDI 837P files from claim records
 * for submission to clearinghouses and payers.
 */

function ediDate(d: string | Date | null | undefined): string {
  return d ? new Date(d).toISOString().split('T')[0].replace(/-/g, '') : ''
}

function ediTime(d: string | Date | null | undefined): string {
  return d ? new Date(d).toISOString().split('T')[1].slice(0, 5).replace(':', '') : '0000'
}

function pad(s: string | null | undefined, n: number): string {
  return String(s || '').padEnd(n).slice(0, n)
}

function ediName(s: string | null | undefined): string {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 35)
}

function ediId(s: string | null | undefined): string {
  return String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 30)
}

export interface ProviderInfo {
  agencyName: string
  npi: string
  taxId: string
  medicaidId: string
  taxonomyCode: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  contactName: string
  clearinghouseId: string
  clearinghouseName: string
}

export interface PayerInfo {
  name: string
  edi_payer_id?: string
  npi?: string
}

export interface ClaimRecord {
  id: string
  claim_number?: string
  client_last_name?: string
  client_last?: string
  client_first_name?: string
  client_first?: string
  medicaid_id?: string
  client_address?: string
  client_city?: string
  client_state?: string
  client_zip?: string
  client_dob?: string
  date_of_birth?: string
  gender?: string
  caregiver_last?: string
  caregiver_last_name?: string
  caregiver_first?: string
  caregiver_first_name?: string
  caregiver_npi?: string
  npi_number?: string
  taxonomy_code?: string
  charge_amount?: string | number
  service_date?: string
  service_date_from?: string
  service_date_to?: string
  place_of_service?: string
  procedure_code?: string
  modifier?: string
  units_billed?: string | number
  units?: string | number
  units_of_service?: string | number
  diagnosis_code?: string
  primary_diagnosis_code?: string
  auth_number?: string
  authorization_number?: string
  sandata_visit_id?: string
}

interface Generate837POptions {
  claims: ClaimRecord[]
  provider: ProviderInfo
  payer: PayerInfo
  interchangeControlNum?: string | number
}

/**
 * Build a complete EDI 837P file from claim data
 */
export function generate837P({ claims, provider, payer, interchangeControlNum }: Generate837POptions): string {
  const icn = String(interchangeControlNum || Date.now()).padStart(9, '0')
  const today = ediDate(new Date())
  const now = ediTime(new Date())
  const segments: string[] = []
  let segCount = 0
  let hlCount = 0

  const seg = (...parts: string[]) => {
    segments.push(parts.join('*') + '~')
    segCount++
  }

  // ISA - Interchange Control Header
  seg('ISA', '00', pad('', 10), '00', pad('', 10),
    'ZZ', pad(ediId(provider.npi || provider.taxId), 15),
    'ZZ', pad(ediId(payer.edi_payer_id || payer.name), 15),
    today.slice(2), now, '^', '00501', icn, '0',
    process.env.NODE_ENV === 'production' ? 'P' : 'T', ':')

  // GS - Functional Group Header
  seg('GS', 'HC',
    ediId(provider.npi || provider.taxId),
    ediId(payer.edi_payer_id || payer.name),
    today, now, '1', 'X', '005010X222A1')

  // ST - Transaction Set Header
  seg('ST', '837', '0001', '005010X222A1')

  // BHT - Beginning of Hierarchical Transaction
  seg('BHT', '0019', '00', icn, today, now, 'CH')

  // 1000A - Submitter Name
  seg('NM1', '41', '2',
    ediName(provider.agencyName),
    '', '', '', '', '46',
    ediId(provider.npi))
  seg('PER', 'IC',
    ediName(provider.contactName || provider.agencyName),
    'TE', (provider.phone || '0000000000').replace(/\D/g, '').slice(0, 10))

  // 1000B - Receiver Name
  seg('NM1', '40', '2',
    ediName(payer.name),
    '', '', '', '', '46',
    ediId(payer.edi_payer_id))

  // 2000A - Billing Provider Hierarchical Level
  hlCount++
  const billingHL = hlCount
  seg('HL', String(billingHL), '', '20', '1')
  seg('PRV', 'BI', 'PXC', provider.taxonomyCode || '374700000X')

  // 2010AA - Billing Provider Name
  seg('NM1', '85', '2',
    ediName(provider.agencyName),
    '', '', '', '', 'XX',
    ediId(provider.npi))
  seg('N3', ediName(provider.address || ''))
  seg('N4',
    ediName(provider.city || ''),
    provider.state || 'WI',
    (provider.zip || '').replace(/\D/g, '').slice(0, 9))
  seg('REF', 'EI', (provider.taxId || '').replace(/\D/g, ''))

  // Generate claims
  for (const claim of claims) {
    // 2000B - Subscriber Hierarchical Level
    hlCount++
    const subscriberHL = hlCount
    seg('HL', String(subscriberHL), String(billingHL), '22', '0')
    seg('SBR', 'P', '18', '', '', '', '', '', '', 'MC')

    // 2010BA - Subscriber Name
    seg('NM1', 'IL', '1',
      ediName(claim.client_last_name || claim.client_last),
      ediName(claim.client_first_name || claim.client_first),
      '', '', '', 'MI',
      ediId(claim.medicaid_id))

    if (claim.client_address) {
      seg('N3', ediName(claim.client_address))
      seg('N4',
        ediName(claim.client_city || ''),
        claim.client_state || 'WI',
        (claim.client_zip || '').replace(/\D/g, ''))
    }

    if (claim.client_dob || claim.date_of_birth) {
      seg('DMG', 'D8',
        ediDate(claim.client_dob || claim.date_of_birth),
        claim.gender === 'Female' ? 'F' : claim.gender === 'Male' ? 'M' : 'U')
    }

    // 2010BB - Payer Name
    seg('NM1', 'PR', '2',
      ediName(payer.name),
      '', '', '', '', 'PI',
      ediId(payer.edi_payer_id))

    // 2300 - Claim Information
    const claimAmt = parseFloat(String(claim.charge_amount || 0)).toFixed(2)
    const claimRef = ediId(claim.claim_number || claim.id)
    const svcDate = ediDate(claim.service_date || claim.service_date_from)
    const pos = claim.place_of_service || '12'

    seg('CLM', claimRef, claimAmt, '', '',
      `${pos}:B:1`, 'Y', 'A', 'Y', 'I')

    seg('DTP', '431', 'D8', svcDate)
    seg('DTP', '472', 'RD8',
      `${svcDate}-${ediDate(claim.service_date_to || claim.service_date || claim.service_date_from)}`)

    if (claim.auth_number || claim.authorization_number) {
      seg('REF', 'G1', ediId(claim.auth_number || claim.authorization_number))
    }

    const dx = claim.diagnosis_code || claim.primary_diagnosis_code || 'Z7689'
    seg('HI', `ABK:${ediId(dx)}`)

    // 2310B - Rendering Provider
    if (claim.caregiver_last || claim.caregiver_last_name) {
      seg('NM1', '82', '1',
        ediName(claim.caregiver_last || claim.caregiver_last_name),
        ediName(claim.caregiver_first || claim.caregiver_first_name),
        '', '', '', 'XX',
        ediId(claim.caregiver_npi || claim.npi_number || provider.npi))
      if (claim.taxonomy_code) {
        seg('PRV', 'PE', 'PXC', claim.taxonomy_code)
      }
    }

    // 2400 - Service Line
    const units = parseFloat(String(claim.units_billed || claim.units || claim.units_of_service || 1))
    const procCode = claim.procedure_code || 'T1019'
    const modifier = claim.modifier ? `:${claim.modifier}` : ''

    seg('LX', '1')
    seg('SV1',
      `HC:${ediId(procCode)}${modifier}`,
      claimAmt, 'UN',
      units.toFixed(3), '', '1')
    seg('DTP', '472', 'D8', svcDate)

    if (claim.sandata_visit_id) {
      seg('REF', 'LU', ediId(claim.sandata_visit_id))
    }
  }

  // SE - Transaction Set Trailer
  seg('SE', String(segCount + 1), '0001')

  // GE - Functional Group Trailer
  seg('GE', '1', '1')

  // IEA - Interchange Control Trailer
  seg('IEA', '1', icn)

  return segments.join('\n')
}

/**
 * Get agency provider info from environment / agency record
 */
export function getProviderInfo(agency?: { name?: string; npi?: string; address?: string; city?: string; state?: string; zip?: string; phone?: string }): ProviderInfo {
  return {
    agencyName: agency?.name || process.env.AGENCY_NAME || '{{COMPANY_NAME}}',
    npi: agency?.npi || process.env.AGENCY_NPI || '',
    taxId: process.env.AGENCY_TAX_ID || '',
    medicaidId: process.env.AGENCY_MEDICAID_ID || '',
    taxonomyCode: process.env.AGENCY_TAXONOMY || '374700000X',
    address: agency?.address || process.env.AGENCY_ADDRESS || '',
    city: agency?.city || process.env.AGENCY_CITY || '',
    state: agency?.state || process.env.AGENCY_STATE || 'WI',
    zip: agency?.zip || process.env.AGENCY_ZIP || '',
    phone: agency?.phone || process.env.AGENCY_PHONE || '',
    contactName: process.env.AGENCY_CONTACT || '',
    clearinghouseId: process.env.CLEARINGHOUSE_ID || '',
    clearinghouseName: process.env.CLEARINGHOUSE_NAME || '',
  }
}
