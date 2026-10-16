// The medications on file for a client, as a card prints them — ONE source (Run 4).
//
// The record is the client's ACTIVE rows in the medications table (the Medications page; the MAR a
// caregiver records doses against). The client record's free-text `medications` list (Edit Client's
// box, CVHC's original field) is a legacy note: read beside the table it printed the same medicine
// twice ("Lisinopril · 10mg · oral" and "Lisinopril 10mg daily" — no name match can pair them), so
// it is used only when the client has NO medication rows, and the caller is told which it got.
//
// Readers: the caregiver's client card (GET /api/clients/:id/caregiver-view) and the client portal's
// care plan (GET /api/portal/care-plan). The family portal and the office read the table itself.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'

export type MedicationsSource = 'medications' | 'client_record' | null

/** The client record's JSON list (or a stray string) as trimmed lines. */
export function freeTextLines(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v] } catch { return [v] } })() : []
  return arr.map((x: any) => (x && typeof x === 'object' ? x.name || x.label || '' : String(x ?? ''))).map((s: string) => s.trim()).filter(Boolean)
}

export async function medicationsOnFile(clientId: string, freeText: unknown): Promise<{ lines: string[]; source: MedicationsSource }> {
  const r: any = await db.execute(sql`
    SELECT name, dosage, route, frequency, is_prn FROM medications
     WHERE client_id = ${clientId} AND status = 'active' ORDER BY name`)
  const rows = (r?.rows ?? r) as any[]
  if (rows.length) {
    return { lines: rows.map((m) => [m.name, m.dosage, m.route, m.frequency].filter(Boolean).join(' · ') + (m.is_prn ? ' (as needed)' : '')), source: 'medications' }
  }
  const text = freeTextLines(freeText)
  return { lines: text, source: text.length ? 'client_record' : null }
}
