/**
 * Global Search Service
 *
 * Searches across dispensary entities: contacts, products, orders.
 * Returns unified results with type, name, and link.
 */

import { db } from '../../db/index.ts'
import { contact, product, order, document, teamMember } from '../../db/schema.ts'
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
  const perType = Math.ceil(limit / 4)
  const pattern = `%${searchTerm}%`

  const searchTypes = types || ['contact', 'product', 'order', 'document']

  const searches: Promise<SearchResult[]>[] = []

  // Contacts (customers)
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

  // Products
  if (searchTypes.includes('product')) {
    searches.push(
      db
        .select({ id: product.id, name: product.name, category: product.category, sku: product.sku, brand: product.brand, price: product.price })
        .from(product)
        .where(
          and(
            eq(product.companyId, companyId),
            or(
              ilike(product.name, pattern),
              ilike(product.sku, pattern),
              ilike(product.brand, pattern),
              ilike(product.strainName, pattern),
              ilike(product.description, pattern)
            )
          )
        )
        .orderBy(desc(product.updatedAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'product',
            subtype: item.category,
            id: item.id,
            name: item.name,
            description: `${item.category}${item.sku ? ` - ${item.sku}` : ''} - $${item.price}`,
            url: `/products/${item.id}`,
            icon: 'package',
          }))
        )
    )
  }

  // Orders
  if (searchTypes.includes('order')) {
    searches.push(
      db
        .select({
          id: order.id,
          orderNumber: order.orderNumber,
          number: order.number,
          status: order.status,
          total: order.total,
          customerName: order.customerName,
        })
        .from(order)
        .where(
          and(
            eq(order.companyId, companyId),
            or(
              ilike(order.number, pattern),
              ilike(order.customerName, pattern),
              sql`CAST(${order.orderNumber} AS TEXT) LIKE ${pattern}`,
            )
          )
        )
        .orderBy(desc(order.createdAt))
        .limit(perType)
        .then((items) =>
          items.map((item) => ({
            type: 'order',
            subtype: item.status,
            id: item.id,
            name: `Order #${item.orderNumber || item.number || item.id.slice(0, 8)}`,
            description: `$${Number(item.total).toFixed(2)} - ${item.status}${item.customerName ? ` - ${item.customerName}` : ''}`,
            url: `/orders/${item.id}`,
            icon: 'shopping-cart',
          }))
        )
    )
  }

  // Documents
  if (searchTypes.includes('document')) {
    searches.push(
      db
        .select({ id: document.id, name: document.name, type: document.type })
        .from(document)
        .where(
          and(
            eq(document.companyId, companyId),
            ilike(document.name, pattern)
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
            description: item.type || '',
            url: `/documents/${item.id}`,
            icon: 'file',
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
  const [contacts, products, orders] = await Promise.all([
    db
      .select({ id: contact.id, name: contact.name, type: contact.type })
      .from(contact)
      .where(eq(contact.companyId, companyId))
      .orderBy(desc(contact.updatedAt))
      .limit(3),
    db
      .select({ id: product.id, name: product.name, category: product.category })
      .from(product)
      .where(eq(product.companyId, companyId))
      .orderBy(desc(product.updatedAt))
      .limit(3),
    db
      .select({ id: order.id, orderNumber: order.orderNumber, number: order.number, status: order.status })
      .from(order)
      .where(eq(order.companyId, companyId))
      .orderBy(desc(order.createdAt))
      .limit(4),
  ])

  return [
    ...contacts.map((c) => ({ type: 'contact', id: c.id, name: c.name, url: `/contacts/${c.id}` })),
    ...products.map((p) => ({ type: 'product', id: p.id, name: p.name, url: `/products/${p.id}` })),
    ...orders.map((o) => ({ type: 'order', id: o.id, name: `Order #${o.orderNumber || o.number || o.id.slice(0, 8)}`, url: `/orders/${o.id}` })),
  ].slice(0, limit)
}

export default { globalSearch, quickSearch, getRecentItems }
