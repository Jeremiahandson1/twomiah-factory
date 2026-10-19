// What the billing group's routers share: reading a body, dates, the signed-in person, a CSV download, and turning the
// invoice engine's refusals into the rulebook's error reply.
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { BillingRefusal } from '../core/invoiceEngine.ts'
import { fail } from '../../../http/reply.ts'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v)
export const num = (v: unknown) => Number(v || 0)

/** The request's JSON body, or {} when there is none or it is not JSON. */
export const body = async (c: Context): Promise<any> => { try { return (await c.req.json()) || {} } catch { return {} } }

/** The signed-in person (the registry signed them in). */
export const who = (c: Context) => c.get('user') as { userId: string; companyId: string; role: string }

/**
 * An engine refusal as `{ error, code }` (RULEBOOK §3). The template replied with the engine's body as it was: a no-rate
 * refusal carried its fix in `message`, a duplicate period the existing invoice's id, an overpayment the figures. The fix
 * goes into the sentence (the figures already are), and each kind gets a code a screen can branch on.
 */
export function refusalReply(c: Context, e: BillingRefusal) {
  const b = e.body as Record<string, unknown>
  const sentence = [b.error, b.message].filter((x) => typeof x === 'string' && x).join(' — ') || 'Refused'
  const code = b.existingInvoiceId ? 'invoice_exists'
    : b.balanceDue !== undefined ? 'overpayment'
    : /No billing rate/.test(String(b.error || '')) ? 'no_billing_rate'
    : undefined
  return fail(c, e.status as ContentfulStatusCode, sentence, code)
}

/** Run a handler; a BillingRefusal becomes its 4xx, anything else propagates to the error handler. */
export const refusalAware = (fn: (c: any) => Promise<Response>) => async (c: any) => {
  try { return await fn(c) } catch (e: any) {
    if (e instanceof BillingRefusal) return refusalReply(c, e)
    throw e
  }
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** A CSV file download. */
export function csvDownload(c: Context, filename: string, rows: unknown[][]) {
  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', `attachment; filename=${filename}`)
  return c.body(rows.map((r) => r.map(csvCell).join(',')).join('\n'))
}

/** A file download of the given type. */
export function download(c: Context, type: string, filename: string, content: string) {
  c.header('Content-Type', type)
  c.header('Content-Disposition', `attachment; filename=${filename}`)
  return c.body(content)
}

/** A request body without the keys a caller may never set: the row's id and which company it belongs to. */
export function withoutOwnership<T extends Record<string, any>>(b: T): Omit<T, 'id' | 'companyId' | 'company_id'> {
  const { id: _id, companyId: _c, company_id: _cc, ...rest } = (b && typeof b === 'object' ? b : {}) as any
  return rest
}
