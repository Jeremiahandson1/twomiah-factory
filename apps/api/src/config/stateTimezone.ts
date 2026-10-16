// The time zone a signup's business keeps — decided by its state, the way every CRM decides it.
//
// The CRMs never read a zone from the Factory: each derives it from the state the signup gives it ({{STATE}} in the
// seed) — crm-homecare services/agencyTime.ts, packages/tenant-backend time/businessDay.ts (the shared CRMs) and
// crm-dispensary utils/isoTime.ts, until the owner sets their own. The public signup form has a Timezone select that
// starts on Eastern and does not follow the state; its value only reached the Factory as free text in `notes`
// ("Timezone: America/New_York"), so a Wisconsin agency's Factory record said Eastern while its CRM ran on Central
// (Run 4). The Factory now records the zone the CRM will actually use, from the same table.
// tests/shared/signup-timezone.test.ts holds this table to all three CRM copies, state by state.

const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam', VI: 'America/St_Thomas',
}

/** The state's zone ('WI' → America/Chicago), or null when the state is blank or not a US state/territory code. */
export function stateTimezone(state: unknown): string | null {
  const st = typeof state === 'string' ? state.trim().toUpperCase() : ''
  return STATE_ZONES[st] || null
}

/**
 * The signup's notes with its "Timezone: …" part stating the zone the CRM will use. The form writes the select's
 * value there (Eastern unless changed); a signup with a known state gets that state's zone instead, and a part is
 * added when the form sent none. No known state: the notes are left exactly as sent.
 */
export function notesWithTimezone(notes: unknown, zone: string | null): string | null {
  const text = typeof notes === 'string' ? notes : ''
  if (!zone) return text || null
  const isZone = (p: string) => /^timezone\s*:/i.test(p)
  const parts = text.split('|').map((p) => p.trim()).filter(Boolean)
  const first = parts.findIndex(isZone)
  const kept = parts.filter((p) => !isZone(p))
  kept.splice(first < 0 ? kept.length : first, 0, 'Timezone: ' + zone)
  return kept.join(' | ')
}
