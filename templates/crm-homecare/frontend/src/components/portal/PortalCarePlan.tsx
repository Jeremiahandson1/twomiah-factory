// components/portal/PortalCarePlan.jsx
// Read-only view of the client's care plan for family members
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const formatDate = (dateStr) => {
  if (!dateStr) return '\u2014';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
};

const unitLabel = (unitType) => {
  const map = {
    '15min': '15-min units',
    'hour':  'hours',
    'visit': 'visits',
    'day':   'days',
  };
  return map[unitType] || unitType || 'units';
};

const PortalCarePlan = ({ token }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    apiCall('/api/portal/care-plan', { method: 'GET' }, token)
      .then(d => { if (d) setData(d); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading care plan...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!data)   return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No care plan data available.</div>;

  const { client, authorizations, emergencyContacts, caregivers } = data;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        📋 Care Plan
      </h2>

      {/* Client Info Card */}
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#1a5276' }}>
          Client Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <InfoField label="Name" value={`${client.firstName} ${client.lastName}`} />
          <InfoField label="Date of Birth" value={formatDate(client.dateOfBirth)} />
          <InfoField label="Gender" value={client.gender} />
          <InfoField label="Phone" value={client.phone} />
          <InfoField label="Address" value={[client.address, client.city, client.state, client.zip].filter(Boolean).join(', ')} />
          <InfoField label="Service Type" value={client.serviceType} />
          {client.insuranceProvider && (
            <InfoField label="Insurance" value={client.insuranceProvider} />
          )}
          {client.primaryDiagnosisCode && (
            <InfoField label="Primary Diagnosis" value={client.primaryDiagnosisCode} />
          )}
        </div>
      </div>

      {/* Medical Conditions */}
      {client.medicalConditions?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#1a5276' }}>
            🩺 Medical Conditions
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {client.medicalConditions.map((condition, i) => (
              <span key={i} style={{
                background: '#eaf4fd', color: '#1a5276',
                padding: '4px 12px', borderRadius: '16px',
                fontSize: '0.85rem', fontWeight: 500,
              }}>
                {condition}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Allergies */}
      {client.allergies?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
          borderLeft: '4px solid #e74c3c',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#c0392b' }}>
            ⚠️ Allergies
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {client.allergies.map((allergy, i) => (
              <span key={i} style={{
                background: '#fdf2f2', color: '#c0392b',
                padding: '4px 12px', borderRadius: '16px',
                fontSize: '0.85rem', fontWeight: 500,
              }}>
                {allergy}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Medications */}
      {client.medications?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#1a5276' }}>
            💊 Medications
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {client.medications.map((med, i) => (
              <div key={i} style={{
                background: '#f8f9fa', padding: '8px 14px', borderRadius: '8px',
                fontSize: '0.88rem', color: '#333',
              }}>
                {typeof med === 'string' ? med : med.name || JSON.stringify(med)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Special Instructions */}
      {client.notes && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
          borderLeft: '4px solid #f39c12',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#d68910' }}>
            📝 Special Instructions
          </h3>
          <div style={{ fontSize: '0.9rem', color: '#555', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {client.notes}
          </div>
        </div>
      )}

      {/* Authorized Services */}
      {authorizations?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: '#1a5276' }}>
            📑 Authorized Services
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authorizations.map(auth => {
              const pct = auth.authorizedUnits > 0
                ? Math.round((auth.usedUnits / auth.authorizedUnits) * 100)
                : 0;
              const isLow = auth.remainingUnits <= 20;
              return (
                <div key={auth.id} style={{
                  border: '1px solid #e8ecf0', borderRadius: '10px', padding: '16px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    <div>
                      {auth.authNumber && (
                        <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '2px' }}>
                          Auth #{auth.authNumber}
                        </div>
                      )}
                      <div style={{ fontWeight: 600, color: '#333' }}>
                        {auth.procedureCode || 'Service'} {auth.modifier ? `(${auth.modifier})` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.78rem', color: '#888' }}>
                        {formatDate(auth.startDate)} - {formatDate(auth.endDate)}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>
                      <span>{auth.usedUnits} of {auth.authorizedUnits} {unitLabel(auth.unitType)} used</span>
                      <span style={{ fontWeight: 600, color: isLow ? '#c0392b' : '#1e8449' }}>
                        {auth.remainingUnits} remaining
                      </span>
                    </div>
                    <div style={{
                      background: '#e8ecf0', borderRadius: '4px', height: '8px', overflow: 'hidden',
                    }}>
                      <div style={{
                        background: isLow ? '#e74c3c' : pct > 75 ? '#f39c12' : '#2980b9',
                        height: '100%',
                        width: `${Math.min(pct, 100)}%`,
                        borderRadius: '4px',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assigned Caregivers */}
      {caregivers?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#1a5276' }}>
            👤 Assigned Caregivers
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {caregivers.map(cg => (
              <div key={cg.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 14px', background: '#f8f9fa', borderRadius: '8px',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1a5276, #2980b9)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '0.9rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {cg.firstName?.[0]}{cg.lastName?.[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#333' }}>
                    {cg.firstName} {cg.lastName}
                  </div>
                  {cg.hoursPerWeek && (
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      {cg.hoursPerWeek} hrs/week
                    </div>
                  )}
                </div>
                {cg.phone && (
                  <a href={`tel:${cg.phone}`} style={{
                    color: '#1a5276', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none',
                  }}>
                    📞 {cg.phone}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Emergency Contacts */}
      {emergencyContacts?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
          borderLeft: '4px solid #e74c3c',
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#c0392b' }}>
            🚨 Emergency Contacts
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {emergencyContacts.map(ec => (
              <div key={ec.id} style={{
                padding: '10px 14px', background: '#fdf2f2', borderRadius: '8px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#333' }}>
                    {ec.name}
                    {ec.isPrimary && (
                      <span style={{
                        background: '#c0392b', color: '#fff',
                        padding: '1px 6px', borderRadius: '8px',
                        fontSize: '0.7rem', fontWeight: 600, marginLeft: '8px',
                      }}>
                        PRIMARY
                      </span>
                    )}
                  </div>
                  {ec.relationship && (
                    <div style={{ fontSize: '0.82rem', color: '#666' }}>{ec.relationship}</div>
                  )}
                </div>
                <a href={`tel:${ec.phone}`} style={{
                  color: '#c0392b', fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem',
                }}>
                  📞 {ec.phone}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const InfoField = ({ label, value }) => {
  if (!value || value === '\u2014') return null;
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '2px', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: '#333', fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
};

export default PortalCarePlan;
