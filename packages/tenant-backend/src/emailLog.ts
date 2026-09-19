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

export interface EmailLogTables {
  emailLog: any
  /** the tenant's single company row, so a recorder does not need a request context to know whose email it is */
  company: any
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
  // TEMP DIAG (#260 records nothing live) — remove with the rest of the [emailLog] diag lines.
  console.error('[emailLog] diag: logger created', { hasEmailLog: !!t?.emailLog, hasCompany: !!t?.company })
  return async function recordEmail(entry: EmailLogEntry): Promise<void> {
    console.error('[emailLog] diag: called', { to: entry.to, status: entry.status })
    try {
      if (!t?.emailLog) console.error('[emailLog] diag: no emailLog table')
      if (!t?.emailLog || !t?.company) return
      if (!companyId) {
        const [row] = await db.select({ id: t.company.id }).from(t.company).limit(1)
        companyId = row?.id || null
      }
      if (!companyId) { console.error('[emailLog] diag: no company row'); return }
      await db.insert(t.emailLog).values({
        companyId,
        to: String(entry.to || '').slice(0, 320),
        subject: String(entry.subject || '').slice(0, 500),
        status: entry.status,
        errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
        sentAt: entry.status === 'sent' ? new Date() : null,
      })
      console.error('[emailLog] diag: inserted', { companyId })
    } catch (err) {
      console.error('[emailLog] diag: insert threw', (err as Error)?.message)
      // The mail already went out. Losing the record is a reporting problem; throwing here would turn it
      // into a failed send the customer never hears about.
      logger?.warn('[emailLog] could not record a send', { error: (err as Error)?.message })
    }
  }
}
