// Starts the visits area's two background scans — shift reminders and over-visit-length texts —
// every 5 minutes.
//
// Never double-runs: startVisitJobs() is a no-op after the first call, a scan that is still running
// when its next tick arrives is skipped, and every send is claimed through a primary-key insert first
// (shift_reminder_log, overtime_alert_log), so even two instances of the service cannot send twice.
// Off under NODE_ENV=test and when VISIT_JOBS_DISABLED=1.
import { scanShiftReminders } from './shiftReminders.ts'
import { scanOvertimeAlerts } from './overtimeAlerts.ts'

const FIVE_MIN = 5 * 60 * 1000
let started = false
const timers: ReturnType<typeof setInterval>[] = []

function every(name: string, firstDelayMs: number, fn: () => Promise<number>) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const n = await fn()
      if (n) console.log(`[${name}] ${n} sent`)
    } catch (e: any) {
      console.error(`[${name}] scan failed:`, e?.message)
    } finally {
      running = false
    }
  }
  timers.push(setTimeout(tick, firstDelayMs) as any)
  timers.push(setInterval(tick, FIVE_MIN))
}

export function startVisitJobs() {
  if (started) return
  if (process.env.NODE_ENV === 'test' || process.env.VISIT_JOBS_DISABLED === '1') return
  started = true
  every('shift-reminders', 60_000, () => scanShiftReminders())
  every('overtime-alerts', 90_000, () => scanOvertimeAlerts())
  console.log('[visit-jobs] shift reminders + overtime alerts every 5 min')
}

export function stopVisitJobs() {
  for (const t of timers.splice(0)) clearInterval(t as any)
  started = false
}
