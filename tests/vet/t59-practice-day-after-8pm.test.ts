// The practice's day after 8pm ET. (T59, the owner's 11:23pm run)
//
//   "A visit at 10:24pm ET on Oct 8 produced INV-00178 dated Oct 9, with the line reading
//    'Veterinary visit - 10/9/2026'. It should be Oct 8."
//   "At 11:24pm ET on Oct 8, visits for 12:13am through 2:44am ET on Oct 9 were all accepted."
//
// Both are invisible in daytime — ET and UTC agree on the date — which is why both were passed as fixed.
// So this stands at the owner's exact moment instead of the real clock: 11:24pm ET on Oct 8 is
// 03:24 UTC on Oct 9. And a daytime control, so the rules are shown to hold at both hours.
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const { visitDateError, visitInvoiceDates } = await import('./src/routes/visits.ts')
const ET = 'America/New_York'
const NIGHT = new Date('2026-10-09T03:24:00Z') // 11:24pm ET, Oct 8
const NOON = new Date('2026-10-08T16:00:00Z')  // noon ET, Oct 8

console.log('\n══════════ a visit cannot be after the practice\'s midnight ══════════')
for (const [t, iso] of [['12:13am ET Oct 9', '2026-10-09T04:13:00Z'], ['1:30am ET Oct 9', '2026-10-09T05:30:00Z'], ['2:44am ET Oct 9', '2026-10-09T06:44:00Z']] as const) {
  check(`at 11:24pm ET, a visit at ${t} is REFUSED (it was accepted)`, !!visitDateError(iso, ET, NIGHT), visitDateError(iso, ET, NIGHT))
}
check('at 11:24pm ET, a visit at 11:00pm ET the same night is accepted', visitDateError('2026-10-09T03:00:00Z', ET, NIGHT) === null)
check('at 11:24pm ET, a visit at 11:50pm ET — later, but still Oct 8 — is accepted', visitDateError('2026-10-09T03:50:00Z', ET, NIGHT) === null)
check('at 11:24pm ET, the picked day Oct 9 is refused', !!visitDateError('2026-10-09', ET, NIGHT))
check('at 11:24pm ET, the picked day Oct 8 is accepted', visitDateError('2026-10-08', ET, NIGHT) === null)
check('daytime control: at noon ET, 11:00pm ET tonight is accepted', visitDateError('2026-10-09T03:00:00Z', ET, NOON) === null)
check('daytime control: at noon ET, 12:13am ET tomorrow is refused', !!visitDateError('2026-10-09T04:13:00Z', ET, NOON))
check('a mistyped year is still refused', !!visitDateError('2027-03-04', ET, NIGHT))

console.log('\n══════════ an invoice raised at 10:24pm ET is dated the practice\'s day ══════════')
{
  const at = new Date('2026-10-09T02:24:00Z') // 10:24pm ET, Oct 8 — the owner's INV-00178
  const fromInstant = visitInvoiceDates(new Date('2026-10-09T02:24:00Z'), ET, at)
  check('the issue date is Oct 8 (it was Oct 9)', fromInstant.issueDate.toISOString() === '2026-10-08T00:00:00.000Z', fromInstant.issueDate.toISOString())
  check('the line reads 10/8/2026 for a visit recorded at 10:24pm ET (it read 10/9/2026)', fromInstant.visitLabel === '10/8/2026', fromInstant.visitLabel)
  const fromPicked = visitInvoiceDates(new Date('2026-10-08T00:00:00.000Z'), ET, at)
  check('a PICKED day Oct 8 reads 10/8/2026 — not walked back to 10/7 by the zone', fromPicked.visitLabel === '10/8/2026', fromPicked.visitLabel)
  const noon = visitInvoiceDates(new Date('2026-10-08T16:00:00Z'), ET, NOON)
  check('daytime control: noon ET reads 10/8/2026, issued Oct 8', noon.visitLabel === '10/8/2026' && noon.issueDate.toISOString() === '2026-10-08T00:00:00.000Z', noon)
  check('no visit date → no date on the line', visitInvoiceDates(null, ET, at).visitLabel === '')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
