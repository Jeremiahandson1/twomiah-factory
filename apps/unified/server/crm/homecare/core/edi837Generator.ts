/**
 * EDI 837P (Professional) Claim File Generator. Moved from templates/crm-homecare/backend/src/services/edi837Generator.ts.
 * Pure: generates ANSI X12 EDI 837P files from claim records for submission to clearinghouses and payers.
 *
 * Changes: a claim record and the payer are read in camelCase (clientLastName, ediPayerId …), as the unified reads
 * return them; getProviderInfo takes the agency's `company` row, and its last-resort name is 'Our agency' (the
 * template's was a build placeholder, '{{COMPANY_NAME}}', which the unified app — with no build step — would print).
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
  ediPayerId?: string | null
  npi?: string | null
}

export interface ClaimRecord {
  id: string
  claimNumber?: string | null
  clientLastName?: string | null
  clientLast?: string | null
  clientFirstName?: string | null
  clientFirst?: string | null
  medicaidId?: string | null
  clientAddress?: string | null
  clientCity?: string | null
  clientState?: string | null
  clientZip?: string | null
  clientDob?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  caregiverLast?: string | null
  caregiverLastName?: string | null
  caregiverFirst?: string | null
  caregiverFirstName?: string | null
  caregiverNpi?: string | null
  npiNumber?: string | null
  taxonomyCode?: string | null
  chargeAmount?: string | number | null
  serviceDate?: string | null
  serviceDateFrom?: string | null
  serviceDateTo?: string | null
  placeOfService?: string | null
  procedureCode?: string | null
  modifier?: string | null
  unitsBilled?: string | number | null
  units?: string | number | null
  unitsOfService?: string | number | null
  diagnosisCode?: string | null
  primaryDiagnosisCode?: string | null
  authNumber?: string | null
  authorizationNumber?: string | null
  sandataVisitId?: string | null
}

interface Generate837POptions {
  claims: ClaimRecord[]
  provider: ProviderInfo
  payer: PayerInfo
  interchangeControlNum?: string | number
}

/** Build a complete EDI 837P file from claim data. */
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
    'ZZ', pad(ediId(payer.ediPayerId || payer.name), 15),
    today.slice(2), now, '^', '00501', icn, '0',
    process.env.NODE_ENV === 'production' ? 'P' : 'T', ':')

  // GS - Functional Group Header
  seg('GS', 'HC',
    ediId(provider.npi || provider.taxId),
    ediId(payer.ediPayerId || payer.name),
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
    ediId(payer.ediPayerId))

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
      ediName(claim.clientLastName || claim.clientLast),
      ediName(claim.clientFirstName || claim.clientFirst),
      '', '', '', 'MI',
      ediId(claim.medicaidId))

    if (claim.clientAddress) {
      seg('N3', ediName(claim.clientAddress))
      seg('N4',
        ediName(claim.clientCity || ''),
        claim.clientState || 'WI',
        (claim.clientZip || '').replace(/\D/g, ''))
    }

    if (claim.clientDob || claim.dateOfBirth) {
      seg('DMG', 'D8',
        ediDate(claim.clientDob || claim.dateOfBirth),
        claim.gender === 'Female' ? 'F' : claim.gender === 'Male' ? 'M' : 'U')
    }

    // 2010BB - Payer Name
    seg('NM1', 'PR', '2',
      ediName(payer.name),
      '', '', '', '', 'PI',
      ediId(payer.ediPayerId))

    // 2300 - Claim Information
    const claimAmt = parseFloat(String(claim.chargeAmount || 0)).toFixed(2)
    const claimRef = ediId(claim.claimNumber || claim.id)
    const svcDate = ediDate(claim.serviceDate || claim.serviceDateFrom)
    const pos = claim.placeOfService || '12'

    seg('CLM', claimRef, claimAmt, '', '',
      `${pos}:B:1`, 'Y', 'A', 'Y', 'I')

    seg('DTP', '431', 'D8', svcDate)
    seg('DTP', '472', 'RD8',
      `${svcDate}-${ediDate(claim.serviceDateTo || claim.serviceDate || claim.serviceDateFrom)}`)

    if (claim.authNumber || claim.authorizationNumber) {
      seg('REF', 'G1', ediId(claim.authNumber || claim.authorizationNumber))
    }

    const dx = claim.diagnosisCode || claim.primaryDiagnosisCode || 'Z7689'
    seg('HI', `ABK:${ediId(dx)}`)

    // 2310B - Rendering Provider
    if (claim.caregiverLast || claim.caregiverLastName) {
      seg('NM1', '82', '1',
        ediName(claim.caregiverLast || claim.caregiverLastName),
        ediName(claim.caregiverFirst || claim.caregiverFirstName),
        '', '', '', 'XX',
        ediId(claim.caregiverNpi || claim.npiNumber || provider.npi))
      if (claim.taxonomyCode) {
        seg('PRV', 'PE', 'PXC', claim.taxonomyCode)
      }
    }

    // 2400 - Service Line
    const units = parseFloat(String(claim.unitsBilled || claim.units || claim.unitsOfService || 1))
    const procCode = claim.procedureCode || 'T1019'
    const modifier = claim.modifier ? `:${claim.modifier}` : ''

    seg('LX', '1')
    seg('SV1',
      `HC:${ediId(procCode)}${modifier}`,
      claimAmt, 'UN',
      units.toFixed(3), '', '1')
    seg('DTP', '472', 'D8', svcDate)

    if (claim.sandataVisitId) {
      seg('REF', 'LU', ediId(claim.sandataVisitId))
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

/** The agency's provider info from its `company` row, then the environment. */
export function getProviderInfo(agency?: { name?: string | null; npi?: string | null; medicaidId?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null } | null): ProviderInfo {
  return {
    agencyName: agency?.name || process.env.AGENCY_NAME || 'Our agency',
    npi: agency?.npi || process.env.AGENCY_NPI || '',
    taxId: process.env.AGENCY_TAX_ID || '',
    medicaidId: agency?.medicaidId || process.env.AGENCY_MEDICAID_ID || '',
    taxonomyCode: process.env.AGENCY_TAXONOMY || '374700000X',
    address: agency?.address || process.env.AGENCY_ADDRESS || '',
    city: agency?.city || process.env.AGENCY_CITY || '',
    state: agency?.state || process.env.AGENCY_STATE || '',
    zip: agency?.zip || process.env.AGENCY_ZIP || '',
    phone: agency?.phone || process.env.AGENCY_PHONE || '',
    contactName: process.env.AGENCY_CONTACT || '',
    clearinghouseId: process.env.CLEARINGHOUSE_ID || '',
    clearinghouseName: process.env.CLEARINGHOUSE_NAME || '',
  }
}
