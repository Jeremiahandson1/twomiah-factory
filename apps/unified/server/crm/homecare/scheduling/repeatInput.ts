// Reads "how often does this shift repeat" from a create / edit request (item 12). One place, so the create and the edit
// agree. `frequency` may be 'weekly' | 'biweekly' | 'monthly' | 'every_N_weeks'; `repeatEveryWeeks` (1..12) is the
// friendlier way to say the same and wins when both are sent. Monthly and every-3-or-more-weeks need the agency's
// `care_shift_repeats` feature (registered not ready); weekly and bi-weekly never do.
import type { CrmDeps } from '../../deps.ts'
import { everyNWeeks, isKnownFrequency, isNewRepeat } from '../core/repeats.ts'

export const SHIFT_REPEAT_FEATURE = 'care_shift_repeats'

export async function frequencyFromRequest(
  d: CrmDeps, companyId: string, b: any,
): Promise<{ frequency: string | undefined } | { error: string; code: string }> {
  let frequency: string | undefined = typeof b.frequency === 'string' && b.frequency.trim() ? b.frequency.trim().toLowerCase() : undefined
  if (b.repeatEveryWeeks !== undefined && b.repeatEveryWeeks !== null && b.repeatEveryWeeks !== '') {
    const f = everyNWeeks(b.repeatEveryWeeks)
    if (!f) return { error: 'Repeat every how many weeks? Pick a whole number from 1 to 12.', code: 'bad_repeat' }
    frequency = f
  }
  if (frequency === undefined) return { frequency }
  if (!isKnownFrequency(frequency)) return { error: `"${frequency}" is not a way a shift can repeat. Use weekly, every 2 to 12 weeks, or monthly.`, code: 'bad_repeat' }
  if (isNewRepeat(frequency) && !(await d.features.isFeatureEnabled(companyId, SHIFT_REPEAT_FEATURE))) {
    return { error: 'Monthly and every-few-weeks shifts are not switched on for this agency yet.', code: 'repeat_not_available' }
  }
  return { frequency }
}
