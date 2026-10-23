// Moved from templates/crm-homecare/frontend/src/components/admin/CaregiverHistory.tsx — AdminDashboard's
// caregiver-history section, now its own address: /crm/caregivers/:id/history. Shift timeline + GPS route viewer.
//
// Replies read (server/crm/homecare):
//   GET /api/users/caregivers/:id                 hr/caregivers.ts — the caregiver's name for the heading (the template
//                                                 was handed it by the list; an address carries only the id)
//   GET /api/time-entries/caregiver-history/:id   visits/timeTracking.ts — { data }: id, clientId, startTime, endTime,
//                                                 durationMinutes, isComplete, notes, client { firstName, lastName },
//                                                 clientAddress, clientCity, gpsPointCount; ?startDate&endDate are the
//                                                 agency's calendar days, the end day included.
//   GET /api/time-entries/:id/gps                 { data }: the visit's points (latitude, longitude, timestamp), oldest first
//
// The map is Leaflet from the app's own bundle (as packages/tenant-ui's FleetPage loads it): the template loaded it
// from cdnjs, which the app's content security policy (server/http/guards.ts) does not allow.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { api, rows } from '../lib/http'
import { toLocalYMD } from '../lib/date'
import { formatAgencyDateTime, agencyToday } from '../lib/agencyClock'
import { fullName } from './shared'

const formatDuration = (minutes: number) => {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const formatDateTime = (dt: unknown) => (dt ? formatAgencyDateTime(dt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const formatTime = (dt: unknown) => (dt ? formatAgencyDateTime(dt, { hour: '2-digit', minute: '2-digit' }) : '—')

interface GpsPoint { latitude: string; longitude: string; timestamp: string }

interface Entry {
  id: string
  clientId: string | null
  startTime: string
  endTime: string | null
  durationMinutes: number | null
  isComplete: boolean
  notes: string | null
  client?: { firstName: string | null; lastName: string | null } | null
  gpsPointCount?: number | string | null
  clientAddress?: string | null
  clientCity?: string | null
}

// The route line in the brand's colour (the template's {{PRIMARY_COLOR}}), read from the page's own brand variable.
const brandLine = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()
  return v ? `rgb(${v})` : '#0d9488'
}

function GPSRouteMap({ timeEntryId, onClose }: { timeEntryId: string; onClose: () => void }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [points, setPoints] = useState<GpsPoint[]>([])
  const [loading, setLoading] = useState(true)
  const mapInstanceRef = useRef<L.Map | null>(null)

  useEffect(() => {
    api.get(`/api/time-entries/${timeEntryId}/gps`)
      .then((data) => { setPoints(rows<GpsPoint>(data)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [timeEntryId])

  useEffect(() => {
    if (loading || !mapRef.current || mapInstanceRef.current) return
    if (points.length === 0) return

    const map = L.map(mapRef.current)
    mapInstanceRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)

    const latlngs: L.LatLngTuple[] = points.map((p) => [parseFloat(p.latitude), parseFloat(p.longitude)])

    // Draw route
    const polyline = L.polyline(latlngs, { color: brandLine(), weight: 4, opacity: 0.8 }).addTo(map)

    // Start marker (green)
    if (latlngs.length > 0) {
      L.circleMarker(latlngs[0], { radius: 10, fillColor: '#16A34A', color: '#fff', weight: 2, fillOpacity: 1 })
        .bindPopup(`<b>Clock In</b><br>${formatAgencyDateTime(points[0].timestamp, { hour: 'numeric', minute: '2-digit' })}`)
        .addTo(map)
    }

    // End marker (red)
    if (latlngs.length > 1) {
      const last = latlngs[latlngs.length - 1]
      L.circleMarker(last, { radius: 10, fillColor: '#DC2626', color: '#fff', weight: 2, fillOpacity: 1 })
        .bindPopup(`<b>Clock Out</b><br>${formatAgencyDateTime(points[points.length - 1].timestamp, { hour: 'numeric', minute: '2-digit' })}`)
        .addTo(map)
    }

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] })
  }, [loading, points])

  useEffect(() => () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--hc-line)' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📍 GPS Route — {points.length} location points</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--hc-muted)' }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: '400px' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: 'var(--hc-muted)' }}>
              Loading GPS data...
            </div>
          )}
          {!loading && points.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', color: 'var(--hc-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📍</div>
              <p>No GPS data recorded for this shift.</p>
              <p style={{ fontSize: '0.85rem' }}>GPS tracking requires the caregiver to grant location permission on their device.</p>
            </div>
          )}
          {!loading && points.length > 0 && (
            <div ref={mapRef} style={{ width: '100%', height: '450px' }} />
          )}
        </div>
        {!loading && points.length > 0 && (
          <div style={{ padding: '0.75rem 1.25rem', background: 'var(--hc-subtle)', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--hc-muted)' }}>
            <span>🟢 Start: {formatTime(points[0]?.timestamp)}</span>
            <span>🔴 End: {formatTime(points[points.length - 1]?.timestamp)}</span>
            <span>📍 {points.length} points recorded</span>
          </div>
        )}
      </div>
    </div>
  )
}

// The status pairs: ink and ground (and the border/dot colour) from the frame's tokens, light and dark.
const STATUS = {
  active: { bg: 'var(--hc-warning-bg)', border: 'var(--hc-warning-line)', dot: 'var(--hc-warning-ink)', text: 'var(--hc-warning-ink)', label: 'Active' },
  long: { bg: 'var(--hc-danger-bg)', border: 'var(--hc-danger-line)', dot: 'var(--hc-red-ink)', text: 'var(--hc-danger-ink)', label: 'Long Shift' },
  done: { bg: 'var(--hc-success-bg)', border: 'var(--hc-success-line)', dot: 'var(--hc-green-ink)', text: 'var(--hc-success-ink)', label: 'Complete' },
}

const fieldLabel = { fontSize: '0.72rem', color: 'var(--hc-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' } as const
const fieldValue = { fontSize: '0.9rem', fontWeight: 600, color: 'var(--hc-ink)' } as const

export default function CaregiverHistory() {
  const { id: caregiverId = '' } = useParams()
  const navigate = useNavigate()
  const onBack = () => navigate('/crm/caregivers')
  const [caregiverName, setCaregiverName] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState({
    start: toLocalYMD(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    end: agencyToday(),
  })
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [stats, setStats] = useState({ totalShifts: 0, totalHours: '0.00', avgDuration: 0, clients: new Set<string>() })

  useEffect(() => {
    api.get(`/api/users/caregivers/${caregiverId}`).then((c) => setCaregiverName(fullName(c))).catch(() => setCaregiverName(''))
  }, [caregiverId])

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId, dateRange])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const data = await api.get(`/api/time-entries/caregiver-history/${caregiverId}`, {
        startDate: dateRange.start, endDate: dateRange.end, limit: 100,
      })
      const list = rows<Entry>(data)
      setEntries(list)

      // Calculate stats
      const totalMins = list.reduce((sum, e) => sum + (parseInt(String(e.durationMinutes)) || 0), 0)
      const clients = new Set(list.map((e) => e.clientId).filter((x): x is string => !!x))
      setStats({
        totalShifts: list.length,
        totalHours: (totalMins / 60).toFixed(2),
        avgDuration: list.length ? Math.round(totalMins / list.length) : 0,
        clients,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const statusOf = (entry: Entry) => {
    if (!entry.endTime) return STATUS.active
    if ((entry.durationMinutes || 0) > 480) return STATUS.long
    return STATUS.done
  }

  const dateInput = { padding: '0.4rem 0.75rem', border: '1px solid var(--hc-line)', borderRadius: '6px', fontSize: '0.9rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as const

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px',
          border: '1px solid var(--hc-line)', background: 'var(--hc-surface)', color: 'var(--hc-ink)', cursor: 'pointer', fontWeight: 500, fontSize: '0.9rem',
        }}>← Back</button>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--hc-ink)' }}>
            🕐 Shift History — {caregiverName}
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--hc-muted)', fontSize: '0.85rem' }}>
            Clock-in/out records with GPS routes
          </p>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="hc-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--hc-muted)', fontWeight: 500 }}>From</label>
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))} style={dateInput} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--hc-muted)', fontWeight: 500 }}>To</label>
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))} style={dateInput} />
          </div>
          <button onClick={loadHistory} style={{
            padding: '0.4rem 1rem', background: 'var(--hc-brand-deep)', color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
          }}>Apply</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Total Shifts', value: stats.totalShifts, icon: '📋' },
          { label: 'Total Hours', value: `${stats.totalHours}h`, icon: '⏱️' },
          { label: 'Avg Duration', value: formatDuration(stats.avgDuration), icon: '📊' },
          { label: 'Unique Clients', value: stats.clients.size, icon: '👤' },
        ].map((st) => (
          <div key={st.label} className="hc-card" style={{ padding: '0.875rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{st.icon}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--hc-ink)' }}>{st.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)' }}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading shift history...</div>
      ) : entries.length === 0 ? (
        <div className="hc-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
          <p>No shifts found for the selected date range.</p>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Timeline line */}
          <div style={{ position: 'absolute', left: '20px', top: '20px', bottom: '20px', width: '2px', background: 'var(--hc-line)', zIndex: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingLeft: '50px' }}>
            {entries.map((entry) => {
              const sc = statusOf(entry)
              const hasGPS = parseInt(String(entry.gpsPointCount ?? 0)) > 0
              return (
                <div key={entry.id} style={{ position: 'relative' }}>
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: '-38px', top: '18px', width: '14px', height: '14px', borderRadius: '50%',
                    background: sc.dot, border: '2px solid var(--hc-surface)', boxShadow: '0 0 0 2px ' + sc.dot, zIndex: 1,
                  }} />
                  <div className="hc-card" style={{ padding: '1rem', borderLeft: `3px solid ${sc.dot}`, transition: 'box-shadow 0.15s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--hc-ink)', marginBottom: '0.25rem' }}>
                          {entry.client?.firstName ? `${entry.client.firstName} ${entry.client.lastName}` : 'Unknown Client'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>
                          {entry.clientAddress && `📍 ${entry.clientAddress}, ${entry.clientCity}`}
                        </div>
                      </div>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600, background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>{sc.label}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                      <div>
                        <div style={fieldLabel}>Clock In</div>
                        <div style={fieldValue}>{formatDateTime(entry.startTime)}</div>
                      </div>
                      <div>
                        <div style={fieldLabel}>Clock Out</div>
                        <div style={fieldValue}>
                          {entry.endTime ? formatDateTime(entry.endTime) : <span style={{ color: 'var(--hc-warning-ink)' }}>Still Active</span>}
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabel}>Duration</div>
                        <div style={fieldValue}>
                          {entry.durationMinutes ? `${formatDuration(entry.durationMinutes)} (${(entry.durationMinutes / 60).toFixed(2)}h)` : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabel}>GPS</div>
                        <div style={{ fontSize: '0.9rem' }}>
                          {hasGPS ? (
                            <button
                              onClick={() => setSelectedEntryId(entry.id)}
                              style={{ background: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)', border: '1px solid var(--hc-info-line)', borderRadius: '6px', padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                            >
                              📍 View Route ({String(entry.gpsPointCount)} pts)
                            </button>
                          ) : (
                            <span style={{ color: 'var(--hc-muted)', fontSize: '0.85rem' }}>No GPS data</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {entry.notes && (
                      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--hc-subtle)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--hc-muted)', borderLeft: '3px solid var(--hc-line)' }}>
                        📝 {entry.notes}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* GPS Route Modal */}
      {selectedEntryId && <GPSRouteMap timeEntryId={selectedEntryId} onClose={() => setSelectedEntryId(null)} />}
    </div>
  )
}
