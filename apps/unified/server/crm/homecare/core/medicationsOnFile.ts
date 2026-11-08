// The medications on file for a client, as a card prints them — ONE source (Run 4). Moved from
// templates/crm-homecare/backend/src/services/medicationsOnFile.ts; the read is the query builder now (the template's
// raw SQL), scoped to the company.
//
// The record is the client's ACTIVE rows in the medications table (the Medications page; the MAR a caregiver records
// doses against). The client record's free-text `medications` list (a legacy note) is used only when the client has
// NO medication rows, and the caller is told which it got.
//
// Readers: the caregiver's client card (GET /api/clients/:id/caregiver-view) and the client portal's care plan.
import { and, asc, eq } from 'drizzle-orm'
import { medications } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export type MedicationsSource = 'medications' | 'client_record' | null

/** The client record's JSON list (or a stray string) as trimmed lines. */
export function freeTextLines(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v] } catch { return [v] } })() : []
  return arr.map((x: any) => (x && typeof x === 'object' ? x.name || x.label || '' : String(x ?? ''))).map((s: string) => s.trim()).filter(Boolean)
}

export function createMedicationsOnFile(d: CrmDeps) {
  async function medicationsOnFile(companyId: string, clientId: string, freeText: unknown): Promise<{ lines: string[]; source: MedicationsSource }> {
    const rows: { name: string; dosage: string | null; route: string | null; frequency: string | null; isPrn: boolean; doseTimes: unknown }[] = await d.db
      .select({ name: medications.name, dosage: medications.dosage, route: medications.route, frequency: medications.frequency, isPrn: medications.isPrn, doseTimes: medications.doseTimes })
      .from(medications)
      .where(and(eq(medications.companyId, companyId), eq(medications.clientId, clientId), eq(medications.status, 'active')))
      .orderBy(asc(medications.name))
    if (rows.length) {
      // The dose times too (home care live test 11/08: the caregiver's Medical tab had the medicine, not when it is due).
      const at = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((t) => /^\d{2}:\d{2}/.test(t)).map(twelveHour) : [])
      return { lines: rows.map((m) => [m.name, m.dosage, m.route, m.frequency, at(m.doseTimes).length ? `at ${at(m.doseTimes).join(', ')}` : null].filter(Boolean).join(' · ') + (m.isPrn ? ' (as needed)' : '')), source: 'medications' }
    }
    const text = freeTextLines(freeText)
    return { lines: text, source: text.length ? 'client_record' : null }
  }
  return { medicationsOnFile }
}

/** "14:30" → "2:30 PM". */
function twelveHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
