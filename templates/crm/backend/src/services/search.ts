/**
 * Global Search Service
 *
 * Searches across all entities: contacts, projects, jobs, quotes, invoices, etc.
 * Returns unified results with type, name, and link.
 */

import { db } from '../../db/index.ts'
import { contact, project, job, quote, invoice, document, teamMember, rfi } from '../../db/schema.ts'
import { eq, and, or, ilike, desc, asc, sql } from 'drizzle-orm'

interface SearchResult {
  type: string
  subtype: string | null
  id: string
  name: string
  description: string
  url: string
  icon: string
}

/**
 * Search all entities
 */
export async function globalSearch(
  companyId: string,
  query: string,
  options: { limit?: number; types?: string[] | null } = {}
) {
  const { limit = 20, types = null } = options

  if (!query || query.length < 2) {
    return { results: [], query }
  }

  const searchTerm = query.trim()
  const perType = Math.ceil(limit / 6)
  const pattern = `%${searchTerm}%`

  const searchTypes = types || ['contact', 'project', 'job', 'quote', 'invoice', 'document']

  const searches: Promise<SearchResult[]>[] = []

  // Contacts
  if (searchTypes.includes('contact')) {
    searches.push(
      db
        .select({ id: contact.id, name: contact.name, type: contact.type, email: contact.email, company: contact.company })
        .from(contact)
        .where(
          and(
            eq(contact.companyId, companyId),
            or(
              ilike(contact.name, pattern),
              ilike(contact.email, pattern),
              ilike(contact.company, pattern),
              ilike(contact.phone, pattern)
            )
          )
        )
        .orderBy(desc(contact.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'contact',
            subtype: item.type,
            id: item.id,
            name: item.name,
            description: item.company || item.email || '',
            url: `/contacts/${item.id}`,
            icon: 'user',
          }))
        )
    )
  }

  // Projects
  if (searchTypes.includes('project')) {
    searches.push(
      db
        .select({ id: project.id, name: project.name, number: project.number, status: project.status })
        .from(project)
        .where(
          and(
            eq(project.companyId, companyId),
            or(
              ilike(project.name, pattern),
              ilike(project.number, pattern),
              ilike(project.description, pattern),
              ilike(project.address, pattern)
            )
          )
        )
        .orderBy(desc(project.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'project',
            subtype: item.status,
            id: item.id,
            name: item.name,
            description: item.number,
            url: `/projects/${item.id}`,
            icon: 'folder',
          }))
        )
    )
  }

  // Jobs
  if (searchTypes.includes('job')) {
    searches.push(
      db
        .select({ id: job.id, title: job.title, number: job.number, status: job.status })
        .from(job)
        .where(
          and(
            eq(job.companyId, companyId),
            or(
              ilike(job.title, pattern),
              ilike(job.number, pattern),
              ilike(job.description, pattern)
            )
          )
        )
        .orderBy(desc(job.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'job',
            subtype: item.status,
            id: item.id,
            name: item.title,
            description: item.number,
            url: `/jobs/${item.id}`,
            icon: 'wrench',
          }))
        )
    )
  }

  // Quotes
  if (searchTypes.includes('quote')) {
    searches.push(
      db
        .select({ id: quote.id, name: quote.name, number: quote.number, status: quote.status, total: quote.total })
        .from(quote)
        .where(
          and(
            eq(quote.companyId, companyId),
            or(ilike(quote.number, pattern), ilike(quote.name, pattern))
          )
        )
        .orderBy(desc(quote.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'quote',
            subtype: item.status,
            id: item.id,
            name: item.name || item.number,
            description: `${item.number} - $${Number(item.total).toLocaleString()}`,
            url: `/quotes/${item.id}`,
            icon: 'file-text',
          }))
        )
    )
  }

  // Invoices
  if (searchTypes.includes('invoice')) {
    searches.push(
      db
        .select({ id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total })
        .from(invoice)
        .where(and(eq(invoice.companyId, companyId), ilike(invoice.number, pattern)))
        .orderBy(desc(invoice.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'invoice',
            subtype: item.status,
            id: item.id,
            name: item.number,
            description: `$${Number(item.total).toLocaleString()} - ${item.status}`,
            url: `/invoices/${item.id}`,
            icon: 'file-invoice',
          }))
        )
    )
  }

  // Documents
  if (searchTypes.includes('document')) {
    searches.push(
      db
        .select({ id: document.id, name: document.name, type: document.type, mimeType: document.mimeType })
        .from(document)
        .where(
          and(
            eq(document.companyId, companyId),
            or(ilike(document.name, pattern), ilike(document.description, pattern))
          )
        )
        .orderBy(desc(document.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'document',
            subtype: item.type,
            id: item.id,
            name: item.name,
            description: item.mimeType || '',
            url: `/documents/${item.id}`,
            icon: 'file',
          }))
        )
    )
  }

  // Team Members
  if (searchTypes.includes('team')) {
    searches.push(
      db
        .select({ id: teamMember.id, name: teamMember.name, role: teamMember.role, email: teamMember.email })
        .from(teamMember)
        .where(
          and(
            eq(teamMember.companyId, companyId),
            or(ilike(teamMember.name, pattern), ilike(teamMember.email, pattern))
          )
        )
        .orderBy(asc(teamMember.name))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'team',
            subtype: item.role,
            id: item.id,
            name: item.name,
            description: item.role || item.email || '',
            url: `/team/${item.id}`,
            icon: 'users',
          }))
        )
    )
  }

  // RFIs
  if (searchTypes.includes('rfi')) {
    searches.push(
      db
        .select({ id: rfi.id, number: rfi.number, subject: rfi.subject, status: rfi.status })
        .from(rfi)
        .where(
          and(
            eq(rfi.companyId, companyId),
            or(ilike(rfi.number, pattern), ilike(rfi.subject, pattern))
          )
        )
        .orderBy(desc(rfi.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'rfi',
            subtype: item.status,
            id: item.id,
            name: item.subject,
            description: item.number,
            url: `/rfis/${item.id}`,
            icon: 'help-circle',
          }))
        )
    )
  }

  // Execute all searches in parallel
  const resultsArrays = await Promise.all(searches)

  // Flatten and sort by relevance
  let results = resultsArrays.flat()

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

  return {
    results,
    query: searchTerm,
    count: results.length,
  }
}

/**
 * Quick search - lighter weight, just names
 */
export async function quickSearch(companyId: string, query: string, limit = 10) {
  if (!query || query.length < 2) {
    return []
  }

  const results = await globalSearch(companyId, query, { limit })
  return results.results.map((r) => ({
    type: r.type,
    id: r.id,
    name: r.name,
    url: r.url,
  }))
}

/**
 * Get recent items (for empty search state)
 */
export async function getRecentItems(companyId: string, limit = 10) {
  const [contacts, projects, jobs] = await Promise.all([
    db
      .select({ id: contact.id, name: contact.name, type: contact.type })
      .from(contact)
      .where(eq(contact.companyId, companyId))
      .orderBy(desc(contact.updatedAt))
      .limit(3),
    db
      .select({ id: project.id, name: project.name, number: project.number })
      .from(project)
      .where(eq(project.companyId, companyId))
      .orderBy(desc(project.updatedAt))
      .limit(3),
    db
      .select({ id: job.id, title: job.title, number: job.number })
      .from(job)
      .where(eq(job.companyId, companyId))
      .orderBy(desc(job.updatedAt))
      .limit(4),
  ])

  return [
    ...contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, url: `/contacts/${c.id}` })),
    ...projects.map((p) => ({ type: 'project', id: p.id, name: p.name, url: `/projects/${p.id}` })),
    ...jobs.map((j) => ({ type: 'job', id: j.id, name: j.title, url: `/jobs/${j.id}` })),
  ].slice(0, limit)
}

export default { globalSearch, quickSearch, getRecentItems }
