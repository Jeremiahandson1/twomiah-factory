import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';
import api from '../../services/api';
import { FEATURE_CATEGORIES } from '../../data/features';

// Self-serve feature toggles (Features tab). Reads the agency's enabledFeatures,
// lets an admin flip any feature, saves via PUT /api/company/features (which
// writes the column AND the settings blob — hasFeature checks both), then
// updateCompany() so gating reflects the change without a reload.
export default function FeaturesPage() {
  const { company, updateCompany } = useAuth() as any;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fresh: any = await api.company.get();
        // Effective enabled = column ∪ settings blob (hasFeature checks both).
        const col: string[] = Array.isArray(fresh?.enabledFeatures) ? fresh.enabledFeatures : [];
        let blob: string[] = [];
        let s = fresh?.settings || {};
        if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = {}; } }
        if (Array.isArray(s?.enabledFeatures)) blob = s.enabledFeatures;
        const enabled = Array.from(new Set([...col, ...blob]));
        setSelected(new Set(enabled));
        setInitial(new Set(enabled));
      } catch {
        const col: string[] = Array.isArray(company?.enabledFeatures) ? company.enabledFeatures : [];
        setSelected(new Set(col));
        setInitial(new Set(col));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const changed = (() => {
    let n = 0;
    selected.forEach((id) => { if (!initial.has(id)) n++; });
    initial.forEach((id) => { if (!selected.has(id)) n++; });
    return n;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const ids = Array.from(selected);
      await api.company.updateFeatures(ids);
      updateCompany({ enabledFeatures: ids });
      setInitial(new Set(ids));
      toast('Features updated', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to save features', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#6b7280' }}>Loading features…</div>;

  return (
    <div style={{ maxWidth: 760, padding: '24px 0' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Features</h1>
      <p style={{ color: '#6b7280', margin: '0 0 24px' }}>
        Every feature is included in your plan — switch on the ones you want. Changes apply to your whole team immediately.
      </p>

      {FEATURE_CATEGORIES.map((cat) => (
        <div key={cat.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontWeight: 600 }}>{cat.name}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{cat.description}</div>
          </div>
          {cat.features.map((f, i) => {
            const on = selected.has(f.id);
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px', borderTop: i === 0 ? 'none' : '1px solid #f9fafb' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{f.description}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`${f.name} — ${on ? 'on' : 'off'}`}
                  onClick={() => toggle(f.id)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: on ? '{{PRIMARY_COLOR}}' : '#d1d5db', transition: 'background .15s', flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 4, left: on ? 24 : 4, width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
                  }} />
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {changed > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button onClick={handleSave} disabled={saving} style={{ background: '{{PRIMARY_COLOR}}', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={() => setSelected(new Set(initial))} disabled={saving} style={{ background: 'none', border: 'none', color: '#6b7280', fontWeight: 600, cursor: 'pointer' }}>
            Discard
          </button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{changed} unsaved {changed === 1 ? 'change' : 'changes'}</span>
        </div>
      )}
    </div>
  );
}
