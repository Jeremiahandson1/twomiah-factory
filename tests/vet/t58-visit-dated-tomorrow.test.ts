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

// A full timestamp is resolved to the day it falls on in the practice's zone, not the server's.
// 2026-10-07T02:00Z is still the 6th in New York, so a New York practice may record it.
check('a timestamp that is tomorrow in UTC but today in New York is accepted',
  visitDateError(`${dayIn('America/New_York')}T23:30:00-04:00`, 'America/New_York') === null,
  visitDateError(`${dayIn('America/New_York')}T23:30:00-04:00`, 'America/New_York'))

// An unknown zone must not throw or silently accept everything — it falls back, and the rule holds.
check('an invalid zone falls back rather than throwing', visitDateError(dayIn('UTC', 2), 'Mars/Olympus') !== null,
  visitDateError(dayIn('UTC', 2), 'Mars/Olympus'))

// No zone at all is the old call shape — every existing caller must keep working.
check('called with no zone, a far-future date is still refused', visitDateError('2030-01-01') !== null)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
