// Weekly regression: run the factory test matrix and shout if it breaks.
//
// The matrix runner has existed for a while and was only ever run by hand,
// which means template or generator breakage was found by a customer's deploy
// rather than by us. This runs the smoke matrix on a schedule.
//
// Deliberately generate-only and compose-off (the runner's defaults):
//   - no Render services are created, so a weekly regression costs no infra
//   - no Anthropic calls, so it cannot quietly drain the credits that real
//     customer composes depend on
// Both are opt-in flags on the runner for when a human wants the full thing.
//
// Every tenant the matrix creates is flagged is_test_tenant and hard-deleted by
// the runner itself; verified after a real run that the tenant table was back
// to exactly the live rows.

import { spawn } from 'child_process'
import path from 'path'
import { notifyProvisionFailure } from '../services/email'

const apiDir = path.resolve(import.meta.dir, '..', '..')

function runScript(script: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', script], {
      cwd: apiDir,
      env: process.env,
      shell: process.platform === 'win32',
    })
    let output = ''
    child.stdout.on('data', (d) => { const s = String(d); output += s; process.stdout.write(s) })
    child.stderr.on('data', (d) => { const s = String(d); output += s; process.stderr.write(s) })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
    child.on('error', (err) => resolve({ code: 1, output: output + '\n' + String(err) }))
  })
}

const runMatrix = () => runScript('scripts/test-factory-matrix.ts')

// The booking/deposit money path dies silently when webhook verification or
// endpoint registration regresses (it did — every Stripe webhook 500'd on Bun
// for months before 2026-08-21). This proves it live weekly: one throwaway
// salon tenant through the real pipeline, a test-card deposit charged, the
// auto-registered webhook flipping the booking, then hard-deleted.
// Deliberately gated: it needs deploy + test-Stripe credentials the matrix
// doesn't, and must never run with a live Stripe key (the script refuses).
function canRunBookingDeposit(): string | null {
  if (!process.env.RENDER_API_KEY) return 'RENDER_API_KEY missing'
  if (!process.env.GITHUB_TOKEN) return 'GITHUB_TOKEN missing'
  if (!(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) return 'STRIPE_SECRET_KEY missing or not a test key'
  return null
}

async function main() {
  console.log('[Regression] Factory matrix starting at', new Date().toISOString())
  const { code, output } = await runMatrix()

  // The runner prints its own summary; pull it out for the alert body.
  const summary = (output.match(/Pass:\s+\d+\/\d+[\s\S]{0,200}/) || [''])[0].trim()
  const failing = output
    .split('\n')
    .filter(l => l.includes('❌') || /\bFail:\s+[1-9]/.test(l))
    .slice(0, 20)
    .join('\n')

  let bkdepFailed = false
  let bkdepSummary = ''
  const skipReason = canRunBookingDeposit()
  if (skipReason) {
    console.log('[Regression] booking/deposit E2E SKIPPED —', skipReason)
  } else {
    console.log('[Regression] booking/deposit E2E starting')
    const bkdep = await runScript('scripts/test-booking-deposit-e2e.ts')
    bkdepFailed = bkdep.code !== 0
    bkdepSummary = (bkdep.output.match(/Pass:\s+\d+\/\d+[\s\S]{0,200}/) || [''])[0].trim()
    console.log('[Regression] booking/deposit E2E', bkdepFailed ? 'FAIL' : 'PASS', '—', bkdepSummary.split('\n')[0])
  }

  if (code === 0 && !bkdepFailed) {
    console.log('[Regression] PASS —', summary.split('\n')[0])
    return
  }

  console.error('[Regression] FAIL — alerting staff')
  // Staff-only: this is our regression, not something to tell a customer about.
  await notifyProvisionFailure(
    { name: 'Factory regression', email: undefined, slug: 'factory-matrix' } as any,
    'Weekly factory regression FAILED',
    (summary + '\n\n' + (bkdepFailed ? 'booking/deposit E2E FAILED\n' + bkdepSummary + '\n\n' : '') + failing).slice(0, 4000) || 'The run exited non-zero with no parsable summary.',
  ).catch((err) => console.error('[Regression] could not send alert:', err?.message))

  process.exit(1)
}

main()
