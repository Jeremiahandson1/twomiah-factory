// Moved from templates/crm-homecare/frontend/src/components/CaregiverClientModal.tsx.
// What a caregiver sees when they open a client — care-focused information only, no admin or billing.
//
// Server (server/crm/homecare/clients/clients.ts): GET /api/clients/:id/caregiver-view (the card: firstName, lastName,
// phone, dateOfBirth, address, city, state, zip, emergencyContactName / Phone / Relationship, carePreferences, notes,
// allergies, medicalConditions, medications, medicationsSource, medicalNotes, mobilityAssistanceNeeds), GET
// /api/clients/:id/visit-notes ({ data }: id, note, createdAt, source, caregiverName) and POST …/visit-notes { note }.
//
// Changes from the template: no token; the card and the notes are camelCase and the notes a { data } list; a failed
// note is the app's toast (the template's alert()); every colour is a frame token (the warning and danger cards are the
// frame's warning / danger pairs); the tab and action buttons are hc-btn.
import { useEffect, useState, type FormEvent } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'
import { formatDateTime } from '../lib/datetime'
import { TextButton, useToast } from '../../../../shared'

/** GET /api/clients/:id/caregiver-view. */
interface ClientCard {
  id: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelationship: string | null
  medicalConditions: string | null
  medications: string | null
  medicationsSource: 'medications' | 'client_record' | null
  allergies: string | null
  medicalNotes: string | null
  carePreferences: string | null
  mobilityAssistanceNeeds: string | null
  notes: string | null
}

/** A row of GET /api/clients/:id/visit-notes. */
interface VisitNote { id: string; note: string; createdAt: string; source?: string; caregiverName: string | null }

const CaregiverClientModal = ({ clientId, isOpen, onClose }: { clientId: string | null; isOpen: boolean; onClose: () => void }) => {
  const toast = useToast()
  const [client, setClient] = useState<ClientCard | null>(null)
  const [visitNotes, setVisitNotes] = useState<VisitNote[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'medical' | 'notes'>('info')
  const [newNote, setNewNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadClientData = async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const [card, notes] = await Promise.all([
        api.get(`/api/clients/${clientId}/caregiver-view`).catch(() => null),
        api.get(`/api/clients/${clientId}/visit-notes`).catch(() => null),
      ])
      setClient(card as ClientCard | null)
      if (notes) setVisitNotes(rows<VisitNote>(notes))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && clientId) loadClientData()
  }, [isOpen, clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault()
    if (!newNote.trim() || !clientId) return
    setSubmitting(true)
    try {
      await api.post(`/api/clients/${clientId}/visit-notes`, { note: newNote })
      setNewNote('')
      loadClientData()
    } catch (error) {
      toast.error('Failed to add note: ' + errorMessage(error, 'Failed to add note'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'info' as const, label: '📋 Info' },
    { id: 'medical' as const, label: '📋 Medical' },
    { id: 'notes' as const, label: '📝 Notes' },
  ]
  const plain = { marginBottom: '1rem' }

  return (
    <div className="modal active">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h2>{loading ? 'Loading...' : `${client?.firstName ?? ''} ${client?.lastName ?? ''}`}</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : !client ? (
          <p>Client not found</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--hc-line)', paddingBottom: '0.5rem' }}>
              {tabs.map((tab) => (
                <button key={tab.id} type="button"
                  className={`hc-btn ${activeTab === tab.id ? 'hc-btn-primary' : 'hc-btn-secondary'}`}
                  onClick={() => setActiveTab(tab.id)} style={{ flex: 1 }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'info' && (
              <div>
                <div className="hc-card" style={{ background: 'var(--hc-subtle)', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0 }}>👤 Basic Information</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <p><strong>Phone:</strong> <a href={`tel:${client.phone || ''}`}>{client.phone || 'N/A'}</a>{client.phone && <>{' '}<TextButton phone={client.phone} name={client.firstName} compact /></>}</p>
                    <p><strong>DOB:</strong> {client.dateOfBirth ? formatDate(client.dateOfBirth) : 'N/A'}</p>
                    <p style={{ gridColumn: '1 / -1' }}>
                      <strong>Address:</strong>{' '}
                      {client.address ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${client.address}, ${client.city}, ${client.state} ${client.zip}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          📍 {client.address}, {client.city}, {client.state} {client.zip}
                        </a>
                      ) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Emergency Contact - IMPORTANT */}
                <div className="hc-card" style={{ background: 'var(--hc-warning-bg)', border: '2px solid var(--hc-warning-line)', color: 'var(--hc-warning-ink)', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0, color: 'var(--hc-warning-ink)' }}>🚨 Emergency Contact</h4>
                  {client.emergencyContactName ? (
                    <div>
                      <p style={{ margin: '0.25rem 0' }}>
                        <strong>{client.emergencyContactName}</strong>
                        {client.emergencyContactRelationship && ` (${client.emergencyContactRelationship})`}
                      </p>
                      <p style={{ margin: '0.25rem 0', fontSize: '1.1rem' }}>
                        📞 <a href={`tel:${client.emergencyContactPhone || ''}`} style={{ fontWeight: 'bold', color: 'var(--hc-warning-ink)' }}>
                          {client.emergencyContactPhone}
                        </a>
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: 'var(--hc-warning-ink)' }}>No emergency contact on file</p>
                  )}
                </div>

                {client.carePreferences && (
                  <div className="hc-card" style={plain}>
                    <h4 style={{ marginTop: 0 }}>💡 Care Preferences</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{client.carePreferences}</p>
                  </div>
                )}

                {client.notes && (
                  <div className="hc-card" style={plain}>
                    <h4 style={{ marginTop: 0 }}>📋 Care Instructions</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{client.notes}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'medical' && (
              <div>
                {/* Allergies - CRITICAL */}
                <div className="hc-card" style={client.allergies
                  ? { background: 'var(--hc-danger-bg)', border: '2px solid var(--hc-danger-ink)', color: 'var(--hc-danger-ink)', marginBottom: '1rem' }
                  : { background: 'var(--hc-subtle)', border: '1px solid var(--hc-line)', marginBottom: '1rem' }}>
                  <h4 style={{ marginTop: 0, color: client.allergies ? 'var(--hc-danger-ink)' : 'inherit' }}>⚠️ Allergies</h4>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.allergies || 'No known allergies'}</p>
                </div>

                <div className="hc-card" style={plain}>
                  <h4 style={{ marginTop: 0 }}>📋 Medical Conditions</h4>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.medicalConditions || 'None on file'}</p>
                </div>

                <div className="hc-card" style={plain}>
                  <h4 style={{ marginTop: 0 }}>💊 Medications</h4>
                  {/* The office's Medications list is the record; the client record's old free-text note shows only
                      when that list is empty, and says so. */}
                  {client.medicationsSource === 'client_record' && (
                    <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      Notes from the client record — not on the office's Medications list yet.
                    </p>
                  )}
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.medications || 'None on file'}</p>
                </div>

                {client.medicalNotes && (
                  <div className="hc-card" style={plain}>
                    <h4 style={{ marginTop: 0 }}>📝 Medical Notes</h4>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.medicalNotes}</p>
                  </div>
                )}

                {client.mobilityAssistanceNeeds && (
                  <div className="hc-card" style={plain}>
                    <h4 style={{ marginTop: 0 }}>🚶 Mobility & Assistance</h4>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{client.mobilityAssistanceNeeds}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <div className="hc-card" style={plain}>
                  <h4 style={{ marginTop: 0 }}>➕ Add Visit Note</h4>
                  <form onSubmit={handleAddNote}>
                    <div className="form-group">
                      <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
                        placeholder="How was the visit? Any observations, concerns, or updates about the client..."
                        rows={3} required />
                    </div>
                    <button type="submit" className="hc-btn hc-btn-primary" disabled={submitting || !newNote.trim()}>
                      {submitting ? 'Saving...' : 'Add Note'}
                    </button>
                  </form>
                </div>

                <div className="hc-card">
                  <h4 style={{ marginTop: 0 }}>📜 Recent Visit Notes</h4>
                  {visitNotes.length === 0 ? (
                    <p style={{ color: 'var(--hc-muted)' }}>No visit notes yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {visitNotes.map((note, idx) => (
                        <div key={note.id || idx} style={{ padding: '1rem', background: 'var(--hc-subtle)', borderRadius: '6px', borderLeft: '4px solid var(--hc-blue-ink)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--hc-muted)' }}>
                            <span><strong>{note.caregiverName || 'Caregiver'}</strong></span>
                            <span>{formatDateTime(note.createdAt)}</span>
                          </div>
                          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="hc-btn hc-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default CaregiverClientModal
