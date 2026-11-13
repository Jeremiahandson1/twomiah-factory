// The next number in a series of site records — RFI-004, SUB-012, INS-0031 (code review 04-8, 2026-11-13).
//
// These were numbered "how many there are, plus one". Delete RFI-002 of three and the next one made is RFI-003 — a
// second RFI-003, on a document that goes to the architect by its number. The next number is one more than the HIGHEST
// in the series, so a number that exists is never given again. (Deleting the newest one frees its number; nothing
// else can.)
export async function nextSeriesNumber(db: any, table: any, where: any, prefix: string, pad: number): Promise<string> {
  const rows: Array<{ number: string | null }> = await db.select({ number: table.number }).from(table).where(where)
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = 0
  for (const r of rows) { const m = re.exec(String(r.number || '')); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  return `${prefix}-${String(max + 1).padStart(pad, '0')}`
}
