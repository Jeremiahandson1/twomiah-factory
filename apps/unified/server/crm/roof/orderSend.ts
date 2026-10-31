// Sending a material order to the supplier by email (docs/parity/roof-material-list.md #11): who it goes to, which orders may be
// sent, and the log of what was sent. Pure, so the rules are tested without a server.

/** An order can be sent from these: a draft, one marked ready, one the supplier rejected (sent again, corrected), and one already
 *  sent (sent again as a reminder). Ordered / partly delivered / delivered / cancelled orders are past sending. */
export const SENDABLE_STATUSES = ['not_ordered', 'ready_to_send', 'rejected', 'sent'] as const
export const isSendable = (status: string) => (SENDABLE_STATUSES as readonly string[]).includes(status)

export const MAX_TO = 10
export const MAX_CC = 10
export const MAX_BULK = 25
export const SEND_LOG_KEEPS = 50

const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]{2,}$/

/** Addresses from a list or from one box where people type "a@x.com, b@y.com; c@z.com": trimmed, lower-cased, no repeats. */
export function parseRecipients(input: unknown): { emails: string[]; bad: string[] } {
  const parts = (Array.isArray(input) ? input : [input]).flatMap((v) => String(v ?? '').split(/[,;\n]+/)).map((s) => s.trim()).filter(Boolean)
  const emails: string[] = []
  const bad: string[] = []
  for (const p of parts) {
    const e = p.toLowerCase()
    if (!EMAIL.test(e)) { bad.push(p); continue }
    if (!emails.includes(e)) emails.push(e)
  }
  return { emails, bad }
}

export interface SendLogEntry {
  at: string
  byUserId: string | null
  byName: string | null
  to: string[]
  cc: string[]
  subject: string
  message: string
  attachment: string
  messageId: string | null
}

/** The order's log with one more entry, newest last, the oldest dropped past the cap. */
export function appendSendLog(log: unknown, entry: SendLogEntry): SendLogEntry[] {
  const prior = Array.isArray(log) ? (log as SendLogEntry[]) : []
  return [...prior, entry].slice(-SEND_LOG_KEEPS)
}
