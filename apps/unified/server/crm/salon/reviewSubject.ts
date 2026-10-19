// What a salon review request is about: the VISIT that raised it (CrmSettings.reviews.subject 'visit'). Moved from
// templates/crm-salon/backend/src/services/reviews.ts (Salon T30 L2).
//
// The shared list shows the job a request came from, and a salon request has no job — it is raised when a visit is
// completed — so the column was blank on every row. There is no stored link between the two: the request is created at
// completion, so the visit is that client's most recent service at or before it. One query for the whole page.
import { desc, eq, inArray } from 'drizzle-orm'
import { serviceRecord, serviceMenu } from '../../db/schema/index.ts'

interface RequestRow { contactId?: string | null; createdAt?: string | Date | null; job?: unknown }

export function createVisitSubject(db: any) {
  return async function visitFor<T extends RequestRow>(rows: T[]): Promise<T[]> {
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean))] as string[]
    if (!contactIds.length) return rows
    const visits: Array<{ contactId: string; performedAt: Date; name: string | null }> = await db
      .select({ contactId: serviceRecord.contactId, performedAt: serviceRecord.performedAt, name: serviceMenu.name })
      .from(serviceRecord)
      .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .where(inArray(serviceRecord.contactId, contactIds))
      .orderBy(desc(serviceRecord.performedAt))

    return rows.map((r) => {
      if (r.job) return r
      const asked = r.createdAt ? new Date(r.createdAt).getTime() : Date.now()
      // the newest visit that had already happened when the request was raised
      const v = visits.find((x) => x.contactId === r.contactId && new Date(x.performedAt).getTime() <= asked + 60_000)
      if (!v) return r
      const day = new Date(v.performedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      return { ...r, job: { id: null, title: v.name ? `${v.name} · ${day}` : day } }
    })
  }
}
