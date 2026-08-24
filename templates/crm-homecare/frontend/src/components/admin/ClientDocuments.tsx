// ClientDocuments.jsx — send the agency's paperwork to clients for signature,
// keep the standard wording in one place, and read the signed record.
//
// Different from Form Builder: those are forms STAFF fill in about a client.
// These are documents the CLIENT signs in their portal, with the evidence
// (IP, device, consent, document hash) kept against the signature.

import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/date';

const API = import.meta.env.VITE_API_URL || '';

const STATUS_BADGE = {
  sent: { label: 'Awaiting signature', bg: '#fefcbf', color: '#b7791f' },
  viewed: { label: 'Opened, not signed', bg: '#feebc8', color: '#9c4221' },
  signed: { label: 'Signed', bg: '#c6f6d5', color: '#22543d' },
  declined: { label: 'Declined', bg: '#fed7d7', color: '#822727' },
  void: { label: 'Voided', bg: '#e2e8f0', color: '#4a5568' },
};

export default function ClientDocuments() {
  const { token } = useAuth();
  const [tab, setTab] = useState('sent');
  const [documents, setDocuments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [clientList, setClientList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [sending, setSending] = useState(false);
  const [sendClientId, setSendClientId] = useState('');
  const [sendTemplateId, setSendTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  const [viewDoc, setViewDoc] = useState(null);
  const [editTemplate, setEditTemplate] = useState(null);

  const call = async (path, options = {}) => {
    const res = await fetch(`${API}/api/client-documents${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'Request failed');
    return body;
  };

  const loadAll = async () => {
    try {
      const [docs, tpls] = await Promise.all([call(''), call('/templates')]);
      setDocuments(docs.data || []);
      setTemplates(tpls.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      // The list is paginated (default 50) and only active clients can be
      // sent paperwork, so ask for exactly that.
      const res = await fetch(`${API}/api/clients?isActive=true&limit=500`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      const rows = Array.isArray(body) ? body : (body.clients || body.data || []);
      setClientList(rows);
    } catch {
      setClientList([]);
    }
  };

  useEffect(() => { loadAll(); loadClients(); }, []);

  const sendDocument = async () => {
    // M-08: don't let placeholder boilerplate go out for signature.
    const tpl = templates.find(t => t.id === sendTemplateId);
    if (tpl && /REPLACE THIS TEXT|YOUR AGENCY'?S OWN/i.test(tpl.body || '')) {
      setError('This template still contains placeholder text. Edit it under the Templates tab before sending.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await call('', {
        method: 'POST',
        body: JSON.stringify({ clientId: sendClientId, templateId: sendTemplateId }),
      });
      // Say plainly whether the client was actually notified — a document
      // sitting in a portal nobody was told about is not "sent".
      setNotice(created.emailed
        ? 'Sent. The client has been emailed a link to sign it.'
        : (created.emailNote || 'Saved to the client’s portal.'));
      setSending(false);
      setSendClientId('');
      setSendTemplateId('');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (id) => {
    setError('');
    try {
      setViewDoc(await call(`/${id}`));
    } catch (err) {
      setError(err.message);
    }
  };

  const remind = async (id) => {
    setError('');
    setNotice('');
    try {
      const res = await call(`/${id}/remind`, { method: 'POST' });
      setNotice(`Reminder sent to ${res.sentTo}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const voidDocument = async (id) => {
    setError('');
    setNotice('');
    try {
      await call(`/${id}/void`, { method: 'POST' });
      setViewDoc(null);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveTemplate = async () => {
    setBusy(true);
    setError('');
    try {
      if (editTemplate.id) {
        await call(`/templates/${editTemplate.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: editTemplate.title, body: editTemplate.body, isActive: editTemplate.isActive }),
        });
      } else {
        await call('/templates', {
          method: 'POST',
          body: JSON.stringify({ title: editTemplate.title, body: editTemplate.body }),
        });
      }
      setEditTemplate(null);
      setNotice('Saved. Documents already sent keep the wording they were sent with.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div style={{ padding: '2rem', color: '#666' }}>Loading…</div>;

  // ── signed record / document detail ──────────────────────────────────
  if (viewDoc) {
    const badge = STATUS_BADGE[viewDoc.status] || { label: viewDoc.status, bg: '#e2e8f0', color: '#4a5568' };
    return (
      <div style={{ padding: '1.5rem', maxWidth: '860px' }}>
        <button onClick={() => setViewDoc(null)} style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}>
          ← Back to documents
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
          <h2 style={{ margin: 0 }}>{viewDoc.title}</h2>
          <span style={{ background: badge.bg, color: badge.color, borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.78rem', fontWeight: 600 }}>
            {badge.label}
          </span>
        </div>
        <p style={{ color: '#718096', fontSize: '0.85rem', marginTop: 0 }}>
          {viewDoc.client ? `${viewDoc.client.firstName} ${viewDoc.client.lastName} · ` : ''}
          sent {new Date(viewDoc.sentAt).toLocaleString()}
          {viewDoc.viewedAt ? ` · opened ${new Date(viewDoc.viewedAt).toLocaleString()}` : ''}
        </p>

        {viewDoc.status === 'signed' && (
          <div style={{ background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem' }}>
            <strong style={{ color: '#22543d' }}>Signed acceptance</strong>
            <table style={{ marginTop: '0.75rem', fontSize: '0.88rem', color: '#2d3748', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096' }}>Signed by</td><td>{viewDoc.signedBy} ({viewDoc.signerRelationship})</td></tr>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096' }}>Signed at</td><td>{new Date(viewDoc.signedAt).toLocaleString()}</td></tr>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096' }}>Consent given</td><td>{viewDoc.consentAt ? new Date(viewDoc.consentAt).toLocaleString() : '—'}</td></tr>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096' }}>IP address</td><td>{viewDoc.signedIp || '—'}</td></tr>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096', verticalAlign: 'top' }}>Device</td><td style={{ wordBreak: 'break-word' }}>{viewDoc.signedUserAgent || '—'}</td></tr>
                <tr><td style={{ paddingRight: '1.5rem', color: '#718096', verticalAlign: 'top' }}>Document hash</td><td style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem' }}>{viewDoc.documentHash}</td></tr>
              </tbody>
            </table>
            {viewDoc.signatureImage && (
              <img src={viewDoc.signatureImage} alt='Signature' style={{ maxWidth: '280px', marginTop: '1rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px' }} />
            )}
          </div>
        )}

        {viewDoc.status === 'declined' && (
          <div style={{ background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem', color: '#822727' }}>
            <strong>Declined {viewDoc.declinedAt ? new Date(viewDoc.declinedAt).toLocaleString() : ''}</strong>
            {viewDoc.declineReason && <div style={{ marginTop: '0.35rem' }}>{viewDoc.declineReason}</div>}
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.5rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {viewDoc.body}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          {viewDoc.status !== 'signed' && viewDoc.status !== 'void' && (
            <>
              <button onClick={() => remind(viewDoc.id)} style={{ background: '#1a5276', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '8px', cursor: 'pointer' }}>
                Send reminder
              </button>
              <button onClick={() => voidDocument(viewDoc.id)} style={{ background: 'none', border: '1px solid #cbd5e0', color: '#4a5568', padding: '0.6rem 1.2rem', borderRadius: '8px', cursor: 'pointer' }}>
                Void
              </button>
            </>
          )}
        </div>
        {error && <div style={{ color: '#c53030', marginTop: '1rem' }}>{error}</div>}
        {notice && <div style={{ color: '#22543d', marginTop: '1rem' }}>{notice}</div>}
      </div>
    );
  }

  // ── template editor ──────────────────────────────────────────────────
  if (editTemplate) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: '860px' }}>
        <button onClick={() => setEditTemplate(null)} style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}>
          ← Back
        </button>
        <h2 style={{ marginTop: 0 }}>{editTemplate.id ? 'Edit document' : 'New document'}</h2>
        <p style={{ color: '#718096', fontSize: '0.88rem' }}>
          You can use {'{{CLIENT_NAME}}'}, {'{{AGENCY_NAME}}'}, {'{{START_DATE}}'}, {'{{RATE}}'} and {'{{DATE}}'} — they are filled in when the document is sent.
        </p>

        <input
          value={editTemplate.title}
          onChange={e => setEditTemplate(t => ({ ...t, title: e.target.value }))}
          placeholder='Document title'
          style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px', marginBottom: '0.75rem' }}
        />
        <textarea
          value={editTemplate.body}
          onChange={e => setEditTemplate(t => ({ ...t, body: e.target.value }))}
          rows={22}
          placeholder='The wording the client will read and sign'
          style={{ width: '100%', padding: '0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button
            onClick={saveTemplate}
            disabled={busy || !editTemplate.title.trim() || !editTemplate.body.trim()}
            style={{ background: '#1a5276', color: '#fff', border: 'none', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditTemplate(null)} style={{ background: 'none', border: '1px solid #cbd5e0', color: '#4a5568', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {error && <div style={{ color: '#c53030', marginTop: '1rem' }}>{error}</div>}
      </div>
    );
  }

  // ── lists ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Client Documents</h2>
          <p style={{ color: '#718096', fontSize: '0.88rem', margin: '0.25rem 0 0' }}>
            Agreements and consents your clients sign in their portal.
          </p>
        </div>
        <button
          onClick={() => { setSending(true); setNotice(''); setError(''); }}
          style={{ background: '#1a5276', color: '#fff', border: 'none', padding: '0.65rem 1.35rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
        >
          Send a document
        </button>
      </div>

      {error && <div style={{ background: '#fed7d7', color: '#822727', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>}
      {notice && <div style={{ background: '#c6f6d5', color: '#22543d', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>{notice}</div>}

      {sending && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>Send a document for signature</h3>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={sendClientId} onChange={e => setSendClientId(e.target.value)} style={{ padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px', minWidth: '220px' }}>
              <option value=''>Choose a client…</option>
              {clientList.map(cl => (
                <option key={cl.id} value={cl.id}>{cl.firstName || cl.first_name} {cl.lastName || cl.last_name}</option>
              ))}
            </select>
            <select value={sendTemplateId} onChange={e => setSendTemplateId(e.target.value)} style={{ padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px', minWidth: '260px' }}>
              <option value=''>Choose a document…</option>
              {templates.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button
              onClick={sendDocument}
              disabled={busy || !sendClientId || !sendTemplateId}
              style={{ background: (!sendClientId || !sendTemplateId) ? '#a0aec0' : '#1a5276', color: '#fff', border: 'none', padding: '0.6rem 1.35rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => setSending(false)} style={{ background: 'none', border: '1px solid #cbd5e0', color: '#4a5568', padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.25rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1rem' }}>
        {[['sent', 'Sent documents'], ['templates', 'Standard documents']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0.6rem 0',
              fontWeight: tab === key ? 600 : 400, color: tab === key ? '#1a5276' : '#4a5568',
              borderBottom: tab === key ? '3px solid #1a5276' : '3px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sent' && (
        documents.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '2rem', color: '#718096' }}>
            Nothing sent yet. Use “Send a document” to get a client’s paperwork signed in their portal.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            {documents.map((doc, i) => {
              const badge = STATUS_BADGE[doc.status] || { label: doc.status, bg: '#e2e8f0', color: '#4a5568' };
              return (
                <div
                  key={doc.id}
                  onClick={() => openDocument(doc.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                    padding: '0.9rem 1.25rem', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid #edf2f7',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#2d3748' }}>{doc.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#718096', marginTop: '2px' }}>
                      {doc.clientFirstName} {doc.clientLastName} ·{' '}
                      {doc.status === 'signed' && doc.signedAt
                        ? `signed ${formatDate(doc.signedAt)} by ${doc.signedBy}`
                        : `sent ${formatDate(doc.sentAt)}`}
                    </div>
                  </div>
                  <span style={{ background: badge.bg, color: badge.color, borderRadius: '999px', padding: '0.25rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'templates' && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => setEditTemplate({ title: '', body: '', isActive: true })}
              style={{ background: 'none', border: '1px solid #1a5276', color: '#1a5276', padding: '0.55rem 1.1rem', borderRadius: '8px', cursor: 'pointer' }}
            >
              + New document
            </button>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            {templates.map((t, i) => (
              <div
                key={t.id}
                onClick={() => setEditTemplate({ id: t.id, title: t.title, body: t.body, isActive: t.isActive })}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                  padding: '0.9rem 1.25rem', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid #edf2f7',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#2d3748' }}>{t.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#718096', marginTop: '2px' }}>
                    {t.body.startsWith('REPLACE THIS TEXT')
                      ? 'Starter wording — edit it before sending this to anyone'
                      : `${t.body.length} characters`}
                  </div>
                </div>
                {!t.isActive && <span style={{ fontSize: '0.78rem', color: '#718096' }}>Inactive</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
