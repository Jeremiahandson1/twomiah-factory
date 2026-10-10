// T58 — "a visit dated tomorrow is still accepted."
//
// It was. T41 added the check with a 36-hour tolerance, and 36 hours includes tomorrow. The reasoning
// behind the window was sound — the date arrives as the browser's local day and the server read it in
// UTC, so a clinic in Auckland entering TODAY is already tomorrow in UTC — but a blanket day of slack
// buys every clinic a free tomorrow to pay for the few that need one.
//
// The rule is now a calendar-day comparison in the practice's own zone, so there is nothing left for
// the slack to paper over. This exercises the rule directly across zones, because the behaviour that
// matters is precisely the one that depends on where the practice is, and a test pinned to the
// server's zone would pass in CI and tell us nothing.
// The harness assembles a crm-vet sandbox and runs this from its root, so the template's own tree is
// at ./src — the same shape every other suite file uses.
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { visitDateError } = await import('./src/routes/visits.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

/** The calendar day it is right now, in a given zone — the same way the rule computes it. */
const dayIn = (tz: string, offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return p // en-CA gives YYYY-MM-DD
}

const ZONES = ['Pacific/Auckland', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'UTC']

for (const tz of ZONES) {
  const today = dayIn(tz), tomorrow = dayIn(tz, 1), yesterday = dayIn(tz, -1)

  // The report, in every zone: tomorrow is not a day a visit can have happened on.
  const t = visitDateError(tomorrow, tz)
  check(`${tz}: a visit dated tomorrow (${tomorrow}) is refused`, !!t, t)
  if (t) check(`${tz}: …and the refusal says what to do instead`, /appointment/i.test(t), t)

  // And the thing the 36 hours existed to protect: entering TODAY must always work.
  check(`${tz}: today (${today}) is accepted`, visitDateError(today, tz) === null, visitDateError(today, tz))
  check(`${tz}: yesterday (${yesterday}) is accepted`, visitDateError(yesterday, tz) === null, visitDateError(yesterday, tz))
}

// The original report that put the check there at all — a mistyped year.
check('a visit dated 2027 is refused', !!visitDateError('2027-03-04', 'America/New_York'))

// Blank is not an error: the column defaults to now() and the form may legitimately omit it.
check('an empty date is not an error', visitDateError('', 'UTC') === null)
check('a missing date is not an error', visitDateError(undefined, 'UTC') === null)
check('a null date is not an error', visitDateError(null, 'UTC') === null)

// Nonsense is still caught, and says so differently.
const junk = visitDateError('not a date', 'UTC')
check('junk is refused', !!junk && /not a date/i.test(junk), junk)

/**
 * A TIMESTAMP IS JUDGED AS AN INSTANT, NOT AS A DAY — and the T41 case is why.
 *
 * T41 put a clinic whose clock runs ahead of the server deliberately in scope: the instant lands a
 * few hours in the future and must still save. My first version of this rule compared calendar days
 * for timestamps too, which refused that — and made the answer depend on the time of day the suite
 * ran, fine at 2pm and refused at 11pm. That flakiness hid a real defect earlier in this campaign,
 * so these are expressed as offsets from NOW and are deterministic at every hour.
 */
/*
 * PINNED, NOT OFFSET FROM THE REAL CLOCK. (T63)
 *
 * These were offsets from Date.now() and asserted the T58 skew window ("6 hours ahead is accepted"). T59 replaced
 * that window with the practice's calendar day — the owner's 11:24pm case — so "6 hours ahead" is today at 2pm and
 * tomorrow at 11pm, and this went red every evening (caught at 23:08Z while the code was right). visitDateError
 * takes `now`; every case below passes it, so the rule is checked on BOTH sides of midnight at any hour the suite runs.
 */
const NOON_ET = new Date('2026-10-09T16:00:00Z')          // 12:00 Oct 9 in New York, 16:00 Oct 9 UTC
const LATE_ET = new Date('2026-10-10T03:24:00Z')          // 11:24pm Oct 9 in New York — T59's moment
const at = (now: Date, n: number) => new Date(now.getTime() + n * 3_600_000).toISOString()
check('midday: a timestamp 6 hours ahead is accepted — still today where the practice is (a clock ahead of the server)',
  visitDateError(at(NOON_ET, 6), 'America/New_York', NOON_ET) === null, visitDateError(at(NOON_ET, 6), 'America/New_York', NOON_ET))
check('…and one 2 hours ahead, in a UTC practice', visitDateError(at(NOON_ET, 2), 'UTC', NOON_ET) === null, visitDateError(at(NOON_ET, 2), 'UTC', NOON_ET))
check('…and one in the past, obviously', visitDateError(at(NOON_ET, -30), 'UTC', NOON_ET) === null)
check('11:24pm: 49 minutes ahead is after the practice\'s midnight — refused (T59)',
  visitDateError(at(LATE_ET, 49 / 60), 'America/New_York', LATE_ET) !== null, visitDateError(at(LATE_ET, 49 / 60), 'America/New_York', LATE_ET))
check('…while 30 minutes ahead is still tonight — accepted',
  visitDateError(at(LATE_ET, 0.5), 'America/New_York', LATE_ET) === null, visitDateError(at(LATE_ET, 0.5), 'America/New_York', LATE_ET))
check('a timestamp a full day ahead is refused',
  visitDateError(at(NOON_ET, 25), 'America/New_York', NOON_ET) !== null, visitDateError(at(NOON_ET, 25), 'America/New_York', NOON_ET))
check('…and so is one a week ahead', visitDateError(at(NOON_ET, 24 * 7), 'UTC', NOON_ET) !== null)

// An unknown zone must not throw or silently accept everything — it falls back, and the rule holds.
// A DATE two days out, so this is about the zone fallback and not about the skew window.
check('an invalid zone falls back rather than throwing', visitDateError(dayIn('UTC', 2), 'Mars/Olympus') !== null,
  visitDateError(dayIn('UTC', 2), 'Mars/Olympus'))

// No zone at all is the old call shape — every existing caller must keep working.
check('called with no zone, a far-future date is still refused', visitDateError('2030-01-01') !== null)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
