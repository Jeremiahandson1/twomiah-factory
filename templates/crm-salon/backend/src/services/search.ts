/**
 * Global Search Service
 *
 * Searches across a salon's entities: clients (contacts), invoices, documents,
 * and staff. Construction entities (projects/jobs/quotes/RFIs) were removed when
 * the salon CRM was scoped down — they linked to routes that no longer exist.
 * Returns unified results with type, name, and link.
 */

import { db } from '../../db/index.ts'
import { contact, invoice, document, teamMember } from '../../db/schema.ts'
import { eq, and, or, ilike, desc, asc } from 'drizzle-orm'

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
  const perType = Math.ceil(limit / 4)
  const pattern = `%${searchTerm}%`

  const searchTypes = types || ['contact', 'invoice', 'document']

  const searches: Promise<SearchResult[]>[] = []

  // Clients / contacts
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
            url: `/crm/contacts/${item.id}`,
            icon: 'user',
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
            url: `/crm/invoices/${item.id}`,
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
            url: `/crm/documents/${item.id}`,
            icon: 'file',
          }))
        )
    )
  }

  // Team Members (stylists)
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
            url: `/crm/team/${item.id}`,
            icon: 'users',
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
 * Get recent items (for empty search state) — recent clients only.
 */
export async function getRecentItems(companyId: string, limit = 10) {
  const contacts = await db
    .select({ id: contact.id, name: contact.name, type: contact.type })
    .from(contact)
    .where(eq(contact.companyId, companyId))
    .orderBy(desc(contact.updatedAt))
    .limit(limit)

  return contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, url: `/crm/contacts/${c.id}` }))
}

export default { globalSearch, quickSearch, getRecentItems }
