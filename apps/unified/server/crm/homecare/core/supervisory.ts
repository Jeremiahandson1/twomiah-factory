// Supervisory visits (item 11): a check-in on each client's care every 60 or 90 days. The AGENCY picks the rule (60 or 90,
// kept in company.settings.supervisoryVisitDays; 90 until it picks); one client can have their own number of days, or
// none at all. A client's next visit is due that many days after the last one — or, before the first, after their start
// date. Only for a company with the care_supervisory_visits feature (not ready until the owner has tested it).
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import { supervisoryRows } from '../../../data/homecareSupervisory.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { addDays } from './agencyTime.ts'

export const SUPERVISORY_FEATURE = 'care_supervisory_visits'
export const AGENCY_RULES = [60, 90] as const
export const DEFAULT_RULE = 90
/** "Due soon" starts this many days before the due date. */
export const DUE_SOON_DAYS = 14

export type SupervisoryStatus = 'overdue' | 'due_soon' | 'ok'

/** overdue = the due date has passed; due_soon = within DUE_SOON_DAYS; otherwise ok. Dates are 'YYYY-MM-DD'. */
export function supervisoryStatus(dueDate: string, today: string): SupervisoryStatus {
  if (dueDate < today) return 'overdue'
  return dueDate <= addDays(today, DUE_SOON_DAYS) ? 'due_soon' : 'ok'
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export function createSupervisory(d: CrmDeps, deps: { time: AgencyTime }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, SUPERVISORY_FEATURE)

  /** The agency's rule in days: 60 or 90. */
  async function rule(companyId: string): Promise<number> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const n = Number((row?.settings as any)?.supervisoryVisitDays)
    return (AGENCY_RULES as readonly number[]).includes(n) ? n : DEFAULT_RULE
  }

  async function setRule(companyId: string, days: number): Promise<void> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), supervisoryVisitDays: days } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  /** Each client with a rule: status, due date and how many days over / until. Most overdue first. */
  async function dueList(companyId: string) {
    const [days, today] = await Promise.all([rule(companyId), deps.time.today(companyId)])
    const rows = await supervisoryRows(d.db, companyId, days)
    return {
      ruleDays: days, today,
      clients: rows.map((r: any) => {
        const status = supervisoryStatus(r.dueDate, today)
        return { ...r, status, daysOverdue: status === 'overdue' ? daysBetween(r.dueDate, today) : 0, daysUntilDue: status === 'overdue' ? 0 : daysBetween(today, r.dueDate) }
      }),
    }
  }

  /** The dashboard's two numbers ({0,0} when the agency does not have the feature). */
  async function counts(companyId: string): Promise<{ overdue: number; dueSoon: number }> {
    if (!(await enabled(companyId))) return { overdue: 0, dueSoon: 0 }
    const { clients } = await dueList(companyId)
    return { overdue: clients.filter((c: any) => c.status === 'overdue').length, dueSoon: clients.filter((c: any) => c.status === 'due_soon').length }
  }

  return { enabled, rule, setRule, dueList, counts }
}
