// Moved from templates/crm-homecare/frontend/src/components/admin/ClientDocuments.tsx — send the agency's paperwork to
// clients for signature, keep the standard wording in one place, and read the signed record.
//
// Different from Form Builder: those are forms STAFF fill in about a client.
// These are documents the CLIENT signs in their portal, with the evidence
// (IP, device, consent, document hash) kept against the signature.
// (server/crm/homecare/clients/clientDocuments.ts)
import { useState, useEffect, type CSSProperties } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatDateTime } from '../lib/datetime'
import { formatAgencyDate } from '../lib/agencyClock'
import { allRows, type Client } from './shared'
import { useMay } from '../lib/useMay'

// Each status chip: its ink on its own ground, in both themes.
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Awaiting signature', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200' },
  viewed: { label: 'Opened, not signed', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' },
  signed: { label: 'Signed', cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' },
  declined: { label: 'Declined', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  void: { label: 'Voided', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}
const badgeOf = (status: string) => STATUS_BADGE[status] || { label: status, cls: STATUS_BADGE.void.cls }

/** A row of GET /api/client-documents. */
interface DocRow {
  id: string
  title: string
  status: string
  sentAt?: string | null
  signedAt?: string | null
  signedBy?: string | null
  clientFirstName?: string | null
  clientLastName?: string | null
}

/** GET /api/client-documents/:id — the whole record with the signature evidence and the client. */
interface DocDetail extends DocRow {
  body: string
  viewedAt?: string | null
  signerRelationship?: string | null
  consentAt?: string | null
  signedIp?: string | null
  signedUserAgent?: string | null
  documentHash?: string | null
  signatureImage?: string | null
  declinedAt?: string | null
  declineReason?: string | null
  client?: { firstName?: string; lastName?: string } | null
}

/** A standard document (GET /api/client-documents/templates). */
interface DocTemplate {
  id: string
  title: string
  body: string
  isActive: boolean
}

interface TemplateDraft { id?: string; title: string; body: string; isActive: boolean }

// The template's navy, a fixed ground white reads on in either theme (9:1); as ink on the page it is the frame's blue.
const primaryBtn: CSSProperties = { background: '#1a5276', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }
const plainBtn: CSSProperties = { background: 'none', border: '1px solid var(--hc-line)', color: 'var(--hc-ink-soft)', borderRadius: '8px', cursor: 'pointer' }
const panel: CSSProperties = { background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderRadius: '10px' }
const field: CSSProperties = { padding: '0.6rem 0.75rem', border: '1px solid var(--hc-line)', borderRadius: '8px' }
const muted: CSSProperties = { color: 'var(--hc-muted)' }

export default function ClientDocuments() {
  // Each control for whoever the server lets use it (care-clients create / update / delete) (lib/useMay.ts).
  const may = useMay('care-clients')
  const [tab, setTab] = useState('sent')
  const [documents, setDocuments] = useState<DocRow[]>([])
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [clientList, setClientList] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [sending, setSending] = useState(false)
  const [sendClientId, setSendClientId] = useState('')
  const [sendTemplateId, setSendTemplateId] = useState('')
  const [busy, setBusy] = useState(false)

  const [viewDoc, setViewDoc] = useState<DocDetail | null>(null)
  const [editTemplate, setEditTemplate] = useState<TemplateDraft | null>(null)

  const base = '/api/client-documents'

  const loadAll = async () => {
    try {
      const [docs, tpls] = await Promise.all([api.get(base), api.get(`${base}/templates`)])
      setDocuments(rows<DocRow>(docs))
      setTemplates(rows<DocTemplate>(tpls))
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    } finally {
      setLoading(false)
    }
  }

  const loadClients = async () => {
    try {
      // Only active clients can be sent paperwork, so ask for exactly that (every page of them).
      setClientList(await allRows<Client>('/api/clients', { isActive: true }))
    } catch {
      setClientList([])
    }
  }

  useEffect(() => { loadAll(); loadClients() }, [])

  const sendDocument = async () => {
    // M-08: don't let placeholder boilerplate go out for signature.
    const tpl = templates.find((t) => t.id === sendTemplateId)
    if (tpl && /REPLACE THIS TEXT|YOUR AGENCY'?S OWN/i.test(tpl.body || '')) {
      setError('This template still contains placeholder text. Edit it under the Templates tab before sending.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const created: { emailed?: boolean; emailNote?: string | null } = await api.post(base, { clientId: sendClientId, templateId: sendTemplateId })
      // Say plainly whether the client was actually notified — a document
      // sitting in a portal nobody was told about is not "sent".
      setNotice(created.emailed
        ? 'Sent. The client has been emailed a link to sign it.'
        : (created.emailNote || 'Saved to the client’s portal.'))
      setSending(false)
      setSendClientId('')
      setSendTemplateId('')
      loadAll()
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    } finally {
      setBusy(false)
    }
  }

  const openDocument = async (id: string) => {
    setError('')
    try {
      setViewDoc(await api.get(`${base}/${id}`))
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    }
  }

  const remind = async (id: string) => {
    setError('')
    setNotice('')
    try {
      const res: { sentTo?: string } = await api.post(`${base}/${id}/remind`)
      setNotice(`Reminder sent to ${res.sentTo}`)
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    }
  }

  const voidDocument = async (id: string) => {
    setError('')
    setNotice('')
    try {
      await api.post(`${base}/${id}/void`)
      setViewDoc(null)
      loadAll()
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    }
  }

  const saveTemplate = async () => {
    if (!editTemplate) return
    setBusy(true)
    setError('')
    try {
      if (editTemplate.id) {
        await api.put(`${base}/templates/${editTemplate.id}`, { title: editTemplate.title, body: editTemplate.body, isActive: editTemplate.isActive })
      } else {
        await api.post(`${base}/templates`, { title: editTemplate.title, body: editTemplate.body })
      }
      setEditTemplate(null)
      setNotice('Saved. Documents already sent keep the wording they were sent with.')
      loadAll()
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div style={{ padding: '2rem', ...muted }}>Loading…</div>

  // ── signed record / document detail ──────────────────────────────────
  if (viewDoc) {
    const badge = badgeOf(viewDoc.status)
    const label: CSSProperties = { paddingRight: '1.5rem', ...muted }
    return (
      <div style={{ padding: '1.5rem', maxWidth: '860px' }}>
        <button onClick={() => setViewDoc(null)} style={{ background: 'none', border: 'none', color: 'var(--hc-blue-ink)', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}>
          ← Back to documents
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
          <h2 style={{ margin: 0 }}>{viewDoc.title}</h2>
          <span className={badge.cls} style={{ borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.78rem', fontWeight: 600 }}>
            {badge.label}
          </span>
        </div>
        <p style={{ ...muted, fontSize: '0.85rem', marginTop: 0 }}>
          {viewDoc.client ? `${viewDoc.client.firstName} ${viewDoc.client.lastName} · ` : ''}
          sent {formatDateTime(viewDoc.sentAt)}
          {viewDoc.viewedAt ? ` · opened ${formatDateTime(viewDoc.viewedAt)}` : ''}
        </p>

        {viewDoc.status === 'signed' && (
          <div style={{ background: 'var(--hc-success-bg)', border: '1px solid var(--hc-success-line)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem' }}>
            <strong style={{ color: 'var(--hc-success-ink)' }}>Signed acceptance</strong>
            <table style={{ marginTop: '0.75rem', fontSize: '0.88rem', color: 'var(--hc-ink)', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={label}>Signed by</td><td>{viewDoc.signedBy} ({viewDoc.signerRelationship})</td></tr>
                <tr><td style={label}>Signed at</td><td>{formatDateTime(viewDoc.signedAt)}</td></tr>
                <tr><td style={label}>Consent given</td><td>{viewDoc.consentAt ? formatDateTime(viewDoc.consentAt) : '—'}</td></tr>
                <tr><td style={label}>IP address</td><td>{viewDoc.signedIp || '—'}</td></tr>
                <tr><td style={{ ...label, verticalAlign: 'top' }}>Device</td><td style={{ wordBreak: 'break-word' }}>{viewDoc.signedUserAgent || '—'}</td></tr>
                <tr><td style={{ ...label, verticalAlign: 'top' }}>Document hash</td><td style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem' }}>{viewDoc.documentHash}</td></tr>
              </tbody>
            </table>
            {viewDoc.signatureImage && (
              // The signature is ink on paper-white in either theme.
              <img src={viewDoc.signatureImage} alt="Signature" style={{ maxWidth: '280px', marginTop: '1rem', background: '#fff', border: '1px solid var(--hc-line)', borderRadius: '6px', padding: '4px' }} />
            )}
          </div>
        )}

        {viewDoc.status === 'declined' && (
          <div style={{ background: 'var(--hc-danger-bg)', border: '1px solid var(--hc-danger-line)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.25rem', color: 'var(--hc-danger-ink)' }}>
            <strong>Declined {viewDoc.declinedAt ? formatDateTime(viewDoc.declinedAt) : ''}</strong>
            {viewDoc.declineReason && <div style={{ marginTop: '0.35rem' }}>{viewDoc.declineReason}</div>}
          </div>
        )}

        <div style={{ ...panel, padding: '1.5rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {viewDoc.body}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          {viewDoc.status !== 'signed' && viewDoc.status !== 'void' && (
            <>
              {may.update && <button onClick={() => remind(viewDoc.id)} style={{ ...primaryBtn, fontWeight: 400, padding: '0.6rem 1.2rem' }}>
                Send reminder
              </button>}
              {may.delete && <button onClick={() => voidDocument(viewDoc.id)} style={{ ...plainBtn, padding: '0.6rem 1.2rem' }}>
                Void
              </button>}
            </>
          )}
        </div>
        {error && <div style={{ color: 'var(--hc-red-ink)', marginTop: '1rem' }}>{error}</div>}
        {notice && <div style={{ color: 'var(--hc-green-ink)', marginTop: '1rem' }}>{notice}</div>}
      </div>
    )
  }

  // ── template editor ──────────────────────────────────────────────────
  if (editTemplate) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: '860px' }}>
        <button onClick={() => setEditTemplate(null)} style={{ background: 'none', border: 'none', color: 'var(--hc-blue-ink)', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}>
          ← Back
        </button>
        <h2 style={{ marginTop: 0 }}>{editTemplate.id ? 'Edit document' : 'New document'}</h2>
        <p style={{ ...muted, fontSize: '0.88rem' }}>
          You can use {'{{CLIENT_NAME}}'}, {'{{AGENCY_NAME}}'}, {'{{START_DATE}}'}, {'{{RATE}}'} and {'{{DATE}}'} — they are filled in when the document is sent.
        </p>

        <input
          value={editTemplate.title}
          onChange={(e) => setEditTemplate((t) => (t ? { ...t, title: e.target.value } : t))}
          placeholder="Document title"
          style={{ ...field, width: '100%', marginBottom: '0.75rem' }}
        />
        <textarea
          value={editTemplate.body}
          onChange={(e) => setEditTemplate((t) => (t ? { ...t, body: e.target.value } : t))}
          rows={22}
          placeholder="The wording the client will read and sign"
          style={{ ...field, width: '100%', padding: '0.75rem', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          {(editTemplate.id ? may.update : may.create) && <button
            onClick={saveTemplate}
            disabled={busy || !editTemplate.title.trim() || !editTemplate.body.trim()}
            style={{ ...primaryBtn, padding: '0.7rem 1.5rem' }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>}
          <button onClick={() => setEditTemplate(null)} style={{ ...plainBtn, padding: '0.7rem 1.25rem' }}>
            Cancel
          </button>
        </div>
        {error && <div style={{ color: 'var(--hc-red-ink)', marginTop: '1rem' }}>{error}</div>}
      </div>
    )
  }

  // ── lists ────────────────────────────────────────────────────────────
  const sendDisabled = !sendClientId || !sendTemplateId
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Client Documents</h2>
          <p style={{ ...muted, fontSize: '0.88rem', margin: '0.25rem 0 0' }}>
            Agreements and consents your clients sign in their portal.
          </p>
        </div>
        {may.create && <button onClick={() => { setSending(true); setNotice(''); setError('') }} style={{ ...primaryBtn, padding: '0.65rem 1.35rem' }}>
          Send a document
        </button>}
      </div>

      {error && <div style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>}
      {notice && <div style={{ background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>{notice}</div>}

      {sending && (
        <div style={{ ...panel, padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>Send a document for signature</h3>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={sendClientId} onChange={(e) => setSendClientId(e.target.value)} style={{ ...field, minWidth: '220px' }}>
              <option value="">Choose a client…</option>
              {clientList.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.firstName} {cl.lastName}</option>
              ))}
            </select>
            <select value={sendTemplateId} onChange={(e) => setSendTemplateId(e.target.value)} style={{ ...field, minWidth: '260px' }}>
              <option value="">Choose a document…</option>
              {templates.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button
              onClick={sendDocument}
              disabled={busy || sendDisabled}
              style={{ ...primaryBtn, padding: '0.6rem 1.35rem', opacity: sendDisabled ? 0.55 : 1 }}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => setSending(false)} style={{ ...plainBtn, padding: '0.6rem 1.1rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.25rem', borderBottom: '1px solid var(--hc-line)', marginBottom: '1rem' }}>
        {[['sent', 'Sent documents'], ['templates', 'Standard documents']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0.6rem 0',
              fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--hc-blue-ink)' : 'var(--hc-ink-soft)',
              borderBottom: tab === key ? '3px solid var(--hc-blue-ink)' : '3px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sent' && (
        documents.length === 0 ? (
          <div style={{ ...panel, padding: '2rem', ...muted }}>
            Nothing sent yet. Use “Send a document” to get a client’s paperwork signed in their portal.
          </div>
        ) : (
          <div style={{ ...panel, overflow: 'hidden' }}>
            {documents.map((doc, i) => {
              const badge = badgeOf(doc.status)
              return (
                <div
                  key={doc.id}
                  onClick={() => openDocument(doc.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                    padding: '0.9rem 1.25rem', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid var(--hc-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{doc.title}</div>
                    <div style={{ fontSize: '0.8rem', ...muted, marginTop: '2px' }}>
                      {doc.clientFirstName} {doc.clientLastName} ·{' '}
                      {doc.status === 'signed' && doc.signedAt
                        ? `signed ${formatAgencyDate(doc.signedAt, { month: 'numeric', day: 'numeric', year: 'numeric' })} by ${doc.signedBy}`
                        : `sent ${formatAgencyDate(doc.sentAt, { month: 'numeric', day: 'numeric', year: 'numeric' })}`}
                    </div>
                  </div>
                  <span className={badge.cls} style={{ borderRadius: '999px', padding: '0.25rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {badge.label}
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'templates' && (
        <div>
          {may.create && <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => setEditTemplate({ title: '', body: '', isActive: true })}
              style={{ background: 'none', border: '1px solid var(--hc-blue-ink)', color: 'var(--hc-blue-ink)', padding: '0.55rem 1.1rem', borderRadius: '8px', cursor: 'pointer' }}
            >
              + New document
            </button>
          </div>}
          <div style={{ ...panel, overflow: 'hidden' }}>
            {templates.map((t, i) => (
              <div
                key={t.id}
                onClick={() => setEditTemplate({ id: t.id, title: t.title, body: t.body, isActive: t.isActive })}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                  padding: '0.9rem 1.25rem', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid var(--hc-subtle)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{t.title}</div>
                  <div style={{ fontSize: '0.8rem', ...muted, marginTop: '2px' }}>
                    {t.body.startsWith('REPLACE THIS TEXT')
                      ? 'Starter wording — edit it before sending this to anyone'
                      : `${t.body.length} characters`}
                  </div>
                </div>
                {!t.isActive && <span style={{ fontSize: '0.78rem', ...muted }}>Inactive</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
