// The agency's clock — for the office, the caregivers and the client and family portals.
//
// Visit times in the portals are the agency's wall-clock times (a 9:00 visit is 9:00 where the
// agency is). An INSTANT — a vitals reading, a clock-in, a message, a signature — printed with the
// browser's zone disagreed with them: a reading taken at 11:10 AM Central showed "4:10 PM" in a
// browser on UTC (Run 4). The portals therefore print instants in the agency's zone, which the
// server names (GET /api/portal/me agency_timezone, GET /api/family-portal/portal/client timezone). The
// office and caregiver screens learn it at sign-in (company.effectiveTimezone, contexts/AuthContext.tsx)
// and print through these helpers and utils/datetime.ts — never a bare toLocaleString on an instant.
// Until it has answered (or if it never does) the browser's zone is used.

import { zoneMoment, zoneWall } from '@twomiah/tenant-ui/src/time/companyClock';

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

// A typed date and time on a homecare form is the AGENCY's wall clock, and so is what such a form shows for a stored
// moment — the same zone the screens print in (2026-10-23: they read and wrote the browser's). The zone math is the one
// shared implementation (tenant-ui time/companyClock.ts zoneMoment / zoneWall).

/** The instant the agency's wall clock reads `hhmm` (HH:MM) on `ymd` (YYYY-MM-DD). */
export function agencyMoment(ymd: string, hhmm = '00:00'): Date {
  return zoneMoment(ymd, hhmm, zone);
}
/** A moment's wall date and time on the agency's clock: { date, time }. */
export function agencyWall(value: unknown = new Date()): { date: string; time: string } {
  return zoneWall(value, zone);
}
/** A moment as a datetime-local value (YYYY-MM-DDTHH:MM) on the agency's clock, and back. */
export function agencyLocalInput(value: unknown = new Date()): string {
  const w = zoneWall(value, zone);
  return w.date ? `${w.date}T${w.time}` : '';
}
export function agencyFromLocalInput(value: string): Date {
  const [day, time] = String(value || '').split('T');
  return zoneMoment(day, (time || '').slice(0, 5), zone);
}
/** Today on the agency's calendar, YYYY-MM-DD — the day its visits, shifts and forms are counted on (not the browser's). */
export function agencyToday(): string {
  return zoneWall(new Date(), zone).date;
}
/** Today's weekday on the agency's calendar, 0 = Sunday. */
export function agencyWeekday(): number {
  const [y, m, d] = agencyToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Today on the agency's calendar as a Date at local midnight — for calendar arithmetic (week starts, month grids, the
 *  days before), whose keys are read back with the browser-local getters. `new Date()` there was the browser's today. */
export function agencyTodayDate(): Date {
  const [y, m, d] = agencyToday().split('-').map(Number);
  return new Date(y, m - 1, d);
}
/** Has a calendar day (YYYY-MM-DD…) begun on the agency's calendar? — an expiry or due day reached, by the agency's
 *  midnight, not the browser's (`parseLocalDate(day) < new Date()`). */
export function agencyDayHasBegun(value: unknown): boolean {
  const day = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= agencyToday();
}
/** Whole days from the agency's today to a calendar day (0 on the day itself, negative once it has passed). */
export function agencyDaysUntil(value: unknown): number {
  const day = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${agencyToday()}T00:00:00Z`)) / 86_400_000);
}
