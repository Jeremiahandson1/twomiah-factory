// The rows the canvassing screens read (server/crm/roof/field/canvassing.ts; db/schema/roof.ts canvassing_*). Decimal
// columns (centre, radius, a door's lat/lng) arrive as strings.

export interface CanvassSession {
  id: string
  userId: string
  name: string
  status: string
  centerLat: string | number | null
  centerLng: string | number | null
  radiusMiles: string | number | null
  weatherEvent: string | null
  totalDoors: number | null
  answeredDoors: number | null
  leadsCreated: number | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  /** GET /sessions/:id only: every door in it. */
  stops?: CanvassStop[]
}

export interface CanvassStop {
  id: string
  address: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  lat: string | number | null
  lng: string | number | null
  outcome: string
  notes: string | null
  /** The roofing job a door that wanted an inspection made, and its homeowner. */
  jobId: string | null
  contactId: string | null
  doorHangerLeft: boolean
  followUpDate?: string | null
  visitedAt: string | null
}

export interface ScriptStep { title: string; body: string; tips: string }

export interface CanvassScript {
  id: string
  name: string
  isDefault: boolean
  steps: ScriptStep[] | null
}

/** The pin colour for each outcome (server/crm/roof/validation.ts CANVASSING_OUTCOMES). */
export const PIN_COLORS: Record<string, string> = {
  no_answer: '#9CA3AF',
  not_interested: '#EF4444',
  interested: '#EAB308',
  appointment_set: '#22C55E',
  already_has_contractor: '#F97316',
  vacant: '#9CA3AF',
}
