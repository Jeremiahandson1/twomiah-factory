import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const STEPS = ['Welcome', 'Agency Profile', 'Quick Setup', 'Ready!'];

const FEATURES = [
  {
    id: 'evv_tracking',
    label: 'EVV Tracking',
    description: 'Electronic Visit Verification — clock in/out with GPS to meet Medicaid compliance requirements.',
    icon: '📍',
  },
  {
    id: 'family_portal',
    label: 'Family Portal',
    description: 'Give family members a portal to view schedules, care notes, and communicate with your team.',
    icon: '🏠',
  },
  {
    id: 'automated_billing',
    label: 'Automated Billing',
    description: 'Auto-generate invoices from verified visits and submit claims to payers.',
    icon: '🧾',
  },
  {
    id: 'caregiver_gps',
    label: 'Caregiver GPS Clock-In',
    description: 'Require caregivers to clock in from the client\'s location using geofence verification.',
    icon: '🛰️',
  },
];

const PAYER_OPTIONS = [
  { value: '', label: 'Select primary payer...' },
  { value: 'medicaid', label: 'Medicaid' },
  { value: 'medicare', label: 'Medicare' },
  { value: 'private_pay', label: 'Private Pay' },
  { value: 'va', label: 'Veterans Affairs (VA)' },
];

export default function OnboardingWizard() {
  const { company, updateCompany } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [agency, setAgency] = useState<any>(null);

  // Agency profile form state
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    medicaidId: '',
    npi: '',
    primaryPayer: '',
  });

  // Feature toggles
  const [enabledSetup, setEnabledSetup] = useState<Record<string, boolean>>({
    evv_tracking: false,
    family_portal: false,
    automated_billing: false,
    caregiver_gps: false,
  });

  // Pre-fill from company (agency) data
  useEffect(() => {
    if (company) {
      setAgency(company);
      setProfile({
        name: company.name || '',
        phone: company.phone || '',
        email: company.email || '',
        address: company.address || '',
        city: company.city || '',
        state: company.state || '',
        zip: company.zip || '',
        medicaidId: company.medicaidId || '',
        npi: company.npi || '',
        primaryPayer: '',
      });
      // Default EVV on if agency settings indicate the add-on was purchased
      const settings = company.settings || {};
      if (settings.evv_addon || settings.evv_enabled) {
        setEnabledSetup(prev => ({ ...prev, evv_tracking: true }));
      }
    }
  }, [company]);

  const handleProfileChange = (field: string, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const toggleFeature = (featureId: string) => {
    setEnabledSetup(prev => ({ ...prev, [featureId]: !prev[featureId] }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const currentSettings = (agency?.settings && typeof agency.settings === 'object') ? agency.settings : {};
      const update: Record<string, any> = {
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zip: profile.zip,
        medicaidId: profile.medicaidId || null,
        npi: profile.npi || null,
        settings: {
          ...currentSettings,
          onboardingComplete: true,
          onboardingFeatures: enabledSetup,
          primaryPayer: profile.primaryPayer || null,
        },
      };

      const updated = await api.company.update(update);
      updateCompany(updated);
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
    } finally {
      setSaving(false);
    }
  };

  const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-teal-50 flex flex-col" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Progress bar */}
      <div style={{ width: '100%', height: 6, background: '#e5e7eb' }}>
        <div style={{ height: '100%', width: `${progressPercent}%`, background: '#14b8a6', borderRadius: '0 4px 4px 0', transition: 'width 0.5s ease' }} />
      </div>

      {/* Step indicators */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 1rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {STEPS.map((label, idx) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600,
                  background: idx <= currentStep ? '#14b8a6' : '#e5e7eb',
                  color: idx <= currentStep ? '#fff' : '#9ca3af',
                  boxShadow: idx === currentStep ? '0 0 0 4px rgba(20,184,166,0.2)' : 'none',
                }}>
                  {idx < currentStep ? '✓' : idx + 1}
                </div>
                <span style={{ fontSize: 12, color: idx <= currentStep ? '#111' : '#9ca3af', fontWeight: idx <= currentStep ? 500 : 400 }}>
                  {label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div style={{ width: 40, height: 2, background: idx < currentStep ? '#14b8a6' : '#e5e7eb' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '2rem 1rem' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          {currentStep === 0 && <StepWelcome agencyName={agency?.name} />}
          {currentStep === 1 && <StepProfile profile={profile} onChange={handleProfileChange} />}
          {currentStep === 2 && <StepQuickSetup features={enabledSetup} onToggle={toggleFeature} />}
          {currentStep === 3 && <StepReady />}
        </div>
      </div>

      {/* Navigation buttons */}
      <div style={{ borderTop: '1px solid #e5e7eb', background: '#fff', padding: '1rem' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
          {currentStep > 0 ? (
            <button onClick={handleBack} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.6rem 1.2rem', fontSize: 14, fontWeight: 500,
              color: '#374151', background: 'transparent', border: 'none',
              borderRadius: 8, cursor: 'pointer',
            }}>
              ← Back
            </button>
          ) : <div />}

          {currentStep < STEPS.length - 1 ? (
            <button onClick={handleNext} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.6rem 1.5rem', fontSize: 14, fontWeight: 600,
              color: '#fff', background: '#14b8a6', border: 'none',
              borderRadius: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              Continue →
            </button>
          ) : (
            <button onClick={handleComplete} disabled={saving} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.6rem 1.5rem', fontSize: 14, fontWeight: 600,
              color: '#fff', background: saving ? '#9ca3af' : '#14b8a6', border: 'none',
              borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              {saving ? 'Saving...' : 'Go to Dashboard 🚀'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Step Components ---------- */

function StepWelcome({ agencyName }: { agencyName?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
      <div style={{
        width: 80, height: 80, borderRadius: 16,
        background: 'rgba(20,184,166,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 1.5rem', fontSize: 40,
      }}>
        💚
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 12 }}>
        Welcome to {agencyName || 'Twomiah Care'}!
      </h1>
      <p style={{ fontSize: 16, color: '#6b7280', marginBottom: 32, maxWidth: 460, margin: '0 auto 2rem' }}>
        Let's set up your agency in just a few steps. Twomiah Care helps you manage clients, caregivers, scheduling, billing, and compliance — all in one place.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, maxWidth: 500, margin: '0 auto', textAlign: 'left' }}>
        {[
          { icon: '🏢', text: 'Set up your agency profile' },
          { icon: '⚙️', text: 'Choose your care features' },
          { icon: '🚀', text: 'Start managing your clients' },
        ].map(({ icon, text }) => (
          <div key={text} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12,
            borderRadius: 8, background: '#fff', border: '1px solid #e5e7eb',
          }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
            <span style={{ fontSize: 14, color: '#374151' }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem',
  border: '1px solid #d1d5db', borderRadius: 8,
  fontSize: 14, color: '#111', background: '#fff',
  outline: 'none', boxSizing: 'border-box',
};

function StepProfile({ profile, onChange }: { profile: any; onChange: (field: string, value: string) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4 }}>Agency Profile</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Confirm your agency details. You can update these later in Settings.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FieldRow>
          <Field label="Agency Name" value={profile.name} field="name" onChange={onChange} placeholder="Sunshine Home Care" />
        </FieldRow>

        <FieldRow cols={2}>
          <Field label="Phone" value={profile.phone} field="phone" onChange={onChange} placeholder="(555) 123-4567" type="tel" />
          <Field label="Email" value={profile.email} field="email" onChange={onChange} placeholder="info@agency.com" type="email" />
        </FieldRow>

        <FieldRow>
          <Field label="Street Address" value={profile.address} field="address" onChange={onChange} placeholder="123 Main St" />
        </FieldRow>

        <FieldRow cols={3}>
          <Field label="City" value={profile.city} field="city" onChange={onChange} placeholder="City" />
          <Field label="State" value={profile.state} field="state" onChange={onChange} placeholder="ST" />
          <Field label="ZIP" value={profile.zip} field="zip" onChange={onChange} placeholder="12345" />
        </FieldRow>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 4 }}>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>Optional — helps with payer setup</p>
        </div>

        <FieldRow cols={2}>
          <Field label="State Medicaid Provider Number" value={profile.medicaidId} field="medicaidId" onChange={onChange} placeholder="Optional" />
          <Field label="NPI Number" value={profile.npi} field="npi" onChange={onChange} placeholder="Optional" />
        </FieldRow>

        <FieldRow>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
              Primary Payer
            </label>
            <select
              value={profile.primaryPayer}
              onChange={e => onChange('primaryPayer', e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {PAYER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </FieldRow>
      </div>
    </div>
  );
}

function StepQuickSetup({ features, onToggle }: { features: Record<string, boolean>; onToggle: (id: string) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4 }}>Quick Setup</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Enable the features you need. You can always change these later in Settings.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {FEATURES.map(feature => {
          const enabled = features[feature.id];
          return (
            <button
              key={feature.id}
              onClick={() => onToggle(feature.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'flex-start', gap: 16,
                padding: 16, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                border: `2px solid ${enabled ? '#14b8a6' : '#e5e7eb'}`,
                background: enabled ? 'rgba(20,184,166,0.05)' : '#fff',
                transition: 'all 0.2s',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
                background: enabled ? '#14b8a6' : '#f3f4f6',
              }}>
                {feature.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: enabled ? '#0d9488' : '#111' }}>
                    {feature.label}
                  </span>
                  <div style={{
                    width: 40, height: 24, borderRadius: 12, padding: 2,
                    background: enabled ? '#14b8a6' : '#d1d5db',
                    display: 'flex', alignItems: enabled ? 'center' : 'center',
                    justifyContent: enabled ? 'flex-end' : 'flex-start',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
                  </div>
                </div>
                <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{feature.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepReady() {
  return (
    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
      <div style={{
        width: 80, height: 80, borderRadius: 16,
        background: 'rgba(34,197,94,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 1.5rem', fontSize: 40,
      }}>
        ✅
      </div>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 12 }}>You're all set!</h2>
      <p style={{ fontSize: 16, color: '#6b7280', marginBottom: 32 }}>
        Your agency is ready. Here's what to do next:
      </p>

      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: 24, maxWidth: 400, margin: '0 auto', textAlign: 'left',
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
          First steps
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FirstAction icon="👤" label="Add your first client" hint="Go to Clients in the sidebar" />
          <FirstAction icon="🧑‍⚕️" label="Add your first caregiver" hint="Go to Caregivers in the sidebar" />
          <FirstAction icon="📅" label="Set up your first schedule" hint="Go to Schedule Hub in the sidebar" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Shared small components ---------- */

function FirstAction({ icon, label, hint }: { icon: string; label: string; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>{hint}</div>
      </div>
    </div>
  );
}

function FieldRow({ children, cols }: { children: React.ReactNode; cols?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols ? `repeat(${cols}, 1fr)` : '1fr', gap: 12 }}>
      {children}
    </div>
  );
}

function Field({ label, value, field, onChange, placeholder, type }: {
  label: string; value: string; field: string;
  onChange: (field: string, value: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(field, e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}
