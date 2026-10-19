// The client portal's My Caregivers: who serves the client now. Moved from
// templates/crm-homecare/frontend/src/components/portal/PortalCaregivers.tsx.
//
// Server: GET /api/portal/caregivers (server/crm/homecare/portals/clientPortal.ts → data/homecarePortals.ts
// caregiversServingClient) — a list of { assignmentId, caregiverId, firstName, lastName, phone, hoursPerWeek,
// certifications, status, assignmentDate }.
import { useEffect, useState } from 'react'
import { listRows, usePortal } from './portalHttp'
import CaregiverBackgroundChecks from './CaregiverBackgroundChecks'

interface ServingCaregiver {
  assignmentId: string
  caregiverId: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  hoursPerWeek: string | number | null
  certifications: unknown
}

/** A caregiver's certifications as text: the column is a JSON list (names, or { name } objects). */
const certNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((c) => (typeof c === 'string' ? c : (c as { name?: string })?.name || '')).filter(Boolean) : []

export default function PortalCaregivers({ agencyState }: { agencyState?: string | null }) {
  const portal = usePortal()
  const [caregivers, setCaregivers] = useState<ServingCaregiver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    portal.get('/api/portal/caregivers')
      .then((reply) => { if (reply) setCaregivers(listRows<ServingCaregiver>(reply)) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>👤 My Caregivers</h2>

      {caregivers.length === 0 ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>👤</div>
          <div>No caregivers currently assigned.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {caregivers.map((cg) => {
            const certs = certNames(cg.certifications)
            return (
              <div
                key={cg.caregiverId || cg.assignmentId}
                style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                {/* Avatar: white initials on a fixed navy gradient, in both themes. */}
                <div style={{
                  width: '54px', height: '54px', borderRadius: '50%', background: 'linear-gradient(135deg, #1a5276, #2980b9)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '1.3rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {cg.firstName?.[0]}{cg.lastName?.[0]}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--hcp-navy)' }}>{cg.firstName} {cg.lastName}</div>

                  {cg.hoursPerWeek ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginTop: '2px' }}>{cg.hoursPerWeek} hrs/week</div>
                  ) : null}

                  {certs.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                      {certs.map((cert, i) => (
                        <span key={i} style={{ background: 'var(--hcp-tint)', color: 'var(--hcp-navy)', padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 600 }}>{cert}</span>
                      ))}
                    </div>
                  )}

                  <CaregiverBackgroundChecks caregiverId={cg.caregiverId} apiBase="/api" agencyState={agencyState} />
                </div>

                {cg.phone && (
                  <a
                    href={`tel:${cg.phone}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--hcp-tint)', color: 'var(--hcp-navy)',
                      padding: '8px 14px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem', flexShrink: 0,
                    }}
                  >
                    📞 Call
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
