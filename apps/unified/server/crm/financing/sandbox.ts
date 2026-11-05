// The sandbox harness for the lender (Wisetack): run by a PERSON who holds sandbox keys, never by the test suite and never
// against production. It exercises the adapter in lender.ts — the one place that guesses the partner API (SPEC-PENDING) —
// and reports, check by check, which guesses the real sandbox confirmed and which it did not, so lender.ts can be corrected.
//
//   WISETACK_SANDBOX_URL         the sandbox API address Wisetack gave you
//   WISETACK_SANDBOX_KEY         the sandbox partner key
//   WISETACK_SANDBOX_MERCHANT_ID a sandbox merchant id
//   WISETACK_SANDBOX_CONFIRM     must be exactly "sandbox": you say these are sandbox keys, not live ones
//   WISETACK_SANDBOX_WEBHOOK_SECRET + WISETACK_SANDBOX_WEBHOOK_SAMPLE   (optional) the signing secret and the path to a
//                                JSON file { "signature": "<header value>", "body": "<raw body, exactly as received>" }
//                                saved from a webhook the sandbox sent you
//
// It reads ONLY these names: the production WISETACK_API_URL / WISETACK_API_KEY are never read, so a stray live key in the
// environment cannot be used. With any of the first four missing it does nothing and calls nothing.
import { readFileSync } from 'node:fs'
import { wisetack } from './lender.ts'

export interface Check { name: string; ok: boolean; detail: string }
export interface SandboxReport { ran: boolean; skipped?: string; checks: Check[] }

const NEEDED = ['WISETACK_SANDBOX_URL', 'WISETACK_SANDBOX_KEY', 'WISETACK_SANDBOX_MERCHANT_ID'] as const

export async function runSandbox(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
  readSample: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): Promise<SandboxReport> {
  const missing = NEEDED.filter((k) => !String(env[k] ?? '').trim())
  if (missing.length) return { ran: false, skipped: `No sandbox run: set ${missing.join(', ')} (keys from your Wisetack partner account). Nothing was called.`, checks: [] }
  if (env.WISETACK_SANDBOX_CONFIRM !== 'sandbox') return { ran: false, skipped: 'No sandbox run: set WISETACK_SANDBOX_CONFIRM=sandbox to say these are sandbox keys, not live ones. Nothing was called.', checks: [] }
  const url = String(env.WISETACK_SANDBOX_URL).trim().replace(/\/+$/, '')
  if (!/^https:\/\//.test(url)) return { ran: false, skipped: 'No sandbox run: the sandbox address must start with https://. Nothing was called.', checks: [] }

  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  const api = { url, key: String(env.WISETACK_SANDBOX_KEY).trim() }

  let transactionId = ''
  try {
    const opened = await wisetack.createTransaction(api, {
      merchantId: String(env.WISETACK_SANDBOX_MERCHANT_ID).trim(), amount: 1000, reference: `sandbox:${Date.now()}`,
      callbackUrl: wisetack.callbackUrl('https://example.invalid'),
      customer: { firstName: 'Sandbox', lastName: 'Customer', email: 'sandbox@example.com', phone: null },
    }, fetcher)
    transactionId = opened.transactionId
    add('open an application', true, `transaction ${opened.transactionId}, status "${opened.status}", link ${new URL(opened.applyUrl).origin}/…`)
  } catch (e) {
    add('open an application', false, `${(e as Error).message} — correct createTransaction in lender.ts (address, authentication, request, response)`)
  }

  const samplePath = String(env.WISETACK_SANDBOX_WEBHOOK_SAMPLE ?? '').trim()
  const secret = String(env.WISETACK_SANDBOX_WEBHOOK_SECRET ?? '').trim()
  if (samplePath && secret) {
    try {
      const sample = JSON.parse(readSample(samplePath)) as { signature?: string; body?: string }
      const body = String(sample.body ?? '')
      const genuine = wisetack.verifyWebhook(body, sample.signature, secret)
      add('webhook signature', genuine, genuine ? 'the sample verifies under the scheme in lender.ts' : `the sample does not verify — correct SIGNATURE_HEADER (${wisetack.signatureHeader}) and verifyWisetackWebhook in lender.ts`)
      add('a tampered body is refused', !wisetack.verifyWebhook(body + ' ', sample.signature, secret), 'one added space must fail')
      let parsed: any = null
      try { parsed = JSON.parse(body) } catch { /* reported below */ }
      const ev = parsed ? wisetack.parseEvent(parsed) : { error: 'the sample body is not JSON' }
      add('webhook event body', !('error' in ev), 'error' in ev ? `${ev.error} — correct parseLenderEvent in lender.ts` : `event ${ev.eventId}: ${ev.rawStatus} → ${ev.status}`)
    } catch (e) { add('webhook sample', false, `could not read the sample: ${(e as Error).message}`) }
  } else {
    add('webhook signature', false, 'not run: the webhook secret and a saved webhook sample (a webhook the sandbox sent you, saved as { signature, body }) were not given — see the settings listed at the top of this file')
  }
  void transactionId
  return { ran: true, checks }
}

export function formatReport(r: SandboxReport): string {
  if (!r.ran) return r.skipped || 'No sandbox run.'
  return [...r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`), '', r.checks.every((c) => c.ok) ? 'The sandbox confirmed every guess checked.' : 'Some guesses were not confirmed: fix lender.ts, then run this again.'].join('\n')
}
