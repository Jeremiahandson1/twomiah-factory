// Frontend copy of backend/src/helpers/biweekly.ts#isBiweeklyOn — keep identical.
//
// "Is this bi-weekly shift on this date?" Whole calendar days from the anchor, floored to weeks,
// even = on. Every calendar must use THIS, never its own ms-and-Math.round arithmetic (a rounding
// difference once painted a caregiver on the opposite fortnight from the one payroll paid).
const MS_DAY = 86400000;

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

/** Any date-ish value → 'YYYY-MM-DD'. API strings are calendar dates; Date objects use local getters. */
export function toYMD(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export function dayDiff(aYMD: string, bYMD: string): number {
  return Math.round((Date.UTC(...parts(bYMD)) - Date.UTC(...parts(aYMD))) / MS_DAY);
}

export function isBiweeklyOn(date: any, anchor: any): boolean {
  const a = toYMD(anchor);
  if (!a) return true;
  const weeks = Math.floor(dayDiff(a, toYMD(date)!) / 7);
  return ((weeks % 2) + 2) % 2 === 0;
}
