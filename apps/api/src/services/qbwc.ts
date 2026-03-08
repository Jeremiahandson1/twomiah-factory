/**
 * QuickBooks Web Connector (QBWC) Service
 *
 * Implements the QBWC SOAP protocol so QB Desktop (2006+) can poll this
 * endpoint on a schedule and sync customers, invoices, and payments.
 *
 * Flow:
 *   1. authenticate  → validate username/password, return session ticket
 *   2. sendRequestXML → return next qbXML request (CustomerAdd, InvoiceAdd, etc.)
 *   3. receiveResponseXML → process QB's response, store QB IDs
 *   4. repeat 2-3 until no more requests
 *   5. closeConnection
 *
 * Environment:
 *   QBWC_USERNAME  — username the Web Connector sends (default: "twomiah")
 *   QBWC_PASSWORD  — shared secret configured in the Web Connector
 *   QBWC_COMPANY_FILE — optional path to QB company file (blank = currently open)
 */

import { supabase } from '../middleware/auth'
import Stripe from 'stripe'

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncSession {
  ticket: string
  step: number
  requests: string[]
  createdAt: number
}

// In-memory session store (sessions live ~5 min max)
const sessions = new Map<string, SyncSession>()

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string | null | undefined): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function generateTicket(): string {
  return crypto.randomUUID()
}

// Clean up stale sessions older than 10 minutes
function cleanSessions() {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [ticket, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(ticket)
  }
}

// ── Build qbXML Requests ─────────────────────────────────────────────────────

function wrapQbXml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<?qbxml version="13.0"?>\n<QBXML>\n<QBXMLMsgsRq onError="continueOnError">\n${body}\n</QBXMLMsgsRq>\n</QBXML>`
}

function customerAddXml(tenant: any, requestID: string): string {
  const name = escapeXml((tenant.name || tenant.slug || 'Customer').slice(0, 41))
  const email = escapeXml(tenant.email || '')
  const phone = escapeXml(tenant.phone || '')

  return wrapQbXml(`<CustomerAddRq requestID="${requestID}">
  <CustomerAdd>
    <Name>${name}</Name>
    <CompanyName>${name}</CompanyName>
    ${email ? `<Email>${email}</Email>` : ''}
    ${phone ? `<Phone>${phone}</Phone>` : ''}
  </CustomerAdd>
</CustomerAddRq>`)
}

function invoiceAddXml(invoice: any, customerName: string, requestID: string): string {
  const refNumber = escapeXml(invoice.number || invoice.id)
  const txnDate = new Date((invoice.created || 0) * 1000).toISOString().slice(0, 10)
  const dueDate = invoice.due_date ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10) : txnDate
  const custName = escapeXml(customerName.slice(0, 41))

  const lines = (invoice.lines?.data || []).map((line: any, i: number) => {
    const desc = escapeXml(line.description || `Line ${i + 1}`)
    const amount = ((line.amount || 0) / 100).toFixed(2)
    return `  <InvoiceLineAdd>
    <Desc>${desc}</Desc>
    <Amount>${amount}</Amount>
  </InvoiceLineAdd>`
  }).join('\n')

  return wrapQbXml(`<InvoiceAddRq requestID="${requestID}">
  <InvoiceAdd>
    <CustomerRef><FullName>${custName}</FullName></CustomerRef>
    <TxnDate>${txnDate}</TxnDate>
    <RefNumber>${refNumber}</RefNumber>
    <DueDate>${dueDate}</DueDate>
    ${lines}
  </InvoiceAdd>
</InvoiceAddRq>`)
}

function paymentAddXml(payment: any, customerName: string, invoiceRefNumber: string, requestID: string): string {
  const txnDate = new Date((payment.created || 0) * 1000).toISOString().slice(0, 10)
  const amount = ((payment.amount || 0) / 100).toFixed(2)
  const custName = escapeXml(customerName.slice(0, 41))
  const refNum = escapeXml(invoiceRefNumber)

  return wrapQbXml(`<ReceivePaymentAddRq requestID="${requestID}">
  <ReceivePaymentAdd>
    <CustomerRef><FullName>${custName}</FullName></CustomerRef>
    <TxnDate>${txnDate}</TxnDate>
    <TotalAmount>${amount}</TotalAmount>
    <AppliedToTxnAdd>
      <TxnID></TxnID>
      <RefNumber>${refNum}</RefNumber>
      <PaymentAmount>${amount}</PaymentAmount>
    </AppliedToTxnAdd>
  </ReceivePaymentAdd>
</ReceivePaymentAddRq>`)
}

// ── Build Sync Request Queue ─────────────────────────────────────────────────

async function buildSyncRequests(): Promise<string[]> {
  const requests: string[] = []
  let reqId = 1

  // 1. Sync tenants as QB customers
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, name, slug, email, phone, qb_desktop_id')
    .is('qb_desktop_id', null)
    .limit(50)

  for (const tenant of tenants || []) {
    requests.push(customerAddXml(tenant, String(reqId++)))
  }

  // 2. Sync Stripe invoices (last 30 days, not yet synced)
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
  if (stripe) {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400

    // Get tenants with stripe IDs for name lookup
    const { data: allTenants } = await supabase
      .from('tenants')
      .select('id, name, slug, stripe_customer_id, qb_desktop_synced_invoices')

    const tenantMap = new Map<string, any>()
    for (const t of allTenants || []) {
      if (t.stripe_customer_id) tenantMap.set(t.stripe_customer_id, t)
    }

    try {
      const invoices = await stripe.invoices.list({
        created: { gte: since },
        status: 'paid',
        limit: 50,
        expand: ['data.lines'],
      })

      for (const inv of invoices.data) {
        const tenant = tenantMap.get(inv.customer as string)
        if (!tenant) continue

        // Skip already-synced invoices
        const synced: string[] = tenant.qb_desktop_synced_invoices || []
        if (synced.includes(inv.id)) continue

        const custName = tenant.name || tenant.slug || 'Customer'
        requests.push(invoiceAddXml(inv, custName, String(reqId++)))

        // Also sync the payment
        if (inv.charge) {
          const refNumber = inv.number || inv.id
          requests.push(paymentAddXml(
            { created: inv.status_transitions?.paid_at || inv.created, amount: inv.amount_paid },
            custName,
            refNumber,
            String(reqId++)
          ))
        }
      }
    } catch (err: any) {
      console.error('[QBWC] Stripe invoice fetch error:', err.message)
    }
  }

  return requests
}

// ── SOAP Method Handlers ─────────────────────────────────────────────────────

export async function handleAuthenticate(username: string, password: string): Promise<{ ticket: string; result: string }> {
  cleanSessions()

  const expectedUser = process.env.QBWC_USERNAME || 'twomiah'
  const expectedPass = process.env.QBWC_PASSWORD || ''

  if (!expectedPass) {
    return { ticket: '', result: 'nvu' } // not valid user — password not configured
  }

  if (username !== expectedUser || password !== expectedPass) {
    return { ticket: '', result: 'nvu' }
  }

  const ticket = generateTicket()
  const requests = await buildSyncRequests()

  if (requests.length === 0) {
    return { ticket, result: 'none' } // nothing to sync
  }

  sessions.set(ticket, { ticket, step: 0, requests, createdAt: Date.now() })
  return { ticket, result: '' } // empty string = valid, proceed with company file
}

export function handleSendRequestXML(ticket: string): string {
  const session = sessions.get(ticket)
  if (!session || session.step >= session.requests.length) return '' // no more requests

  const xml = session.requests[session.step]
  return xml
}

export async function handleReceiveResponseXML(ticket: string, response: string): Promise<number> {
  const session = sessions.get(ticket)
  if (!session) return -1

  // Parse QB response for ListID/TxnID to store back
  await processQbResponse(response, session.step, session.requests[session.step])

  session.step++

  if (session.step >= session.requests.length) {
    return 100 // 100% done
  }

  // Return progress percentage
  return Math.floor((session.step / session.requests.length) * 100)
}

export function handleCloseConnection(ticket: string): string {
  sessions.delete(ticket)
  return 'OK'
}

export function handleGetLastError(ticket: string): string {
  return '' // no error tracking for now
}

export function handleServerVersion(): string {
  return '1.0.0'
}

export function handleClientVersion(_version: string): string {
  return '' // empty = client version is OK
}

export function handleConnectionError(ticket: string, _message: string): string {
  sessions.delete(ticket)
  return 'done'
}

// ── Process QB Response ──────────────────────────────────────────────────────

async function processQbResponse(responseXml: string, stepIndex: number, requestXml: string) {
  try {
    // Extract ListID from CustomerAdd response
    const listIdMatch = responseXml.match(/<ListID>([^<]+)<\/ListID>/)
    const statusCode = responseXml.match(/statusCode="(\d+)"/)
    const code = statusCode ? statusCode[1] : '0'

    if (code !== '0' && code !== '0') {
      const msg = responseXml.match(/statusMessage="([^"]*)"/)
      console.warn(`[QBWC] QB returned status ${code}: ${msg?.[1] || 'unknown'}`)
      return
    }

    if (requestXml.includes('<CustomerAddRq') && listIdMatch) {
      // Find which tenant this was for by matching the Name
      const nameMatch = requestXml.match(/<Name>([^<]+)<\/Name>/)
      if (nameMatch) {
        const name = nameMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id')
          .or(`name.eq.${name},slug.eq.${name}`)
          .limit(1)
          .maybeSingle()

        if (tenant) {
          await supabase.from('tenants').update({ qb_desktop_id: listIdMatch[1] }).eq('id', tenant.id)
        }
      }
    }

    if (requestXml.includes('<InvoiceAddRq')) {
      // Store synced invoice ID
      const refMatch = requestXml.match(/<RefNumber>([^<]+)<\/RefNumber>/)
      if (refMatch) {
        // Find tenant by customer name in the request
        const custMatch = requestXml.match(/<FullName>([^<]+)<\/FullName>/)
        if (custMatch) {
          const custName = custMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          const { data: tenant } = await supabase
            .from('tenants')
            .select('id, qb_desktop_synced_invoices')
            .or(`name.eq.${custName},slug.eq.${custName}`)
            .limit(1)
            .maybeSingle()

          if (tenant) {
            const synced: string[] = tenant.qb_desktop_synced_invoices || []
            synced.push(refMatch[1])
            await supabase.from('tenants').update({ qb_desktop_synced_invoices: synced }).eq('id', tenant.id)
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[QBWC] Error processing QB response:', err.message)
  }
}

// ── SOAP Envelope Parser + Builder ───────────────────────────────────────────

function extractSoapBody(xml: string): { method: string; params: Record<string, string> } {
  // Extract method name from SOAP body
  const methodMatch = xml.match(/<(\w+)\s+xmlns="http:\/\/developer\.intuit\.com\/">/)
  if (!methodMatch) {
    // Try without namespace
    const fallback = xml.match(/<(?:soap[^:]*:)?Body[^>]*>\s*<(\w+)/)
    if (!fallback) return { method: '', params: {} }
    return extractParams(fallback[1], xml)
  }
  return extractParams(methodMatch[1], xml)
}

function extractParams(method: string, xml: string): { method: string; params: Record<string, string> } {
  const params: Record<string, string> = {}
  // Common QBWC parameters
  const paramNames = ['strUserName', 'strPassword', 'ticket', 'strHCPResponse', 'strCompanyFileName',
    'qbXMLCountry', 'qbXMLMajorVers', 'qbXMLMinorVers', 'response', 'hresult', 'message',
    'strNewVersion', 'strOldVersion']

  for (const name of paramNames) {
    const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
    if (match) params[name] = match[1]
  }
  return { method, params }
}

export function buildSoapResponse(method: string, resultXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${method}Response xmlns="http://developer.intuit.com/">
      ${resultXml}
    </${method}Response>
  </soap:Body>
</soap:Envelope>`
}

// ── Main SOAP Dispatcher ─────────────────────────────────────────────────────

export async function handleSoapRequest(rawXml: string): Promise<string> {
  const { method, params } = extractSoapBody(rawXml)

  switch (method) {
    case 'serverVersion': {
      const ver = handleServerVersion()
      return buildSoapResponse(method, `<serverVersionResult>${escapeXml(ver)}</serverVersionResult>`)
    }

    case 'clientVersion': {
      const result = handleClientVersion(params.strNewVersion || '')
      return buildSoapResponse(method, `<clientVersionResult>${escapeXml(result)}</clientVersionResult>`)
    }

    case 'authenticate': {
      const { ticket, result } = await handleAuthenticate(params.strUserName || '', params.strPassword || '')
      return buildSoapResponse(method, `<authenticateResult><string>${escapeXml(ticket)}</string><string>${escapeXml(result)}</string></authenticateResult>`)
    }

    case 'sendRequestXML': {
      const xml = handleSendRequestXML(params.ticket || '')
      return buildSoapResponse(method, `<sendRequestXMLResult>${xml ? escapeXml(xml) : ''}</sendRequestXMLResult>`)
    }

    case 'receiveResponseXML': {
      const pct = await handleReceiveResponseXML(params.ticket || '', params.response || '')
      return buildSoapResponse(method, `<receiveResponseXMLResult>${pct}</receiveResponseXMLResult>`)
    }

    case 'closeConnection': {
      const msg = handleCloseConnection(params.ticket || '')
      return buildSoapResponse(method, `<closeConnectionResult>${escapeXml(msg)}</closeConnectionResult>`)
    }

    case 'getLastError': {
      const err = handleGetLastError(params.ticket || '')
      return buildSoapResponse(method, `<getLastErrorResult>${escapeXml(err)}</getLastErrorResult>`)
    }

    case 'connectionError': {
      const result = handleConnectionError(params.ticket || '', params.message || '')
      return buildSoapResponse(method, `<connectionErrorResult>${escapeXml(result)}</connectionErrorResult>`)
    }

    default:
      console.warn('[QBWC] Unknown SOAP method:', method)
      return buildSoapResponse(method || 'unknownMethod', `<result>Unknown method</result>`)
  }
}

// ── QWC Config File Generator ────────────────────────────────────────────────

export function generateQwcFile(baseUrl: string, appName: string = 'Twomiah Factory'): string {
  const appId = crypto.randomUUID()
  const fileId = crypto.randomUUID()
  const ownerId = crypto.randomUUID()
  const username = process.env.QBWC_USERNAME || 'twomiah'

  return `<?xml version="1.0"?>
<QBWCXML>
  <AppName>${escapeXml(appName)}</AppName>
  <AppID>${appId}</AppID>
  <AppURL>${escapeXml(baseUrl)}/api/v1/qbwc/soap</AppURL>
  <AppDescription>Syncs Twomiah Factory customers, invoices, and payments with QuickBooks Desktop.</AppDescription>
  <AppSupport>${escapeXml(baseUrl)}</AppSupport>
  <UserName>${escapeXml(username)}</UserName>
  <OwnerID>{${ownerId}}</OwnerID>
  <FileID>{${fileId}}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>30</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>`
}
