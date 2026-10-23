// A visit invoice's own public page (/d/<token> — the link its email carries, and the client portal's "View and pay"),
// and Stripe's return page (/payment-success). Moved from templates/crm-homecare/frontend/src/components/PaymentPage.tsx.
//
// One rule with the CRM's invoices (live test, 2026-10-23): the page is reached by the invoice's token, never its id (it
// was /pay/<invoice id>); it always shows what is owed; a card is offered only when the agency can take one, and
// otherwise the page says plainly how to pay, with the agency's phone and email — it showed "Error: Card payments are
// not available on your account yet — contact Twomiah" to a family when Stripe was not set up.
//
// Server (server/crm/homecare/billing/stripe.ts, /api/stripe, public):
//   GET  /api/stripe/document/:token        → { invoiceNumber, clientName, total, amountPaid, amountDue (text, 2 places),
//                                              status, dueDate, billingPeriod, payOnline, business: { name, phone, email } };
//                                              404 for an unknown link or a draft
//   POST /api/stripe/document/:token/pay    → { url } (Stripe Checkout, the agency's account); refused 400 when nothing is
//                                              owed or the agency doesn't take cards online
//   GET  /api/stripe/verify-payment/:id?doc → { success: true, amount, invoiceId, customerEmail } or { success: false, status }
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { formatDate } from '../lib/date'
import { agencyNameFromPage, publicCall } from './portalHttp'
import { money } from '@twomiah/tenant-ui/src/money'

interface DocInvoice {
  invoiceNumber: string
  clientName: string
  total: string | number | null
  amountPaid?: string | number | null
  amountDue: string | number | null
  status: string
  dueDate?: string | null
  billingPeriod?: { start: string | null; end: string | null }
  payOnline: boolean
  business?: { name: string | null; phone: string | null; email: string | null }
}

const dollars = (v: unknown) => (parseFloat(String(v ?? 0)) || 0).toFixed(2)

export default function PaymentPage({ token }: { token: string }) {
  const { search } = useLocation()
  const cancelled = new URLSearchParams(search).get('cancelled') === 'true'
  const [invoice, setInvoice] = useState<DocInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageAgency = agencyNameFromPage()
  const pageEmail = document.querySelector('meta[name="company-email"]')?.getAttribute('content') || ''

  useEffect(() => {
    let live = true
    publicCall<DocInvoice>('GET', `/api/stripe/document/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!live) return
        // The server's own sentence ("This link is not valid. Please contact the business that sent it.").
        if (!r.ok) throw new Error(r.error || 'This link is not valid. Please contact the business that sent it.')
        setInvoice(r.data)
      })
      .catch((err: Error) => { if (live) setError(err.message || 'This link is not valid. Please contact the business that sent it.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [token])

  const handlePayment = async () => {
    setProcessing(true)
    setError(null)
    try {
      const r = await publicCall<{ url?: string }>('POST', `/api/stripe/document/${encodeURIComponent(token)}/pay`)
      if (r.ok && r.data.url) {
        window.location.href = r.data.url // Stripe Checkout
      } else {
        throw new Error(r.error || 'Failed to create payment session')
      }
    } catch (err) {
      setError((err as Error).message)
      setProcessing(false)
    }
  }

  const agency = invoice?.business?.name || pageAgency
  const email = invoice?.business?.email || pageEmail
  const phone = invoice?.business?.phone || ''
  const reach = [phone, email].filter(Boolean).join(' or ')

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <p>Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (error && !invoice) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          {pageAgency && <h1 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)', fontSize: '1.5rem' }}>{pageAgency}</h1>}
          <h2 style={{ color: 'var(--hc-red-ink)' }}>This link can't be opened</h2>
          <p>{error}</p>
          {pageEmail && <p>Contact us at <strong>{pageEmail}</strong>.</p>}
        </div>
      </div>
    )
  }

  const owed = parseFloat(String(invoice?.amountDue ?? 0)) || 0
  if (invoice?.status === 'paid' || owed <= 0) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.successIcon}>✓</div>
          <h2 style={{ color: 'var(--hc-green-ink)' }}>Invoice Paid</h2>
          <p>Invoice #{invoice?.invoiceNumber} has been paid in full. Thank you!</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={{ margin: 0, color: 'var(--hc-ink)' }}>{agency}</h1>
        </div>

        {cancelled && <div style={styles.cancelledBanner}>Payment was cancelled. You can try again below.</div>}

        <div style={styles.invoiceHeader}>
          <h2>Invoice #{invoice?.invoiceNumber}</h2>
          <p style={styles.clientName}>{invoice?.clientName}</p>
        </div>

        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span>Billing Period:</span>
            <span>
              {invoice?.billingPeriod?.start && formatDate(invoice.billingPeriod.start)} - {' '}
              {invoice?.billingPeriod?.end && formatDate(invoice.billingPeriod.end)}
            </span>
          </div>
          {invoice?.dueDate && (
            <div style={styles.detailRow}>
              <span>Due:</span>
              <span>{formatDate(invoice.dueDate)}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span>Invoice Total:</span>
            <span>{money(invoice?.total)}</span>
          </div>
          {parseFloat(String(invoice?.amountPaid ?? 0)) > 0 && (
            <div style={styles.detailRow}>
              <span>Already Paid:</span>
              <span style={{ color: 'var(--hc-green-ink)' }}>-${dollars(invoice?.amountPaid)}</span>
            </div>
          )}
          <div style={{ ...styles.detailRow, ...styles.totalRow }}>
            <span><strong>Amount Due:</strong></span>
            <span style={styles.amountDue}>{money(invoice?.amountDue)}</span>
          </div>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {invoice?.payOnline ? (
          <>
            <button onClick={handlePayment} disabled={processing} style={{ ...styles.payButton, ...(processing ? styles.payButtonDisabled : {}) }}>
              {processing ? 'Processing...' : `Pay ${money(invoice?.amountDue)}`}
            </button>
            <div style={styles.secureNotice}><span>🔒</span> Secure payment powered by Stripe</div>
          </>
        ) : (
          // The CRM's invoice page says the same (packages/tenant-ui portal/PortalInvoices.tsx "How to pay").
          <div style={styles.howToPay} role="note">
            <p style={{ margin: 0, fontWeight: 600 }}>How to pay</p>
            <p style={{ margin: '0.25rem 0 0' }}>{agency || 'This business'} does not take card payments online. To pay this invoice, please contact them{reach ? ` at ${reach}` : ''}.</p>
          </div>
        )}

        <div style={styles.footer}>
          {reach ? (
            <>
              <p>Questions about this invoice? Contact us at:</p>
              <p><strong>{reach}</strong></p>
            </>
          ) : <p>Questions about this invoice? Please contact {agency || 'us'}.</p>}
        </div>
      </div>
    </div>
  )
}

/** Stripe's return page: /payment-success?session_id=…&doc=<the invoice's token> (which agency's account the session is on). */
export function PaymentSuccess() {
  const { search } = useLocation()
  const sessionId = new URLSearchParams(search).get('session_id')
  const doc = new URLSearchParams(search).get('doc') || ''
  const [payment, setPayment] = useState<{ success?: boolean; amount?: number; customerEmail?: string | null } | null>(null)
  const [loading, setLoading] = useState(!!sessionId)

  useEffect(() => {
    if (!sessionId) return
    let live = true
    publicCall<{ success?: boolean; amount?: number; customerEmail?: string | null }>('GET', `/api/stripe/verify-payment/${encodeURIComponent(sessionId)}${doc ? `?doc=${encodeURIComponent(doc)}` : ''}`)
      .then((r) => { if (live) setPayment(r.data) })
      .catch((err) => console.error('Error verifying payment:', err))
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [sessionId, doc])

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}><p>Verifying payment...</p></div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={{ color: 'var(--hc-green-ink)' }}>Payment Successful!</h2>
        {payment?.success && (
          <div style={styles.details}>
            <p>Amount Paid: <strong>{money(payment.amount)}</strong></p>
            <p>A confirmation email has been sent to {payment.customerEmail}</p>
          </div>
        )}
        <p style={{ marginTop: '2rem', color: 'var(--hc-ink-soft)' }}>Thank you for your payment. You can close this window.</p>
      </div>
    </div>
  )
}

// The template's styles, its raw colours as the frame's light/dark tokens. Two fixed grounds hold white text in both
// themes: the pay button (the template's #3498db held white at 3.2:1; the portal's navy is 8.6:1) and the green tick
// (#1e7e34, 5.1:1; the template's #27ae60 was 2.9:1).
const styles: Record<string, CSSProperties> = {
  container: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--hc-ground)',
    padding: '1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: 'var(--hc-ink)',
  },
  card: {
    backgroundColor: 'var(--hc-surface)', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', padding: '2rem',
    maxWidth: '480px', width: '100%', textAlign: 'center',
  },
  logo: { marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--hc-line)' },
  invoiceHeader: { marginBottom: '1.5rem' },
  clientName: { color: 'var(--hc-ink-soft)', fontSize: '1.1rem' },
  details: { backgroundColor: 'var(--hc-subtle)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' },
  detailRow: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--hc-line)' },
  totalRow: { borderBottom: 'none', paddingTop: '1rem', marginTop: '0.5rem', borderTop: '2px solid var(--hc-line)' },
  amountDue: { fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--hc-ink)' },
  payButton: {
    width: '100%', padding: '1rem 2rem', fontSize: '1.1rem', fontWeight: 'bold', color: 'white', backgroundColor: '#1a5276',
    border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'background-color 0.2s',
  },
  payButtonDisabled: { backgroundColor: '#95a5a6', cursor: 'not-allowed' },
  secureNotice: { marginTop: '1rem', color: 'var(--hc-ink-soft)', fontSize: '0.875rem' },
  footer: { marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--hc-line)', color: 'var(--hc-ink-soft)', fontSize: '0.875rem' },
  successIcon: {
    width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#1e7e34', color: 'white', fontSize: '2rem',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
  },
  spinner: {
    width: '40px', height: '40px', border: '4px solid var(--hc-line)', borderTop: '4px solid #3498db', borderRadius: '50%',
    animation: 'hc-spin 1s linear infinite', margin: '0 auto 1rem',
  },
  howToPay: { backgroundColor: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', padding: '1rem', borderRadius: '8px', textAlign: 'left' },
  cancelledBanner: { backgroundColor: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem' },
  errorBanner: { backgroundColor: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem' },
}
