// Who gets a phone notification, for every vertical (core/phonePush.ts sends; home care adds its visit notices).
//
// Jobs: a job assigned to someone, or a job of theirs rescheduled, tells that person — whichever screen or route did it
// (the job form, the dispatch board, the schedule, roofing's crews, a bulk edit, the calendar sync: not every one
// announces the change, so this compares the data). Every minute the open jobs are compared with what each was last
// announced as (job_push_state, data/phonePush.ts jobChanges); a job whose person or time differs is announced and
// recorded. Unassigned, finished or lost work is recorded without a message.
//
// Leads: a new lead (the lead inbox, a tracked call — both announce LEAD_CREATED) tells the people who work leads: those
// whose seat may update contacts (owner, admin, manager by default; never the field seat), counting per-person grants.
import type { PhonePush } from '../../core/phonePush.ts'
import type { Realtime } from '../../core/realtime.ts'
import { activePeople, jobChanges, recordJobState, type JobChange } from '../../data/phonePush.ts'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD HH:MM' → 'Tue Oct 21, 9:00 AM'; the day alone → 'Tue Oct 21'. A calendar day, not an instant: no zone. */
export function whenText(scheduledFor: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2}))?/.exec(scheduledFor || '')
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const day = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  if (m[4] === undefined) return day
  const h = +m[4]
  return `${day}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`
}

/** The message a change earns, or null for none. */
export function messageFor(c: JobChange): { userId: string; title: string; body: string } | null {
  if (c.closed || !c.assigneeId) return null
  const name = c.number ? `${c.title} (${c.number})` : c.title
  const when = whenText(c.scheduledFor)
  if (c.fresh || c.assigneeId !== c.previousAssigneeId) {
    return { userId: c.assigneeId, title: 'New job assigned to you', body: when ? `${name} — ${when}` : name }
  }
  if (c.scheduledFor !== c.previousScheduledFor && when) {
    return { userId: c.assigneeId, title: 'Your job was rescheduled', body: `${name} — now ${when}` }
  }
  return null
}

export function createPhoneRules(deps: {
  db: any
  phonePush: PhonePush
  realtime: Realtime
  permissions: { hasPermission: (role: string, p: string, extra?: string[]) => boolean; getExtraPermissions: (userId?: string) => Promise<string[]> }
  companyId: () => Promise<string | null>
  logger: { error: (m: string, x?: any) => void }
}) {
  /** One pass over the jobs: announce and record every change. Returns the messages sent (for tests). */
  async function scanJobs(): Promise<number> {
    const companyId = await deps.companyId()
    if (!companyId) return 0
    let sent = 0
    for (const c of await jobChanges(deps.db, companyId)) {
      const msg = messageFor(c)
      if (msg) {
        await deps.phonePush.send(companyId, [msg.userId], { title: msg.title, body: msg.body, data: { type: 'job', id: c.jobId } })
        sent++
      }
      await recordJobState(deps.db, c)
    }
    return sent
  }

  /**
   * The people who work leads, by permission (leads:update — the inbox's own; contacts:update reached a salon's stylists
   * and a vet's desk, whose menu no longer offers the inbox), counting per-person grants. (Live role check, 2026-10-23)
   */
  async function leadWorkers(companyId: string): Promise<string[]> {
    const people = await activePeople(deps.db, companyId)
    const out: string[] = []
    for (const p of people) if (deps.permissions.hasPermission(p.role, 'leads:update', await deps.permissions.getExtraPermissions(p.id))) out.push(p.id)
    return out
  }

  deps.realtime.listen((companyId, event, data) => {
    if (event !== deps.realtime.EVENTS.LEAD_CREATED) return
    const name = String((data as any)?.homeownerName || '').trim()
    void leadWorkers(companyId)
      .then((ids) => deps.phonePush.send(companyId, ids, { title: 'New lead', body: name ? `${name} is waiting to hear from you` : 'A new lead is waiting in the inbox', data: { type: 'lead_inbox', id: (data as any)?.id ?? null } }))
      .catch((e) => deps.logger.error('[push] new-lead notice failed', { error: e?.message }))
  })

  let timer: ReturnType<typeof setInterval> | null = null
  return {
    scanJobs,
    /** Started at boot (services.startJobs), never in tests. */
    start() {
      if (timer) return
      timer = setInterval(() => { scanJobs().catch((e) => deps.logger.error('[push] job scan failed', { error: e?.message })) }, 60_000)
    },
  }
}
