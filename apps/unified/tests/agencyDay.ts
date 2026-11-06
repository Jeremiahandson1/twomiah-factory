// The company's calendar day for tests — use this, never `new Date().toISOString().slice(0, 10)`, which is UTC's day and is a day
// ahead every US evening (tests/tests-use-agency-day.test.ts holds the rule). `offset` is whole days from today on that clock.
export function agencyDay(timeZone = 'America/Chicago', offset = 0, from: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(from.getTime() + offset * 86_400_000))
}
