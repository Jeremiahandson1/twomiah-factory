// Scheduled poll against the Wisconsin DOJ WORCS service for background checks we submitted (ported to the template
// from CVHC jobs/worcsPoll.js). Moved from templates/crm-homecare/backend/src/jobs/worcsPoll.ts. Name-based checks
// usually return the same day; polling every 30 minutes lands results in the CRM without anyone pressing a button.
// When a result comes back it is saved to background_checks, the eligibility engine runs against it and the office is
// emailed.
//
// Wisconsin only: an agency in any other state never submits to WORCS, so the schedule starts only when some company
// is in Wisconsin (the manual "Poll WORCS Now" button still works and simply finds nothing).
//
// Never double-runs:
//   · one cycle at a time per process (`running`), so a slow WORCS cannot stack cycles
//   · each row is CLAIMED with a conditional update on updated_at before it is polled (server/data/homecareHr.ts), so
//     two instances (a deploy overlap) never poll — or email about — the same check twice
//
// Changes: nothing runs at import or when the core is built — start() (from the app's startJobs) schedules it and
// stop() ends it; a cycle covers every company's pending checks (runPollCycle(companyId) one company's, for the
// button), each result judged against ITS company's state and bar list and emailed to ITS company's address; writes
// are scoped to the row's company; logs go through d.logger.
import { and, eq, inArray, isNotNull, asc } from 'drizzle-orm'
import { backgroundChecks, company, user } from '../../../db/schema/index.ts'
import { claimBackgroundCheck } from '../../../data/homecareHr.ts'
import type { CrmDeps } from '../../deps.ts'
import { createAgencyTime } from './agencyTime.ts'
import { getCheckResults } from './worcsService.ts'
import { isWisconsin, type AgencyProfile, type AgencyProfiles } from './agencyProfile.ts'
import type { EligibilityEngine } from './eligibilityEngine.ts'
import type { StaffEmails } from './staffEmails.ts'

export type PollSummary = { polled: number; completed: number; errors: number; skipped?: boolean }

const EVERY_MS = 30 * 60 * 1000

export function createWorcsPoll(d: CrmDeps, deps: { eligibility: EligibilityEngine; staffEmails: StaffEmails; profile: AgencyProfiles }) {
  const agencyTime = createAgencyTime(d)
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null
  // The WORCS client, swappable for tests. Production always uses the real one.
  let fetchResults: typeof getCheckResults = getCheckResults

  /** One cycle over the pending WORCS checks — every company's, or one company's when given. */
  async function runPollCycle(companyId?: string): Promise<PollSummary> {
    const summary: PollSummary = { polled: 0, completed: 0, errors: 0 }
    if (running) return { ...summary, skipped: true }
    running = true
    try {
      const pending: any[] = await d.db.select({
        id: backgroundChecks.id,
        companyId: backgroundChecks.companyId,
        caregiverId: backgroundChecks.caregiverId,
        referenceNumber: backgroundChecks.worcsReferenceNumber,
        updatedAt: backgroundChecks.updatedAt,
        firstName: user.firstName,
        lastName: user.lastName,
      })
        .from(backgroundChecks)
        .innerJoin(user, eq(user.id, backgroundChecks.caregiverId))
        .where(and(
          companyId ? eq(backgroundChecks.companyId, companyId) : undefined,
          eq(backgroundChecks.checkType, 'worcs'),
          inArray(backgroundChecks.status, ['pending', 'in_progress']),
          isNotNull(backgroundChecks.worcsReferenceNumber),
        ))
        .orderBy(asc(backgroundChecks.createdAt))
        .limit(100)

      const agencies = new Map<string, AgencyProfile>()
      const agencyOf = async (id: string) => {
        if (!agencies.has(id)) agencies.set(id, await deps.profile.getAgencyProfile(id))
        return agencies.get(id)!
      }

      for (const row of pending) {
        if (!(await claimBackgroundCheck(d.db, row.companyId, row.id, row.updatedAt))) continue

        summary.polled++
        try {
          const result: any = await fetchResults(String(row.referenceNumber))
          const mine = and(eq(backgroundChecks.id, row.id), eq(backgroundChecks.companyId, row.companyId))

          if (result.status === 'pending') {
            await d.db.update(backgroundChecks).set({ status: 'in_progress', updatedAt: new Date() }).where(mine)
            continue
          }

          const bcStatus = result.status === 'completed' ? 'completed' : 'error'
          const bcResult = result.result === 'cleared' ? 'clear'
            : result.result === 'record_found' ? 'record_found'
            : result.result === 'error' ? 'error'
            : null
          const findings = result.rawResult || (result.hasRecord ? 'Record returned by WORCS. See raw WORCS report for details.' : null)

          const [current] = await d.db.select({ completedDate: backgroundChecks.completedDate, findings: backgroundChecks.findings })
            .from(backgroundChecks).where(mine)
          await d.db.update(backgroundChecks).set({
            status: bcStatus,
            result: bcResult,
            worcsStatus: bcStatus,
            // Completed today on the agency's clock (UTC's day was tomorrow every US evening).
            completedDate: current?.completedDate || await agencyTime.today(row.companyId),
            findings: current?.findings || findings,
            updatedAt: new Date(),
          }).where(mine)
          summary.completed++

          const agency = await agencyOf(row.companyId)
          const evalResult = await deps.eligibility.evaluateWorcsResult(row.companyId, {
            hasRecord: result.hasRecord, result: result.result, findings, rawResult: result.rawResult,
          }, agency.state ?? null)

          const adminEmail = agency.email || process.env.ADMIN_EMAIL
          if (adminEmail) {
            deps.staffEmails.sendAdminBgcResult(row.companyId, {
              to: adminEmail,
              caregiverName: `${row.firstName} ${row.lastName}`,
              status: evalResult.status,
              summary: evalResult.summary,
              matches: evalResult.matches,
            }).catch((err: any) => d.logger.error('[worcsPoll] admin email error', { error: err?.message }))
          }
          d.logger.info(`[worcsPoll] ${row.firstName} ${row.lastName} → ${evalResult.status} (${evalResult.matches.length} matches)`)
        } catch (err: any) {
          // Left pending so the next cycle tries again.
          summary.errors++
          d.logger.error(`[worcsPoll] poll failed for bg ${row.id}`, { error: err?.message })
        }
      }
      if (pending.length > 0) {
        d.logger.info(`[worcsPoll] cycle done: polled=${summary.polled} completed=${summary.completed} errors=${summary.errors}`)
      }
    } catch (err: any) {
      d.logger.error('[worcsPoll] cycle error', { error: err?.message })
    } finally {
      running = false
    }
    return summary
  }

  /** Every 30 minutes, when some company is in Wisconsin. Idempotent: a second call does nothing. Never at import. */
  async function start() {
    if (timer) return
    if (process.env.WORCS_POLL_DISABLED === 'true' || process.env.NODE_ENV === 'test') return
    try {
      const states: { state: string | null }[] = await d.db.select({ state: company.state }).from(company)
      if (!states.some((s) => isWisconsin({ state: s.state ? String(s.state).trim().toUpperCase() : null }))) return
    } catch (err: any) {
      d.logger.error('[worcsPoll] could not read the companies; not scheduling', { error: err?.message })
      return
    }
    timer = setInterval(() => {
      runPollCycle().catch((err) => d.logger.error('[worcsPoll] cron error', { error: err?.message }))
    }, EVERY_MS)
    d.logger.info('[worcsPoll] scheduled — polling WORCS every 30 minutes')
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return {
    runPollCycle, start, stop,
    /** Test seam. */
    __setWorcsClientForTests(fn: typeof getCheckResults | null) { fetchResults = fn || getCheckResults },
  }
}

export type WorcsPoll = ReturnType<typeof createWorcsPoll>
