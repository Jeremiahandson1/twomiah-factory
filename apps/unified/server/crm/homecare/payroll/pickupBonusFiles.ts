// An hours file (ADP, Paychex, Gusto) carries hours, not a flat bonus. A pay run with pickup bonuses (care_pickup_rewards) must not go out
// in one of them with the bonus silently left off — that would underpay the caregiver — so the file is refused in plain words, naming who
// and how much, UNLESS the file carries the bonus under the provider's bonus code (row 21: the ADP bonus earnings code, the Paychex
// bonus pay component, Gusto's Bonus column). The CSV export and QuickBooks file carry the bonus as its own line.
export function bonusNotInFile(people: { firstName: string | null; lastName: string | null; pickupBonus?: number | string | null; bonusPay?: number | null }[], file: string, carried = false): string | null {
  if (carried) return null
  const owed = people.map((p) => ({ p, amount: Number(p.pickupBonus ?? p.bonusPay ?? 0) })).filter((x) => x.amount > 0)
  if (!owed.length) return null
  const list = owed.map((x) => `${`${x.p.firstName ?? ''} ${x.p.lastName ?? ''}`.trim()} $${x.amount.toFixed(2)}`).join(', ')
  return `These dates include open-shift pickup bonuses (${list}) that the ${file} cannot carry, so it was not made — an underpaid caregiver is worse than a late file. Set the provider's bonus code in Pay rules so the file carries it, use the payroll CSV or the QuickBooks file, which list each bonus on its own line, or pay the bonus in your payroll provider and run the file for dates without one.`
}
