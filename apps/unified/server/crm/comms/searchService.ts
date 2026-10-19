// Global search across contacts, projects, jobs, quotes, invoices, documents, team and RFIs: one list of results,
// each with its type, name and link. Moved from templates/crm/backend/src/services/search.ts.
import { eq, and, or, ilike, desc, asc } from 'drizzle-orm'
import { deriveStatus } from '@twomiah/tenant-backend'
import { contact, project, job, quote, invoice, document, teamMember, rfi, event, eventSpace, menuPackage } from '../../db/schema/index.ts'
import { patient } from '../../db/schema/index.ts'
import { searchUnits } from '../../data/rvDealership.ts'
import { barMenuItem, barTap } from '../../db/schema/index.ts'
import { serviceMenu } from '../../db/schema/index.ts'
import { NON_CLIENT_TYPES } from '../salon/people.ts'

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

/**
 * Where a contact opens. Where the business keeps client charts (a salon's client_profiles), a client belongs on their
 * chart — formula history, visits, memberships — not the generic contacts page; leads and suppliers have no chart.
 * (templates/crm-salon services/search.ts, Salon T28 L7)
 */
const contactLink = (clientChart: boolean) => (id: string, type: unknown) =>
  clientChart && !NON_CLIENT_TYPES.includes(String(type || '') as typeof NON_CLIENT_TYPES[number]) ? `/crm/clients/${id}` : `/crm/contacts/${id}`

export function createSearchService(db: any) {
  async function globalSearch(companyId: string, query: string | undefined, options: { limit?: number; types?: string[] | null; clientChart?: boolean } = {}) {
    const { limit = 20, types = null } = options
    const contactUrl = contactLink(!!options.clientChart)
    if (!query || query.length < 2) return { results: [] as SearchResult[], query }

    const searchTerm = query.trim()
    const perType = Math.ceil(limit / 6)
    const pattern = `%${searchTerm}%`
    // 'patient' first: the pet is what a clinic searches by (templates/crm-vet services/search.ts). Where the business
    // has no patient records the route leaves the type out (search.ts TYPE_FEATURES).
    const searchTypes = types || ['patient', 'contact', 'project', 'job', 'quote', 'invoice', 'document']
    const searches: Promise<SearchResult[]>[] = []

    if (searchTypes.includes('patient')) {
      searches.push(db
        .select({ id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, microchip: patient.microchip })
        .from(patient)
        .where(and(eq(patient.companyId, companyId), or(ilike(patient.name, pattern), ilike(patient.breed, pattern), ilike(patient.microchip, pattern))))
        .orderBy(desc(patient.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'patient', subtype: item.species, id: item.id, name: item.name,
          description: [item.species, item.breed].filter(Boolean).join(' · '), url: `/crm/patients/${item.id}`, icon: 'paw',
        }))))
    }

    // A dealership's units by stock number, VIN, make, model, trim or year; a result opens Inventory filtered to it (there
    // is no per-unit page). (templates/crm-rv services/search.ts, RV T19 M7: "Bennington" found nothing)
    if (searchTypes.includes('unit')) {
      searches.push(searchUnits(db, companyId, pattern, perType).then((items) => items.map((item) => ({
        type: 'unit', subtype: item.status, id: item.id,
        name: [item.year, item.make, item.modelName, item.trim].filter(Boolean).join(' ') || item.stockNumber || 'Unit',
        description: [item.stockNumber ? `Stock ${item.stockNumber}` : '', item.status].filter(Boolean).join(' · '),
        url: `/crm/units?search=${encodeURIComponent(item.stockNumber || item.vin || item.modelName || '')}`, icon: 'caravan',
      }))))
    }

    if (searchTypes.includes('contact')) {
      searches.push(db
        .select({ id: contact.id, name: contact.name, type: contact.type, email: contact.email, company: contact.company })
        .from(contact)
        .where(and(eq(contact.companyId, companyId), or(ilike(contact.name, pattern), ilike(contact.email, pattern), ilike(contact.company, pattern), ilike(contact.phone, pattern))))
        .orderBy(desc(contact.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'contact', subtype: item.type, id: item.id, name: item.name,
          description: item.company || item.email || '', url: contactUrl(item.id, item.type), icon: 'user',
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
          description: item.mimeType || '', url: '/crm/documents', icon: 'file',
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
          description: item.role || item.email || '', url: '/crm/team', icon: 'users',
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
          description: item.number, url: '/crm/rfis', icon: 'help-circle',
        }))))
    }

    // A venue's own records: events (enquiry → confirmed bookings), its rooms and its catering packages
    // (templates/crm-restaurant and crm-bar services/search.ts, H-03). Asked for by the caller only where they're on.
    if (searchTypes.includes('event')) {
      searches.push(db
        .select({ id: event.id, name: event.name, status: event.status, eventDate: event.eventDate })
        .from(event)
        .where(and(eq(event.companyId, companyId), or(ilike(event.name, pattern), ilike(event.notes, pattern))))
        .orderBy(desc(event.updatedAt))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'event', subtype: item.status, id: item.id, name: item.name || 'Untitled event',
          description: item.eventDate ? String(item.eventDate) : '', url: `/crm/events/${item.id}`, icon: 'calendar',
        }))))
    }

    // A salon's service menu, by name or category (templates/crm-salon services/search.ts).
    if (searchTypes.includes('service')) {
      searches.push(db
        .select({ id: serviceMenu.id, name: serviceMenu.name, category: serviceMenu.category, price: serviceMenu.price })
        .from(serviceMenu)
        .where(and(eq(serviceMenu.companyId, companyId), eq(serviceMenu.active, true), or(ilike(serviceMenu.name, pattern), ilike(serviceMenu.category, pattern))))
        .orderBy(asc(serviceMenu.name))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'service', subtype: item.category || '', id: item.id, name: item.name,
          description: [item.category, item.price != null ? `${Number(item.price).toFixed(2)}` : ''].filter(Boolean).join(' · '),
          url: '/crm/service-menu', icon: 'scissors',
        }))))
    }

    if (searchTypes.includes('space')) {
      searches.push(db
        .select({ id: eventSpace.id, name: eventSpace.name })
        .from(eventSpace)
        .where(and(eq(eventSpace.companyId, companyId), ilike(eventSpace.name, pattern)))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'space', subtype: null, id: item.id, name: item.name, description: 'Space', url: '/crm/spaces', icon: 'map-pin',
        }))))
    }

    if (searchTypes.includes('menu')) {
      searches.push(db
        .select({ id: menuPackage.id, name: menuPackage.name })
        .from(menuPackage)
        .where(and(eq(menuPackage.companyId, companyId), ilike(menuPackage.name, pattern)))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'menu', subtype: null, id: item.id, name: item.name, description: 'Catering package', url: '/crm/menus', icon: 'utensils',
        }))))
    }

    // A bar's menu items (86 status shows in the description) and its taps (templates/crm-bar services/search.ts).
    if (searchTypes.includes('item')) {
      searches.push(db
        .select({ id: barMenuItem.id, name: barMenuItem.name, is86ed: barMenuItem.is86ed })
        .from(barMenuItem)
        .where(and(eq(barMenuItem.companyId, companyId), ilike(barMenuItem.name, pattern)))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'item', subtype: null, id: item.id, name: item.name, description: item.is86ed ? 'Menu · 86' : 'Menu', url: '/crm/menu', icon: 'utensils',
        }))))
    }

    if (searchTypes.includes('tap')) {
      searches.push(db
        .select({ id: barTap.id, name: barTap.beerName, line: barTap.lineNumber })
        .from(barTap)
        .where(and(eq(barTap.companyId, companyId), eq(barTap.isActive, true), ilike(barTap.beerName, pattern)))
        .limit(perType)
        .then((items: any[]) => items.map((item) => ({
          type: 'tap', subtype: null, id: item.id, name: item.name, description: `Tap ${item.line}`, url: '/crm/taps', icon: 'beer',
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

  // Documents, team members and RFIs have no page of their own: their results open the list they are on. Every link
  // is under /crm, where the screens are (the template's Recent links had no prefix and opened the home page).
  /** Lighter: names and links only. */
  async function quickSearch(companyId: string, query: string | undefined, limit = 10, options: { types?: string[]; clientChart?: boolean } = {}) {
    if (!query || query.length < 2) return []
    const r = await globalSearch(companyId, query, { limit, ...options })
    return r.results.map((x) => ({ type: x.type, id: x.id, name: x.name, url: x.url }))
  }

  /** The most recently changed contacts, projects and jobs (the empty search box). */
  async function getRecentItems(companyId: string, limit = 10, clientChart = false) {
    const [contacts, projects, jobs] = await Promise.all([
      db.select({ id: contact.id, name: contact.name, type: contact.type }).from(contact).where(eq(contact.companyId, companyId)).orderBy(desc(contact.updatedAt)).limit(3),
      db.select({ id: project.id, name: project.name, number: project.number }).from(project).where(eq(project.companyId, companyId)).orderBy(desc(project.updatedAt)).limit(3),
      db.select({ id: job.id, title: job.title, number: job.number }).from(job).where(eq(job.companyId, companyId)).orderBy(desc(job.updatedAt)).limit(4),
    ])
    return [
      ...contacts.map((c: any) => ({ type: 'contact', id: c.id, name: c.name, url: contactLink(clientChart)(c.id, c.type) })),
      ...projects.map((p: any) => ({ type: 'project', id: p.id, name: p.name, url: `/crm/projects/${p.id}` })),
      ...jobs.map((j: any) => ({ type: 'job', id: j.id, name: j.title, url: `/crm/jobs/${j.id}` })),
    ].slice(0, limit)
  }

  return { globalSearch, quickSearch, getRecentItems }
}
