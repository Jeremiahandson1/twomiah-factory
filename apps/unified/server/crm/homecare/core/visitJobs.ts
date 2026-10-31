// The visits area's two background scans — shift reminders and over-visit-length texts — every 5 minutes. Moved from
// templates/crm-homecare/backend/src/jobs/visitJobs.ts, where index.ts started them at boot; here nothing starts at
// import or in the factory: the home-care core's startJobs() calls start().
//
// Never double-runs: start() is a no-op after the first call, a scan still running when its next tick arrives is
// skipped, and every send is claimed through a unique-key insert first (shift_reminder_log, overtime_alert_log), so even
// two instances of the service cannot send twice. Off under NODE_ENV=test and when VISIT_JOBS_DISABLED=1.
import type { CrmDeps } from '../../deps.ts'

const FIVE_MIN = 5 * 60 * 1000

export function createVisitJobs(d: CrmDeps, deps: {
  reminders: { scanShiftReminders: () => Promise<number> }
  overtime: { scanOvertimeAlerts: () => Promise<number> }
  certReminders: { scanCertReminders: () => Promise<number> }
  /** Autopay's scan (item 3): optional, so a caller without it runs as before. */
  autopay?: { sweep: () => Promise<number> }
}) {
  let started = false
  const timers: ReturnType<typeof setTimeout>[] = []

  function every(name: string, firstDelayMs: number, fn: () => Promise<number>) {
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        const n = await fn()
        if (n) d.logger.info(`[${name}] ${n} sent`)
      } catch (e: any) {
        d.logger.error(`[${name}] scan failed`, { error: e?.message })
      } finally {
        running = false
      }
    }
    timers.push(setTimeout(tick, firstDelayMs))
    timers.push(setInterval(tick, FIVE_MIN))
  }

  function start() {
    if (started) return
    if (process.env.NODE_ENV === 'test' || process.env.VISIT_JOBS_DISABLED === '1') return
    started = true
    every('shift-reminders', 60_000, () => deps.reminders.scanShiftReminders())
    every('overtime-alerts', 90_000, () => deps.overtime.scanOvertimeAlerts())
    // Credential-expiry reminders: the claim rows make each stage send once a day's worth, however often this ticks.
    every('cert-reminders', 150_000, () => deps.certReminders.scanCertReminders())
    // Autopay: the safety net behind the charge on issue, and the retries after a declined card (claimed per try, so never twice).
    if (deps.autopay) every('autopay', 210_000, () => deps.autopay!.sweep())
    d.logger.info('[visit-jobs] shift reminders + overtime alerts + credential reminders every 5 min')
  }

  function stop() {
    for (const t of timers.splice(0)) { clearTimeout(t); clearInterval(t) }
    started = false
  }

  return { start, stop }
}
