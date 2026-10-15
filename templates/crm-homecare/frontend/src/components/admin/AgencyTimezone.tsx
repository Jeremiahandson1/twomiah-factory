// The agency's clock, shown (and changeable) where its effect is visible: every report counts calendar
// days, "today" and lateness on this zone. Unset, the server derives it from the agency's state.
import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';

const ZONES = [
  'America/New_York', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Chicago', 'America/Denver',
  'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Puerto_Rico', 'Pacific/Guam',
];

const AgencyTimezone = ({ onChange }: { onChange?: () => void }) => {
  const { token } = useAuth();
  const [effective, setEffective] = useState<string>('');
  const [own, setOwn] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/company`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const a = await r.json();
      setEffective(a.effectiveTimezone || a.effective_timezone || '');
      setOwn(a.timezone || null);
    } catch { /* the reports still work on the server's derived zone */ }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/company`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ timezone: choice || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Save failed');
      toast('Time zone saved', 'success');
      setEditing(false);
      await load();
      onChange && onChange();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!effective) return null;
  const options = ZONES.includes(effective) ? ZONES : [effective, ...ZONES];

  return (
    <div style={{ fontSize: '0.82rem', color: '#4B5563', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
      {!editing ? (
        <>
          <span>Days counted on <strong style={{ color: '#111827' }}>{effective.replace(/_/g, ' ')}</strong>{own ? '' : ' (from your state)'}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setChoice(own || effective); setEditing(true); }}>Change</button>
        </>
      ) : (
        <>
          <label htmlFor="agency-tz" style={{ margin: 0 }}>Agency time zone</label>
          <select id="agency-tz" value={choice} onChange={e => setChoice(e.target.value)}>
            {options.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
        </>
      )}
    </div>
  );
};

export default AgencyTimezone;
