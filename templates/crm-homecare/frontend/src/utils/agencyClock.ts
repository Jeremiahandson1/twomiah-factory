// The agency's clock for the client and family portals.
//
// Visit times in the portals are the agency's wall-clock times (a 9:00 visit is 9:00 where the
// agency is). An INSTANT — a vitals reading, a clock-in, a message, a signature — printed with the
// browser's zone disagreed with them: a reading taken at 11:10 AM Central showed "4:10 PM" in a
// browser on UTC (Run 4). The portals therefore print instants in the agency's zone, which the
// server names (GET /api/portal/me agency_timezone, GET /api/family-portal/portal/client timezone).
// Until it has answered (or if it never does) the browser's zone is used.

let zone: string | undefined;

const valid = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** Called once by each portal when the server names the agency's zone. */
export function setAgencyTimezone(tz: unknown): void {
  if (valid(tz)) zone = tz;
}

export function agencyTimezone(): string | undefined {
  return zone;
}

const asDate = (value: unknown): Date | null => {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as any);
  return isNaN(d.getTime()) ? null : d;
};

/** An instant as date + time on the agency's clock, e.g. "Oct 16, 11:10 AM". */
export function formatAgencyDateTime(value: unknown, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }): string {
  const d = asDate(value);
  return d ? d.toLocaleString('en-US', { ...opts, timeZone: zone }) : '';
}

/** An instant's calendar day on the agency's clock, e.g. "Oct 16, 2026". */
export function formatAgencyDate(value: unknown, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  const d = asDate(value);
  return d ? d.toLocaleDateString('en-US', { ...opts, timeZone: zone }) : '';
}
