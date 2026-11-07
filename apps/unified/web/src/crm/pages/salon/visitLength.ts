// How long a several-service visit runs — the server's own rule (crm/salon/appointments.ts resolveItems): each service starts where
// the ones before it end, unless it starts with the first (offset 0); the visit ends when the last one does. The New appointment form
// shows this as the visit's end, as the server will save it (salon live test 11/07: the End box kept the first service's end).
export function visitMinutes(first: number, more: Array<{ minutes: number; withFirst?: boolean }>): number {
  let cursor = Math.max(0, first || 0)
  for (const m of more) {
    const offset = m.withFirst ? 0 : cursor
    cursor = Math.max(cursor, offset + Math.max(0, m.minutes || 0))
  }
  return cursor
}
