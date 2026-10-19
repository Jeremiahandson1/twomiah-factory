// Moved from templates/crm-homecare/frontend/src/components/admin/NoShowAlerts.tsx.
// Monitor and configure automated no-show detection.
//
// Its calls, as the unified server answers them (server/crm/homecare/scheduling/noShow.ts; every route asks
// care-schedule:update):
//   GET  /api/no-show/alerts?status=      → list reply; rows camelCase (caregiverName, clientName, shiftDate
//                                           'YYYY-MM-DD', expectedStart 'HH:MM:SS', smsSent, resolutionNote).
//   GET  /api/no-show/stats               → { openCount, todayCount, weekCount, resolvedCount, … } (was open_count …).
//   GET  /api/no-show/config              → { graceMinutes, notifyAdmin, notifyCaregiver, notifyClientFamily, adminPhone,
//                                           adminEmail, isActive } (was grace_minutes …).
//   POST /api/no-show/run-check           → { checked, alertsCreated } (was alerts_created).
//   PUT  /api/no-show/alerts/:id/resolve  { resolutionNote, status: 'resolved' | 'false_alarm' } — stored as sent (the
//                                           template's route stored 'resolved' for both).
//   PUT  /api/no-show/config              — the same camelCase body as the template.
import { useState, useEffect, type CSSProperties } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { useToast } from '../../../../shared'
import { SOLID, backdrop, field } from './ui'
import { useMay } from '../lib/useMay'

interface NoShowAlert {
  id: string
  caregiverName: string | null
  clientName: string | null
  shiftDate: string
  expectedStart: string | null
  status: string
  smsSent: boolean | null
  resolutionNote: string | null
  /** Not in the reply (the template read caregiver_phone, which its server never sent either); kept for the day it is. */
  caregiverPhone?: string | null
}

interface NoShowStats { openCount?: number; todayCount?: number; weekCount?: number; resolvedCount?: number }

interface NoShowConfig {
  graceMinutes: number
  notifyAdmin: boolean
  notifyCaregiver: boolean
  notifyClientFamily: boolean
  adminPhone: string | null
  adminEmail: string | null
  isActive: boolean
}

type NotifyKey = 'notifyAdmin' | 'notifyCaregiver' | 'notifyClientFamily'
type Filter = 'open' | 'resolved' | 'false_alarm' | 'all'

export default function NoShowAlerts() {
  const toast = useToast()
  // Every /api/no-show write is care-schedule:update (scheduling/noShow.ts) — lib/useMay.ts.
  const may = useMay('care-schedule')
  const [alerts, setAlerts] = useState<NoShowAlert[]>([])
  const [stats, setStats] = useState<NoShowStats>({})
  const [config, setConfig] = useState<NoShowConfig>({ graceMinutes: 15, notifyAdmin: true, notifyCaregiver: true, notifyClientFamily: false, adminPhone: '', adminEmail: '', isActive: true })
  const [tab, setTab] = useState<'alerts' | 'settings'>('alerts')
  const [filter, setFilter] = useState<Filter>('open')
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [resolveModal, setResolveModal] = useState<NoShowAlert | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [alertsData, statsData, cfg] = await Promise.all([
        api.get('/api/no-show/alerts', { status: filter, limit: 100 }),
        api.get('/api/no-show/stats'),
        api.get('/api/no-show/config'),
      ])
      setAlerts(rows<NoShowAlert>(alertsData))
      setStats((statsData as NoShowStats) || {})
      const c = cfg as NoShowConfig | null
      if (c && c.graceMinutes) setConfig(c)
    } catch { /* the template showed nothing on a failed load */ }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [filter])

  const runCheck = async () => {
    setChecking(true)
    try {
      const data = (await api.post('/api/no-show/run-check')) as { alertsCreated?: number; checked?: number }
      const created = data?.alertsCreated ?? 0
      const checked = data?.checked ?? 0
      toast.success(`✓ Check complete — ${created} new alert${created !== 1 ? 's' : ''} created (${checked} shifts checked)`)
      load()
    } catch { toast.error('Check failed') }
    setChecking(false)
  }

  const resolve = async (id: string, status: 'resolved' | 'false_alarm') => {
    try {
      await api.put(`/api/no-show/alerts/${encodeURIComponent(id)}/resolve`, { resolutionNote: resolveNote, status })
      toast.success('Resolved')
      setResolveModal(null)
      setResolveNote('')
      load()
    } catch (e) { toast.error(errorMessage(e, 'Error')) }
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      await api.put('/api/no-show/config', {
        graceMinutes: config.graceMinutes,
        notifyAdmin: config.notifyAdmin,
        notifyCaregiver: config.notifyCaregiver,
        notifyClientFamily: config.notifyClientFamily,
        adminPhone: config.adminPhone,
        adminEmail: config.adminEmail,
        isActive: config.isActive,
      })
      toast.success('Settings saved')
    } catch (e) { toast.error(errorMessage(e, 'Error saving')) }
    setSavingConfig(false)
  }

  const tabStyle = (t: 'alerts' | 'settings'): CSSProperties => ({
    padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? 'var(--hc-blue-ink)' : 'transparent'}`,
    background: 'none', cursor: 'pointer', fontWeight: tab === t ? 700 : 400,
    color: tab === t ? 'var(--hc-blue-ink)' : 'var(--hc-ink-soft)', fontSize: '0.92rem',
  })

  // Each status as an ink on its own ground, light and dark.
  const statusBadge = (s: string) => {
    const map: Record<string, [string, string]> = {
      open: ['var(--hc-danger-bg)', 'var(--hc-danger-ink)'],
      resolved: ['var(--hc-success-bg)', 'var(--hc-success-ink)'],
    }
    const [bg, color] = map[s] || ['var(--hc-subtle)', 'var(--hc-ink-soft)']
    return <span style={{ background: bg, color, padding: '0.15rem 0.55rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>{String(s || '').replace('_', ' ')}</span>
  }

  const labelStyle: CSSProperties = { display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--hc-ink-soft)' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>🚨 No-Show Alerts</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: config.isActive ? 'var(--hc-green-ink)' : 'var(--hc-red-ink)', fontWeight: 600 }}>
            {config.isActive ? '● Active' : '○ Disabled'}
          </span>
          {may.update && <button onClick={runCheck} disabled={checking}
            style={{ padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none', background: SOLID.blue, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', opacity: checking ? 0.7 : 1 }}>
            {checking ? '⏳ Checking...' : '▶ Run Check Now'}
          </button>}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Open Alerts', val: stats.openCount || 0, kind: 'danger' },
          { label: 'Today', val: stats.todayCount || 0, kind: 'warning' },
          { label: 'This Week', val: stats.weekCount || 0, kind: 'info' },
          { label: 'Resolved', val: stats.resolvedCount || 0, kind: 'success' },
        ].map((s) => (
          <div key={s.label} style={{ background: `var(--hc-${s.kind}-bg)`, borderRadius: '10px', padding: '1rem', textAlign: 'center', border: `1px solid var(--hc-${s.kind}-line)` }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: `var(--hc-${s.kind}-ink)` }}>{s.val}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink)', fontWeight: 600, marginTop: '0.2rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--hc-line)', marginBottom: '1.25rem' }}>
        <button style={tabStyle('alerts')} onClick={() => setTab('alerts')}>🚨 Alerts</button>
        <button style={tabStyle('settings')} onClick={() => setTab('settings')}>⚙️ Settings</button>
      </div>

      {tab === 'alerts' && (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {(['open', 'resolved', 'false_alarm', 'all'] as Filter[]).map((s) => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ padding: '0.35rem 0.85rem', borderRadius: '20px', border: `1px solid ${filter === s ? SOLID.blue : 'var(--hc-line)'}`,
                  background: filter === s ? SOLID.blue : 'var(--hc-surface)', color: filter === s ? '#fff' : 'var(--hc-ink-soft)',
                  cursor: 'pointer', fontSize: '0.82rem', fontWeight: filter === s ? 700 : 400 }}>
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          {loading ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-ink-soft)' }}>Loading...</div>
          : alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-ink-soft)', background: 'var(--hc-subtle)', borderRadius: '10px', border: '2px dashed var(--hc-line)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
              <div style={{ fontWeight: 600 }}>No {filter !== 'all' ? filter : ''} alerts</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {alerts.map((a) => (
                <div key={a.id} style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', border: `1px solid ${a.status === 'open' ? 'var(--hc-danger-line)' : 'var(--hc-line)'}`, borderLeft: `4px solid ${a.status === 'open' ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)'}`, borderRadius: '8px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{a.caregiverName || 'Unknown'}</span>
                      <span style={{ color: 'var(--hc-muted)', fontSize: '0.82rem' }}>→ {a.clientName || 'Unknown client'}</span>
                      {statusBadge(a.status)}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--hc-muted)' }}>
                      Shift: {a.shiftDate} at {a.expectedStart?.slice(0, 5)}
                      {a.caregiverPhone && <span style={{ marginLeft: '0.75rem' }}>📞 {a.caregiverPhone}</span>}
                    </div>
                    {a.smsSent && <div style={{ fontSize: '0.75rem', color: 'var(--hc-green-ink)', marginTop: '0.2rem' }}>✓ SMS sent</div>}
                    {a.resolutionNote && <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginTop: '0.35rem', fontStyle: 'italic' }}>"{a.resolutionNote}"</div>}
                  </div>
                  {may.update && a.status === 'open' && (
                    <button onClick={() => { setResolveModal(a); setResolveNote('') }}
                      style={{ padding: '0.4rem 0.9rem', borderRadius: '8px', border: 'none', background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                      Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'settings' && (
        <div style={{ maxWidth: '480px' }}>
          <div style={{ background: 'var(--hc-subtle)', color: 'var(--hc-ink)', borderRadius: '10px', padding: '1.25rem', border: '1px solid var(--hc-line)' }}>
            <h4 style={{ margin: '0 0 1rem' }}>Alert Configuration</h4>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Monitoring Active</span>
                <input type="checkbox" checked={config.isActive} onChange={(e) => setConfig((c) => ({ ...c, isActive: e.target.checked }))} disabled={!may.update} style={{ width: '1.1rem', height: '1.1rem' }} />
              </label>
              <label style={labelStyle}>Grace Period (minutes)</label>
              <input type="number" value={config.graceMinutes} onChange={(e) => setConfig((c) => ({ ...c, graceMinutes: parseInt(e.target.value) }))} min={5} max={60} disabled={!may.update}
                style={{ ...field, width: '100px' }} />
              <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginTop: '0.25rem' }}>Alert triggers if no clock-in after this many minutes past shift start</div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Notify</div>
              {([
                { key: 'notifyAdmin', label: 'Admin / Office' },
                { key: 'notifyCaregiver', label: 'Caregiver (via SMS)' },
                { key: 'notifyClientFamily', label: "Client's Family" },
              ] as Array<{ key: NotifyKey; label: string }>).map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!config[key]} onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.checked }))} disabled={!may.update} />
                  <span style={{ fontSize: '0.88rem' }}>{label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Admin Phone (for SMS)</label>
              <input value={config.adminPhone || ''} onChange={(e) => setConfig((c) => ({ ...c, adminPhone: e.target.value }))} disabled={!may.update}
                placeholder="+15555551234"
                style={{ ...field, fontSize: '0.88rem' }} />
            </div>

            {may.update && <button onClick={saveConfig} disabled={savingConfig}
              style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: 'none', background: SOLID.blue, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem' }}>
              {savingConfig ? 'Saving...' : '✓ Save Settings'}
            </button>}
          </div>

          <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', background: 'var(--hc-info-bg)', borderRadius: '8px', border: '1px solid var(--hc-info-line)' }}>
            <div style={{ fontWeight: 700, color: 'var(--hc-info-ink)', fontSize: '0.88rem', marginBottom: '0.35rem' }}>💡 How it works</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink)', lineHeight: 1.6 }}>
              Click "Run Check Now" anytime to scan all shifts that should have started in the last 4 hours. Automated background checks run on a schedule — you don't need to set anything up.
            </div>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div style={{ ...backdrop, padding: '1rem' }} onClick={() => setResolveModal(null)}>
          <div style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', padding: '1.5rem', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 0.5rem' }}>Resolve Alert</h4>
            <p style={{ fontSize: '0.88rem', color: 'var(--hc-muted)', margin: '0 0 1rem' }}>
              {resolveModal.caregiverName} → {resolveModal.clientName}
            </p>
            <textarea value={resolveNote} onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Resolution note (optional)..." rows={3}
              style={{ ...field, padding: '0.6rem', borderRadius: '8px', fontSize: '0.88rem', resize: 'vertical', marginBottom: '1rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => resolve(resolveModal.id, 'resolved')} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', background: SOLID.green, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>✓ Resolved</button>
              <button onClick={() => resolve(resolveModal.id, 'false_alarm')} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--hc-line)', background: 'var(--hc-surface)', color: 'var(--hc-ink-soft)', cursor: 'pointer', fontWeight: 600 }}>False Alarm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
