// components/portal/PortalDocuments.jsx
// Read and sign the agency's paperwork — service agreement, client rights,
// privacy acknowledgment, consent to care.
//
// The person holding portal access is often not the client themselves (an
// adult child, a power of attorney), so the signer states their relationship
// and that is stored with the signature.

import React, { useState, useEffect, useRef } from 'react';
import { formatDate } from '../../utils/date';
import { apiCall } from '../../config';

const STATUS_LABEL = {
  sent: { text: 'Needs your signature', color: '#b7791f', bg: '#fefcbf' },
  viewed: { text: 'Needs your signature', color: '#b7791f', bg: '#fefcbf' },
  signed: { text: 'Signed', color: '#22543d', bg: '#c6f6d5' },
  declined: { text: 'Declined', color: '#822727', bg: '#fed7d7' },
};

const RELATIONSHIPS = ['Self', 'Spouse', 'Son', 'Daughter', 'Power of attorney', 'Legal guardian', 'Other family member'];

// Draw-to-sign pad. Pointer events cover mouse, pen and touch in one path.
const SignaturePad = ({ onChange }) => {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size the backing store to the displayed size so the line is not blurry
    // and the exported image matches what the signer saw.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a202c';
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{
          width: '100%', height: '160px', border: '1px dashed #a0aec0',
          borderRadius: '8px', background: '#fff', touchAction: 'none', cursor: 'crosshair',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        <span style={{ fontSize: '0.8rem', color: '#718096' }}>Draw your signature above</span>
        <button
          type='button'
          onClick={clear}
          style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          Clear
        </button>
      </div>
    </div>
  );
};

const PortalDocuments = ({ token }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDoc, setOpenDoc] = useState(null);
  const [error, setError] = useState('');

  // signing state
  const [signature, setSignature] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [relationship, setRelationship] = useState('Self');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const load = () => {
    apiCall('/api/portal/documents', { method: 'GET' }, token)
      .then(res => setDocuments((res && res.data) || []))
      .catch(() => setError('Could not load your documents'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);

  const open = (id) => {
    setError('');
    apiCall(`/api/portal/documents/${id}`, { method: 'GET' }, token)
      .then(doc => {
        setOpenDoc(doc);
        setSignature('');
        setSignedBy('');
        setRelationship('Self');
        setConsent(false);
        setDeclining(false);
        setDeclineReason('');
      })
      .catch(() => setError('Could not open that document'));
  };

  const sign = () => {
    setSaving(true);
    setError('');
    apiCall(`/api/portal/documents/${openDoc.id}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signature, signedBy, signerRelationship: relationship, consent }),
    }, token)
      .then(updated => {
        setOpenDoc(updated);
        load();
      })
      .catch(err => setError(err.message || 'Could not save your signature'))
      .finally(() => setSaving(false));
  };

  const decline = () => {
    setSaving(true);
    setError('');
    apiCall(`/api/portal/documents/${openDoc.id}/decline`, {
      method: 'POST',
      body: JSON.stringify({ reason: declineReason }),
    }, token)
      .then(updated => {
        setOpenDoc(updated);
        load();
      })
      .catch(err => setError(err.message || 'Could not record that'))
      .finally(() => setSaving(false));
  };

  if (loading) return <div style={{ padding: '2rem', color: '#666' }}>Loading your documents…</div>;

  // ── one document open ────────────────────────────────────────────────
  if (openDoc) {
    const isSigned = openDoc.status === 'signed';
    const isDeclined = openDoc.status === 'declined';

    return (
      <div style={{ maxWidth: '760px' }}>
        <button
          onClick={() => { setOpenDoc(null); setError(''); }}
          style={{ background: 'none', border: 'none', color: '#1a5276', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}
        >
          ← Back to my documents
        </button>

        <h2 style={{ margin: '0 0 0.25rem', color: '#1a5276' }}>{openDoc.title}</h2>
        <p style={{ color: '#718096', fontSize: '0.85rem', margin: '0 0 1.25rem' }}>
          Sent {formatDate(openDoc.sentAt)}
        </p>

        {error && (
          <div style={{ background: '#fed7d7', color: '#822727', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
          padding: '1.5rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#2d3748',
        }}>
          {openDoc.body}
        </div>

        {isSigned && (
          <div style={{ background: '#c6f6d5', border: '1px solid #9ae6b4', borderRadius: '10px', padding: '1.25rem', marginTop: '1.25rem' }}>
            <strong style={{ color: '#22543d' }}>Signed</strong>
            <div style={{ color: '#22543d', fontSize: '0.9rem', marginTop: '0.35rem' }}>
              {openDoc.signedBy} ({openDoc.signerRelationship}) on {new Date(openDoc.signedAt).toLocaleString()}
            </div>
            {openDoc.signatureImage && (
              <img
                src={openDoc.signatureImage}
                alt='Your signature'
                style={{ maxWidth: '260px', marginTop: '0.75rem', background: '#fff', borderRadius: '6px', padding: '4px' }}
              />
            )}
            <div style={{ color: '#22543d', fontSize: '0.75rem', marginTop: '0.75rem', wordBreak: 'break-all' }}>
              Document reference: {openDoc.documentHash}
            </div>
          </div>
        )}

        {isDeclined && (
          <div style={{ background: '#fed7d7', border: '1px solid #feb2b2', borderRadius: '10px', padding: '1.25rem', marginTop: '1.25rem', color: '#822727' }}>
            <strong>You declined this document</strong>
            {openDoc.declineReason && <div style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>{openDoc.declineReason}</div>}
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Your care coordinator will be in touch.</div>
          </div>
        )}

        {!isSigned && !isDeclined && !declining && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.5rem', marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', color: '#1a5276', fontSize: '1.05rem' }}>Sign this document</h3>

            {/* Consent sits ABOVE the pad: you agree first, then you sign. */}
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginBottom: '1.1rem', cursor: 'pointer' }}>
              <input type='checkbox' checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: '3px' }} />
              <span style={{ fontSize: '0.9rem', color: '#4a5568' }}>
                I have read this document and I agree that signing it electronically has the same effect as signing it on paper.
              </span>
            </label>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.35rem' }}>
                Your full name
              </label>
              <input
                value={signedBy}
                onChange={e => setSignedBy(e.target.value)}
                placeholder='Type your full name'
                style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#4a5568', marginBottom: '0.35rem' }}>
                You are signing as
              </label>
              <select
                value={relationship}
                onChange={e => setRelationship(e.target.value)}
                style={{ padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px' }}
              >
                {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <SignaturePad onChange={setSignature} />

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button
                onClick={sign}
                disabled={saving || !consent || !signedBy.trim() || !signature}
                style={{
                  background: (!consent || !signedBy.trim() || !signature) ? '#a0aec0' : '#1a5276',
                  color: '#fff', border: 'none', padding: '0.7rem 1.5rem', borderRadius: '8px',
                  cursor: (!consent || !signedBy.trim() || !signature) ? 'not-allowed' : 'pointer', fontWeight: 600,
                }}
              >
                {saving ? 'Saving…' : 'Sign document'}
              </button>
              <button
                onClick={() => setDeclining(true)}
                style={{ background: 'none', border: '1px solid #cbd5e0', color: '#4a5568', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}
              >
                I do not want to sign this
              </button>
            </div>
          </div>
        )}

        {declining && !isSigned && !isDeclined && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.5rem', marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', color: '#822727' }}>Decline this document</h3>
            <p style={{ fontSize: '0.9rem', color: '#4a5568', marginTop: 0 }}>
              Tell us why if you would like to — your care coordinator will follow up either way.
            </p>
            <textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '8px' }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                onClick={decline}
                disabled={saving}
                style={{ background: '#c53030', color: '#fff', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
              >
                {saving ? 'Saving…' : 'Confirm'}
              </button>
              <button
                onClick={() => setDeclining(false)}
                style={{ background: 'none', border: '1px solid #cbd5e0', color: '#4a5568', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}
              >
                Go back
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── list ─────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ margin: '0 0 1.25rem', color: '#1a5276' }}>My Documents</h2>

      {error && (
        <div style={{ background: '#fed7d7', color: '#822727', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '2rem', color: '#718096' }}>
          Nothing to sign right now. Anything your care agency sends you will appear here.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          {documents.map((doc, i) => {
            const badge = STATUS_LABEL[doc.status] || { text: doc.status, color: '#4a5568', bg: '#edf2f7' };
            return (
              <div
                key={doc.id}
                onClick={() => open(doc.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                  padding: '1rem 1.25rem', cursor: 'pointer',
                  borderTop: i === 0 ? 'none' : '1px solid #edf2f7',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#2d3748' }}>{doc.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#718096', marginTop: '2px' }}>
                    {doc.status === 'signed' && doc.signedAt
                      ? `Signed ${formatDate(doc.signedAt)} by ${doc.signedBy}`
                      : `Sent ${formatDate(doc.sentAt)}`}
                  </div>
                </div>
                <span style={{
                  background: badge.bg, color: badge.color, borderRadius: '999px',
                  padding: '0.25rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                  {badge.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalDocuments;
