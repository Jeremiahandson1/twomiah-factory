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
 * Today on the viewer's own calendar, as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is today in UTC, which is tomorrow from 7pm in Chicago. The
 * analytics page built its date range that way, so west of UTC it asked the server for a window a day
 * out from the one the selector claimed — and the Unique Customers tile read 2 against an API that
 * answered 4 for the period the label named. The server already interprets these dates on the STORE's
 * clock (storeRange); it just has to be given the day a person would write down. (Dispensary T29 L2)
 */
export function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The calendar date at the STORE, not at whoever is looking.
 *
 * Every figure the server reports is bucketed on the shop's clock, so a screen that builds its date
 * range from the viewer's laptop asks for a different day than the one it is about to display. A
 * manager in Central looking at an Ohio store at 23:10 asked Analytics for 2026-09-27 while the
 * till and the compliance report had already rolled to the 28th: Today read $0.00 from 0 orders
 * beside a dashboard showing $718.75 from 9 sales. (Dispensary T42 M1)
 *
 * Falls back to the viewer's own calendar when the store has no usable zone — which is still better
 * than UTC, the bug this replaced (T29 L2).
 */
export function storeDay(timeZone?: string | null, d: Date = new Date()): string {
  if (!timeZone) return localDay(d);
  try {
    // en-CA renders as YYYY-MM-DD, which is the shape the API expects.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return localDay(d);
  }
}
