// UTC-safe date formatting.
//
// Date-only values (project start, due dates, expected dates) are stored as
// UTC midnight (e.g. "2026-09-01T00:00:00.000Z"). Rendering those with
// `new Date(v).toLocaleDateString()` shifts any viewer west of UTC to the
// previous day ("8/31/2026"). Parsing the date part at LOCAL midnight avoids
// the shift. Values that carry a real time-of-day are rendered as-is.

export function formatDate(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else {
    const s = String(value);
    // Treat "YYYY-MM-DD" and midnight-UTC timestamps as date-only → local midnight.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s) || /T00:00:00(\.000)?Z?$/.test(s);
    d = dateOnly ? new Date(s.slice(0, 10) + 'T00:00:00') : new Date(s);
  }
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * An instant as YYYY-MM-DD on the calendar the person at the desk is looking at.
 *
 * The obvious `toISOString().slice(0, 10)` is the UTC date, and anywhere west of UTC that flips early:
 * at 7pm in Chicago it is already tomorrow in UTC. The Book opened on TOMORROW with the heading still
 * reading "Today", the enrol form pre-filled tomorrow, and a visit logged in the evening was dated the
 * next day. Evening is exactly when a salon is still checking people out. (Salon T25 N2)
 */
export function toDayString(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today, on that same calendar. */
export const todayStr = (): string => toDayString();
