/**
 * The crew's day on the phone (landscaping parity rows 11–15) — pure TypeScript, tested by tests/mobile/landscaping-crew-day.test.ts.
 * The server's half is apps/unified server/crm/landscaping/crewDay.ts (/api/crew-day). Every save here is safe to send twice and is
 * kept on the phone with no signal (src/offline): a skip is one open skip per visit, a material line carries its own entry key, a
 * clock start/stop of a person whose clock is already so changes nothing — and each carries the moment it was tapped.
 */
export const SKIP_REASONS: Array<{ id: string; label: string }> = [
  { id: 'weather', label: 'Rain or weather' }, { id: 'locked_gate', label: 'Locked gate' }, { id: 'dog', label: 'Dog in the yard' },
  { id: 'customer_asked', label: 'Customer asked to skip' }, { id: 'no_access', label: 'Could not get in' }, { id: 'equipment', label: 'Equipment problem' },
  { id: 'ran_out_of_time', label: 'Ran out of time' }, { id: 'other', label: 'Other' },
]
export const REBOOK = 'Rebook it'
export const NO_REBOOK = 'No need to rebook'
export const skipReasonId = (label: string | undefined) => SKIP_REASONS.find((r) => r.label === label)?.id

/** "Couldn't do it": the save for a visit, the reason by its id. Null when no reason was picked. */
export function skipRequest(jobId: string, v: { reason?: string; rebook?: string; note?: string }, at: Date = new Date()) {
  const reason = skipReasonId(v.reason)
  if (!reason) return null
  return { method: 'POST' as const, path: `/api/crew-day/visits/${jobId}/skip`, body: { reason, rebook: v.rebook !== NO_REBOOK, ...(v.note?.trim() ? { note: v.note.trim() } : {}), tappedAt: at.toISOString() } }
}

export const materialsKey = (jobId: string) => `materials:${jobId}`
export const crewKey = (jobId: string) => `crew:${jobId}`

/** A quantity as typed ("2.5", "3"): a positive number, or null. */
export const quantityOf = (s: string) => { const n = Number(String(s).trim().replace(',', '.')); return Number.isFinite(n) && n > 0 && n <= 100_000 ? Math.round(n * 100) / 100 : null }

/** One material line: from the price book (its id) or typed (its name); `entryKey` makes a repeat the same line. */
export function materialRequest(jobId: string, m: { name?: string; pricebookItemId?: string; quantity: number; unit?: string }, entryKey: string) {
  return { method: 'POST' as const, path: `/api/crew-day/visits/${jobId}/materials`, body: {
    ...(m.pricebookItemId ? { pricebookItemId: m.pricebookItemId } : { name: String(m.name || '').trim() }),
    quantity: m.quantity, ...(m.unit?.trim() ? { unit: m.unit.trim() } : {}), entryKey,
  } }
}

/** Start or stop one person's clock on a visit (`key` is the server's: u:<userId> or m:<memberId>). */
export function crewClockRequest(jobId: string, key: string, action: 'start' | 'stop', at: Date = new Date()) {
  return { method: 'POST' as const, path: `/api/crew-day/visits/${jobId}/crew/${encodeURIComponent(key)}/${action}`, body: { tappedAt: at.toISOString() } }
}

/** The clocks as the crew lead should see them while saves wait: the last waiting start/stop of each person wins. */
export function clocksWithWaiting<P extends { key: string; running: boolean }>(people: P[], queue: Array<{ path: string; method: string; recordKey?: string }>, jobId: string): Array<P & { waiting: boolean }> {
  return people.map((p) => {
    const mine = queue.filter((q) => q.method === 'POST' && q.recordKey === crewKey(jobId) && q.path.includes(`/crew/${encodeURIComponent(p.key)}/`))
    const last = mine[mine.length - 1]
    return { ...p, running: last ? last.path.endsWith('/start') : p.running, waiting: !!last }
  })
}

/** Hours as the screen says them: "2 h 15 min", "45 min". */
export const hoursWords = (h: number) => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` }

/** The Finish Day recap in plain words, one line each, in the order Service Autopilot's Finish Day reads. */
export function recapLines(r: { stops: number; done: number; couldNotDo: any[]; stillOpen: any[]; hours: number; notesOutstanding: any[] }): string[] {
  return [
    `${r.done} of ${r.stops} stop${r.stops === 1 ? '' : 's'} done`,
    ...(r.couldNotDo.length ? [`${r.couldNotDo.length} could not be done`] : []),
    ...(r.stillOpen.length ? [`${r.stillOpen.length} still to do`] : []),
    `${hoursWords(r.hours)} worked`,
    ...(r.notesOutstanding.length ? [`${r.notesOutstanding.length} customer note${r.notesOutstanding.length === 1 ? '' : 's'} still to write`] : []),
  ]
}
