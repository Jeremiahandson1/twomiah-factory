// Moved from templates/crm-homecare/frontend/src/components/admin/ClientOnboarding.tsx — each client's six onboarding
// steps and how far along they are.
//
// Changed in the move (the template's screen never worked): it saved each step's form to
// PATCH /api/clients/:id/onboarding/:stepId, a route neither the template's server nor the unified one has, so every
// save answered 404 ("Error: Failed to save"); and it measured progress from fields (emergency_contact_1_name,
// assessment_notes …) the onboarding record does not have, so every client read 0%. The record
// (client_onboarding) holds one done / not-done switch per step, which PATCH /api/clients/:id/onboarding sets
// (emergencyContactsCompleted … initialAssessmentCompleted; all six → allCompleted). This screen now reads and sets
// those switches. The step's details themselves live on the client's record (Clients → Edit) and its documents.
import { useState, useEffect } from 'react'
import { api, errorMessage } from '../lib/http'
import { allRows, type Client } from './shared'
import { useMay } from '../lib/useMay'

/** GET /api/clients/:id/onboarding — the client_onboarding row. */
interface Onboarding {
  emergencyContactsCompleted?: boolean
  medicalHistoryCompleted?: boolean
  insuranceInfoCompleted?: boolean
  carePreferencesCompleted?: boolean
  familyCommunicationCompleted?: boolean
  initialAssessmentCompleted?: boolean
  allCompleted?: boolean
}

type StepKey = Exclude<keyof Onboarding, 'allCompleted'>

const onboardingSteps: Array<{ id: string; key: StepKey; label: string; description: string; where: string }> = [
  { id: 'emergency_contacts', key: 'emergencyContactsCompleted', label: 'Emergency Contacts', description: 'Primary and secondary emergency contact information', where: 'Clients → Edit → Basic Info' },
  { id: 'medical_history', key: 'medicalHistoryCompleted', label: 'Medical History', description: 'Conditions, medications, allergies, and medical alerts', where: 'Clients → Edit → Medical' },
  { id: 'insurance_info', key: 'insuranceInfoCompleted', label: 'Insurance Information', description: 'Insurance provider and policy details', where: 'Clients → Edit → Billing' },
  { id: 'care_preferences', key: 'carePreferencesCompleted', label: 'Care Preferences', description: 'Client preferences and preferred caregivers', where: 'Clients → Edit → Caregivers' },
  { id: 'family_communication', key: 'familyCommunicationCompleted', label: 'Family Communication Plan', description: 'How and when to contact family', where: '' },
  { id: 'initial_assessment', key: 'initialAssessmentCompleted', label: 'Initial Assessment', description: 'Comprehensive care assessment and goals', where: '' },
]

const ClientOnboarding = () => {
  // Marking a step is care-clients:update, the server's check (lib/useMay.ts).
  const may = useMay('care-clients')
  const [clients, setClients] = useState<Client[]>([])
  const [expandedClient, setExpandedClient] = useState<string | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [clientData, setClientData] = useState<Record<string, Onboarding>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      const clientsList = await allRows<Client>('/api/clients')
      setClients(clientsList)

      // Load onboarding data for each client
      clientsList.forEach((client) => {
        loadClientData(client.id)
      })
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to load clients'))
    } finally {
      setLoading(false)
    }
  }

  const loadClientData = async (clientId: string) => {
    try {
      const data: Onboarding = await api.get(`/api/clients/${clientId}/onboarding`)
      setClientData((prev) => ({ ...prev, [clientId]: data || {} }))
    } catch {
      // A client created before onboarding records existed has none: it reads as nothing done.
      setClientData((prev) => ({ ...prev, [clientId]: {} }))
    }
  }

  const handleSaveStep = async (clientId: string, key: StepKey, done: boolean) => {
    setSaving(true)
    try {
      const updated: Onboarding = await api.patch(`/api/clients/${clientId}/onboarding`, { [key]: done })
      setClientData((prev) => ({ ...prev, [clientId]: updated || {} }))
      setMessage(done ? 'Onboarding step marked complete.' : 'Onboarding step marked not complete.')
      setTimeout(() => setMessage(''), 2000)
      setExpandedStep(null)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const calculateProgress = (client: Client) => {
    const data = clientData[client.id] || {}
    const completedSteps = onboardingSteps.filter((step) => data[step.key] === true).length
    return Math.round((completedSteps / onboardingSteps.length) * 100)
  }

  const getStepStatus = (client: Client, key: StepKey) => (clientData[client.id] || {})[key] === true

  return (
    <div>
      <div className="page-header">
        <h2>Client Onboarding</h2>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
        </div>
      ) : clients.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No clients yet. Create a client to begin onboarding.</p>
        </div>
      ) : (
        <div className="onboarding-list">
          {clients.map((client) => {
            const progress = calculateProgress(client)
            const isExpanded = expandedClient === client.id

            return (
              <div key={client.id} className="hc-card" style={{ marginBottom: '1.5rem' }}>
                <div
                  className="onboarding-header"
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                  style={{ cursor: 'pointer', paddingBottom: '1rem', borderBottom: '1px solid var(--hc-line)' }}
                >
                  <div className="onboarding-info">
                    <h3 style={{ margin: '0 0 0.25rem 0' }}>{client.firstName} {client.lastName}</h3>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--hc-muted)' }}>
                      {client.serviceType?.replace('_', ' ').toUpperCase()} - {client.city || 'No city'}
                    </p>
                  </div>

                  <div className="onboarding-status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ width: '100px', height: '6px', background: 'var(--hc-line)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: progress === 100 ? 'var(--hc-green-ink)' : 'var(--hc-blue-ink)',
                            transition: 'width 0.3s',
                          }}
                        ></div>
                      </div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold', minWidth: '40px' }}>
                        {progress}%
                      </span>
                    </div>
                    {progress === 100 && <span className="hc-badge hc-badge-success">Complete</span>}
                  </div>

                  <span style={{ fontSize: '1.2rem' }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '1rem' }}>
                    {onboardingSteps.map((step) => {
                      const stepCompleted = getStepStatus(client, step.key)
                      const stepExpanded = expandedStep === `${client.id}-${step.id}`

                      return (
                        <div key={step.id} style={{ marginBottom: '1rem' }}>
                          <div
                            onClick={() => setExpandedStep(stepExpanded ? null : `${client.id}-${step.id}`)}
                            style={{
                              padding: '1rem',
                              background: stepCompleted ? 'var(--hc-success-bg)' : 'var(--hc-subtle)',
                              color: stepCompleted ? 'var(--hc-success-ink)' : 'var(--hc-ink)',
                              borderLeft: `4px solid ${stepCompleted ? 'var(--hc-green-ink)' : 'var(--hc-line)'}`,
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              borderRadius: '4px',
                            }}
                          >
                            <div>
                              <strong>{step.label}</strong>
                              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: stepCompleted ? 'var(--hc-success-ink)' : 'var(--hc-muted)' }}>
                                {step.description}
                              </p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {stepCompleted && <span style={{ color: 'var(--hc-green-ink)', fontSize: '1.2rem' }}>✓</span>}
                              <span style={{ fontSize: '1rem' }}>
                                {stepExpanded ? '▼' : '▶'}
                              </span>
                            </div>
                          </div>

                          {stepExpanded && (
                            <div style={{ paddingTop: '1rem' }}>
                              <div className="hc-card hc-card-form">
                                <h4>{step.label}</h4>
                                <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                                  {step.description}.{step.where ? ` Kept on the client in ${step.where}.` : ''}
                                </p>
                                <div className="form-actions" style={{ marginTop: '1rem' }}>
                                  {may.update && <button
                                    type="button"
                                    className="hc-btn hc-btn-primary"
                                    disabled={saving}
                                    onClick={() => handleSaveStep(client.id, step.key, !stepCompleted)}
                                  >
                                    {stepCompleted ? `Mark ${step.label} not complete` : `Mark ${step.label} complete`}
                                  </button>}
                                  <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setExpandedStep(null)}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ClientOnboarding
