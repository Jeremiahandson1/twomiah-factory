// Moved from templates/crm-homecare/frontend/src/components/admin/DashboardOverview.tsx — the office's overview, at
// /crm/dashboard for whoever holds care-schedule:update (crm/verticals/homecare.tsx HomecareDashboard).
//   · The summary (GET /api/dashboard/summary) was loaded by AdminDashboard and passed in; it is loaded here.
//   · Each tile, banner and quick action goes to its /crm/<path> page with useNavigate (the template switched
//     AdminDashboard's section with onNavigate(id)); "New Client" is /crm/client-onboarding (the template's
//     'onboarding' section). A link is shown only to someone who may open its page (crm/verticals/homecare.tsx
//     routePermissions), so a tile never leads to a refusal.
//   · Each panel is asked for only by a seat its route serves (server/crm/homecare/planning/dashboard.ts): the tiles,
//     "Today" and referral sources ask care-billing:read, caregiver hours care-hr:read (a manager holds neither the
//     template's admin-only page nor care-hr), the action items care-schedule:update, the no-show banner
//     care-schedule:update (scheduling/noShow.ts), incident responses care-compliance:read (office/incidents.ts). The
//     template asked for every one and showed zeros or an empty table for a refusal.
//   · Replies are camelCase: no-show stats openCount/todayCount (were open_count/today_count); referral rows
//     referralCount/totalRevenue; caregiver rows firstName/lastName/totalHours/avgSatisfaction; the two lists are
//     { data, pagination }.
//   · "Avg Satisfaction" says N/A for a caregiver with no rating: the server answers 0 for none (COALESCE), a string the
//     template read as present ("★ 0.00").
//   · "Today — <weekday, month day>" is the agency's day (lib/agencyClock), the day the server counts "today" on; the
//     template printed the browser's.
//   · Both themes: the banner, the action items, the Today tiles and the coverage box take token or light/dark pairs.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, usePermissions } from '../../../../shared';
import { allowsPermission } from '@twomiah/tenant-ui/src/shell/types';
import { routePermissions, nav } from '../../../verticals/homecare';
import { api, rows } from '../lib/http';
import { formatAgencyDate } from '../lib/agencyClock';
import IncidentResponsesDue from './IncidentResponsesDue';
import { money } from '@twomiah/tenant-ui/src/money'

interface Summary {
  totalClients: number;
  activeCaregivers: number;
  /** care-billing:read's; absent for the read-only office seat (planning/dashboard.ts). */
  pendingInvoices?: { count: number; amount: number; draftCount: number; draftAmount: number };
  thisMonthRevenue?: number;
  clockedInNow: number;
  todayShifts: number;
  remainingShifts: number;
  coverageGaps: number;
}

interface ActionItem {
  key: string;
  label: string;
  count: number;
  /** The template's section id: the page is /crm/<page>. */
  page: string;
  severity: 'high' | 'med';
}

interface NoShowStats { openCount: number; todayCount: number }

interface ReferralRow { name: string; type?: string | null; referralCount?: number | null; totalRevenue?: string | number | null }

interface CaregiverHoursRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  shifts?: number | null;
  totalHours?: string | number | null;
  avgSatisfaction?: string | number | null;
}

/** A money figure to two places (the server's numeric columns can arrive as strings). */
const formatCurrency = (value: unknown): string => (parseFloat(String(value ?? '')) || 0).toFixed(2);

// A "New …" action also asks the permission to make one: a seat that may read the page and add nothing was offered
// "New Caregiver" (found in the browser, 2026-10-19).
const QUICK_ACTIONS: Array<{ page: string; label: string; adds?: string }> = [
  { page: 'client-onboarding', label: '➕ New Client', adds: 'care-clients:create' },
  { page: 'caregivers', label: '➕ New Caregiver', adds: 'care-hr:create' },
  { page: 'billing', label: '📄 Billing' },
  { page: 'reports', label: '📊 Reports' },
  { page: 'emergency-coverage', label: '🚨 Emergency Coverage' },
  { page: 'background-checks', label: '🔍 Background Checks' },
];

export default function OfficeHome() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { hasFeature } = useAuth();
  const seesMoney = can('care-billing:read');
  // The counts — active clients and caregivers, today's shifts — are the read-only office seat's too (care-office:read):
  // GET /api/dashboard/summary answers it without the money (live role check, 2026-10-23: its dashboard was blank).
  const seesCounts = seesMoney || can('care-office:read');
  const seesHr = can('care-hr:read');
  const seesSchedule = can('care-schedule:update');
  const seesIncidents = can('care-compliance:read');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [caregiverHours, setCaregiverHours] = useState<CaregiverHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noShowStats, setNoShowStats] = useState<NoShowStats | null>(null);
  const [actionItems, setActionItems] = useState<{ items: ActionItem[]; totalCount: number }>({ items: [], totalCount: 0 });

  /**
   * May this person open /crm/<page>? A page with no permission on file is open; a page the menu shows only with a
   * switch on (Reports & Analytics: reports, Documents: documents) is offered only while it is on — the same rule as
   * the menu, so no tile or quick action leads to a switched-off page.
   */
  const mayOpen = useCallback((page: string) => {
    const permission = routePermissions[`/crm/${page}`];
    const features = nav.find((i) => i.to === `/crm/${page}`)?.features;
    return allowsPermission(can, permission) && (!features?.length || features.some((f) => hasFeature(f)));
  }, [can, hasFeature]);
  const go = (page: string) => { if (mayOpen(page)) navigate(`/crm/${page}`); };

  useEffect(() => {
    let live = true;
    // Each panel renders without the others: a refusal or a cold server leaves that panel empty, as in the template.
    const summaryCall = seesCounts ? api.get('/api/dashboard/summary').catch(() => null) : Promise.resolve(null);
    const referralCall = seesMoney ? api.get('/api/dashboard/referrals').catch(() => null) : Promise.resolve(null);
    const hoursCall = seesHr ? api.get('/api/dashboard/caregiver-hours').catch(() => null) : Promise.resolve(null);
    Promise.all([summaryCall, referralCall, hoursCall]).then(([s, ref, hours]) => {
      if (!live) return;
      setSummary((s as Summary | null) || null);
      setReferrals(rows<ReferralRow>(ref));
      setCaregiverHours(rows<CaregiverHoursRow>(hours));
      setLoading(false);
    });
    if (seesSchedule) {
      api.get('/api/dashboard/action-items')
        .then((r: { items?: ActionItem[]; totalCount?: number } | null) => {
          if (live && r && Array.isArray(r.items)) setActionItems({ items: r.items, totalCount: r.totalCount || 0 });
        })
        .catch(() => { /* the dashboard still renders without it */ });
      api.get('/api/no-show/stats')
        .then((r: NoShowStats | null) => { if (live) setNoShowStats(r || null); })
        .catch(() => { /* ignore */ });
    }
    return () => { live = false; };
  }, [seesMoney, seesCounts, seesHr, seesSchedule]);

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-[10px] bg-gray-100 dark:bg-slate-800" />
      ))}
    </div>
  );

  const openNoShows = Number(noShowStats?.openCount) || 0;
  const gaps = summary?.coverageGaps || 0;
  const quickActions = QUICK_ACTIONS.filter((q) => mayOpen(q.page) && (!q.adds || can(q.adds)));

  return (
    <>
      {seesIncidents && <IncidentResponsesDue />}
      {/* No-Show Alert Banner */}
      {openNoShows > 0 && (
        <button
          type="button"
          onClick={() => go('no-show-alerts')}
          className="mb-4 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-red-200 bg-red-100 px-5 py-3 text-left text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          <span style={{ fontSize: '1.5rem' }}>&#x1F6A8;</span>
          <div>
            <strong>{openNoShows} active no-show alert{openNoShows !== 1 ? 's' : ''}</strong>
            <span style={{ marginLeft: 8, fontSize: '0.85rem' }}>
              ({noShowStats?.todayCount || 0} today) — Click to review
            </span>
          </div>
        </button>
      )}

      {/* Key Metrics */}
      {summary && (
        <div className="grid">
          <div className="hc-stat-card">
            <h3>Active Clients</h3>
            <div className="value">{summary.totalClients || 0}</div>
          </div>
          <div className="hc-stat-card">
            <h3>Active Caregivers</h3>
            <div className="value">{summary.activeCaregivers || 0}</div>
          </div>
          {summary.pendingInvoices && <div className="hc-stat-card">
            <h3>Pending Invoices</h3>
            <div className="value value-danger">
              {money(summary.pendingInvoices?.amount)}
            </div>
            <p className="hc-stat-subtext">
              {summary.pendingInvoices?.count || 0} invoice{summary.pendingInvoices?.count === 1 ? '' : 's'} owed
              {(summary.pendingInvoices?.draftCount ?? 0) > 0 && ` · ${summary.pendingInvoices!.draftCount} draft${summary.pendingInvoices!.draftCount === 1 ? '' : 's'} not sent yet`}
            </p>
          </div>}
          {summary.thisMonthRevenue !== undefined && <div className="hc-stat-card" title="Sum of payments received this calendar month. Outstanding A/R and future-dated invoices are not counted.">
            <h3>This Month Revenue <span style={{ fontSize: '0.7rem', color: 'var(--hc-muted)', fontWeight: 400 }}>(collected)</span></h3>
            <div className="value value-success">
              {money(summary.thisMonthRevenue)}
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', margin: '0.25rem 0 0', fontWeight: 400 }}>
              Payments received this month — A/R not counted
            </p>
          </div>}
        </div>
      )}

      {/* Action Items — the day's to-do list */}
      {actionItems.items.length > 0 && (
        <div className="hc-card" style={{ borderLeft: '4px solid #DC2626' }}>
          <div className="hc-card-title">
            🎯 Action Items
            <span style={{ marginLeft: 8, background: '#B91C1C', color: '#fff', borderRadius: 10, padding: '2px 10px', fontSize: '0.75rem', fontWeight: 700 }}>
              {actionItems.totalCount} total
            </span>
          </div>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {actionItems.items.map((item) => {
              const high = item.severity === 'high';
              const open = mayOpen(item.page);
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => go(item.page)}
                  disabled={!open}
                  className={`flex items-center justify-between rounded-lg border-0 px-4 py-3 text-left text-[0.9rem] ${high ? 'bg-red-50 dark:bg-red-950/40' : 'bg-amber-50 dark:bg-amber-950/40'} ${open ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{ borderLeft: `3px solid ${high ? '#DC2626' : '#D97706'}` }}
                >
                  <span className="text-gray-700 dark:text-slate-200">{item.label}</span>
                  <span style={{
                    background: high ? '#B91C1C' : '#B45309',
                    color: '#fff', borderRadius: 12, padding: '2px 10px',
                    fontWeight: 700, fontSize: '0.85rem', minWidth: 28, textAlign: 'center',
                  }}>{item.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Referral Sources Performance */}
      {seesMoney && (
        <div className="hc-card">
          <div className="hc-card-title">🤝 Referral Sources Performance</div>

          {referrals.length === 0 ? (
            <p className="hc-card-empty-state">No referral data yet</p>
          ) : (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Referral Source</th>
                  <th>Type</th>
                  <th>Referrals</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => (
                  <tr key={ref.name}>
                    <td><strong>{ref.name}</strong></td>
                    <td>
                      <span className="hc-badge hc-badge-info">
                        {ref.type || 'General'}
                      </span>
                    </td>
                    <td>{ref.referralCount || 0}</td>
                    <td>{money(ref.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Caregiver Hours & Performance */}
      {seesHr && (
        <div className="hc-card">
          <div className="hc-card-title">👔 Caregiver Hours & Performance</div>

          {caregiverHours.length === 0 ? (
            <p className="hc-card-empty-state">No caregiver data yet</p>
          ) : (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Shifts</th>
                  <th>Total Hours</th>
                  <th>Avg Satisfaction</th>
                </tr>
              </thead>
              <tbody>
                {caregiverHours.map((cg) => {
                  const rating = parseFloat(String(cg.avgSatisfaction ?? '')) || 0;
                  return (
                    <tr key={cg.id}>
                      <td><strong>{cg.firstName} {cg.lastName}</strong></td>
                      <td>{cg.shifts || 0}</td>
                      <td>{cg.totalHours || 0} hrs</td>
                      <td>
                        {rating > 0 ? (
                          <>
                            <span className="star-icon">★</span> {rating.toFixed(2)}
                          </>
                        ) : (
                          'N/A'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Today Panel */}
      {summary && (
        <div className="hc-card" style={{ marginBottom: '1rem' }}>
          <div className="hc-card-title">📅 Today — {formatAgencyDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            {[
              { label: 'Shifts Today', value: summary.todayShifts || 0, icon: '📋', color: 'var(--hc-blue-ink)' },
              { label: 'Clocked In Now', value: summary.clockedInNow || 0, icon: '✅', color: 'var(--hc-green-ink)' },
              { label: 'Shifts Remaining', value: summary.remainingShifts || 0, icon: '⏰', color: 'var(--hc-warning-ink)' },
              { label: 'Coverage Gaps', value: gaps, icon: '🚨', color: gaps > 0 ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)' },
            ].map((s) => (
              <div key={s.label} style={{ padding: '0.75rem', background: 'var(--hc-subtle)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--hc-line)' }}>
                <div style={{ fontSize: '1.3rem' }}>{s.icon}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', fontWeight: 600, marginTop: '0.2rem' }}>{s.label}</div>
              </div>
            ))}
          </div>
          {gaps > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 dark:border-red-800 dark:bg-red-950/40">
              <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                ⚠️ {gaps} shift{gaps !== 1 ? 's' : ''} need{gaps === 1 ? 's' : ''} coverage
              </span>
              {mayOpen('emergency-coverage') && (
                <button
                  type="button"
                  onClick={() => go('emergency-coverage')}
                  style={{ padding: '0.3rem 0.75rem', background: '#DC2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  Find Coverage →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      {quickActions.length > 0 && (
        <div className="hc-card">
          <div className="hc-card-title">⚡ Quick Actions</div>
          <div className="quick-actions-grid">
            {quickActions.map((q) => (
              <button key={q.page} type="button" className="hc-btn hc-btn-primary" onClick={() => go(q.page)}>{q.label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
