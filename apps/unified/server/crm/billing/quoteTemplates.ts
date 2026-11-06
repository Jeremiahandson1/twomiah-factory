// /api/quote-templates — saved quotes to start the next one from (feature quote_templates, not ready).
//
//   GET    /                 quotes:read    the company's templates: name, how many lines, what they add up to
//   GET    /:id              quotes:read    one template, shaped as the New Quote form takes it (prefills it; nothing is created)
//   POST   /                 quotes:create  { quoteId, name } — save a quote as a template
//   PUT    /:id              quotes:update  { name } — rename
//   DELETE /:id              quotes:delete  remove one
//
// "Create similar" and "From a template" both prefill the New Quote form; saving that form is the one ordinary POST /api/quotes,
// so numbering, totals, tax, the expiry and every rule on a new quote stay the quote route's own. A template is NOT a quote: it
// has no number, no customer and no dates, and no report counts it. What a template keeps of a quote: the name, notes, terms,
// customer message, tax rate, deposit and the lines (description, type, quantity, price, section, cost code, allowance, optional
// and the markup). What it leaves: the customer, project, job, expiry, signature, status — and the Good/Better/Best options,
// whose lines belong to a choice a customer made on that one quote.
// Cost-side line fields (unitCost, markupPct) are kept in the template and sent only to a seat with margin:read, the rule the
// quote itself follows; a seat without it starts from the prices alone.
// Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { round2 } from '@twomiah/tenant-backend'
import { quote, quoteLineItem, quoteTemplate } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one, done } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'

const nameSchema = z.object({ name: z.string().trim().min(1, 'Give the template a name').max(120, 'Keep the name under 120 characters') })
const saveSchema = nameSchema.extend({ quoteId: z.string().min(1, 'Pick the quote to save') })

interface TemplateLine {
  description: string; quantity: number; unitPrice: number
  type?: string; unitCost?: number; pricebookItemId?: string; optional?: boolean; selected?: boolean
  section?: string; markupPct?: number; allowance?: boolean; costCode?: string
}
interface TemplateBody {
  name: string; notes: string; terms: string; customerMessage: string; taxRate: number
  depositType: 'percent' | 'fixed' | null; depositValue: number; lineItems: TemplateLine[]
}

/** One quote line as a template keeps it: only what was set, as plain numbers. */
const lineOf = (li: any): TemplateLine => ({
  description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice),
  ...(li.type ? { type: li.type } : {}),
  ...(li.unitCost === null || li.unitCost === undefined ? {} : { unitCost: Number(li.unitCost) }),
  ...(li.pricebookItemId ? { pricebookItemId: li.pricebookItemId } : {}),
  ...(li.optional ? { optional: true, selected: !!li.selected } : {}),
  ...(li.section ? { section: li.section } : {}),
  ...(li.markupPct === null || li.markupPct === undefined ? {} : { markupPct: Number(li.markupPct) }),
  ...(li.allowance ? { allowance: true } : {}),
  ...(li.costCode ? { costCode: li.costCode } : {}),
})

/** The template as the caller may see it: without what the company pays unless they hold margin:read. */
export function templateFor(body: TemplateBody, mayMargin: boolean): TemplateBody {
  if (mayMargin) return body
  return { ...body, lineItems: body.lineItems.map(({ unitCost: _c, markupPct: _m, ...rest }) => rest) }
}

export function createQuoteTemplateRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const find = async (companyId: string, id: string) =>
    (await db.select().from(quoteTemplate).where(and(eq(quoteTemplate.id, id), eq(quoteTemplate.companyId, companyId))).limit(1))[0]
  const nameTaken = async (companyId: string, name: string, exceptId?: string) => {
    const rows = await db.select({ id: quoteTemplate.id, name: quoteTemplate.name }).from(quoteTemplate).where(eq(quoteTemplate.companyId, companyId))
    return rows.some((r: any) => r.id !== exceptId && String(r.name).trim().toLowerCase() === name.trim().toLowerCase())
  }

  app.get('/', requirePermission('quotes:read'), async (c) => {
    const rows = await db.select().from(quoteTemplate).where(eq(quoteTemplate.companyId, c.get('user').companyId)).orderBy(desc(quoteTemplate.updatedAt))
    return listAll(c, rows.map((r: any) => {
      const b = r.body as TemplateBody
      const lines = (b.lineItems || []).filter((l) => !l.optional || l.selected)
      return { id: r.id, name: r.name, lineCount: (b.lineItems || []).length, total: round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)), updatedAt: r.updatedAt }
    }))
  })

  app.get('/:id', requirePermission('quotes:read'), async (c) => {
    const user = c.get('user')
    const row = await find(user.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Template not found')
    return one(c, { id: row.id, name: row.name, body: templateFor(row.body as TemplateBody, await mayWith(user.role, 'margin:read', user.userId)) })
  })

  app.post('/', requirePermission('quotes:create'), async (c) => {
    const parsed = saveSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const user = c.get('user')
    const [q] = await db.select().from(quote).where(and(eq(quote.id, parsed.data.quoteId), eq(quote.companyId, user.companyId))).limit(1)
    if (!q) return fail(c, 404, 'Quote not found')
    if (await nameTaken(user.companyId, parsed.data.name)) return fail(c, 409, 'You already have a template with that name. Pick another name.')
    // Read from the saved quote itself (never from what the browser sends), minus the lines of a Good/Better/Best option.
    const lines = await db.select().from(quoteLineItem).where(and(eq(quoteLineItem.quoteId, q.id), isNull(quoteLineItem.proposalOptionId))).orderBy(asc(quoteLineItem.sortOrder), asc(quoteLineItem.id))
    if (!lines.length) return fail(c, 400, 'That quote has no lines to save.')
    const body: TemplateBody = {
      name: q.name, notes: q.notes || '', terms: q.terms || '', customerMessage: q.customerMessage || '', taxRate: Number(q.taxRate) || 0,
      depositType: q.depositType === 'percent' || q.depositType === 'fixed' ? q.depositType : null, depositValue: Number(q.depositValue) || 0,
      lineItems: lines.map(lineOf),
    }
    const [row] = await db.insert(quoteTemplate).values({ companyId: user.companyId, name: parsed.data.name, body, createdById: user.userId ?? null }).returning()
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'quote_template', entityId: row.id, entityName: row.name, metadata: { fromQuote: q.number, lines: lines.length }, req: c })
    return one(c, { id: row.id, name: row.name, lineCount: lines.length }, 201)
  })

  app.put('/:id', requirePermission('quotes:update'), async (c) => {
    const parsed = nameSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const user = c.get('user')
    const row = await find(user.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Template not found')
    if (await nameTaken(user.companyId, parsed.data.name, row.id)) return fail(c, 409, 'You already have a template with that name. Pick another name.')
    await db.update(quoteTemplate).set({ name: parsed.data.name, updatedAt: new Date() }).where(eq(quoteTemplate.id, row.id))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'quote_template', entityId: row.id, entityName: parsed.data.name, metadata: { was: row.name }, req: c })
    return one(c, { id: row.id, name: parsed.data.name })
  })

  app.delete('/:id', requirePermission('quotes:delete'), async (c) => {
    const user = c.get('user')
    const row = await find(user.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Template not found')
    await db.delete(quoteTemplate).where(eq(quoteTemplate.id, row.id))
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'quote_template', entityId: row.id, entityName: row.name, req: c })
    return done(c, 'Template deleted')
  })

  return app
}
