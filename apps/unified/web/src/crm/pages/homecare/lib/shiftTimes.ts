// The schedule forms' copy of backend/src/services/scheduleOccurrences.ts#shiftTimesError — keep
// identical. A shift may run past midnight (the schedule engine wraps an end earlier than the
// start), but an end typed before the start is refused unless the form says the shift is
// OVERNIGHT: "9:00am – 8:00am" was a slip, not a 23-hour visit (Run 3).

const hm = (t: unknown): string | null => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/** True when the end time is earlier than the start, i.e. the shift would end the next day. */
export function endsBeforeStart(start: unknown, end: unknown): boolean {
  const a = hm(start), b = hm(end);
  return !!a && !!b && b < a;
}

/** The message to show for a start/end pair, or null when it is fine. */
export function shiftTimesError(start: unknown, end: unknown, overnight?: boolean): string | null {
  const a = hm(start), b = hm(end);
  if (!a || !b) return 'A valid start and end time are required.';
  if (a === b) return 'Start and end time cannot be the same';
  if (b < a && overnight !== true) {
    return 'The end time is before the start time. If the shift runs past midnight, mark it as overnight.';
  }
  return null;
}
