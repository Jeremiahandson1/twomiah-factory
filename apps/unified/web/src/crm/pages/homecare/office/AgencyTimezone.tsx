// Moved from templates/crm-homecare/frontend/src/components/admin/AgencyTimezone.tsx.
// The agency's clock, shown (and changeable) where its effect is visible: every report counts calendar days, "today"
// and lateness on this zone. Unset, the server derives it from the agency's state (GET /api/company effectiveTimezone,
// server/crm/homecare/office/companyFields.ts).
// Changes: "Change" shows only to whoever holds company:update (PUT /api/company is the owner's and the admins'; the
// template showed it to everyone and let the server refuse). The agency's clock the frame learnt is updated on save.
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/http';
import { setAgencyTimezone } from '../lib/agencyClock';
import { usePermissions, useToast } from '../../../../shared';

const ZONES = [
  'America/New_York', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Chicago', 'America/Denver',
  'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Puerto_Rico', 'Pacific/Guam',
];

/** The parts of GET/PUT /api/company this reads: the column, and the zone the reports actually use. */
interface CompanyClock { timezone?: string | null; effectiveTimezone?: string }

const AgencyTimezone = ({ onChange }: { onChange?: () => void }) => {
  const toast = useToast();
  const { can } = usePermissions();
  const [effective, setEffective] = useState<string>('');
  const [own, setOwn] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);

  const show = (a: CompanyClock | null) => {
    setEffective(a?.effectiveTimezone || '');
    setOwn(a?.timezone || null);
  };

  const load = async () => {
    try {
      show(await api.get('/api/company') as CompanyClock);
    } catch { /* the reports still work on the server's derived zone */ }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.put('/api/company', { timezone: choice || null }) as CompanyClock;
      toast.success('Time zone saved');
      setEditing(false);
      show(saved);
      setAgencyTimezone(saved?.effectiveTimezone);
      onChange && onChange();
    } catch (e) {
      toast.error(errorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!effective) return null;
  const options = ZONES.includes(effective) ? ZONES : [effective, ...ZONES];

  return (
    <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
      {!editing ? (
        <>
          <span>Days counted on <strong style={{ color: 'var(--hc-ink)' }}>{effective.replace(/_/g, ' ')}</strong>{own ? '' : ' (from your state)'}</span>
          {can('company:update') && (
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setChoice(own || effective); setEditing(true); }}>Change</button>
          )}
        </>
      ) : (
        <>
          <label htmlFor="agency-tz" style={{ margin: 0 }}>Agency time zone</label>
          <select
            id="agency-tz"
            value={choice}
            onChange={e => setChoice(e.target.value)}
            style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', border: '1px solid var(--hc-line)', borderRadius: '6px', padding: '0.25rem 0.4rem' }}
          >
            {options.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="button" className="hc-btn hc-btn-sm hc-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
        </>
      )}
    </div>
  );
};

export default AgencyTimezone;
