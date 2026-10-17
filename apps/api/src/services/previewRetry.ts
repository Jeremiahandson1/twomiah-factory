// What the preview sweep does with one intake still waiting on its website preview
// (routes/factory/intake.ts /internal/preview-sweep). Pure, so the rule is testable without a database.
//
// The intake fires the composer on a timer inside the Factory process; a deploy, a crash or a failed
// composer call used to lose that preview for good. Each attempt is written on the row
// (intake_data.compose), and this decides from it:
//   · an attempt that began before this process booted is dead — the process that ran it is gone — so go now;
//   · one that began in this process and is not running any more failed here — wait RETRY_AFTER_MS;
//   · after MAX_COMPOSE_ATTEMPTS, stop and tell staff once.
export const MAX_COMPOSE_ATTEMPTS = 3
export const RETRY_AFTER_MS = 10 * 60_000

export interface ComposeState { attempts?: number; lastAttemptAt?: string; lastError?: string; gaveUpAt?: string }
export type RetryDecision = 'compose' | 'wait' | 'give_up' | 'given_up'

export function previewRetryDecision(
  row: { created_at: string; intake_data?: any },
  opts: { now: number; bootedAt: number; composingHere: boolean },
): RetryDecision {
  if (opts.composingHere) return 'wait'
  const st = (row.intake_data?.compose || {}) as ComposeState
  // A row from before attempts were recorded had its one attempt at intake.
  const attempts = Number(st.attempts) || 1
  const last = Date.parse(st.lastAttemptAt || row.created_at)
  const lastIsOver = last < opts.bootedAt || opts.now - last > RETRY_AFTER_MS
  if (attempts >= MAX_COMPOSE_ATTEMPTS) {
    if (st.gaveUpAt) return 'given_up'
    // The last try can die with the process before its own catch runs; the sweep then says so instead.
    return lastIsOver ? 'give_up' : 'wait'
  }
  return lastIsOver ? 'compose' : 'wait'
}
