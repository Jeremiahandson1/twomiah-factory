// Global search across contacts, projects, jobs, quotes, invoices, documents, team and RFIs: one list of results,
// each with its type, name and link. Moved from templates/crm/backend/src/services/search.ts.
import { eq, and, or, ilike, desc, asc } from 'drizzle-orm'
import { deriveStatus } from '@twomiah/tenant-backend'
import { contact, project, job, quote, invoice, document, teamMember, rfi } from '../../db/schema/index.ts'

interface SearchResult {
  type: string
  subtype: string | null
  id: string
  name: string
  description: string
  url: string
  icon: string
}

const money = (v: unknown) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function createSearchService(db: any) {
  async function globalSearch(companyId: string, query: string | undefined, options: { limit?: number; types?: string[] | null } = {}) {
    const { limit = 20, types = null } = options
    if (!query || query.length < 2) return { results: [] as SearchResult[], query }

    const searchTerm = query.trim()
    const perType = Math.ceil(limit / 6)
    const pattern = `%${searchTerm}%`
    const searchTypes = types || ['contact', 'project', 'job', 'quote', 'invoice', 'document']
    const searches: Promise<SearchResult[]>[] = []

    if (searchTypes.includes('contact')) {
      searches.push(db
        .select({ id: contact.id, name: contact.name, type: contact.type, email: contact.email, company: contact.company })
        .from(contact)
        .where(and(eq(contact.companyId, companyId), or(ilike(contact.name, pattern), ilike(contact.email, pattern), ilike(contact.company, pattern), ilike(contact.phone, pattern))))
        .orderBy(desc(contact.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'contact', subtype: item.type, id: item.id, name: item.name,
          description: item.company || item.email || '', url: `/crm/contacts/${item.id}`, icon: 'user',
        }))))
    }

    if (searchTypes.includes('project')) {
      searches.push(db
        .select({ id: project.id, name: project.name, number: project.number, status: project.status })
        .from(project)
        .where(and(eq(project.companyId, companyId), or(ilike(project.name, pattern), ilike(project.number, pattern), ilike(project.description, pattern), ilike(project.address, pattern))))
        .orderBy(desc(project.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'project', subtype: item.status, id: item.id, name: item.name,
          description: item.number, url: `/crm/projects/${item.id}`, icon: 'folder',
        }))))
    }

    if (searchTypes.includes('job')) {
      searches.push(db
        .select({ id: job.id, title: job.title, number: job.number, status: job.status })
        .from(job)
        .where(and(eq(job.companyId, companyId), or(ilike(job.title, pattern), ilike(job.number, pattern), ilike(job.description, pattern))))
        .orderBy(desc(job.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'job', subtype: item.status, id: item.id, name: item.title,
          description: item.number, url: `/crm/jobs/${item.id}`, icon: 'wrench',
        }))))
    }

    if (searchTypes.includes('quote')) {
      searches.push(db
        .select({ id: quote.id, name: quote.name, number: quote.number, status: quote.status, total: quote.total })
        .from(quote)
        .where(and(eq(quote.companyId, companyId), or(ilike(quote.number, pattern), ilike(quote.name, pattern))))
        .orderBy(desc(quote.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'quote', subtype: item.status, id: item.id, name: item.name || item.number,
          description: `${item.number} - $${money(item.total)}`, url: `/crm/quotes/${item.id}`, icon: 'file-text',
        }))))
    }

    if (searchTypes.includes('invoice')) {
      searches.push(db
        // everything deriveStatus needs: "overdue" is computed at read time, never stored (T14 H10)
        .select({ id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total, dueDate: invoice.dueDate, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded })
        .from(invoice)
        .where(and(eq(invoice.companyId, companyId), ilike(invoice.number, pattern)))
        .orderBy(desc(invoice.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'invoice', subtype: deriveStatus(item), id: item.id, name: item.number,
          description: `$${money(item.total)} - ${deriveStatus(item)}`, url: `/crm/invoices/${item.id}`, icon: 'file-invoice',
        }))))
    }

    if (searchTypes.includes('document')) {
      searches.push(db
        .select({ id: document.id, name: document.name, type: document.type, mimeType: document.mimeType })
        .from(document)
        .where(and(eq(document.companyId, companyId), or(ilike(document.name, pattern), ilike(document.description, pattern))))
        .orderBy(desc(document.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'document', subtype: item.type, id: item.id, name: item.name,
          description: item.mimeType || '', url: `/crm/documents/${item.id}`, icon: 'file',
        }))))
    }

    if (searchTypes.includes('team')) {
      searches.push(db
        .select({ id: teamMember.id, name: teamMember.name, role: teamMember.role, email: teamMember.email })
        .from(teamMember)
        .where(and(eq(teamMember.companyId, companyId), or(ilike(teamMember.name, pattern), ilike(teamMember.email, pattern))))
        .orderBy(asc(teamMember.name))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'team', subtype: item.role, id: item.id, name: item.name,
          description: item.role || item.email || '', url: `/crm/team/${item.id}`, icon: 'users',
        }))))
    }

    if (searchTypes.includes('rfi')) {
      searches.push(db
        .select({ id: rfi.id, number: rfi.number, subject: rfi.subject, status: rfi.status })
        .from(rfi)
        .where(and(eq(rfi.companyId, companyId), or(ilike(rfi.number, pattern), ilike(rfi.subject, pattern))))
        .orderBy(desc(rfi.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'rfi', subtype: item.status, id: item.id, name: item.subject,
          description: item.number, url: `/crm/rfis/${item.id}`, icon: 'help-circle',
        }))))
    }

    let results = (await Promise.all(searches)).flat()

    // Exact names first, then names that start with the query.
    const lowerQuery = searchTerm.toLowerCase()
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === lowerQuery
      const bExact = b.name.toLowerCase() === lowerQuery
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1
      const aStarts = a.name.toLowerCase().startsWith(lowerQuery)
      const bStarts = b.name.toLowerCase().startsWith(lowerQuery)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return 0
    })
    results = results.slice(0, limit)
    return { results, query: searchTerm, count: results.length }
  }

  /** Lighter: names and links only. */
  async function quickSearch(companyId: string, query: string | undefined, limit = 10) {
    if (!query || query.length < 2) return []
    const r = await globalSearch(companyId, query, { limit })
    return r.results.map((x) => ({ type: x.type, id: x.id, name: x.name, url: x.url }))
  }

  /** The most recently changed contacts, projects and jobs (the empty search box). */
  async function getRecentItems(companyId: string, limit = 10) {
    const [contacts, projects, jobs] = await Promise.all([
      db.select({ id: contact.id, name: contact.name, type: contact.type }).from(contact).where(eq(contact.companyId, companyId)).orderBy(desc(contact.updatedAt)).limit(3),
      db.select({ id: project.id, name: project.name, number: project.number }).from(project).where(eq(project.companyId, companyId)).orderBy(desc(project.updatedAt)).limit(3),
      db.select({ id: job.id, title: job.title, number: job.number }).from(job).where(eq(job.companyId, companyId)).orderBy(desc(job.updatedAt)).limit(4),
    ])
    return [
      ...contacts.map((c: any) => ({ type: 'contact', id: c.id, name: c.name, url: `/contacts/${c.id}` })),
      ...projects.map((p: any) => ({ type: 'project', id: p.id, name: p.name, url: `/projects/${p.id}` })),
      ...jobs.map((j: any) => ({ type: 'job', id: j.id, name: j.title, url: `/jobs/${j.id}` })),
    ].slice(0, limit)
  }

  return { globalSearch, quickSearch, getRecentItems }
}
