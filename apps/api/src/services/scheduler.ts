/**
 * In-process scheduler for Twomiah Bookings cron jobs.
 *
 * Avoids paying for separate Render cron services by piggy-backing on the
 * factory process that's already running 24/7. Calls the factory's existing
 * `/internal/*` HTTP endpoints on localhost so the auth + fan-out logic
 * stays identical to what an external scheduler would do.
 *
 * Tradeoff: if the factory restarts, the in-memory timer resets. For an
 * hourly reminder cron that's at most one missed tick (~1 hour) which is
 * acceptable for nudges; the daily jobs recalculate their next-fire time
 * on boot so they always fire on the configured schedule.
 *
 * Enable with ENABLE_BUILTIN_CRON=true on the factory's Render env. When
 * unset, this module is a no-op so it's safe to leave imported.
 */

import { raiseAlert, clearAlert } from './alerts'

const TZ_OFFSET_HOURS_FOR_DAILY = 0 // UTC — match the schedules in the runbook

interface JobConfig {
  name: string
  path: string
  schedule: 'hourly' | { dailyAtUtcHour: number } | { everyMinutes: number; firstAfterMinutes: number }
}

const JOBS: JobConfig[] = [
  { name: 'booking-reminders', path: '/api/v1/factory/internal/booking-reminders', schedule: 'hourly' },
  { name: 'booking-rebook-reminders', path: '/api/v1/factory/internal/booking-rebook-reminders', schedule: { dailyAtUtcHour: 14 } },
  { name: 'booking-review-requests', path: '/api/v1/factory/internal/booking-review-requests', schedule: { dailyAtUtcHour: 16 } },
  // A2P vetting advances over hours–days; poll hourly.
  { name: 'a2p-poll', path: '/api/v1/factory/internal/a2p/poll', schedule: 'hourly' },
  // Tenants' branded addresses onto Cloudflare once their domain is active (services/emailAliasSync.ts).
  { name: 'email-alias-sweep', path: '/api/v1/factory/internal/email-alias-sweep', schedule: 'hourly' },
  { name: 'messaging-low-balance-nudge', path: '/api/v1/factory/internal/messaging/low-balance-nudge', schedule: { dailyAtUtcHour: 15 } },
  // A website preview whose compose died with a restart or failed (routes/factory/intake.ts). Soon after
  // boot — a deploy is exactly what kills one, and the prospect was promised it within 15 minutes —
  // by when the instance it replaced has stopped; then every 10 minutes.
  { name: 'preview-sweep', path: '/api/v1/factory/internal/preview-sweep', schedule: { everyMinutes: 10, firstAfterMinutes: 3 } },
]

export async function fireJob(job: JobConfig, port: number, secret: string) {
  const url = `http://127.0.0.1:${port}${job.path}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'x-cron-secret': secret } })
    const body = await res.text()
    const ms = Date.now() - t0
    if (res.ok) {
      console.log(`[scheduler] ${job.name} ok (${ms}ms): ${body.slice(0, 200)}`)
      clearAlert('job:' + job.name)
    } else {
      console.warn(`[scheduler] ${job.name} status=${res.status} (${ms}ms): ${body.slice(0, 300)}`)
      void raiseAlert({ key: 'job:' + job.name, what: `The "${job.name}" background job is failing`, detail: `HTTP ${res.status}: ${body.slice(0, 300)}` })
    }
  } catch (e: any) {
    console.warn(`[scheduler] ${job.name} threw: ${e?.message}`)
    void raiseAlert({ key: 'job:' + job.name, what: `The "${job.name}" background job is failing`, detail: e?.message || String(e) })
  }
}

function msUntilNextHourTop(): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0)
  return next.getTime() - now.getTime()
}

function msUntilNextDailyUtc(hourUtc: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(hourUtc + TZ_OFFSET_HOURS_FOR_DAILY, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

export function startScheduler(port: number): void {
  if (process.env.ENABLE_BUILTIN_CRON !== 'true') {
    console.log('[scheduler] ENABLE_BUILTIN_CRON not set — built-in cron disabled')
    return
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.warn('[scheduler] CRON_SECRET not set — cannot fire internal jobs, skipping')
    return
  }

  for (const job of JOBS) {
    if (typeof job.schedule === 'object' && 'everyMinutes' in job.schedule) {
      const { everyMinutes, firstAfterMinutes } = job.schedule
      console.log(`[scheduler] ${job.name} first fire in ${firstAfterMinutes}min, then every ${everyMinutes}min`)
      setTimeout(() => {
        fireJob(job, port, secret)
        setInterval(() => fireJob(job, port, secret), everyMinutes * 60 * 1000)
      }, firstAfterMinutes * 60 * 1000)
    } else if (job.schedule === 'hourly') {
      const delay = msUntilNextHourTop()
      console.log(`[scheduler] ${job.name} first fire in ${Math.round(delay / 1000)}s, then every hour`)
      setTimeout(() => {
        fireJob(job, port, secret)
        setInterval(() => fireJob(job, port, secret), 60 * 60 * 1000)
      }, delay)
    } else {
      const delay = msUntilNextDailyUtc(job.schedule.dailyAtUtcHour)
      console.log(`[scheduler] ${job.name} first fire in ${Math.round(delay / 60_000)}min, then daily at ${job.schedule.dailyAtUtcHour}:00 UTC`)
      setTimeout(function fireDaily() {
        fireJob(job, port, secret)
        setTimeout(fireDaily, 24 * 60 * 60 * 1000)
      }, delay)
    }
  }
}
