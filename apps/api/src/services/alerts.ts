// The one path a Factory failure takes to the owner's inbox.
//
// Most customer-facing failures were a console.error line that nobody reads. They come here instead:
//   raiseAlert(key, ...)  the failure happened (again)
//   clearAlert(key)       the same thing just worked — the next failure is news again
//
// The rule is the health monitor's (services/healthMonitor.ts): alert on the TRANSITION into broken, then at most
// one reminder a day while it stays broken. An alert that fires every time gets muted, and a muted alert is no alert.
//   - first failure for a key        → email now
//   - the same key again, < 24h on   → nothing (a burst of one error is one email)
//   - the same key again, ≥ 24h on   → one "still broken" reminder, with how many times it has happened
//   - clearAlert(key)                → forgotten; the next failure emails at once
// A global ceiling (MAX_PER_HOUR) keeps a bad day of DIFFERENT failures from becoming a flood; what it holds back is
// counted into the next email that does go out.
//
// State is in this process's memory (no new table, no outside service). A restart — every deploy — forgets it, so
// a failure that is still happening alerts once more after one. That is the cheaper side to err on.
//
// raiseAlert never throws and never blocks a caller on the customer's path: call it, don't await it.

export const REMINDER_MS = 24 * 60 * 60 * 1000
export const MAX_PER_HOUR = 10
const HOUR_MS = 60 * 60 * 1000
const FORGET_MS = 7 * 24 * 60 * 60 * 1000
const MAX_KEYS = 500

interface AlertState { firstAt: number; lastSentAt: number | null; lastSeenAt: number; count: number; sentCount: number }

export type AlertOutcome = 'sent' | 'reminded' | 'repeat' | 'held' | 'unsent'

export interface RaiseInput {
  /** What is broken, stable across occurrences: 'route:signup', 'deploy-stalled:<tenantId>'. One email per key. */
  key: string
  /** Short plain English, what broke: "New signups are failing". No business name — that goes in `business`. */
  what: string
  /** Which business it hit, when it hit one. */
  business?: string | null
  /** The error / context for whoever opens the email. */
  detail?: string
  /** The tenant, when there is one. */
  tenantId?: string | null
}

type Send = (subject: string, detail: string, tenantId: string | null) => Promise<boolean>

const states = new Map<string, AlertState>()
const sentAt: number[] = []
let held = 0
let sendHook: Send | null = null
let clock: () => number = () => Date.now()

/** Tests: swap the mail sender and the clock. Pass nothing to restore. */
export function setAlertHooks(h: { send?: Send; now?: () => number } = {}): void {
  sendHook = h.send ?? null
  clock = h.now ?? (() => Date.now())
}

/** Tests: forget everything. */
export function resetAlerts(): void {
  states.clear()
  sentAt.length = 0
  held = 0
}

/** The keys currently alerting (for tests and the report). */
export function activeAlertKeys(): string[] {
  return [...states.keys()]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function deliver(subject: string, detail: string, tenantId: string | null): Promise<boolean> {
  if (sendHook) return sendHook(subject, detail, tenantId)
  // Under `bun test` NODE_ENV is 'test': a test that reaches a failure path must never send real mail.
  if (process.env.NODE_ENV === 'test') return false
  const { notifyStaff } = await import('./email')
  return notifyStaff(subject, detail, tenantId)
}

function prune(now: number): void {
  if (states.size < MAX_KEYS) return
  for (const [k, s] of states) if (now - s.lastSeenAt > FORGET_MS) states.delete(k)
  // Still full of live keys: drop the oldest-seen rather than grow without bound.
  while (states.size >= MAX_KEYS) {
    const oldest = [...states.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0]
    if (!oldest) break
    states.delete(oldest[0])
  }
}

export async function raiseAlert(input: RaiseInput): Promise<AlertOutcome> {
  try {
    const now = clock()
    let s = states.get(input.key)
    if (!s) {
      prune(now)
      s = { firstAt: now, lastSentAt: null, lastSeenAt: now, count: 0, sentCount: 0 }
      states.set(input.key, s)
    }
    s.count++
    s.lastSeenAt = now

    const reminder = s.lastSentAt !== null
    if (reminder && now - (s.lastSentAt as number) < REMINDER_MS) return 'repeat'

    while (sentAt.length && now - sentAt[0] >= HOUR_MS) sentAt.shift()
    if (sentAt.length >= MAX_PER_HOUR) { held++; return 'held' }

    const where = input.business ? ' — ' + input.business : ''
    const subject = (reminder ? 'Still broken: ' : '⚠ ') + input.what + where
    const lines: string[] = []
    lines.push('<strong>' + esc(input.what) + '</strong>' + (input.business ? ' — ' + esc(input.business) : '') + '.')
    if (input.detail) lines.push('What the Factory saw: <code>' + esc(input.detail.slice(0, 600)) + '</code>')
    if (reminder) lines.push('It has been failing since ' + new Date(s.firstAt).toISOString() + ' — ' + s.count + ' time(s) so far. You get one reminder a day until it works again.')
    else lines.push('You will not be emailed again about this until it has worked once in between, or in a day if it keeps failing.')
    const heldNow = held
    if (heldNow) { lines.push(heldNow + ' other alert(s) were held back in the last hour to avoid a flood — check the logs.'); held = 0 }

    // Claim the send BEFORE the mail goes out: a burst of the same error arrives while the first email is still being
    // sent, and each of those must see "already told".
    const before = { lastSentAt: s.lastSentAt, sentCount: s.sentCount }
    s.lastSentAt = now
    s.sentCount++
    sentAt.push(now)
    let ok = false
    try { ok = await deliver(subject, lines.join('</p><p>'), input.tenantId ?? null) } catch { ok = false }
    if (!ok) {
      // Not sent: forget the claim, so the next occurrence tries again, and give the held count back.
      s.lastSentAt = before.lastSentAt; s.sentCount = before.sentCount
      const i = sentAt.lastIndexOf(now); if (i >= 0) sentAt.splice(i, 1)
      held += heldNow
      return 'unsent'
    }
    return reminder ? 'reminded' : 'sent'
  } catch (e: any) {
    console.warn('[Alerts] could not raise', input.key + ':', e?.message || e)
    return 'unsent'
  }
}

/** The thing worked. Forget it, so its next failure is a fresh alert. `key` is exact; `{ prefix }` clears a family. */
export function clearAlert(key: string | { prefix: string }): void {
  if (typeof key === 'string') { states.delete(key); return }
  for (const k of [...states.keys()]) if (k.startsWith(key.prefix)) states.delete(k)
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

export type AiProblem = 'credit' | 'auth' | 'other'

/** Is this Anthropic error the account being out of credit (or the key being refused) — not a one-off bad answer? */
export function aiProblem(err: unknown): AiProblem {
  const e = err as any
  const msg = String(e?.message || e || '') + ' ' + String(e?.error?.error?.message || '')
  if (/credit balance is too low|purchase credits|plans\s*&\s*billing|insufficient (?:credit|funds)/i.test(msg)) return 'credit'
  if (e?.status === 401 || e?.status === 403 || /invalid x-api-key|authentication_error|ANTHROPIC_API_KEY not configured/i.test(msg)) return 'auth'
  return 'other'
}

/** Raises the account-level alert for an Anthropic credit/key problem; false when it was some other error. */
export function raiseIfAiAccountProblem(err: unknown, business?: string | null, tenantId?: string | null): boolean {
  const p = aiProblem(err)
  if (p === 'other') return false
  const detail = String((err as any)?.message || err)
  if (p === 'credit') void raiseAlert({ key: 'ai:credit', what: 'The AI site builder is out of Anthropic credit — new sites fall back to the template site', business, detail, tenantId })
  else void raiseAlert({ key: 'ai:auth', what: 'The AI site builder cannot sign in to Anthropic (key missing or refused) — new sites fall back to the template site', business, detail, tenantId })
  return true
}
