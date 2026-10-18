// Visit counts per path per day (the website's first-party analytics).
import { sql } from 'drizzle-orm'
import { pageView } from '../db/schema/index.ts'

/** One more visit to `path` today (UTC). Fire-and-forget: a failed count never affects the page. */
export function countView(db: any, companyId: string, path: string): void {
  const day = new Date().toISOString().slice(0, 10)
  Promise.resolve(
    db.insert(pageView).values({ companyId, day, path, count: 1 })
      .onConflictDoUpdate({ target: [pageView.companyId, pageView.day, pageView.path], set: { count: sql`${pageView.count} + 1` } }),
  ).catch(() => {})
}
