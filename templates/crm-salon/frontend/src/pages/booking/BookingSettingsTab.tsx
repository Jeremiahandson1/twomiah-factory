import { useState, useEffect } from 'react';
import api from '../../services/api';

/**
 * Booking settings — hours, lead time, and the master switch.
 *
 * Until this tab existed the settings API (GET/PUT /api/booking/settings) had
 * no UI at all: an owner who closes Mondays could not say so without a raw API
 * call. Self-contained on purpose (no toast context, local status line) so the
 * identical file drops into every template that sells online_booking.
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];

interface DayHours { start: string; end: string; enabled: boolean }
type WorkingHours = Record<Day, DayHours>;

interface Settings {
  enabled: boolean;
  slotDurationMinutes: number;
  leadTimeDays: number;
  maxDaysOut: number;
  workingHours: WorkingHours;
  welcomeMessage: string;
  confirmationMessage: string;
  notifyEmail: boolean;
  notifySms: boolean;
}

const DEFAULT_DAY: DayHours = { start: '09:00', end: '17:00', enabled: false };

function normalizeHours(raw: unknown): WorkingHours {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<DayHours>>;
  const out = {} as WorkingHours;
  for (const d of DAYS) {
    const v = src[d] || {};
    out[d] = {
      start: typeof v.start === 'string' ? v.start : DEFAULT_DAY.start,
      end: typeof v.end === 'string' ? v.end : DEFAULT_DAY.end,
      enabled: v.enabled === true,
    };
  }
  return out;
}

export default function BookingSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get('/api/booking/settings');
        setSettings({
          enabled: s?.enabled !== false,
          slotDurationMinutes: Number(s?.slotDurationMinutes ?? 60),
          leadTimeDays: Number(s?.leadTimeDays ?? 1),
          maxDaysOut: Number(s?.maxDaysOut ?? 30),
          workingHours: normalizeHours(s?.workingHours ?? s?.working_hours),
          welcomeMessage: s?.welcomeMessage || '',
          confirmationMessage: s?.confirmationMessage || '',
          notifyEmail: s?.notifyEmail !== false,
          notifySms: s?.notifySms === true,
        });
      } catch {
        setStatus({ kind: 'err', text: 'Could not load booking settings.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((s) => (s ? { ...s, [k]: v } : s));
    setDirty(true);
    setStatus(null);
  };
  const setDay = (d: Day, patch: Partial<DayHours>) => {
    setSettings((s) => (s ? { ...s, workingHours: { ...s.workingHours, [d]: { ...s.workingHours[d], ...patch } } } : s));
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    if (!settings) return;
    for (const d of DAYS) {
      const h = settings.workingHours[d];
      if (h.enabled && h.start >= h.end) {
        setStatus({ kind: 'err', text: `${d[0].toUpperCase() + d.slice(1)}: opening time must be before closing time.` });
        return;
      }
    }
    setSaving(true);
    try {
      await api.put('/api/booking/settings', {
        enabled: settings.enabled,
        slotDurationMinutes: settings.slotDurationMinutes,
        leadTimeDays: settings.leadTimeDays,
        maxDaysOut: settings.maxDaysOut,
        workingHours: settings.workingHours,
        welcomeMessage: settings.welcomeMessage,
        confirmationMessage: settings.confirmationMessage,
        notifyEmail: settings.notifyEmail,
        notifySms: settings.notifySms,
      });
      setDirty(false);
      setStatus({ kind: 'ok', text: 'Saved — the booking page updates immediately.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="bg-white rounded-xl border p-12 text-center text-gray-400">Loading settings...</div>;
  if (!settings) return <div className="bg-white rounded-xl border p-12 text-center text-red-500">{status?.text || 'Could not load booking settings.'}</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Master switch */}
      <div className="bg-white rounded-xl border p-5 flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900">Online booking is {settings.enabled ? 'ON' : 'OFF'}</div>
          <p className="text-sm text-gray-500">
            {settings.enabled
              ? 'Customers can book from your website and the booking page.'
              : 'The public booking page tells customers booking is unavailable.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => set('enabled', !settings.enabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${settings.enabled ? 'bg-orange-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Hours */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Booking hours</h2>
        <p className="text-sm text-gray-500 mb-4">Days switched off never appear on the public date picker.</p>
        <div className="space-y-2">
          {DAYS.map((d) => {
            const h = settings.workingHours[d];
            return (
              <div key={d} className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 w-32 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDay(d, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-sm font-medium text-gray-700 capitalize">{d}</span>
                </label>
                {h.enabled ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={h.start} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDay(d, { start: e.target.value })}
                      className="px-2 py-1.5 border rounded-lg text-sm" />
                    <span className="text-gray-400 text-sm">to</span>
                    <input type="time" value={h.end} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDay(d, { end: e.target.value })}
                      className="px-2 py-1.5 border rounded-lg text-sm" />
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scheduling rules */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Scheduling rules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slot length</label>
            <select value={settings.slotDurationMinutes}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('slotDurationMinutes', Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg text-sm">
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">A service's own duration overrides this.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notice needed</label>
            <select value={settings.leadTimeDays}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('leadTimeDays', Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value={0}>Same-day OK</option>
              <option value={1}>1 day ahead</option>
              <option value={2}>2 days ahead</option>
              <option value={3}>3 days ahead</option>
              <option value={7}>1 week ahead</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Book up to</label>
            <select value={settings.maxDaysOut}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('maxDaysOut', Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value={14}>2 weeks out</option>
              <option value={30}>30 days out</option>
              <option value={60}>60 days out</option>
              <option value={90}>90 days out</option>
            </select>
          </div>
        </div>
      </div>

      {/* Messages + notifications */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Messages</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Booking page heading</label>
          <input value={settings.welcomeMessage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('welcomeMessage', e.target.value)}
            placeholder="Book an appointment"
            className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirmation message</label>
          <input value={settings.confirmationMessage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('confirmationMessage', e.target.value)}
            placeholder="You're booked — see you soon!"
            className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.notifyEmail}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('notifyEmail', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <span className="text-sm text-gray-700">Email me on each booking</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.notifySms}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('notifySms', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <span className="text-sm text-gray-700">Text me on each booking</span>
          </label>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>
        {status && (
          <span className={`text-sm ${status.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{status.text}</span>
        )}
        {dirty && !status && <span className="text-sm text-gray-400">Unsaved changes</span>}
      </div>
    </div>
  );
}
