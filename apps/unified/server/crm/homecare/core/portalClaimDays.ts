// Insurer-portal claim days. Moved from templates/crm-homecare/backend/src/services/portalClaimDays.ts (ported there
// from CVHC's MIDAS claim days page, generalised). The read is in server/data/homecareEvv.ts.
//
// CVHC built this for ONE insurer: My Choice Wisconsin authorises two kinds of weekly units per client, keyed into its
// MIDAS portal per day — S5125 attendant care (EVV required) and S5130 homemaker (no EVV). Here the portal, the two
// procedure codes and their labels are DATA on the payer (referral_sources.claim_portal); WISCONSIN_PRESETS is offered
// by the screen only when the agency's state is WI.
//
// The arithmetic is CVHC's, unchanged: a Sun–Sat week; 1 unit = 15 minutes; EVV minutes come from the visits that went
// through EVV, in time order, never more than the client's weekly EVV allowance (clients.evv_weekly_units — never the
// TOTAL weekly authorization, which includes the other code's time; a blank EVV share is reported by name with the
// total beside it); everything else is the other code; units rounded PER DAY with the week's EVV units trimmed
// latest-day-first; training (shadow) shifts never bill. A visit with no stored Sandata decision of an EVV client counts
// as EVV.
//
// Changes: the read is the company's (portalClaimWeek takes its id); the reply is camelCase (weekStart, clientName,
// evvWeeklyUnits, inEvv, clockIn, needsApproval, pendingApproval …) where the template's was snake_case.
import { portalClaimWeekVisits } from '../../../data/homecareEvv.ts'
import type { CrmDeps } from '../../deps.ts'
import { allocateEvvWeek } from './evvWeekly.ts'

export interface ClaimPortalConfig {
  name: string          // the portal, e.g. "MIDAS"
  evvCode: string       // e.g. "S5125"
  evvLabel: string      // e.g. "Attendant care (EVV)"
  otherCode: string     // e.g. "S5130"
  otherLabel: string    // e.g. "Homemaker"
}

/** Offered by the screen when the agency's state is WI. Data, not behaviour. */
export const WISCONSIN_PRESETS: Array<{ id: string; label: string; config: ClaimPortalConfig }> = [
  {
    id: 'wi-my-choice-midas',
    label: 'My Choice Wisconsin — MIDAS (S5125 attendant care / S5130 homemaker)',
    config: { name: 'MIDAS', evvCode: 'S5125', evvLabel: 'Attendant care (EVV)', otherCode: 'S5130', otherLabel: 'Homemaker' },
  },
]

/** A config is usable when it names the portal and both codes. */
export function parseClaimPortal(v: any): ClaimPortalConfig | null {
  let o = v
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return null } }
  if (!o || typeof o !== 'object') return null
  const s = (x: any) => (typeof x === 'string' ? x.trim() : '')
  const cfg = { name: s(o.name), evvCode: s(o.evvCode), evvLabel: s(o.evvLabel), otherCode: s(o.otherCode), otherLabel: s(o.otherLabel) }
  if (!cfg.name || !cfg.evvCode || !cfg.otherCode) return null
  return { ...cfg, evvLabel: cfg.evvLabel || cfg.evvCode, otherLabel: cfg.otherLabel || cfg.otherCode }
}

/** A client goes through EVV for this payer when they bill the payer (not private pay) and have a Medicaid ID on file. */
export function clientInEvv(c: { isPrivatePay?: boolean | null; medicaidId?: string | null }) {
  if (!c || c.isPrivatePay === true) return false
  return String(c.medicaidId || '').trim().length > 0
}

/** The Sunday (YYYY-MM-DD) of the week containing `day`. */
export function sundayOf(day: string) {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

export function createPortalClaimDays(d: CrmDeps) {
  /** Claim days for every client of `payerId` for the Sun–Sat week containing `weekStart`, on the agency's clock (`tz`). */
  async function portalClaimWeek(companyId: string, payerId: string, weekStart: string, tz: string, q: any = d.db) {
    const ws = sundayOf(weekStart)
    const we = (() => { const x = new Date(ws + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 6); return x.toISOString().slice(0, 10) })()
    const r = await portalClaimWeekVisits(q, companyId, payerId, ws, we, tz)

    const byClient = new Map<string, any>()
    for (const v of r) {
      if (v.isTraining === true) continue
      if (!byClient.has(v.clientId)) {
        byClient.set(v.clientId, {
          clientId: v.clientId, clientName: `${v.firstName} ${v.lastName}`.trim(),
          medicaidId: v.medicaidId || null, mcoMemberId: v.mcoMemberId || null,
          evvWeeklyUnits: v.evvWeeklyUnits == null ? null : Number(v.evvWeeklyUnits),
          // The client's TOTAL weekly authorized units — named beside a missing EVV share so the office sees which
          // field is blank; never used as the EVV cap.
          weeklyAuthorizedUnits: v.weeklyAuthorizedUnits == null ? null : Number(v.weeklyAuthorizedUnits),
          inEvv: clientInEvv(v), visits: [] as any[],
        })
      }
      const cl = byClient.get(v.clientId)
      cl.visits.push({
        id: v.id, date: v.date, start: v.start, clockIn: v.clockIn, clockOut: v.clockOut,
        caregiver: v.caregiver, minutes: Number(v.minutes) || 0,
        // No stored decision (visits from before the Sandata decision existed): an EVV client's visits all went
        // through EVV.
        sentToSandata: v.sentFlag == null ? cl.inEvv : v.sentFlag === true,
        needsApproval: v.needsApproval === true, approvalReason: v.approvalReason || null,
      })
    }
    const clients = [...byClient.values()].map((cl) => {
      const alloc = allocateEvvWeek(cl.inEvv ? cl.evvWeeklyUnits : 0, cl.visits)
      const { visits, ...rest } = cl
      return { ...rest, ...alloc, pendingApproval: visits.filter((v: any) => v.needsApproval).length }
    })
    return { weekStart: ws, weekEnd: we, clients }
  }

  return { portalClaimWeek }
}
