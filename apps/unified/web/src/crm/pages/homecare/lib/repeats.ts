// Frontend copy of server/crm/homecare/core/repeats.ts — keep identical. Which days a repeating shift happens on.
// 'weekly' | 'biweekly' | 'every_N_weeks' (N 3..12) | 'monthly' (the same weekday-of-the-month as the anchor; a 5th is the
// last one). Every calendar must use THIS, never its own arithmetic, so the screen agrees with payroll and the phone.
import { dayDiff, toYMD } from './biweekly';

export const MAX_EVERY_N_WEEKS = 12;

export type Repeat = { kind: 'weekly' } | { kind: 'every_n'; n: number } | { kind: 'monthly' };

export function parseFrequency(frequency: unknown): Repeat {
  const f = String(frequency ?? 'weekly').trim().toLowerCase();
  if (f === 'biweekly' || f === 'bi-weekly') return { kind: 'every_n', n: 2 };
  if (f === 'monthly') return { kind: 'monthly' };
  const m = f.match(/^every_(\d{1,2})_weeks$/);
  if (m && Number(m[1]) >= 2 && Number(m[1]) <= MAX_EVERY_N_WEEKS) return { kind: 'every_n', n: Number(m[1]) };
  return { kind: 'weekly' };
}

/** The `frequency` to send for "every N weeks": 1 weekly, 2 biweekly, 3..12 every_N_weeks. */
export function everyNWeeks(n: number): string {
  return n <= 1 ? 'weekly' : n === 2 ? 'biweekly' : `every_${n}_weeks`;
}

export const weekdayOrdinal = (ymd: string) => Math.ceil(Number(ymd.slice(8, 10)) / 7);
const daysInMonth = (ymd: string) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();

/** Does a repeating pattern happen on this date (weekday, effective and end dates are checked by the caller)? */
export function isRepeatOn(date: unknown, frequency: unknown, anchor: unknown): boolean {
  const day = toYMD(date);
  const a = toYMD(anchor);
  if (!day) return false;
  const r = parseFrequency(frequency);
  if (r.kind === 'weekly' || !a) return true;
  if (r.kind === 'every_n') {
    const weeks = Math.floor(dayDiff(a, day) / 7);
    return ((weeks % r.n) + r.n) % r.n === 0;
  }
  const want = weekdayOrdinal(a);
  if (weekdayOrdinal(day) === want) return true;
  return want === 5 && Number(day.slice(8, 10)) + 7 > daysInMonth(day);
}

/** How much of a week one occurrence stands for, for a "hours a week" estimate: 1 weekly, 1/2 biweekly, 1/N, ~1/4.3 monthly. */
export function weeklyShare(frequency: unknown): number {
  const r = parseFrequency(frequency);
  return r.kind === 'weekly' ? 1 : r.kind === 'every_n' ? 1 / r.n : 12 / 52;
}

/** Short label for a pill: "Weekly", "Every 3 wks", "Monthly". */
export function repeatPill(frequency: unknown): string {
  const r = parseFrequency(frequency);
  return r.kind === 'weekly' ? 'Recurring' : r.kind === 'monthly' ? 'Monthly' : r.n === 2 ? 'Bi-Weekly' : `Every ${r.n} wks`;
}

/** Plain-English: "every week", "every other week", "every 3 weeks", "monthly (2nd Tuesday)". */
export function describeRepeat(frequency: unknown, dayOfWeek?: unknown, anchor?: unknown): string {
  const r = parseFrequency(frequency);
  if (r.kind === 'weekly') return 'every week';
  if (r.kind === 'every_n') return r.n === 2 ? 'every other week' : `every ${r.n} weeks`;
  const a = toYMD(anchor);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ord = a ? weekdayOrdinal(a) : null;
  const nth = ord === 5 ? 'last' : ord === 1 ? '1st' : ord === 2 ? '2nd' : ord === 3 ? '3rd' : ord === 4 ? '4th' : null;
  const dow = dayOfWeek !== null && dayOfWeek !== undefined && dayOfWeek !== '' && Number.isInteger(Number(dayOfWeek)) ? names[Number(dayOfWeek)] : null;
  return nth && dow ? `monthly (${nth} ${dow})` : 'monthly';
}
