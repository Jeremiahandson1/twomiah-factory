// Date / time formatting, ported from the CVHC home care CRM's utils/datetime.js.
//
//  • DATE columns (no time of day — shift_date, service_date, *_date): read as the local calendar
//    day through utils/date.ts#parseLocalDate, so they NEVER shift with the browser's timezone
//    (new Date('2026-06-12') is UTC midnight and shows 6/11 west of UTC — that is the bug this avoids).
//  • Instants (created_at, *_at, punches): rendered in the viewer's zone.
import { parseLocalDate } from './date';

const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

export function formatDate(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = parseLocalDate(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', opts || DATE_OPTS);
}

export function formatDateTZ(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', opts || DATE_OPTS);
}

// A bare time of day ('09:30', '09:30:00' — TIME columns, shift start/end) as "9:30 AM": no
// seconds, no date. new Date('09:30:00') is invalid, so callers used to print the raw string
// ("09:30:00 - 11:30:00", Run 3 Report Miss).
const CLOCK_ONLY = /^(\d{1,2}):(\d{2})(:\d{2}(\.\d+)?)?$/;

export function formatTime(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const m = typeof value === 'string' ? value.match(CLOCK_ONLY) : null;
  if (m) {
    const h = Number(m[1]);
    if (h > 23 || Number(m[2]) > 59) return '';
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', opts || TIME_OPTS);
}

export function formatDateTime(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', opts || { ...DATE_OPTS, ...TIME_OPTS });
}
