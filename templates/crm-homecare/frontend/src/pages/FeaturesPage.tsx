import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { toast } from '../components/Toast';
import { OPTIONAL_FEATURES } from '../config/optionalFeatures';

// Read the agency's enabled features. homecare stores them on settings.enabledFeatures
// (see admin.ts feature sync); hasFeature also checks a top-level enabledFeatures, so we
// honor both.
function readSettings(company: any): any {
  if (typeof company?.settings === 'string') {
    try { return JSON.parse(company.settings); } catch { return {}; }
  }
  return company?.settings || {};
}
function currentEnabled(company: any): string[] {
  return (company?.enabledFeatures || readSettings(company).enabledFeatures || []) as string[];
}

export default function FeaturesPage() {
  const { company, updateCompany } = useAuth();
  const optionalIds = useMemo(() => new Set(OPTIONAL_FEATURES.map(f => f.id)), []);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(currentEnabled(company).filter(f => optionalIds.has(f)))
  );
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const settings = readSettings(company);
      // Preserve every non-optional enabled id; only the optional/nav-gated ones change.
      const preserved = currentEnabled(company).filter(f => !optionalIds.has(f));
      const next = [...preserved, ...Array.from(selected)];
      const nextSettings = { ...settings, enabledFeatures: next };
      await api.company.update({ settings: nextSettings });
      updateCompany({ enabledFeatures: next, settings: nextSettings });
      toast('Features updated', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to update features', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Features</h1>
          <p style={{ color: '#6b7280', marginTop: '0.4rem', maxWidth: 560 }}>
            Turn on only the modules you use — the sidebar stays focused. Every feature is
            included free, so add or remove anything anytime at no extra charge.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flexShrink: 0, padding: '0.6rem 1.1rem', borderRadius: 8, border: 'none',
            background: '#f97316', color: '#fff', fontWeight: 600, cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#9ca3af', margin: '0.75rem 0 1rem' }}>
        {selected.size} of {OPTIONAL_FEATURES.length} optional modules on
      </p>

      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {OPTIONAL_FEATURES.map(f => {
          const on = selected.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                padding: '0.85rem 1rem', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${on ? '#fb923c' : '#e5e7eb'}`,
                background: on ? '#fff7ed' : '#fff',
              }}
            >
              <span style={{ fontWeight: 600, color: on ? '#c2410c' : '#374151' }}>{f.label}</span>
              <span
                style={{
                  flexShrink: 0, width: 42, height: 24, borderRadius: 999, position: 'relative',
                  background: on ? '#f97316' : '#d1d5db', transition: 'background 0.15s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: '50%',
                  background: '#fff', transition: 'left 0.15s',
                }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
