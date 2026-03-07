// components/portal/PortalInvoices.jsx
// Client billing and invoice history with payment and PDF download
import React, { useState, useEffect } from 'react';
import { apiCall, API_BASE_URL } from '../../config';

const statusBadge = (status) => {
  const map = {
    pending:  { bg: '#fef9e7', color: '#d68910', label: 'Pending'  },
    paid:     { bg: '#eafaf1', color: '#1e8449', label: 'Paid'     },
    overdue:  { bg: '#fdf2f2', color: '#c0392b', label: 'Overdue'  },
    partial:  { bg: '#eaf4fd', color: '#1a5276', label: 'Partial'  },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '3px 10px', borderRadius: '12px',
      fontSize: '0.75rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
};

const formatDate = (dateStr) => {
  if (!dateStr) return '\u2014';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
};

const formatMoney = (amount) => {
  if (amount == null) return '\u2014';
  return `$${parseFloat(amount).toFixed(2)}`;
};

const PortalInvoices = ({ token }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [payingId, setPayingId] = useState(null);
  const [payError, setPayError] = useState('');

  useEffect(() => {
    apiCall('/api/portal/invoices', { method: 'GET' }, token)
      .then(data => { if (data) setInvoices(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const totalOwed = invoices
    .filter(i => i.payment_status === 'pending' || i.payment_status === 'overdue'
              || i.paymentStatus === 'pending' || i.paymentStatus === 'overdue')
    .reduce((sum, i) => sum + parseFloat(i.total || 0), 0);

  const handlePayNow = async (invoiceId) => {
    setPayingId(invoiceId);
    setPayError('');
    try {
      const data = await apiCall(`/api/portal/invoices/${invoiceId}/pay`, {
        method: 'POST',
      }, token);

      if (data?.clientSecret) {
        // Redirect to Stripe-hosted payment or show inline
        // For simplicity, open a payment window with the client secret
        // The app already has a PaymentPage component at /pay/:invoiceId
        window.open(`/pay/${invoiceId}?client_secret=${data.clientSecret}`, '_blank');
      }
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPayingId(null);
    }
  };

  const handleDownloadPDF = async (invoiceId, invoiceNumber) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/portal/invoices/${invoiceId}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const text = await response.text();
        let msg = text;
        try { msg = JSON.parse(text).error || text; } catch {}
        throw new Error(msg);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to download PDF: ' + err.message);
    }
  };

  const getPaymentStatus = (inv) => inv.payment_status || inv.paymentStatus || 'pending';

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading billing...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        📄 Billing & Invoices
      </h2>

      {/* Summary card */}
      {totalOwed > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #1a5276 0%, #2980b9 100%)',
          borderRadius: '12px', padding: '20px 24px', marginBottom: '20px',
          color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85, marginBottom: '4px' }}>TOTAL BALANCE DUE</div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatMoney(totalOwed)}</div>
          </div>
          <span style={{ fontSize: '2.5rem' }}>💳</span>
        </div>
      )}

      {payError && (
        <div style={{
          background: '#fdf2f2', color: '#c0392b', borderRadius: '8px',
          padding: '12px 16px', marginBottom: '16px', fontSize: '0.88rem',
        }}>
          {payError}
        </div>
      )}

      {invoices.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
          <div>No invoices yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {invoices.map(inv => {
            const status = getPaymentStatus(inv);
            const isPending = status === 'pending' || status === 'overdue' || status === 'partial';
            const invNumber = inv.invoice_number || inv.invoiceNumber;

            return (
              <div
                key={inv.id}
                style={{
                  background: '#fff', borderRadius: '12px', padding: '18px 20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#333', marginBottom: '3px' }}>
                      Invoice #{invNumber}
                    </div>
                    <div style={{ fontSize: '0.83rem', color: '#777' }}>
                      {formatDate(inv.billing_period_start || inv.billingPeriodStart)} – {formatDate(inv.billing_period_end || inv.billingPeriodEnd)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1a5276', marginBottom: '4px' }}>
                      {formatMoney(inv.total)}
                    </div>
                    {statusBadge(status)}
                  </div>
                </div>

                {((inv.payment_due_date || inv.paymentDueDate) || (inv.payment_date || inv.paymentDate)) && (
                  <div style={{
                    marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0',
                    display: 'flex', gap: '24px', fontSize: '0.82rem', color: '#777',
                  }}>
                    {(inv.payment_due_date || inv.paymentDueDate) && (
                      <span>Due: <strong style={{ color: '#333' }}>{formatDate(inv.payment_due_date || inv.paymentDueDate)}</strong></span>
                    )}
                    {(inv.payment_date || inv.paymentDate) && (
                      <span>Paid: <strong style={{ color: '#1e8449' }}>{formatDate(inv.payment_date || inv.paymentDate)}</strong></span>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{
                  marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0',
                  display: 'flex', gap: '10px', flexWrap: 'wrap',
                }}>
                  {isPending && (
                    <button
                      onClick={() => handlePayNow(inv.id)}
                      disabled={payingId === inv.id}
                      style={{
                        background: '#1a5276', color: '#fff',
                        border: 'none', padding: '8px 18px', borderRadius: '8px',
                        cursor: payingId === inv.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem', fontWeight: 600,
                        opacity: payingId === inv.id ? 0.6 : 1,
                      }}
                    >
                      {payingId === inv.id ? 'Processing...' : '💳 Pay Now'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDownloadPDF(inv.id, invNumber)}
                    style={{
                      background: 'transparent', color: '#1a5276',
                      border: '1px solid #1a5276', padding: '8px 18px', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    }}
                  >
                    📥 Download PDF
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalInvoices;
