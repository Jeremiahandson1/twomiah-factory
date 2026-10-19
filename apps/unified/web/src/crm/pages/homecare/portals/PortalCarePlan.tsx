// The client portal's Care Plan: the client's details, conditions, allergies, medications, active authorizations,
// caregivers and emergency contacts, read-only. Moved from templates/crm-homecare/frontend/src/components/portal/PortalCarePlan.tsx.
//
// Server: GET /api/portal/care-plan (server/crm/homecare/portals/clientPortal.ts) — one record { client: { firstName,
// lastName, dateOfBirth, gender, address, city, state, zip, phone, serviceType, medicalConditions[], allergies[],
// medications[] (text lines), medicationsSource, notes, insuranceProvider, primaryDiagnosisCode }, authorizations: [{ id,
// authNumber, procedureCode, authorizedUnits, usedUnits, remainingUnits, unitType, startDate, endDate, status }],
// emergencyContacts: [{ id, name, relationship, phone, isPrimary, … }], caregivers: [{ id, firstName, lastName, phone,
// hoursPerWeek }] }. The template also printed an authorization's modifier, which the server does not send.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { formatDate as formatDay } from '../lib/date'
import { serviceLabel } from '../lib/serviceTypes'
import { usePortal } from './portalHttp'

interface CarePlanReply {
  client: {
    firstName: string; lastName: string; dateOfBirth: string | null; gender: string | null
    address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null
    serviceType: string | null; medicalConditions: unknown; allergies: unknown; medications: unknown
    notes: string | null; insuranceProvider: string | null; primaryDiagnosisCode: string | null
  }
  authorizations: Array<{
    id: string; authNumber: string | null; procedureCode: string | null; modifier?: string | null
    authorizedUnits: number; usedUnits: number; remainingUnits: number; unitType: string | null
    startDate: string | null; endDate: string | null
  }>
  emergencyContacts: Array<{ id: string; name: string; relationship: string | null; phone: string; isPrimary: boolean }>
  caregivers: Array<{ id: string; firstName: string | null; lastName: string | null; phone: string | null; hoursPerWeek: string | number | null }>
}

const formatDate = (dateStr: string | null | undefined) =>
  dateStr ? formatDay(dateStr, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—'

const unitLabel = (unitType: string | null) => {
  const map: Record<string, string> = { '15min': '15-min units', hour: 'hours', visit: 'visits', day: 'days' }
  return (unitType && map[unitType]) || unitType || 'units'
}

/** A JSON list column's entries as text (a string, or an object's name). */
const lines = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x as { name?: string })?.name || JSON.stringify(x))) : []

const card = (extra: CSSProperties = {}): CSSProperties => ({
  background: 'var(--hc-surface)', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px', ...extra,
})
const h3 = (color = 'var(--hcp-navy)', margin = '0 0 12px'): CSSProperties => ({ margin, fontSize: '1.05rem', color })

export default function PortalCarePlan() {
  const portal = usePortal()
  const [data, setData] = useState<CarePlanReply | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    portal.get<CarePlanReply>('/api/portal/care-plan')
      .then((d) => { if (d) setData(d) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading care plan...</div>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!data) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>No care plan data available.</div>

  const { client, authorizations, emergencyContacts, caregivers } = data
  const conditions = lines(client.medicalConditions)
  const allergies = lines(client.allergies)
  const meds = lines(client.medications)

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>📋 Care Plan</h2>

      <div style={card()}>
        <h3 style={h3()}>Client Information</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <InfoField label="Name" value={`${client.firstName} ${client.lastName}`} />
          <InfoField label="Date of Birth" value={formatDate(client.dateOfBirth)} />
          <InfoField label="Gender" value={client.gender} />
          <InfoField label="Phone" value={client.phone} />
          <InfoField label="Address" value={[client.address, client.city, client.state, client.zip].filter(Boolean).join(', ')} />
          <InfoField label="Service Type" value={client.serviceType ? serviceLabel(client.serviceType) : null} />
          {client.insuranceProvider && <InfoField label="Insurance" value={client.insuranceProvider} />}
          {client.primaryDiagnosisCode && <InfoField label="Primary Diagnosis" value={client.primaryDiagnosisCode} />}
        </div>
      </div>

      {conditions.length > 0 && (
        <div style={card()}>
          <h3 style={h3()}>🩺 Medical Conditions</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {conditions.map((condition, i) => (
              <span key={i} style={{ background: 'var(--hcp-tint)', color: 'var(--hcp-navy)', padding: '4px 12px', borderRadius: '16px', fontSize: '0.85rem', fontWeight: 500 }}>{condition}</span>
            ))}
          </div>
        </div>
      )}

      {allergies.length > 0 && (
        <div style={card({ borderLeft: '4px solid #e74c3c' })}>
          <h3 style={h3('var(--hc-red-ink)')}>⚠️ Allergies</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {allergies.map((allergy, i) => (
              <span key={i} style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', padding: '4px 12px', borderRadius: '16px', fontSize: '0.85rem', fontWeight: 500 }}>{allergy}</span>
            ))}
          </div>
        </div>
      )}

      {meds.length > 0 && (
        <div style={card()}>
          <h3 style={h3()}>💊 Medications</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {meds.map((med, i) => (
              <div key={i} style={{ background: 'var(--hc-subtle)', padding: '8px 14px', borderRadius: '8px', fontSize: '0.88rem', color: 'var(--hc-ink)' }}>{med}</div>
            ))}
          </div>
        </div>
      )}

      {client.notes && (
        <div style={card({ borderLeft: '4px solid #f39c12' })}>
          <h3 style={h3('var(--hc-warning-ink)')}>📝 Special Instructions</h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{client.notes}</div>
        </div>
      )}

      {authorizations?.length > 0 && (
        <div style={card()}>
          <h3 style={h3('var(--hcp-navy)', '0 0 16px')}>📑 Authorized Services</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authorizations.map((auth) => {
              const pct = auth.authorizedUnits > 0 ? Math.round((auth.usedUnits / auth.authorizedUnits) * 100) : 0
              const isLow = auth.remainingUnits <= 20
              return (
                <div key={auth.id} style={{ border: '1px solid var(--hc-line)', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    <div>
                      {auth.authNumber && <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)', marginBottom: '2px' }}>Auth #{auth.authNumber}</div>}
                      <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{auth.procedureCode || 'Service'} {auth.modifier ? `(${auth.modifier})` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>{formatDate(auth.startDate)} - {formatDate(auth.endDate)}</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--hc-ink-soft)', marginBottom: '4px' }}>
                      <span>{auth.usedUnits} of {auth.authorizedUnits} {unitLabel(auth.unitType)} used</span>
                      <span style={{ fontWeight: 600, color: isLow ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)' }}>{auth.remainingUnits} remaining</span>
                    </div>
                    {/* The bar is a mark, not text: one mid shade reads on the light and the dark track alike. */}
                    <div style={{ background: 'var(--hc-line)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                      <div style={{ background: isLow ? '#e74c3c' : pct > 75 ? '#f39c12' : '#2980b9', height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: '4px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {caregivers?.length > 0 && (
        <div style={card()}>
          <h3 style={h3()}>👤 Assigned Caregivers</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {caregivers.map((cg) => (
              <div key={cg.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: 'var(--hc-subtle)', borderRadius: '8px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #1a5276, #2980b9)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.9rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {cg.firstName?.[0]}{cg.lastName?.[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{cg.firstName} {cg.lastName}</div>
                  {cg.hoursPerWeek ? <div style={{ fontSize: '0.8rem', color: 'var(--hc-ink-soft)' }}>{cg.hoursPerWeek} hrs/week</div> : null}
                </div>
                {cg.phone && (
                  <a href={`tel:${cg.phone}`} style={{ color: 'var(--hcp-navy)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>📞 {cg.phone}</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {emergencyContacts?.length > 0 && (
        <div style={card({ borderLeft: '4px solid #e74c3c' })}>
          <h3 style={h3('var(--hc-red-ink)')}>🚨 Emergency Contacts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {emergencyContacts.map((ec) => (
              <div key={ec.id} style={{ padding: '10px 14px', background: 'var(--hc-danger-bg)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>
                    {ec.name}
                    {ec.isPrimary && (
                      <span style={{ background: '#c0392b', color: '#fff', padding: '1px 6px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600, marginLeft: '8px' }}>PRIMARY</span>
                    )}
                  </div>
                  {ec.relationship && <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>{ec.relationship}</div>}
                </div>
                <a href={`tel:${ec.phone}`} style={{ color: 'var(--hc-danger-ink)', fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem' }}>📞 {ec.phone}</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  if (!value || value === '—') return null
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: '2px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: 'var(--hc-ink)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}
