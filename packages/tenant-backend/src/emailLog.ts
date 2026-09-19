// Every email the product sends, recorded once.
//
// Settings › Integrations shows "Usage this month: N emails" by counting email_log for the month. The only
// thing that ever wrote to that table was the marketing campaign sender, so a tenant who had emailed invoices
// all month still read 0 — the send happened, nothing recorded it. (Contractor T14 M23)
//
// The recorder is handed to the template's email service at startup and called from its one send() choke
// point, so a new kind of email cannot be added and forgotten. Campaigns are NOT recorded here: they go out
// through sendRaw() and marketing.ts writes its own rows, with the contact and campaign attached.
//
// Two rules this must never break: recording is best-effort — a logging failure must not fail a send that
// actually went out — and a send that never left the building (no provider configured) is not usage.

import { isNotNull } from 'drizzle-orm'

export interface EmailLogTables {
  emailLog: any
  company: any
  /**
   * The user table, because "the tenant's company" cannot be guessed. The first version took
   * `select company limit 1` on the assumption that a tenant CRM holds exactly one — the live contractor
   * tenant holds two, so every row was written against a company nobody is signed in to, and every counter
   * (which filters by the signed-in user's company) missed it. No error, no warning, nothing counted.
   * The company that has users in it is the one every request resolves. (T14 M23, found live)
   */
  user: any
}
export interface EmailLogDeps {
  db: any
  tables: EmailLogTables
  logger?: { warn: (msg: string, meta?: any) => void }
}

export interface EmailLogEntry {
  to: string
  subject: string
  status: 'sent' | 'failed'
  /** the provider's own words, for support — never shown to the owner (see integrations/mailError.ts) */
  errorMessage?: string
}

export type EmailRecorder = (entry: EmailLogEntry) => Promise<void>

export function createEmailLogger({ db, tables: t, logger }: EmailLogDeps): EmailRecorder {
  // A tenant CRM holds exactly one company; resolve it once rather than on every send.
  let companyId: string | null = null
  return async function recordEmail(entry: EmailLogEntry): Promise<void> {
    try {
      if (!t?.emailLog || !t?.company || !t?.user) return
      if (!companyId) {
        // the company its people belong to — the same one every authenticated request resolves
        const [row] = await db.select({ id: t.user.companyId }).from(t.user).where(isNotNull(t.user.companyId)).limit(1)
        companyId = row?.id || null
        if (!companyId) {
          const [fallback] = await db.select({ id: t.company.id }).from(t.company).limit(1)
          companyId = fallback?.id || null
          if (companyId) logger?.warn('[emailLog] no user to resolve the company from — usage may be recorded against the wrong one')
        }
      }
      if (!companyId) return
      await db.insert(t.emailLog).values({
        companyId,
        to: String(entry.to || '').slice(0, 320),
        subject: String(entry.subject || '').slice(0, 500),
        status: entry.status,
        errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
        sentAt: entry.status === 'sent' ? new Date() : null,
      })
    } catch (err) {
      // The mail already went out. Losing the record is a reporting problem; throwing here would turn it
      // into a failed send the customer never hears about.
      logger?.warn('[emailLog] could not record a send', { error: (err as Error)?.message })
    }
  }
}
