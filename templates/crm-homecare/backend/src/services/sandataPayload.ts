// services/sandataPayload.ts
// Builds spec-conformant JSON (Sandata third-party spec v7.6 + state DMS addendum) for the client
// and visit intake interfaces. Pure functions — no DB access, no network — so the whole layer is
// testable against plain objects. Ported from the CVHC CRM's services/sandataPayload.js.

// ── formatting helpers ───────────────────────────────────────────────────────────────────────

// Spec date/time: YYYY-MM-DDTHH:MM:SSZ, UTC, to the second (no milliseconds).
export function utc(dt: unknown): string | null {
  if (!dt) return null
  const d = new Date(dt as any)
  if (isNaN(d.getTime())) return null
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// Sequence: the spec-sanctioned timestamp form YYYYMMDDHHMMSS (numbers only, UTC), bumped past the
// last sequence used so a resubmit in the same second still strictly increases and a rejected
// sequence is never reused.
export function nextSequence(lastSeq: unknown, now: Date = new Date()): number {
  const ts = parseInt(now.toISOString().replace(/[-:TZ]/g, '').slice(0, 14), 10)
  const last = parseInt(String(lastSeq ?? ''), 10) || 0
  return ts > last ? ts : last + 1
}

// Punch locations come in several historical shapes:
//   {lat, lng}  ·  {latitude, longitude}  ·  {lat, lng, source, captured_at}
export function normalizeLoc(loc: unknown): { lat: number; lng: number; source: string } | null {
  if (!loc) return null
  const o: any = typeof loc === 'string' ? safeParse(loc) : loc
  if (!o) return null
  const lat = o.lat ?? o.latitude ?? null
  const lng = o.lng ?? o.longitude ?? null
  if (lat == null || lng == null || lat === '' || lng === '') return null
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null
  return { lat: Number(lat), lng: Number(lng), source: o.source || 'tap' }
}

function safeParse(s: string): any { try { return JSON.parse(s) } catch { return null } }

// Client names: max 30 chars; only letters, hyphens, periods, apostrophes (Appendix 10). Strip
// quoted nicknames and disallowed characters.
export function specName(name: unknown): string {
  return String(name || '')
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/[^A-Za-z .'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
}

export function digitsOnly(s: unknown): string { return String(s || '').replace(/\D/g, '') }

// 9-digit zip; pad the +4 with zeros when unknown (spec: "send 0000").
export function specZip(zip: unknown): string | null {
  const d = digitsOnly(zip)
  if (d.length >= 9) return d.slice(0, 9)
  if (d.length >= 5) return d.slice(0, 5).padEnd(9, '0')
  return null
}

export const MA_ID_RE = /^[0-9]{10,12}$/
export const WORKER_ID_RE = /^[0-9]{9,15}$/

// Wisconsin alternate-EVV change reason codes (Addendum v2.6 Appendix 3). 5 and 8 need a memo.
export const EVV_REASON_CODES = ['1', '2', '3', '4', '5', '7', '8'] as const
export const EVV_REASONS_NEEDING_MEMO = ['5', '8']

// ── validation (readiness / pre-flight) ──────────────────────────────────────────────────────

export interface VisitBundle {
  providerId: string | null
  visitOtherId: string
  sequence: number | null
  workerId: string | null
  medicaidId: string | null
  payerId: string | null
  payerProgram: string | null
  serviceCode: string | null
  modifier?: string | null
  startTime: unknown
  endTime: unknown
  clockInLoc: unknown
  clockOutLoc: unknown
  originPhone: string | null
  changes: Array<{ new_start?: unknown; new_end?: unknown; changed_by_label?: string | null; changed_by?: string | null; changed_at?: unknown; reason_code: string; memo?: string | null; resolution_code?: string | null }>
  exceptionAck: { code: string; acknowledged?: boolean } | null
  cancelled: boolean
  /** Sandata time zone vocabulary, e.g. US/Central. */
  timeZone: string
}

// Returns [] when the assembled bundle can produce a valid visit payload.
export function validateVisitBundle(b: VisitBundle): Array<{ code: string; msg: string }> {
  const problems: Array<{ code: string; msg: string }> = []
  if (!b.providerId) problems.push({ code: 'NO_PROVIDER_ID', msg: 'Agency Medicaid provider ID is not set (Integrations → EVV → Sandata account)' })
  if (!MA_ID_RE.test(digitsOnly(b.medicaidId))) problems.push({ code: 'BAD_MEDICAID_ID', msg: `Client MA ID must be 10-12 digits (have: ${b.medicaidId || 'none'})` })
  if (!WORKER_ID_RE.test(digitsOnly(b.workerId))) problems.push({ code: 'BAD_WORKER_ID', msg: `Caregiver EVV worker ID must be 9-15 digits (have: ${b.workerId || 'none'})` })
  if (!b.payerId || !b.payerProgram) problems.push({ code: 'NO_PAYER_CODES', msg: 'Client payer has no Sandata PayerID/PayerProgram mapped' })
  if (!b.serviceCode) problems.push({ code: 'NO_SERVICE_CODE', msg: 'No procedure code (set the care type\'s default service code)' })
  if (!b.startTime) problems.push({ code: 'NO_START', msg: 'Visit has no start time' })
  if (!b.endTime) problems.push({ code: 'NO_END', msg: 'Visit has no end time (still open?)' })
  return problems
}

// ── visit payload (spec 3.6–3.10) ────────────────────────────────────────────────────────────
export function buildVisitPayload(b: VisitBundle): any {
  const maId = digitsOnly(b.medicaidId)
  const inLoc = normalizeLoc(b.clockInLoc)
  const outLoc = normalizeLoc(b.clockOutLoc)
  const isIvr = !!b.originPhone
  const seq = Number(b.sequence)

  // A visit_time_changes row means that punch time was set by the office, not captured live:
  // send it as Adjusted time + VisitChanges, and do not fabricate a call for it (spec 3.6 #18/#19, 3.9).
  const changes = Array.isArray(b.changes) ? b.changes : []
  const startAdjusted = changes.some((c) => c.new_start)
  const endAdjusted = changes.some((c) => c.new_end)

  // CallExternalID max is 16 chars — an id alone would truncate identically for both calls, so
  // build from a shortened visit id + a distinct suffix.
  const callIdBase = String(b.visitOtherId).replace(/-/g, '').slice(0, 14)
  const calls: any[] = []
  if (b.startTime && !startAdjusted) calls.push(buildCall(callIdBase + '-I', b.startTime, 'Time In', inLoc, isIvr, b))
  if (b.endTime && !endAdjusted) calls.push(buildCall(callIdBase + '-O', b.endTime, 'Time Out', outLoc, isIvr, b))

  const payload: any = {
    ProviderIdentification: { ProviderQualifier: 'MedicaidID', ProviderID: String(b.providerId) },
    VisitOtherID: String(b.visitOtherId).slice(0, 50),
    SequenceID: seq,
    EmployeeQualifier: 'EmployeeCustomID',
    EmployeeIdentifier: digitsOnly(b.workerId),
    ClientIDQualifier: 'ClientCustomID',
    ClientID: maId,
    ClientOtherID: maId,
    VisitCancelledIndicator: !!b.cancelled,
    PayerID: b.payerId,
    PayerProgram: b.payerProgram,
    ProcedureCode: b.serviceCode,
    Modifier1: b.modifier || null,
    Modifier2: null,
    Modifier3: null,
    Modifier4: null,
    VisitTimeZone: b.timeZone,
    AdjInDateTime: startAdjusted ? utc(b.startTime) : null,
    AdjOutDateTime: endAdjusted ? utc(b.endTime) : null,
    ClientVerifiedTimes: null,
    ClientVerifiedTasks: null,
    ClientVerifiedService: null,
    ClientSignatureAvailable: null,
    ClientVoiceRecording: null,
    Calls: calls,
  }

  if (changes.length) {
    payload.VisitChanges = changes.map((c, i) => ({
      SequenceID: seq - changes.length + i, // the change sequence precedes the visit's
      ChangeMadeBy: String(c.changed_by_label || c.changed_by || 'system').slice(0, 64),
      ChangeDateTime: utc(c.changed_at),
      GroupCode: null,
      ReasonCode: String(c.reason_code),
      ChangeReasonMemo: c.memo ? String(c.memo).slice(0, 256) : null,
      ResolutionCode: c.resolution_code ? String(c.resolution_code) : '1',
    }))
  }

  if (b.exceptionAck && b.exceptionAck.code != null) {
    payload.VisitExceptionAcknowledgement = [{
      ExceptionID: String(b.exceptionAck.code).slice(0, 2),
      ExceptionAcknowledged: b.exceptionAck.acknowledged !== false,
    }]
  }

  return payload
}

// CallType (spec 3.7): Mobile when GPS was collected, Telephony for IVR (with the originating
// phone), Other for an electronic tap with no GPS fix.
function buildCall(id: string, when: unknown, assignment: string, loc: { lat: number; lng: number } | null, isIvr: boolean, b: VisitBundle): any {
  return {
    CallExternalID: String(id).slice(0, 16),
    CallDateTime: utc(when),
    CallAssignment: assignment,
    GroupCode: null,
    CallType: isIvr ? 'Telephony' : (loc ? 'Mobile' : 'Other'),
    ProcedureCode: b.serviceCode,
    ClientIdentifierOnCall: null,
    CallLatitude: !isIvr && loc ? Number(loc.lat) : null,
    CallLongitude: !isIvr && loc ? Number(loc.lng) : null,
    OriginatingPhoneNumber: isIvr ? digitsOnly(b.originPhone).slice(-10) : null,
    VisitLocationType: null,
  }
}

// ── client payload (spec 3.2–3.5) ────────────────────────────────────────────────────────────
// c = client fields (+ payer sandata_payer_id / sandata_payer_program, default_service_code).
// includePayerSegment only for members without a prior authorization on file at Sandata.
export function buildClientPayload(c: any, opts: { providerId: string | null; sequence: number; includePayerSegment?: boolean; timeZone: string; agencyState?: string }): any {
  const maId = digitsOnly(c.medicaid_id)
  const payload: any = {
    ProviderIdentification: { ProviderQualifier: 'MedicaidID', ProviderID: String(opts.providerId) },
    ClientFirstName: specName(c.first_name),
    ClientMiddleInitial: null,
    ClientLastName: specName(c.last_name),
    ClientQualifier: 'ClientCustomID',
    ClientMedicaidID: maId,
    ClientIdentifier: maId,
    SequenceID: opts.sequence,
    ClientCustomID: maId,
    ClientOtherID: maId,
    ClientTimezone: opts.timeZone,
  }

  if (opts.includePayerSegment) {
    payload.ClientPayerInformation = [{
      PayerID: c.sandata_payer_id,
      PayerProgram: c.sandata_payer_program,
      ProcedureCode: c.default_service_code,
      ClientStatus: c.is_active === false ? '04' : '02',
      EffectiveStartDate: (c.created_at ? new Date(c.created_at) : new Date()).toISOString().slice(0, 10),
    }]
    payload.ClientAddress = [{
      ClientAddressType: 'Other',
      ClientAddressIsPrimary: false,
      ClientAddressLine1: String(c.address || '').trim().slice(0, 30),
      ClientAddressLine2: null,
      ClientCounty: null,
      ClientCity: String(c.city || '').trim().slice(0, 30),
      ClientState: String(c.state || opts.agencyState || '').toUpperCase().slice(0, 2),
      ClientZip: specZip(c.zip),
      ClientAddressLongitude: c.longitude != null ? Number(c.longitude) : null,
      ClientAddressLatitude: c.latitude != null ? Number(c.latitude) : null,
    }]
    payload.ClientPhone = [{
      ClientPhoneType: 'Other',
      ClientPhone: digitsOnly(c.phone).slice(-10) || null,
    }]
  }

  return payload
}
