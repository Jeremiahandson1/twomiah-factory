// Scheduled poll against the Wisconsin DOJ WORCS service for background checks we submitted
// (ported from CVHC jobs/worcsPoll.js). Name-based checks usually return the same day; polling every
// 30 minutes lands results in the CRM without anyone pressing a button. When a result comes back it
// is saved to background_checks, the eligibility engine runs against it and the office is emailed.
//
// Wisconsin only: an agency in any other state never submits to WORCS, so the schedule does not
// start for it (the manual "Poll WORCS Now" button still works and simply finds nothing).
//
// Never double-runs:
//   · one cycle at a time per process (`running`), so a slow WORCS cannot stack cycles
//   · each row is CLAIMED with a conditional update on updated_at before it is polled, so two
//     instances (a deploy overlap) never poll — or email about — the same check twice
import { and, eq, inArray, isNotNull, asc, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { backgroundChecks, users } from '../../db/schema.ts'
import { getCheckResults } from '../services/worcsService.ts'
import { evaluateWorcsResult } from '../services/eligibilityEngine.ts'
import { sendAdminBgcResult } from '../services/staffEmails.ts'
import { getAgencyProfile, isWisconsin } from '../services/agencyProfile.ts'

export type PollSummary = { polled: number; completed: number; errors: number; skipped?: boolean }

let running = false

// The WORCS client, swappable for tests. Production always uses the real one.
let fetchResults: typeof getCheckResults = getCheckResults
export function __setWorcsClientForTests(fn: typeof getCheckResults | null) { fetchResults = fn || getCheckResults }

export async function runPollCycle(): Promise<PollSummary> {
  const summary: PollSummary = { polled: 0, completed: 0, errors: 0 }
  if (running) return { ...summary, skipped: true }
  running = true
  try {
    const pending = await db.select({
      id: backgroundChecks.id,
      caregiverId: backgroundChecks.caregiverId,
      referenceNumber: backgroundChecks.worcsReferenceNumber,
      updatedAt: backgroundChecks.updatedAt,
      firstName: users.firstName,
      lastName: users.lastName,
    })
      .from(backgroundChecks)
      .innerJoin(users, eq(users.id, backgroundChecks.caregiverId))
      .where(and(
        eq(backgroundChecks.checkType, 'worcs'),
        inArray(backgroundChecks.status, ['pending', 'in_progress']),
        isNotNull(backgroundChecks.worcsReferenceNumber),
      ))
      .orderBy(asc(backgroundChecks.createdAt))
      .limit(100)

    const agency = pending.length ? await getAgencyProfile() : null

    for (const row of pending) {
      // Claim: only the process whose update matches the updated_at it read gets to poll this row.
      // Compared at millisecond precision — Postgres keeps microseconds, a JS Date does not, so a
      // plain equality would never match a row stamped by now().
      const [claimed] = await db.update(backgroundChecks)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(backgroundChecks.id, row.id),
          sql`date_trunc('milliseconds', ${backgroundChecks.updatedAt}) = ${row.updatedAt.toISOString()}::timestamp`,
        ))
        .returning({ id: backgroundChecks.id })
      if (!claimed) continue

      summary.polled++
      try {
        const result: any = await fetchResults(String(row.referenceNumber))

        if (result.status === 'pending') {
          await db.update(backgroundChecks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(backgroundChecks.id, row.id))
          continue
        }

        const bcStatus = result.status === 'completed' ? 'completed' : 'error'
        const bcResult = result.result === 'cleared' ? 'clear'
          : result.result === 'record_found' ? 'record_found'
          : result.result === 'error' ? 'error'
          : null
        const findings = result.rawResult || (result.hasRecord ? 'Record returned by WORCS. See raw WORCS report for details.' : null)

        const [current] = await db.select({ completedDate: backgroundChecks.completedDate, findings: backgroundChecks.findings })
          .from(backgroundChecks).where(eq(backgroundChecks.id, row.id))
        await db.update(backgroundChecks).set({
          status: bcStatus,
          result: bcResult,
          worcsStatus: bcStatus,
          completedDate: current?.completedDate || new Date().toISOString().slice(0, 10),
          findings: current?.findings || findings,
          updatedAt: new Date(),
        }).where(eq(backgroundChecks.id, row.id))
        summary.completed++

        const evalResult = await evaluateWorcsResult({
          hasRecord: result.hasRecord, result: result.result, findings, rawResult: result.rawResult,
        }, agency?.state ?? null)

        const adminEmail = agency?.email || process.env.ADMIN_EMAIL
        if (adminEmail) {
          sendAdminBgcResult({
            to: adminEmail,
            caregiverName: `${row.firstName} ${row.lastName}`,
            status: evalResult.status,
            summary: evalResult.summary,
            matches: evalResult.matches,
          }).catch((err) => console.error('[worcsPoll] admin email error:', err?.message))
        }
        console.log(`[worcsPoll] ${row.firstName} ${row.lastName} → ${evalResult.status} (${evalResult.matches.length} matches)`)
      } catch (err: any) {
        // Left pending so the next cycle tries again.
        summary.errors++
        console.error(`[worcsPoll] poll failed for bg ${row.id}:`, err?.message)
      }
    }
    if (pending.length > 0) {
      console.log(`[worcsPoll] cycle done: polled=${summary.polled} completed=${summary.completed} errors=${summary.errors}`)
    }
  } catch (err: any) {
    console.error('[worcsPoll] cycle error:', err?.message)
  } finally {
    running = false
  }
  return summary
}

let timer: ReturnType<typeof setInterval> | null = null

/** Every 30 minutes, for a Wisconsin agency. Idempotent: a second call does nothing. */
export async function startWorcsPoll() {
  if (timer) return
  if (process.env.WORCS_POLL_DISABLED === 'true' || process.env.NODE_ENV === 'test') return
  try {
    const agency = await getAgencyProfile()
    if (!isWisconsin(agency)) return
  } catch (err: any) {
    console.error('[worcsPoll] could not read the agency; not scheduling:', err?.message)
    return
  }
  timer = setInterval(() => {
    runPollCycle().catch((err) => console.error('[worcsPoll] cron error:', err?.message))
  }, 30 * 60 * 1000)
  console.log('[worcsPoll] scheduled — polling WORCS every 30 minutes')
}
