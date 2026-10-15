// Date / time formatting, ported from the CVHC home care CRM's utils/datetime.js.
//
//  • DATE columns (no time of day — shift_date, service_date, *_date): the 'YYYY-MM-DD' part is taken
//    literally, so it NEVER shifts with the browser's timezone (new Date('2026-06-12') is UTC midnight
//    and shows 6/11 west of UTC — that is the bug this avoids).
//  • Instants (created_at, *_at, punches): rendered in the viewer's zone.
const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

export function formatDate(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const s = typeof value === 'string' ? value : (value instanceof Date ? value.toISOString() : String(value));
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', opts || DATE_OPTS);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', opts || DATE_OPTS);
}

export function formatDateTZ(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', opts || DATE_OPTS);
}

export function formatTime(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', opts || TIME_OPTS);
}

export function formatDateTime(value: any, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', opts || { ...DATE_OPTS, ...TIME_OPTS });
}
