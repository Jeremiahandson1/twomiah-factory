// The client portal's Documents: read and sign the agency's paperwork — service agreement, client rights, privacy
// acknowledgment, consent to care. Moved from templates/crm-homecare/frontend/src/components/portal/PortalDocuments.tsx.
//
// The person holding portal access is often not the client (an adult child, a power of attorney), so the signer states
// their relationship and that is stored with the signature.
//
// Server (server/crm/homecare/portals/clientPortal.ts): GET /api/portal/documents — a list of { id, title, status,
// sentAt, signedAt, signedBy, declinedAt }; GET /api/portal/documents/:id — the document (body, signatureImage,
// documentHash, signerRelationship, declineReason …); POST …/:id/sign { signature, signedBy, signerRelationship,
// consent } and POST …/:id/decline { reason } → the updated document.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock'
import { listRows, usePortal } from './portalHttp'

interface DocumentRow { id: string; title: string; status: string; sentAt: string | null; signedAt: string | null; signedBy: string | null }
interface DocumentFull extends DocumentRow {
  body: string
  signerRelationship: string | null
  signatureImage: string | null
  documentHash: string | null
  declineReason: string | null
}

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  sent: { text: 'Needs your signature', color: 'var(--hc-warning-ink)', bg: 'var(--hc-warning-bg)' },
  viewed: { text: 'Needs your signature', color: 'var(--hc-warning-ink)', bg: 'var(--hc-warning-bg)' },
  signed: { text: 'Signed', color: 'var(--hc-success-ink)', bg: 'var(--hc-success-bg)' },
  declined: { text: 'Declined', color: 'var(--hc-danger-ink)', bg: 'var(--hc-danger-bg)' },
}

const RELATIONSHIPS = ['Self', 'Spouse', 'Son', 'Daughter', 'Power of attorney', 'Legal guardian', 'Other family member']

const panel = { background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderRadius: '10px' } as const
const errorBox = { background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' } as const
const quietBtn = { background: 'none', border: '1px solid var(--hc-line)', color: 'var(--hc-ink-soft)', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer' } as const

// Draw-to-sign pad. Pointer events cover mouse, pen and touch in one path. Dark ink on a white card in both themes:
// the drawing becomes a PNG printed on paper-white.
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // The backing store at the displayed size, so the line is not blurry and the image matches what the signer saw.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a202c'
  }, [])

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    dirty.current = true
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    dirty.current = false
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ width: '100%', height: '160px', border: '1px dashed #a0aec0', borderRadius: '8px', background: '#fff', touchAction: 'none', cursor: 'crosshair' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--hc-muted)' }}>Draw your signature above</span>
        <button type="button" onClick={clear} style={{ background: 'none', border: 'none', color: 'var(--hcp-navy)', cursor: 'pointer', fontSize: '0.85rem' }}>Clear</button>
      </div>
    </div>
  )
}

export default function PortalDocuments() {
  const portal = usePortal()
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [openDoc, setOpenDoc] = useState<DocumentFull | null>(null)
  const [error, setError] = useState('')

  const [signature, setSignature] = useState('')
  const [signedBy, setSignedBy] = useState('')
  const [relationship, setRelationship] = useState('Self')
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  const load = () => {
    portal.get('/api/portal/documents')
      .then((reply) => setDocuments(listRows<DocumentRow>(reply)))
      .catch(() => setError('Could not load your documents'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [portal]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    setError('')
    portal.get<DocumentFull>(`/api/portal/documents/${id}`)
      .then((doc) => {
        if (!doc) return
        setOpenDoc(doc)
        setSignature('')
        setSignedBy('')
        setRelationship('Self')
        setConsent(false)
        setDeclining(false)
        setDeclineReason('')
      })
      .catch(() => setError('Could not open that document'))
  }

  const sign = () => {
    if (!openDoc) return
    setSaving(true)
    setError('')
    portal.send<DocumentFull>('POST', `/api/portal/documents/${openDoc.id}/sign`, { signature, signedBy, signerRelationship: relationship, consent })
      .then((updated) => { if (updated) setOpenDoc(updated); load() })
      .catch((err: Error) => setError(err.message || 'Could not save your signature'))
      .finally(() => setSaving(false))
  }

  const decline = () => {
    if (!openDoc) return
    setSaving(true)
    setError('')
    portal.send<DocumentFull>('POST', `/api/portal/documents/${openDoc.id}/decline`, { reason: declineReason })
      .then((updated) => { if (updated) setOpenDoc(updated); load() })
      .catch((err: Error) => setError(err.message || 'Could not record that'))
      .finally(() => setSaving(false))
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--hc-ink-soft)' }}>Loading your documents…</div>

  // ── one document open ────────────────────────────────────────────────
  if (openDoc) {
    const isSigned = openDoc.status === 'signed'
    const isDeclined = openDoc.status === 'declined'
    const blocked = !consent || !signedBy.trim() || !signature

    return (
      <div style={{ maxWidth: '760px' }}>
        <button onClick={() => { setOpenDoc(null); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--hcp-navy)', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}>
          ← Back to my documents
        </button>

        <h2 style={{ margin: '0 0 0.25rem', color: 'var(--hcp-navy)' }}>{openDoc.title}</h2>
        <p style={{ color: 'var(--hc-muted)', fontSize: '0.85rem', margin: '0 0 1.25rem' }}>Sent {formatAgencyDate(openDoc.sentAt)}</p>

        {error && <div style={errorBox}>{error}</div>}

        <div style={{ ...panel, padding: '1.5rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--hc-ink)' }}>{openDoc.body}</div>

        {isSigned && (
          <div style={{ background: 'var(--hc-success-bg)', border: '1px solid var(--hc-success-line)', borderRadius: '10px', padding: '1.25rem', marginTop: '1.25rem' }}>
            <strong style={{ color: 'var(--hc-success-ink)' }}>Signed</strong>
            <div style={{ color: 'var(--hc-success-ink)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
              {openDoc.signedBy} ({openDoc.signerRelationship}) on {formatAgencyDateTime(openDoc.signedAt)}
            </div>
            {openDoc.signatureImage && (
              <img src={openDoc.signatureImage} alt="Your signature" style={{ maxWidth: '260px', marginTop: '0.75rem', background: '#fff', borderRadius: '6px', padding: '4px' }} />
            )}
            <div style={{ color: 'var(--hc-success-ink)', fontSize: '0.75rem', marginTop: '0.75rem', wordBreak: 'break-all' }}>Document reference: {openDoc.documentHash}</div>
          </div>
        )}

        {isDeclined && (
          <div style={{ background: 'var(--hc-danger-bg)', border: '1px solid var(--hc-danger-line)', borderRadius: '10px', padding: '1.25rem', marginTop: '1.25rem', color: 'var(--hc-danger-ink)' }}>
            <strong>You declined this document</strong>
            {openDoc.declineReason && <div style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>{openDoc.declineReason}</div>}
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Your care coordinator will be in touch.</div>
          </div>
        )}

        {!isSigned && !isDeclined && !declining && (
          <div style={{ ...panel, padding: '1.5rem', marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--hcp-navy)', fontSize: '1.05rem' }}>Sign this document</h3>

            {/* Consent sits ABOVE the pad: you agree first, then you sign. */}
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginBottom: '1.1rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: '3px' }} />
              <span style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                I have read this document and I agree that signing it electronically has the same effect as signing it on paper.
              </span>
            </label>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginBottom: '0.35rem' }}>Your full name</label>
              <input className="hcp-field" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Type your full name" style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginBottom: '0.35rem' }}>You are signing as</label>
              <select className="hcp-field" value={relationship} onChange={(e) => setRelationship(e.target.value)} style={{ padding: '0.6rem 0.75rem', borderRadius: '8px' }}>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <SignaturePad onChange={setSignature} />

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button
                onClick={sign}
                disabled={saving || blocked}
                style={{
                  // The template's grey while it can't be pressed (an inactive control), its navy once it can.
                  background: blocked ? '#a0aec0' : 'var(--hcp-navy-fill)', color: '#fff', border: 'none', padding: '0.7rem 1.5rem', borderRadius: '8px',
                  cursor: blocked ? 'not-allowed' : 'pointer', fontWeight: 600,
                }}
              >
                {saving ? 'Saving…' : 'Sign document'}
              </button>
              <button onClick={() => setDeclining(true)} style={quietBtn}>I do not want to sign this</button>
            </div>
          </div>
        )}

        {declining && !isSigned && !isDeclined && (
          <div style={{ ...panel, padding: '1.5rem', marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', color: 'var(--hc-danger-ink)' }}>Decline this document</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)', marginTop: 0 }}>
              Tell us why if you would like to — your care coordinator will follow up either way.
            </p>
            <textarea className="hcp-field" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px' }} />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={decline} disabled={saving} style={{ background: '#c53030', color: '#fff', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                {saving ? 'Saving…' : 'Confirm'}
              </button>
              <button onClick={() => setDeclining(false)} style={quietBtn}>Go back</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── list ─────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ margin: '0 0 1.25rem', color: 'var(--hcp-navy)' }}>My Documents</h2>

      {error && <div style={errorBox}>{error}</div>}

      {documents.length === 0 ? (
        <div style={{ ...panel, padding: '2rem', color: 'var(--hc-muted)' }}>Nothing to sign right now. Anything your care agency sends you will appear here.</div>
      ) : (
        <div style={{ ...panel, overflow: 'hidden' }}>
          {documents.map((doc, i) => {
            const badge = STATUS_LABEL[doc.status] || { text: doc.status, color: 'var(--hc-ink-soft)', bg: 'var(--hc-subtle)' }
            return (
              <div
                key={doc.id}
                onClick={() => open(doc.id)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1rem 1.25rem', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid var(--hc-line)' }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{doc.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)', marginTop: '2px' }}>
                    {doc.status === 'signed' && doc.signedAt ? `Signed ${formatAgencyDate(doc.signedAt)} by ${doc.signedBy}` : `Sent ${formatAgencyDate(doc.sentAt)}`}
                  </div>
                </div>
                <span style={{ background: badge.bg, color: badge.color, borderRadius: '999px', padding: '0.25rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{badge.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
