/**
 * Platform Migration Service
 *
 * Automated data migration from competitor platforms:
 * - Jobber (API)
 * - ServiceTitan (API)
 * - Housecall Pro (API)
 * - Generic CSV with platform-specific presets
 *
 * Each provider connector:
 *   1. Authenticates with the platform API
 *   2. Fetches all data (contacts, jobs, invoices, etc.)
 *   3. Maps it to our schema
 *   4. Inserts with duplicate detection
 */

import { db } from '../../db/index.ts'
import { contact, project, job, quote, quoteLineItem, invoice, invoiceLineItem, payment, pricebookItem } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'

// ============================================
// TYPES
// ============================================

export interface MigrationProgress {
  provider: string
  status: 'connecting' | 'fetching' | 'importing' | 'complete' | 'error'
  phase: string
  total: number
  imported: number
  skipped: number
  errors: Array<{ entity: string; name: string; error: string }>
  startedAt: Date
  completedAt?: Date
}

export interface ProviderCredentials {
  provider: string
  apiKey?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  subdomain?: string
  tenantId?: string
}

// ============================================
// PLATFORM COLUMN PRESETS (for CSV imports)
// ============================================

export const PLATFORM_PRESETS: Record<string, {
  name: string
  description: string
  logo: string
  hasApi: boolean
  csvMappings: Record<string, Record<string, string[]>>
}> = {
  // Salon / barber booking apps. All CSV: export clients + services from the app, upload here.
  booksy: {
    name: 'Booksy',
    description: 'Import clients and services from a Booksy CSV export (Business settings → Clients / Services → Export)',
    logo: '/images/logos/booksy.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
  vagaro: {
    name: 'Vagaro',
    description: 'Import clients and services from Vagaro CSV exports (Reports → Customers / Services → Export)',
    logo: '/images/logos/vagaro.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
  squareappointments: {
    name: 'Square Appointments',
    description: 'Import clients and services from Square (Customers → Export; Items → Export)',
    logo: '/images/logos/squareappointments.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
  glossgenius: {
    name: 'GlossGenius',
    description: 'Import clients and services from GlossGenius CSV exports',
    logo: '/images/logos/glossgenius.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
  fresha: {
    name: 'Fresha',
    description: 'Import clients and services from Fresha CSV exports (Clients → Export)',
    logo: '/images/logos/fresha.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
  other: {
    name: 'Another app or a spreadsheet',
    description: 'Upload any CSV with a header row — you match the columns on the next screen',
    logo: '/images/logos/other.png',
    hasApi: false,
    csvMappings: {
      contacts: {
        name: ['client name', 'name', 'full name', 'customer name', 'client'],
        email: ['email', 'e-mail', 'client email'],
        phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone'],
        notes: ['notes', 'client notes', 'comments'],
        source: ['source', 'referral source', 'how did you hear'],
      },
      products: {
        name: ['service', 'service name', 'name', 'treatment'],
        description: ['description', 'details'],
        price: ['price', 'cost', 'amount'],
        duration: ['duration', 'duration (min)', 'time', 'length'],
        category: ['category', 'service category', 'type'],
      },
    },
  },
}

// ============================================
// API MIGRATION — JOBBER
// ============================================

async function migrateFromJobber(
  credentials: ProviderCredentials,
  companyId: string,
  progress: MigrationProgress
): Promise<MigrationProgress> {
  const { accessToken } = credentials
  if (!accessToken) throw new Error('Jobber access token required')

  const gql = async (query: string, variables: Record<string, any> = {}) => {
    const res = await fetch('https://api.getjobber.com/api/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-JOBBER-GRAPHQL-VERSION': '2024-11-15',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`Jobber API ${res.status}: ${await res.text()}`)
    const data = await res.json()
    if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL error')
    return data.data
  }

  // --- CLIENTS ---
  progress.phase = 'Importing clients'
  let hasNextPage = true
  let cursor: string | null = null

  while (hasNextPage) {
    const data = await gql(`
      query($cursor: String) {
        clients(first: 100, after: $cursor) {
          nodes {
            id
            firstName
            lastName
            companyName
            emails { address primary }
            phones { number primary }
            billingAddress { street1 street2 city province postalCode }
            notes { content }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { cursor })

    for (const c of data.clients.nodes) {
      try {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || 'Unknown'
        const email = c.emails?.find((e: any) => e.primary)?.address || c.emails?.[0]?.address || null
        const phone = c.phones?.find((p: any) => p.primary)?.number || c.phones?.[0]?.number || null
        const addr = c.billingAddress

        // Skip if duplicate
        if (email) {
          const [existing] = await db.select({ id: contact.id }).from(contact)
            .where(and(eq(contact.companyId, companyId), eq(contact.email, email))).limit(1)
          if (existing) { progress.skipped++; progress.total++; continue }
        }

        await db.insert(contact).values({
          companyId,
          name,
          email,
          phone,
          company: c.companyName || null,
          type: 'client',
          address: addr?.street1 || null,
          city: addr?.city || null,
          state: addr?.province || null,
          zip: addr?.postalCode || null,
          notes: c.notes?.map((n: any) => n.content).join('\n') || null,
          source: 'jobber_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'contact', name: c.firstName || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasNextPage = data.clients.pageInfo.hasNextPage
    cursor = data.clients.pageInfo.endCursor
  }

  // --- JOBS ---
  progress.phase = 'Importing jobs'
  hasNextPage = true
  cursor = null
  let jobNum = await getNextNumber(companyId, 'job')

  while (hasNextPage) {
    const data = await gql(`
      query($cursor: String) {
        jobs(first: 100, after: $cursor) {
          nodes {
            id
            title
            jobNumber
            jobStatus
            startAt
            endAt
            instructions
            client { firstName lastName }
            property { address { street1 city province postalCode } }
            lineItems { nodes { name description quantity unitPrice } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { cursor })

    for (const j of data.jobs.nodes) {
      try {
        // Find contact
        let contactId: string | null = null
        if (j.client) {
          const clientName = [j.client.firstName, j.client.lastName].filter(Boolean).join(' ')
          if (clientName) {
            const [found] = await db.select({ id: contact.id }).from(contact)
              .where(and(eq(contact.companyId, companyId), eq(contact.name, clientName))).limit(1)
            contactId = found?.id ?? null
          }
        }

        const addr = j.property?.address
        await db.insert(job).values({
          companyId,
          title: j.title || 'Imported Job',
          number: j.jobNumber?.toString() || `JOB-${String(jobNum++).padStart(5, '0')}`,
          status: mapJobberStatus(j.jobStatus),
          scheduledDate: j.startAt ? new Date(j.startAt) : null,
          scheduledEndDate: j.endAt ? new Date(j.endAt) : null,
          address: addr?.street1 || null,
          city: addr?.city || null,
          state: addr?.province || null,
          zip: addr?.postalCode || null,
          notes: j.instructions || null,
          contactId,
          source: 'jobber_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'job', name: j.title || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasNextPage = data.jobs.pageInfo.hasNextPage
    cursor = data.jobs.pageInfo.endCursor
  }

  // --- INVOICES ---
  progress.phase = 'Importing invoices'
  hasNextPage = true
  cursor = null
  let invNum = await getNextNumber(companyId, 'invoice')

  while (hasNextPage) {
    const data = await gql(`
      query($cursor: String) {
        invoices(first: 100, after: $cursor) {
          nodes {
            id
            invoiceNumber
            subject
            invoiceStatus
            amounts { total subtotal tax }
            issuedDate
            dueDate
            client { firstName lastName }
            lineItems { nodes { name description quantity unitPrice } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { cursor })

    for (const inv of data.invoices.nodes) {
      try {
        let contactId: string | null = null
        if (inv.client) {
          const clientName = [inv.client.firstName, inv.client.lastName].filter(Boolean).join(' ')
          if (clientName) {
            const [found] = await db.select({ id: contact.id }).from(contact)
              .where(and(eq(contact.companyId, companyId), eq(contact.name, clientName))).limit(1)
            contactId = found?.id ?? null
          }
        }

        const [created] = await db.insert(invoice).values({
          companyId,
          number: inv.invoiceNumber?.toString() || `INV-${String(invNum++).padStart(5, '0')}`,
          status: mapJobberInvoiceStatus(inv.invoiceStatus),
          total: inv.amounts?.total?.toString() || '0',
          subtotal: inv.amounts?.subtotal?.toString() || '0',
          tax: inv.amounts?.tax?.toString() || '0',
          issueDate: inv.issuedDate ? new Date(inv.issuedDate) : new Date(),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
          contactId,
          notes: inv.subject || null,
        }).returning()

        // Import line items
        if (inv.lineItems?.nodes) {
          for (const li of inv.lineItems.nodes) {
            await db.insert(invoiceLineItem).values({
              invoiceId: created.id,
              description: li.name || li.description || 'Item',
              quantity: String(li.quantity || 1),
              unitPrice: String(li.unitPrice || 0),
              total: String((li.quantity || 1) * (li.unitPrice || 0)),
            })
          }
        }

        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'invoice', name: inv.invoiceNumber || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasNextPage = data.invoices.pageInfo.hasNextPage
    cursor = data.invoices.pageInfo.endCursor
  }

  return progress
}

// ============================================
// API MIGRATION — SERVICETITAN
// ============================================

async function migrateFromServiceTitan(
  credentials: ProviderCredentials,
  companyId: string,
  progress: MigrationProgress
): Promise<MigrationProgress> {
  const { clientId, clientSecret, tenantId } = credentials
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('ServiceTitan requires clientId, clientSecret, and tenantId')
  }

  // Authenticate
  const authRes = await fetch('https://auth.servicetitan.io/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!authRes.ok) throw new Error(`ServiceTitan auth failed: ${authRes.status}`)
  const { access_token } = await authRes.json()

  const stApi = async (endpoint: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://api.servicetitan.io${endpoint}`)
    url.searchParams.set('tenant', tenantId)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${access_token}`, 'ST-App-Key': clientId },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`ServiceTitan API ${res.status}`)
    return res.json()
  }

  // --- CUSTOMERS ---
  progress.phase = 'Importing customers'
  let page = 1
  let hasMore = true

  while (hasMore) {
    const data = await stApi('/crm/v2/customers', { page: String(page), pageSize: '200' })

    for (const c of data.data || []) {
      try {
        const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'
        const email = c.email || null
        const phone = c.phone || null

        if (email) {
          const [existing] = await db.select({ id: contact.id }).from(contact)
            .where(and(eq(contact.companyId, companyId), eq(contact.email, email))).limit(1)
          if (existing) { progress.skipped++; progress.total++; continue }
        }

        await db.insert(contact).values({
          companyId,
          name,
          email,
          phone,
          type: 'client',
          address: c.address?.street || null,
          city: c.address?.city || null,
          state: c.address?.state || null,
          zip: c.address?.zip || null,
          source: 'servicetitan_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'contact', name: c.name || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = (data.data?.length || 0) >= 200
    page++
  }

  // --- JOBS ---
  progress.phase = 'Importing jobs'
  page = 1
  hasMore = true
  let jobNum = await getNextNumber(companyId, 'job')

  while (hasMore) {
    const data = await stApi('/jpm/v2/jobs', { page: String(page), pageSize: '200' })

    for (const j of data.data || []) {
      try {
        await db.insert(job).values({
          companyId,
          title: j.summary || j.jobType?.name || 'Imported Job',
          number: j.jobNumber || `JOB-${String(jobNum++).padStart(5, '0')}`,
          status: mapServiceTitanStatus(j.jobStatus),
          type: j.jobType?.name || null,
          scheduledDate: j.completedOn ? new Date(j.completedOn) : null,
          address: j.location?.address?.street || null,
          city: j.location?.address?.city || null,
          state: j.location?.address?.state || null,
          zip: j.location?.address?.zip || null,
          source: 'servicetitan_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'job', name: j.jobNumber || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = (data.data?.length || 0) >= 200
    page++
  }

  // --- INVOICES ---
  progress.phase = 'Importing invoices'
  page = 1
  hasMore = true
  let invNum = await getNextNumber(companyId, 'invoice')

  while (hasMore) {
    const data = await stApi('/accounting/v2/invoices', { page: String(page), pageSize: '200' })

    for (const inv of data.data || []) {
      try {
        await db.insert(invoice).values({
          companyId,
          number: inv.number || `INV-${String(invNum++).padStart(5, '0')}`,
          status: inv.balance > 0 ? 'sent' : 'paid',
          total: String(inv.total || 0),
          subtotal: String(inv.subtotal || inv.total || 0),
          tax: String(inv.salesTax || 0),
          issueDate: inv.createdOn ? new Date(inv.createdOn) : new Date(),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
        }).returning()
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'invoice', name: inv.number || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = (data.data?.length || 0) >= 200
    page++
  }

  return progress
}

// ============================================
// API MIGRATION — HOUSECALL PRO
// ============================================

async function migrateFromHousecallPro(
  credentials: ProviderCredentials,
  companyId: string,
  progress: MigrationProgress
): Promise<MigrationProgress> {
  const { apiKey } = credentials
  if (!apiKey) throw new Error('Housecall Pro API key required')

  const hcpApi = async (endpoint: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://api.housecallpro.com${endpoint}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`HCP API ${res.status}`)
    return res.json()
  }

  // --- CUSTOMERS ---
  progress.phase = 'Importing customers'
  let page = 1
  let hasMore = true

  while (hasMore) {
    const data = await hcpApi('/customers', { page: String(page), page_size: '200' })
    const customers = data.customers || data.data || []

    for (const c of customers) {
      try {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Unknown'
        const email = c.email || null

        if (email) {
          const [existing] = await db.select({ id: contact.id }).from(contact)
            .where(and(eq(contact.companyId, companyId), eq(contact.email, email))).limit(1)
          if (existing) { progress.skipped++; progress.total++; continue }
        }

        await db.insert(contact).values({
          companyId,
          name,
          email,
          phone: c.mobile_number || c.home_number || null,
          mobile: c.mobile_number || null,
          company: c.company_name || null,
          type: 'client',
          address: c.address?.street || c.street || null,
          city: c.address?.city || c.city || null,
          state: c.address?.state || c.state || null,
          zip: c.address?.zip || c.zip || null,
          source: 'housecallpro_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'contact', name: c.first_name || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = customers.length >= 200
    page++
  }

  // --- JOBS ---
  progress.phase = 'Importing jobs'
  page = 1
  hasMore = true
  let jobNum = await getNextNumber(companyId, 'job')

  while (hasMore) {
    const data = await hcpApi('/jobs', { page: String(page), page_size: '200' })
    const jobs = data.jobs || data.data || []

    for (const j of jobs) {
      try {
        let contactId: string | null = null
        if (j.customer?.id) {
          const custName = [j.customer.first_name, j.customer.last_name].filter(Boolean).join(' ')
          if (custName) {
            const [found] = await db.select({ id: contact.id }).from(contact)
              .where(and(eq(contact.companyId, companyId), eq(contact.name, custName))).limit(1)
            contactId = found?.id ?? null
          }
        }

        await db.insert(job).values({
          companyId,
          title: j.description || j.job_type || 'Imported Job',
          number: `JOB-${String(jobNum++).padStart(5, '0')}`,
          status: mapHCPStatus(j.work_status),
          scheduledDate: j.schedule?.scheduled_start ? new Date(j.schedule.scheduled_start) : null,
          address: j.address?.street || null,
          city: j.address?.city || null,
          state: j.address?.state || null,
          zip: j.address?.zip || null,
          contactId,
          source: 'housecallpro_migration',
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'job', name: j.description || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = jobs.length >= 200
    page++
  }

  // --- INVOICES ---
  progress.phase = 'Importing invoices'
  page = 1
  hasMore = true
  let invNum = await getNextNumber(companyId, 'invoice')

  while (hasMore) {
    const data = await hcpApi('/invoices', { page: String(page), page_size: '200' })
    const invoices_ = data.invoices || data.data || []

    for (const inv of invoices_) {
      try {
        await db.insert(invoice).values({
          companyId,
          number: inv.invoice_number || `INV-${String(invNum++).padStart(5, '0')}`,
          status: inv.paid ? 'paid' : 'sent',
          total: String(inv.total_amount || 0),
          subtotal: String(inv.subtotal || inv.total_amount || 0),
          tax: String(inv.tax_amount || 0),
          issueDate: inv.created_at ? new Date(inv.created_at) : new Date(),
          dueDate: inv.due_date ? new Date(inv.due_date) : null,
        })
        progress.imported++
      } catch (err: any) {
        progress.errors.push({ entity: 'invoice', name: inv.invoice_number || 'unknown', error: err.message })
        progress.skipped++
      }
      progress.total++
    }

    hasMore = invoices_.length >= 200
    page++
  }

  return progress
}

// ============================================
// STATUS MAPPERS
// ============================================

function mapJobberStatus(status: string): string {
  const s = (status || '').toLowerCase()
  if (s.includes('complet')) return 'completed'
  if (s.includes('active') || s.includes('progress')) return 'in_progress'
  if (s.includes('requir')) return 'scheduled'
  if (s.includes('late') || s.includes('overdue')) return 'scheduled'
  return 'pending'
}

function mapJobberInvoiceStatus(status: string): string {
  const s = (status || '').toLowerCase()
  if (s.includes('paid') || s.includes('collected')) return 'paid'
  if (s.includes('past_due') || s.includes('overdue')) return 'overdue'
  if (s.includes('awaiting')) return 'sent'
  if (s === 'draft') return 'draft'
  return 'sent'
}

function mapServiceTitanStatus(status: string): string {
  const s = (status || '').toLowerCase()
  if (s.includes('completed') || s.includes('done')) return 'completed'
  if (s.includes('in_progress') || s.includes('dispatched')) return 'in_progress'
  if (s.includes('scheduled') || s.includes('pending')) return 'scheduled'
  if (s.includes('canceled') || s.includes('cancelled')) return 'cancelled'
  return 'pending'
}

function mapHCPStatus(status: string): string {
  const s = (status || '').toLowerCase()
  if (s.includes('complete')) return 'completed'
  if (s.includes('in_progress') || s === 'working') return 'in_progress'
  if (s.includes('schedul') || s === 'needs scheduling') return 'scheduled'
  if (s.includes('cancel')) return 'cancelled'
  return 'pending'
}

// ============================================
// HELPERS
// ============================================

async function getNextNumber(companyId: string, entity: 'job' | 'invoice' | 'quote'): Promise<number> {
  const table = entity === 'job' ? job : entity === 'invoice' ? invoice : quote
  const [last] = await db.select({ number: table.number })
    .from(table)
    .where(eq(table.companyId, companyId))
    .orderBy(desc(table.createdAt))
    .limit(1)

  if (!last?.number) return 1
  const match = last.number.match(/(\d+)/)
  return match ? parseInt(match[1]) + 1 : 1
}

// ============================================
// MAIN MIGRATION RUNNER
// ============================================

const activeMigrations = new Map<string, MigrationProgress>()

export async function startMigration(
  provider: string,
  credentials: ProviderCredentials,
  companyId: string
): Promise<string> {
  const migrationId = `${companyId}_${provider}_${Date.now()}`

  const progress: MigrationProgress = {
    provider,
    status: 'connecting',
    phase: 'Connecting to ' + provider,
    total: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    startedAt: new Date(),
  }

  activeMigrations.set(migrationId, progress)

  // Run async
  ;(async () => {
    try {
      progress.status = 'fetching'

      switch (provider) {
        case 'jobber':
          await migrateFromJobber(credentials, companyId, progress)
          break
        case 'servicetitan':
          await migrateFromServiceTitan(credentials, companyId, progress)
          break
        case 'housecallpro':
          await migrateFromHousecallPro(credentials, companyId, progress)
          break
        default:
          throw new Error(`Unknown provider: ${provider}`)
      }

      progress.status = 'complete'
      progress.completedAt = new Date()
    } catch (err: any) {
      progress.status = 'error'
      progress.phase = err.message
      progress.completedAt = new Date()
    }
  })()

  return migrationId
}

export function getMigrationProgress(migrationId: string): MigrationProgress | null {
  return activeMigrations.get(migrationId) || null
}

export function getAvailableProviders() {
  return Object.entries(PLATFORM_PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    description: p.description,
    hasApi: p.hasApi,
    csvEntityTypes: Object.keys(p.csvMappings),
  }))
}

export default {
  startMigration,
  getMigrationProgress,
  getAvailableProviders,
  PLATFORM_PRESETS,
}
