// Calendar days and the ONE way to turn a maybe-date-only value into a Date.
//
// A calendar day ("2026-10-21": shift_date, service_date, start_date, a date column the API sends
// as text) handed to `new Date(...)` is read as UTC midnight, and every viewer west of UTC sees the
// PREVIOUS day ("Tue, Oct 20" for a Wednesday shift; Run 3 HIGH 1). Postgres DATE columns that come
// back through the driver as a Date serialise as UTC midnight ("2026-10-21T00:00:00.000Z") and have
// the same problem. parseLocalDate reads both as LOCAL midnight of that day. Anything carrying a
// real time of day is an instant and is parsed as-is.
//
// scripts/check-homecare-local-dates.ts forbids `new Date(<a date-named value>)` and
// `new Date(x).toLocaleDateString(...)` in the home care frontend: use these instead.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/;

/** True when the string names a calendar day rather than an instant. */
export function isDateOnly(value: unknown): boolean {
  const s = String(value ?? '');
  return DATE_ONLY.test(s) || UTC_MIDNIGHT.test(s);
}

/**
 * A Date for `value`. A calendar day ('YYYY-MM-DD', or a UTC-midnight DATE column) becomes local
 * midnight of THAT day; a Date is copied; anything else is parsed as an instant. Invalid → an
 * invalid Date (check with isNaN(d.getTime())).
 */
export function parseLocalDate(value: string | number | Date | null | undefined): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (value === null || value === undefined || value === '') return new Date(NaN);
  const s = String(value);
  if (isDateOnly(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

/** The local calendar day of a Date (or a parsed value) as 'YYYY-MM-DD'. */
export function toLocalYMD(value: string | number | Date | null | undefined): string {
  const d = parseLocalDate(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A value as a calendar day for display. `opts` as toLocaleDateString's (default: the browser's short form). */
export function formatDate(value?: string | number | Date | null, opts?: Intl.DateTimeFormatOptions): string {
  if (value === null || value === undefined || value === '') return '';
  const d = parseLocalDate(value);
  if (isNaN(d.getTime())) return '';
  return opts ? d.toLocaleDateString('en-US', opts) : d.toLocaleDateString();
}

// Format a date value as "YYYY-MM-DD" for an <input type="date"> value (the local calendar day).
export function formatDateForInput(value?: string | number | Date | null): string {
  return toLocalYMD(value);
}
