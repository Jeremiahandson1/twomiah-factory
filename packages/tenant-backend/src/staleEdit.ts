/**
 * "THIS CHANGED SINCE YOU OPENED IT" (final live pass 11/14, contractor B6).
 *
 * Two tabs open on the same quote (or job): tab 1 saves, then tab 2 saves what it loaded before that, and tab 1's change
 * was gone with no word to anyone. An edit form now sends back the `updatedAt` it opened the record with, as
 * `expectedUpdatedAt`; when the record has been saved since, the save is refused with 409 and a sentence, and the form
 * stays open with what was typed.
 *
 * Optional on purpose: only a form that read the whole record sends it. A quick change of one field (a drag on the
 * schedule, a status box) says nothing and saves as before.
 */

export const CHANGED_SINCE_OPENED = 'changed_since_opened'

/** The time the form opened the record with, or null when it sent none (or something that is not a time). */
export function expectedUpdatedAt(raw: unknown): number | null {
  const v = (raw as any)?.expectedUpdatedAt
  if (typeof v !== 'string' || !v) return null
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Saved since the form opened it: the stored time is not the one the form was given. */
export function changedSince(expected: number | null, stored: unknown): boolean {
  if (expected === null) return false
  const ms = stored instanceof Date ? stored.getTime() : stored ? new Date(String(stored)).getTime() : NaN
  return !Number.isFinite(ms) || ms !== expected
}

/** The refusal: what happened and what to do, in words. */
export function changedSinceOpened(word: string) {
  return {
    error: `Someone saved this ${word} after you opened it. Copy anything you typed, reload to see their changes, then make yours again.`,
    code: CHANGED_SINCE_OPENED,
  }
}

/** Thrown inside a save's transaction to undo it when the row moved under the form. */
export class ChangedSinceOpened extends Error {
  constructor() { super(CHANGED_SINCE_OPENED) }
}
