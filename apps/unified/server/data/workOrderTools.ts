// Work orders from the proposal, saved scopes, and CompanyCam photos (roofing parity row 26; Roofr Work Orders 2.0; feature
// work_order_tools, not ready). The routes are crm/roof/workOrders.ts.
//
//   · from the proposal: the job's signed (approved) quote — the lines the homeowner agreed to, labour and "other" lines included,
//     an option not chosen left out — as the order's scope (one line each, with its quantity) and its material lines (the material
//     ones). NEVER a price: the crew's page shows what to do, not what the homeowner pays.
//   · templates: a scope saved under a name and used on the next order.
//   · CompanyCam: THE STEP LEFT is the business's CompanyCam account (its API token, entered in Settings); until a client is
//     connected the office is told so (NO_ACCOUNT). The job's own photos go on the order today.
// Raw reads here (RULEBOOK §2).
import { and, asc, desc, eq, or } from 'drizzle-orm'
import { includedLines } from '@twomiah/tenant-backend'
import { quote, quoteLineItem, workOrderTemplate } from '../db/schema/index.ts'

export const WORK_ORDER_TOOLS = 'work_order_tools'
export const MAX_TEMPLATES = 100

/** The job's signed proposal as a work order's scope and material lines, or null when the job has no approved quote. */
export async function fromProposal(db: any, companyId: string, jobId: string) {
  const [q] = await db.select().from(quote).where(and(eq(quote.companyId, companyId), eq(quote.status, 'approved'), or(eq(quote.jobId, jobId), eq(quote.convertedToJobId, jobId))))
    .orderBy(desc(quote.approvedAt), desc(quote.createdAt)).limit(1)
  if (!q) return null
  const lines: any[] = includedLines(await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, q.id)).orderBy(asc(quoteLineItem.sortOrder), asc(quoteLineItem.id)))
    .filter((l: any) => l.type !== 'text' || String(l.description || '').trim())
  const qty = (l: any) => { const n = Number(l.quantity); return Number.isFinite(n) && n !== 1 ? ` × ${Number.isInteger(n) ? n : n.toFixed(2)}` : '' }
  const scope = [`From signed proposal ${q.number}${q.name ? ` — ${q.name}` : ''}:`, ...lines.map((l) => (l.type === 'text' ? String(l.description).trim() : `• ${String(l.description || '').trim()}${qty(l)}`))].join('\n')
  const materialLines = lines.filter((l) => l.type === 'material').map((l) => ({ description: String(l.description || '').trim().slice(0, 200), qty: Number(l.quantity) || 1, unit: 'ea' }))
  return { quoteId: q.id, quoteNumber: q.number, scope: scope.slice(0, 5000), materialLines }
}

export const listTemplates = (db: any, companyId: string) =>
  db.select().from(workOrderTemplate).where(eq(workOrderTemplate.companyId, companyId)).orderBy(asc(workOrderTemplate.name))

export interface CompanyCamClient {
  name: string
  photos(projectRef: { address: string | null; jobNumber: string | null }): Promise<Array<{ id: string; url: string; capturedAt: string | null; caption: string | null }>>
}
let testClient: CompanyCamClient | null = null
/** Tests only. */
export function useCompanyCamForTests(c: CompanyCamClient | null) { testClient = c }
/** The business's CompanyCam client — none until its account is connected (see THE STEP LEFT above). */
export const companyCamFor = (_companyId: string): CompanyCamClient | null => testClient
