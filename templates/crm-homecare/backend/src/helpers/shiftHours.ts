// Hours between two HH:MM (or HH:MM:SS) times, wrapping past midnight.
// 13:00 -> 12:00 returns 23 (overnight), not -1; equal times are a 24-hour shift.
export function shiftHours(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0
  const h = (new Date(`2000-01-01T${end}`).getTime() - new Date(`2000-01-01T${start}`).getTime()) / (1000 * 60 * 60)
  if (!Number.isFinite(h)) return 0
  return h <= 0 ? h + 24 : h
}
