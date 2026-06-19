import { db } from '../../db/index.ts'
import { sequence, sequenceStep, sequenceEnrollment, contact as contactTable, company as companyTable } from '../../db/schema.ts'
import { eq, and, lte, asc } from 'drizzle-orm'
import { sendAndLog, renderTemplate } from './sms.ts'
import { sendRaw } from './email.ts'
import logger from './logger.ts'

/**
 * Follow-up sequence runner.
 *
 * Polls active enrollments whose next step is due, sends that step (SMS or
 * email) to the contact, and advances the enrollment to the next step or marks
 * it complete. Runs in-process on a 60s interval — fine for this single web
 * service; if the deployment ever scales horizontally this should move to a
 * dedicated worker with a row lock.
 */

let running = false

export async function processDueEnrollments(now: Date = new Date()): Promise<number> {
  const due = await db.select().from(sequenceEnrollment)
    .where(and(eq(sequenceEnrollment.status, 'active'), lte(sequenceEnrollment.nextRunAt, now)))
    .limit(100)

  let processed = 0
  for (const enr of due) {
    try {
      const seq = (await db.select().from(sequence).where(eq(sequence.id, enr.sequenceId)).limit(1))[0]
      if (!seq || !seq.active) {
        await db.update(sequenceEnrollment).set({ status: 'cancelled' }).where(eq(sequenceEnrollment.id, enr.id))
        continue
      }

      const steps = await db.select().from(sequenceStep)
        .where(eq(sequenceStep.sequenceId, enr.sequenceId))
        .orderBy(asc(sequenceStep.stepOrder))

      const step = steps[enr.currentStep]
      if (!step) {
        await db.update(sequenceEnrollment).set({ status: 'completed', completedAt: now }).where(eq(sequenceEnrollment.id, enr.id))
        continue
      }

      const contact = (await db.select().from(contactTable).where(eq(contactTable.id, enr.contactId)).limit(1))[0]
      const company = (await db.select().from(companyTable).where(eq(companyTable.id, enr.companyId)).limit(1))[0]

      if (contact) {
        const body = renderTemplate(step.body, contact, company)
        try {
          if (step.channel === 'email') {
            if (contact.email) {
              await sendRaw(contact.email, step.subject || `A message from ${company?.name || 'us'}`, body)
            }
          } else {
            const to = contact.mobile || contact.phone
            if (to) {
              await sendAndLog({ companyId: enr.companyId, to, body, contactId: contact.id, source: 'sequence', company })
            }
          }
        } catch (sendErr: any) {
          logger.warn?.('Sequence step send failed', { enrollmentId: enr.id, error: sendErr?.message })
        }
      }

      // Advance to the next step, or complete.
      const next = steps[enr.currentStep + 1]
      if (next) {
        const nextRunAt = new Date(now.getTime() + (next.delayHours || 0) * 3600_000)
        await db.update(sequenceEnrollment)
          .set({ currentStep: enr.currentStep + 1, nextRunAt })
          .where(eq(sequenceEnrollment.id, enr.id))
      } else {
        await db.update(sequenceEnrollment)
          .set({ status: 'completed', completedAt: now })
          .where(eq(sequenceEnrollment.id, enr.id))
      }
      processed++
    } catch (err: any) {
      logger.error?.('Sequence enrollment processing error', { enrollmentId: enr.id, error: err?.message })
    }
  }
  return processed
}

export function startSequenceRunner(intervalMs = 60_000) {
  const tick = async () => {
    if (running) return
    running = true
    try {
      const n = await processDueEnrollments()
      if (n > 0) logger.info?.(`Sequence runner processed ${n} step(s)`)
    } catch (err: any) {
      logger.error?.('Sequence runner tick failed', { error: err?.message })
    } finally {
      running = false
    }
  }
  // Kick off shortly after boot, then on an interval.
  setTimeout(tick, 15_000)
  setInterval(tick, intervalMs)
  logger.info?.('Sequence runner started')
}
