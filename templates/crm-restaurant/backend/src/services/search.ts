/**
 * Global Search Service
 *
 * Searches across a venue's entities: contacts, events, spaces, catering menus,
 * invoices, documents, and staff. Construction entities (projects/jobs/quotes/RFIs)
 * were removed when the restaurant/events CRM was scoped down — they linked to
 * routes that no longer exist. Returns unified results with type, name, and link.
 */

import { db } from '../../db/index.ts'
import { contact, invoice, document, teamMember, event, eventSpace, menuPackage } from '../../db/schema.ts'
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
  const perType = Math.ceil(limit / 5)
  const pattern = `%${searchTerm}%`

  const searchTypes = types || ['contact', 'event', 'space', 'menu', 'invoice', 'document']

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
            url: `/crm/contacts/${item.id}`,
            icon: 'user',
          }))
        )
    )
  }

  // Events (enquiry → confirmed bookings)
  if (searchTypes.includes('event')) {
    searches.push(
      db
        .select({ id: event.id, name: event.name, status: event.status, eventDate: event.eventDate })
        .from(event)
        .where(and(eq(event.companyId, companyId), or(ilike(event.name, pattern), ilike(event.notes, pattern))))
        .orderBy(desc(event.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'event', subtype: item.status, id: item.id, name: item.name || 'Untitled event',
            description: item.eventDate ? String(item.eventDate) : '', url: `/crm/events/${item.id}`, icon: 'calendar',
          }))
        )
    )
  }

  // Spaces
  if (searchTypes.includes('space')) {
    searches.push(
      db
        .select({ id: eventSpace.id, name: eventSpace.name })
        .from(eventSpace)
        .where(and(eq(eventSpace.companyId, companyId), ilike(eventSpace.name, pattern)))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'space', subtype: null, id: item.id, name: item.name, description: 'Space', url: `/crm/spaces`, icon: 'map-pin',
          }))
        )
    )
  }

  // Catering menu packages
  if (searchTypes.includes('menu')) {
    searches.push(
      db
        .select({ id: menuPackage.id, name: menuPackage.name })
        .from(menuPackage)
        .where(and(eq(menuPackage.companyId, companyId), ilike(menuPackage.name, pattern)))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'menu', subtype: null, id: item.id, name: item.name, description: 'Catering package', url: `/crm/menus`, icon: 'utensils',
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
 * Get recent items (for empty search state) — recent contacts and events.
 */
export async function getRecentItems(companyId: string, limit = 10) {
  const [contacts, events] = await Promise.all([
    db
      .select({ id: contact.id, name: contact.name, type: contact.type })
      .from(contact)
      .where(eq(contact.companyId, companyId))
      .orderBy(desc(contact.updatedAt))
      .limit(5),
    db
      .select({ id: event.id, name: event.name })
      .from(event)
      .where(eq(event.companyId, companyId))
      .orderBy(desc(event.updatedAt))
      .limit(5),
  ])

  return [
    ...contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, url: `/crm/contacts/${c.id}` })),
    ...events.map((e) => ({ type: 'event', id: e.id, name: e.name || 'Untitled event', url: `/crm/events/${e.id}` })),
  ].slice(0, limit)
}

export default { globalSearch, quickSearch, getRecentItems }
