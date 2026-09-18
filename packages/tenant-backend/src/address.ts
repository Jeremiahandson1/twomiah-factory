// US address fields — ONE validator for every CRM.
//
// State and ZIP were the only contact fields with no checking at all: "VVVVV" and an eleven-digit ZIP both saved,
// while email, phone, name length and contact type were all validated properly. An address that cannot be posted
// is worse than a missing one — it reaches invoices, statements, rabies certificates and mailing labels.
// (Vet T12 L3)
export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  // territories and the military post offices, which take mail the same way
  AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
  AA: 'Armed Forces Americas', AE: 'Armed Forces Europe', AP: 'Armed Forces Pacific',
}
const BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]))

/** "wi", "Wisconsin", " wi " → "WI"; anything we cannot place → null. */
export function normaliseState(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const upper = s.toUpperCase()
  if (US_STATES[upper]) return upper
  return BY_NAME[s.toLowerCase()] || null
}

/** 12345 or 12345-6789 (a space or an en dash in place of the hyphen is accepted and tidied). */
export function normaliseZip(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/[\s–—]+/g, '-')
  if (!s) return null
  const m = s.match(/^(\d{5})(?:-(\d{4}))?$/)
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null
}

export const STATE_ERROR = 'Enter a US state — its two-letter code (WI) or its name (Wisconsin).'
export const ZIP_ERROR = 'Enter a ZIP code as 12345 or 12345-6789.'
