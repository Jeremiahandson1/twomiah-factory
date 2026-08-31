/**
 * Global Search Service
 *
 * Searches a dealership's entities: customers, units (inventory by VIN/stock/make),
 * deals, repair orders, invoices, and documents. Construction entities
 * (projects/jobs/quotes/RFIs) were removed when the RV CRM was scoped down — they
 * linked to routes that no longer exist. Returns unified results with type, name, link.
 */

import { db } from '../../db/index.ts'
import { contact, unit, salesLead, repairOrder, invoice, document, teamMember } from '../../db/schema.ts'
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

  const searchTypes = types || ['contact', 'unit', 'deal', 'repair-order', 'invoice', 'document']

  const searches: Promise<SearchResult[]>[] = []

  // Customers / contacts
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

  // Units / inventory — the dealership searches by VIN, stock #, make/model
  if (searchTypes.includes('unit')) {
    searches.push(
      db
        .select({ id: unit.id, year: unit.year, make: unit.make, modelName: unit.modelName, stockNumber: unit.stockNumber, vin: unit.vin, status: unit.status })
        .from(unit)
        .where(
          and(
            eq(unit.companyId, companyId),
            or(
              ilike(unit.stockNumber, pattern),
              ilike(unit.vin, pattern),
              ilike(unit.make, pattern),
              ilike(unit.modelName, pattern)
            )
          )
        )
        .orderBy(desc(unit.year))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'unit',
            subtype: item.status,
            id: item.id,
            name: [item.year, item.make, item.modelName].filter(Boolean).join(' ') || 'Unit',
            description: [item.stockNumber && `Stock ${item.stockNumber}`, item.vin && `VIN ${item.vin}`].filter(Boolean).join(' · '),
            url: `/crm/units`,
            icon: 'truck',
          }))
        )
    )
  }

  // Deals / sales pipeline
  if (searchTypes.includes('deal')) {
    searches.push(
      db
        .select({ id: salesLead.id, stage: salesLead.stage, source: salesLead.source, notes: salesLead.notes })
        .from(salesLead)
        .where(
          and(
            eq(salesLead.companyId, companyId),
            or(ilike(salesLead.notes, pattern), ilike(salesLead.source, pattern), ilike(salesLead.stage, pattern))
          )
        )
        .orderBy(desc(salesLead.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'deal',
            subtype: item.stage,
            id: item.id,
            name: `Deal · ${item.stage || 'open'}`,
            description: item.source || '',
            url: `/crm/sales-pipeline`,
            icon: 'file-text',
          }))
        )
    )
  }

  // Repair orders / service
  if (searchTypes.includes('repair-order')) {
    searches.push(
      db
        .select({ id: repairOrder.id, roNumber: repairOrder.roNumber, status: repairOrder.status, advisorName: repairOrder.advisorName })
        .from(repairOrder)
        .where(
          and(
            eq(repairOrder.companyId, companyId),
            or(ilike(repairOrder.roNumber, pattern), ilike(repairOrder.advisorName, pattern), ilike(repairOrder.notes, pattern))
          )
        )
        .orderBy(desc(repairOrder.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'repair-order',
            subtype: item.status,
            id: item.id,
            name: `RO ${item.roNumber || ''}`.trim(),
            description: item.advisorName || item.status || '',
            url: `/crm/service`,
            icon: 'wrench',
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
            url: `/crm/documents`,
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

  const resultsArrays = await Promise.all(searches)
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

  return { results, query: searchTerm, count: results.length }
}

export async function quickSearch(companyId: string, query: string, limit = 10) {
  if (!query || query.length < 2) return []
  const results = await globalSearch(companyId, query, { limit })
  return results.results.map((r) => ({ type: r.type, id: r.id, name: r.name, url: r.url }))
}

/** Recent items (empty search state) — recent customers and units. */
export async function getRecentItems(companyId: string, limit = 10) {
  const [contacts, units] = await Promise.all([
    db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, companyId)).orderBy(desc(contact.updatedAt)).limit(5),
    db.select({ id: unit.id, year: unit.year, make: unit.make, modelName: unit.modelName }).from(unit).where(eq(unit.companyId, companyId)).orderBy(desc(unit.year)).limit(5),
  ])
  return [
    ...contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, url: `/crm/contacts/${c.id}` })),
    ...units.map((u) => ({ type: 'unit', id: u.id, name: [u.year, u.make, u.modelName].filter(Boolean).join(' ') || 'Unit', url: `/crm/units` })),
  ].slice(0, limit)
}

export default { globalSearch, quickSearch, getRecentItems }
