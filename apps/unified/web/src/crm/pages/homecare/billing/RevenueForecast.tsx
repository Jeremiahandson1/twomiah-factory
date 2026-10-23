// Revenue forecast — projected vs actual revenue, authorization utilization, the weekly outlook.
// Moved from templates/crm-homecare/frontend/src/components/admin/RevenueForecast.tsx.
//
// Server: GET /api/forecast/revenue (one record: { actual, projected, weekly, topClients, authSummary }, camelCase rows)
// and GET /api/forecast/caregiver-utilization (a list) — server/crm/homecare/scheduling/forecast.ts, its rows from
// server/data/homecareScheduling.ts (forecastActual, forecastAuthorizations, forecastWeekly, forecastTopClients,
// caregiverUtilization). Sums arrive as Postgres numerics (strings); counts are ints.
import { useEffect, useState, type CSSProperties } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { parseLocalDate } from '../lib/date'
import { money } from '@twomiah/tenant-ui/src/money'

type Num = string | number | null | undefined

interface ActualRow { period: string; billed: Num; collected: Num; claimCount: number; invoiceCount: number }
interface AuthRow {
  clientId: string; clientName: string; serviceType: string | null
  authorizedHours: Num; usedHours: Num; remainingHours: Num; hourlyRate: Num; projectedRemainingRevenue: Num; endDate: string | null
}
interface WeekRow { weekStart: string; caregiverCount: number; shiftCount: number; scheduledHours: Num; estimatedRevenue: Num }
interface TopClient { clientId: string; clientName: string; totalBilled: Num; totalCollected: Num; claimCount: number; invoiceCount: number }
interface AuthSummary {
  totalActiveAuths: number; totalAuthHours: number; totalUsedHours: number; avgUtilizationPct: number
  totalProjectedRemaining: number; unvaluedClients: number
}
interface ForecastReply { actual: ActualRow[]; projected: AuthRow[]; weekly: WeekRow[]; topClients: TopClient[]; authSummary: AuthSummary }
interface UtilRow { id: string; caregiverName: string; clientCount: number; weeklyHours: Num; weeklyRevenue: Num }

const num = (n: Num): number => parseFloat(String(n ?? 0)) || 0
const fmt$ = (n: Num) => money(num(n), 0)
const fmtH = (n: Num) => num(n).toFixed(1) + 'h'

// The template's palette as theme pairs (homecare.css tokens): blue figures, green collected, amber, red.
const BLUE = 'var(--hc-blue-ink)'
const GREEN = 'var(--hc-green-ink)'
const AMBER = 'var(--hc-warning-ink)'
const RED = 'var(--hc-red-ink)'
// Bar fills are marks, not text: one mid shade reads on the light and the dark track alike.
const BAR_BLUE = '#3B82F6'
const BAR_PALE = '#93C5FD'
const barColour = (pct: number, hi: number, mid: number) => (pct >= hi ? '#EF4444' : pct >= mid ? '#F59E0B' : '#10B981')

const emptyBox: CSSProperties = {
  textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)', background: 'var(--hc-subtle)', borderRadius: '10px',
  border: '2px dashed var(--hc-line)',
}
const th: CSSProperties = { textAlign: 'left', padding: '0.65rem 0.85rem', fontWeight: 700, color: 'var(--hc-ink-soft)', fontSize: '0.8rem', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '0.65rem 0.85rem' }
const card: CSSProperties = { background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderRadius: '10px', padding: '1rem' }
const rowBg = (i: number) => (i % 2 === 0 ? 'var(--hc-surface)' : 'var(--hc-subtle)')

export default function RevenueForecast() {
  const toast = useToast()
  const [data, setData] = useState<ForecastReply | null>(null)
  const [utilData, setUtilData] = useState<UtilRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [months, setMonths] = useState(3)

  const load = async () => {
    setLoading(true)
    try {
      const [f, u] = await Promise.all([
        api.get('/api/forecast/revenue', { months }) as Promise<ForecastReply>,
        api.get('/api/forecast/caregiver-utilization'),
      ])
      setData(f)
      setUtilData(rows<UtilRow>(u))
    } catch (e) {
      toast.error(errorMessage(e, 'Could not load the forecast'))
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [months])

  const tabStyle = (t: string): CSSProperties => ({
    padding: '0.5rem 1rem', border: 'none', borderBottom: `3px solid ${tab === t ? BAR_BLUE : 'transparent'}`, background: 'none',
    cursor: 'pointer', fontWeight: tab === t ? 700 : 400, color: tab === t ? BLUE : 'var(--hc-muted)', fontSize: '0.92rem',
  })

  const barWidth = (val: Num, max: Num) => `${Math.min((num(val) / Math.max(num(max) || 1, 1)) * 100, 100)}%`

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--hc-muted)' }}>Loading forecast data...</div>

  const summary: Partial<AuthSummary> = data?.authSummary || {}
  const actual = data?.actual || []
  const projected = data?.projected || []
  const weekly = data?.weekly || []
  const topClients = data?.topClients || []

  const totalActualBilled = actual.reduce((s, r) => s + num(r.billed), 0)
  const totalActualCollected = actual.reduce((s, r) => s + num(r.collected), 0)
  const totalProjectedRemaining = num(summary.totalProjectedRemaining)
  const nextWeek: Partial<WeekRow> = weekly[0] || {}

  const kpis = [
    { label: `Billed (${months}mo)`, val: fmt$(totalActualBilled), sub: `${fmt$(totalActualCollected)} collected`, color: BLUE, bg: 'var(--hc-info-bg)', line: 'var(--hc-info-line)' },
    { label: 'Unused Auth $/week', val: fmt$(totalProjectedRemaining), sub: `Across ${summary.totalActiveAuths || 0} authorized clients`, color: GREEN, bg: 'var(--hc-success-bg)', line: 'var(--hc-success-line)' },
    { label: 'Auth Hours Scheduled', val: `${summary.avgUtilizationPct || 0}%`, sub: `${fmtH(summary.totalUsedHours)} / ${fmtH(summary.totalAuthHours)} per week`, color: AMBER, bg: 'var(--hc-warning-bg)', line: 'var(--hc-warning-line)' },
    { label: 'Est. This Week', val: fmt$(nextWeek.estimatedRevenue || 0), sub: `${fmtH(nextWeek.scheduledHours)} scheduled`, color: 'var(--hc-ink)', bg: 'var(--hc-subtle)', line: 'var(--hc-line)' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>📈 Revenue Forecast</h2>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--hc-muted)' }}>History:</span>
          {[1, 3, 6].map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              style={{ padding: '0.3rem 0.7rem', borderRadius: '20px', border: `1px solid ${months === m ? '#1D4ED8' : 'var(--hc-line)'}`, background: months === m ? '#1D4ED8' : 'var(--hc-surface)', color: months === m ? '#fff' : 'var(--hc-ink)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: months === m ? 700 : 400 }}>
              {m}mo
            </button>
          ))}
          <button onClick={load} aria-label="Refresh" style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid var(--hc-line)', background: 'var(--hc-surface)', color: 'var(--hc-ink)', cursor: 'pointer', fontSize: '0.82rem' }}>↻</button>
        </div>
      </div>

      {/* KPI summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '10px', padding: '1rem 1.1rem', border: `1px solid ${k.line}` }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>{k.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.val}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginTop: '0.3rem' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--hc-line)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        <button style={tabStyle('overview')} onClick={() => setTab('overview')}>📊 Monthly History</button>
        <button style={tabStyle('weekly')} onClick={() => setTab('weekly')}>📅 4-Week Outlook</button>
        <button style={tabStyle('auths')} onClick={() => setTab('auths')}>📋 Authorizations</button>
        <button style={tabStyle('clients')} onClick={() => setTab('clients')}>👤 Top Clients</button>
        <button style={tabStyle('staff')} onClick={() => setTab('staff')}>🧑‍⚕️ Staff Utilization</button>
      </div>

      {tab === 'overview' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)' }}>Billed vs Collected — Last {months} Month{months > 1 ? 's' : ''}</h4>
          {actual.length === 0 ? (
            <div style={emptyBox}>
              No billing data for this period. Billing data will appear here once an invoice is sent or released (drafts do not count) or a claim is made.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {actual.map((row, i) => {
                const billed = num(row.billed)
                const collected = num(row.collected)
                const maxBilled = Math.max(...actual.map((r) => num(r.billed)), 1)
                const collRate = billed > 0 ? Math.round((collected / billed) * 100) : 0
                const period = new Date(`${String(row.period).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                return (
                  <div key={i} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{period}</span>
                      <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                        <span style={{ color: BLUE, fontWeight: 700 }}>Billed: {fmt$(billed)}</span>
                        <span style={{ color: GREEN, fontWeight: 700 }}>Collected: {fmt$(collected)}</span>
                        <span style={{ color: collRate >= 90 ? GREEN : collRate >= 70 ? AMBER : RED, fontWeight: 700 }}>{collRate}% rate</span>
                        <span style={{ color: 'var(--hc-muted)' }}>{row.claimCount} claim{row.claimCount === 1 ? '' : 's'} · {row.invoiceCount || 0} invoice{Number(row.invoiceCount) === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <div style={{ height: '8px', background: 'var(--hc-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: barWidth(billed, maxBilled), background: BAR_PALE, borderRadius: '4px', position: 'relative', transition: 'width 0.3s' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: barWidth(collected, billed), background: BAR_BLUE, borderRadius: '4px' }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'weekly' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)' }}>Next 4 Weeks — Projected Revenue from Scheduled Shifts</h4>
          {weekly.length === 0 ? (
            <div style={emptyBox}>No scheduled shifts found for the next 4 weeks.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {weekly.map((w, i) => {
                const weekStart = parseLocalDate(w.weekStart)
                const weekEnd = parseLocalDate(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
                const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <div key={i} style={{ background: i === 0 ? 'var(--hc-info-bg)' : 'var(--hc-surface)', border: `1px solid ${i === 0 ? 'var(--hc-info-line)' : 'var(--hc-line)'}`, borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
                    {i === 0 && <div style={{ fontSize: '0.72rem', color: BLUE, fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.35rem' }}>This Week</div>}
                    <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginBottom: '0.5rem' }}>{label}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: BLUE }}>{fmt$(w.estimatedRevenue)}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginTop: '0.3rem' }}>{fmtH(w.scheduledHours)} · {w.shiftCount} shifts · {w.caregiverCount} caregivers</div>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--hc-warning-bg)', border: '1px solid var(--hc-warning-line)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--hc-warning-ink)' }}>
            💡 Valued at each client&apos;s real rate — private-pay rate or the payer&apos;s contracted rate for their
            care type ($18.50 fallback only when no rate is on file). Actual revenue depends on billing outcomes.
          </div>
        </div>
      )}

      {tab === 'auths' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)' }}>Weekly Authorization vs Schedule (per client)</h4>
          <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--hc-ink-soft)' }}>
            Authorized hours are weekly. A client on the schedule is treated as live — the paper auth dates are
            stale and ignored. &quot;Unused $/wk&quot; = authorized hours you are not scheduling, valued at the
            client&apos;s rate: recurring money left on the table.
          </div>
          {projected.length === 0 ? (
            <div style={emptyBox}>No authorizations on file.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--hc-subtle)', borderBottom: '2px solid var(--hc-line)' }}>
                    {['Client', 'Service', 'Auth Hrs/wk', 'Scheduled/wk', 'Unused/wk', 'Rate', 'Unused $/wk', 'Auth End (stale)'].map((c) => (
                      <th key={c} style={th}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projected.map((r, i) => {
                    const authorized = num(r.authorizedHours)
                    const pct = authorized > 0 ? Math.round((num(r.usedHours) / authorized) * 100) : 0
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--hc-line)', background: rowBg(i) }}>
                        <td style={{ ...td, fontWeight: 600 }}>{r.clientName}</td>
                        <td style={{ ...td, color: 'var(--hc-muted)' }}>{r.serviceType?.replace(/_/g, ' ')}</td>
                        <td style={td}>{fmtH(r.authorizedHours)}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {fmtH(r.usedHours)}
                            <div style={{ width: '50px', height: '6px', background: 'var(--hc-line)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? '#EF4444' : pct > 70 ? '#F59E0B' : '#10B981' }} />
                            </div>
                            <span style={{ fontSize: '0.72rem', color: 'var(--hc-muted)' }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={{ ...td, fontWeight: 700, color: GREEN }}>{fmtH(r.remainingHours)}</td>
                        <td style={{ ...td, color: 'var(--hc-muted)' }}>{r.hourlyRate ? fmt$(r.hourlyRate) + '/hr' : '—'}</td>
                        <td style={{ ...td, fontWeight: 700, color: BLUE }}>{fmt$(r.projectedRemainingRevenue)}</td>
                        <td style={{ ...td, color: 'var(--hc-muted)', fontSize: '0.82rem' }}>
                          {r.endDate ? new Date(`${String(r.endDate).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--hc-line)', background: 'var(--hc-subtle)' }}>
                    <td colSpan={6} style={{ ...td, fontWeight: 700, textAlign: 'right' }}>Total unused per week:</td>
                    <td style={{ ...td, fontWeight: 800, color: BLUE, fontSize: '1rem' }}>{fmt$(totalProjectedRemaining)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'clients' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)' }}>Top Clients by Revenue — Last 90 Days</h4>
          {topClients.length === 0 ? (
            <div style={emptyBox}>No billing data in the last 90 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {topClients.map((c, i) => {
                const maxBilled = num(topClients[0]?.totalBilled) || 1
                return (
                  <div key={i} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700 }}>{i + 1}. {c.clientName}</span>
                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: BLUE }}>{fmt$(c.totalBilled)}</span>
                        <span style={{ color: GREEN }}>Collected: {fmt$(c.totalCollected)}</span>
                        <span style={{ color: 'var(--hc-muted)' }}>{c.claimCount} claim{c.claimCount === 1 ? '' : 's'} · {c.invoiceCount || 0} invoice{Number(c.invoiceCount) === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <div style={{ height: '6px', background: 'var(--hc-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: barWidth(c.totalBilled, maxBilled), background: BAR_BLUE, borderRadius: '3px' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'staff' && (
        <div>
          <h4 style={{ margin: '0 0 1rem', color: 'var(--hc-ink)' }}>Caregiver Weekly Utilization</h4>
          {utilData.length === 0 ? (
            <div style={emptyBox}>No utilization data.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--hc-subtle)', borderBottom: '2px solid var(--hc-line)' }}>
                    {['Caregiver', 'Type', 'Clients', 'Weekly Hrs', 'Est. Weekly Rev', 'Utilization'].map((c) => (
                      <th key={c} style={th}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {utilData.map((u, i) => {
                    const hrs = num(u.weeklyHours)
                    const pct = Math.min(Math.round((hrs / 40) * 100), 100)
                    return (
                      <tr key={u.id || i} style={{ borderBottom: '1px solid var(--hc-line)', background: rowBg(i) }}>
                        <td style={{ ...td, fontWeight: 600 }}>{u.caregiverName}</td>
                        {/* The server never sent an employment type (template's nor unified's): the template printed 'staff'. */}
                        <td style={{ ...td, color: 'var(--hc-muted)', fontSize: '0.8rem' }}>staff</td>
                        <td style={td}>{u.clientCount || 0}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{fmtH(hrs)}</td>
                        <td style={{ ...td, color: BLUE, fontWeight: 700 }}>{fmt$(u.weeklyRevenue)}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '80px', height: '8px', background: 'var(--hc-line)', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: barColour(pct, 90, 70), borderRadius: '4px' }} />
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
