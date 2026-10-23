import { whenDate } from '@twomiah/tenant-ui/src/time/companyClock'
// UTC-safe date formatting.
//
// Date-only values (project start, due dates, expected dates) are stored as
// UTC midnight (e.g. "2026-09-01T00:00:00.000Z"). Rendering those with
// `new Date(v).toLocaleDateString()` shifts any viewer west of UTC to the
// previous day ("8/31/2026"). Parsing the date part at LOCAL midnight avoids
// the shift. Values that carry a real time-of-day are rendered as-is.

export function formatDate(value?: string | number | Date | null): string {
  // A calendar day (YYYY-MM-DD or midnight UTC) as the day it names; a moment on the company's clock, not the reader's
  // (time/companyClock.ts — the one rule every screen prints a stored time by).
  return whenDate(value)
}
