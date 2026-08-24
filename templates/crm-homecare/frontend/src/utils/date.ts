// Date-only strings (YYYY-MM-DD) parsed via `new Date()` are treated as UTC
// midnight and then shown in local time, which renders a day early for any tenant
// west of UTC (M-01). These helpers parse date-only values at LOCAL noon so the
// calendar day never shifts, while leaving full timestamps untouched.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: any, options?: Intl.DateTimeFormatOptions, locale = 'en-US'): string {
  const d = parseDateSafe(value);
  if (!d) return '';
  return d.toLocaleDateString(locale, options);
}

// For <input type="date"> value binding — always YYYY-MM-DD in local terms.
export function formatDateForInput(value: any): string {
  const d = parseDateSafe(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
