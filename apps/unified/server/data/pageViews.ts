// Visit counts per path per day (the website's first-party analytics).
import { sql } from 'drizzle-orm'
import { pageView } from '../db/schema/index.ts'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'

/** One more visit to `path` today (the company's day). Fire-and-forget: a failed count never affects the page. */
export function countView(db: any, companyId: string, path: string): void {
  const at = new Date()
  Promise.resolve(companyTimeZone(db, companyId)).then((tz) => storeDateString(at, tz)).then((day) =>
    db.insert(pageView).values({ companyId, day, path, count: 1 })
      .onConflictDoUpdate({ target: [pageView.companyId, pageView.day, pageView.path], set: { count: sql`${pageView.count} + 1` } }),
  ).catch(() => {})
}
