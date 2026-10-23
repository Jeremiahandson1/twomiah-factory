// The client portal's Billing: released invoices with their per-day hours, the balance due, the pay page and the PDF.
// Moved from templates/crm-homecare/frontend/src/components/portal/PortalInvoices.tsx.
//
// Server (server/crm/homecare/portals/clientPortal.ts): GET /api/portal/invoices — a list of invoice rows (camelCase:
// invoiceNumber, billingPeriodStart, billingPeriodEnd, total (a numeric, as text), paymentStatus, paymentDueDate,
// paymentDate) each with lineItems [{ id, serviceDate, description, hours, rate, amount }]; GET
// /api/portal/invoices/:id/pdf — the PDF. The figures are printed exactly as the template printed them.
import { useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { formatDate as formatDay } from '../lib/date'
import { saveBlob } from '../lib/http'
import { listRows, money as formatMoney, usePortal } from './portalHttp'

interface LineItem { id: string; serviceDate: string | null; description: string | null; hours: string | number | null; amount: string | number | null }
interface Invoice {
  id: string
  invoiceNumber: string
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  total: string | number | null
  paymentStatus: string | null
  paymentDueDate: string | null
  paymentDate: string | null
  lineItems?: LineItem[]
  /** The invoice's own page (/d/<token>) while something is owed — the page its email links. */
  documentPath?: string | null
}

const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', label: 'Pending' },
  paid: { bg: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', label: 'Paid' },
  overdue: { bg: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', label: 'Overdue' },
  partial: { bg: 'var(--hcp-tint)', color: 'var(--hcp-navy)', label: 'Partial' },
}

const statusBadge = (status: string) => {
  const s = STATUS[status] || STATUS.pending
  return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{s.label}</span>
}

const formatDate = (dateStr: string | null | undefined) =>
  dateStr ? formatDay(String(dateStr).slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—'

const cell = { padding: '4px 6px', borderBottom: '1px solid var(--hc-line)' } as const

export default function PortalInvoices() {
  const portal = usePortal()
  const toast = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggleExpanded = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  useEffect(() => {
    portal.get('/api/portal/invoices')
      .then((reply) => { if (reply) setInvoices(listRows<Invoice>(reply)) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portal])

  const totalOwed = invoices
    .filter((i) => i.paymentStatus === 'pending' || i.paymentStatus === 'overdue')
    .reduce((sum, i) => sum + (parseFloat(String(i.total ?? 0)) || 0), 0)

  const handleDownloadPDF = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const blob = await portal.blob(`/api/portal/invoices/${invoiceId}/pdf`)
      saveBlob(blob, `invoice-${invoiceNumber || invoiceId}.pdf`)
    } catch (err) {
      toast.error('Failed to download PDF: ' + (err as Error).message)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading billing...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>📄 Billing & Invoices</h2>

      {totalOwed > 0 && (
        // White on a fixed navy gradient, in both themes.
        <div style={{
          background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px',
          color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85, marginBottom: '4px' }}>TOTAL BALANCE DUE</div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatMoney(totalOwed)}</div>
          </div>
          <span style={{ fontSize: '2.5rem' }}>💳</span>
        </div>
      )}

      {invoices.length === 0 ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
          <div>No invoices yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {invoices.map((inv) => {
            const status = inv.paymentStatus || 'pending'
            const isPending = status === 'pending' || status === 'overdue' || status === 'partial'
            const lines = Array.isArray(inv.lineItems) ? inv.lineItems : []
            const hoursTotal = lines.reduce((s, li) => s + (parseFloat(String(li.hours ?? 0)) || 0), 0)

            return (
              <div key={inv.id} style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--hc-ink)', marginBottom: '3px' }}>Invoice #{inv.invoiceNumber}</div>
                    <div style={{ fontSize: '0.83rem', color: 'var(--hc-ink-soft)' }}>{formatDate(inv.billingPeriodStart)} – {formatDate(inv.billingPeriodEnd)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--hcp-navy)', marginBottom: '4px' }}>{formatMoney(inv.total)}</div>
                    {statusBadge(status)}
                  </div>
                </div>

                {lines.length > 0 && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--hc-line)' }}>
                    <button
                      onClick={() => toggleExpanded(inv.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--hcp-navy)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: 0 }}
                    >
                      {expanded[inv.id] ? '▾ Hide hours & days' : '▸ Show hours & days'}
                    </button>
                    {expanded[inv.id] && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--hc-ink-soft)', fontSize: '0.72rem' }}>
                              <th style={cell}>Date</th>
                              <th style={cell}>Service</th>
                              <th style={{ ...cell, textAlign: 'right' }}>Hours</th>
                              <th style={{ ...cell, textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((li, i) => (
                              <tr key={li.id || i} style={{ fontSize: '0.8rem', color: 'var(--hc-ink-soft)' }}>
                                <td style={cell}>{li.serviceDate ? formatDate(li.serviceDate) : '—'}</td>
                                <td style={cell}>{li.description || 'Home Care Services'}</td>
                                <td style={{ ...cell, textAlign: 'right' }}>{(parseFloat(String(li.hours ?? 0)) || 0).toFixed(2)}</td>
                                <td style={{ ...cell, textAlign: 'right' }}>{formatMoney(li.amount)}</td>
                              </tr>
                            ))}
                            <tr style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--hc-ink)' }}>
                              <td style={{ padding: '6px 6px' }} colSpan={2}>Total</td>
                              <td style={{ padding: '6px 6px', textAlign: 'right' }}>{hoursTotal.toFixed(2)}</td>
                              <td style={{ padding: '6px 6px', textAlign: 'right' }}>{formatMoney(inv.total)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {(inv.paymentDueDate || inv.paymentDate) && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '24px', fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>
                    {inv.paymentDueDate && <span>Due: <strong style={{ color: 'var(--hc-ink)' }}>{formatDate(inv.paymentDueDate)}</strong></span>}
                    {inv.paymentDate && <span>Paid: <strong style={{ color: 'var(--hc-green-ink)' }}>{formatDate(inv.paymentDate)}</strong></span>}
                  </div>
                )}

                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {isPending && inv.documentPath && (
                    // The same page the invoice email links to: it pays by card, or says how to pay the agency.
                    <a
                      href={inv.documentPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-block', background: 'var(--hcp-navy-fill)', color: '#fff', padding: '8px 18px', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}
                    >
                      View and pay
                    </a>
                  )}
                  <button
                    onClick={() => handleDownloadPDF(inv.id, inv.invoiceNumber)}
                    style={{ background: 'transparent', color: 'var(--hcp-navy)', border: '1px solid var(--hcp-navy)', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                  >
                    📥 Download PDF
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
