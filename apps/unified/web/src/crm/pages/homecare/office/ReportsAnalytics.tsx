// Moved from templates/crm-homecare/frontend/src/components/admin/ReportsAnalytics.tsx (ported from CVHC ReportsAnalytics.jsx).
// Every report reads the unified /api/reports for home care (server/crm/homecare/planning/reports.ts; its SQL is
// server/data/homecarePlanning.ts), whose rows are camelCase: first_name → firstName, total_hours → totalHours, the A/R
// aging's d1_30 / d31_60 / d61_90 / d90_plus → d130 / d3160 / d6190 / d90Plus. The filter pickers are lists ({ data }).
// Changes:
//   · a refused or failed report says why on the page (each report asks its own permission — money care-billing:read,
//     hours care-payroll:read, ratings care-hr:read, incidents care-compliance:read); the template logged it and kept
//     showing the previous tab's figures. An answer that arrives after a newer request is dropped.
//   · an export is named as the server names it (its Content-Disposition, the agency's name in it); the template named it
//     from a build-time placeholder. A refused export shows the server's sentence.
//   · the On-Time % and GPS Capture figures are coloured (green at target, amber below) as their classes intended; the
//     template's value-success / value-warning classes were defined only inside a stat card, so they never coloured.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, errorMessage, rows, saveBlob } from '../lib/http';
import { formatDate, toLocalYMD } from '../lib/date';
import { serviceLabel } from '../lib/serviceTypes';
import { useToast } from '../../../../shared';
import AgencyTimezone from './AgencyTimezone';

/** pg numerics arrive as strings, counts as numbers. */
type Num = number | string | null | undefined;

interface Person { id: string; firstName?: string | null; lastName?: string | null }

interface OverviewData {
  summary?: { totalHours?: Num; workedHours?: Num; payableHours?: Num; deliveredPct?: number | null; totalRevenue?: Num; totalShifts?: Num };
  topCaregivers?: Array<Person & { totalHours?: Num; estLaborCost?: Num; avgSatisfaction?: Num; clientsServed?: Num }>;
  topClients?: Array<Person & { serviceType?: string; totalHours?: Num; revenue?: Num; caregiverCount?: Num }>;
}
interface HoursData {
  hoursByWeek?: Array<{ weekStart?: string; hours?: Num }>;
  hoursByType?: Array<{ serviceType?: string; hours?: Num; percentage?: Num }>;
  caregiverBreakdown?: Array<Person & { totalHours?: Num; workedHours?: Num; payableHours?: Num; clientCount?: Num; avgShiftHours?: Num }>;
}
interface Punctuality extends Person {
  totalShifts: number; onTimeCount: number; earlyCount: number; lateCount: number; unscheduledCount: number; onTimePercentage: Num;
}
interface PerformanceData {
  caregiverPerformance?: Array<Person & { avgRating?: Num; ratingCount?: Num; totalHours?: Num; workedHours?: Num; payableHours?: Num; clientsServed?: Num; gpsCapturePct?: Num }>;
  punctuality?: Punctuality[];
  onTimeRule?: { graceMinutes?: number };
}
interface SatisfactionData {
  satisfaction?: {
    avgRating?: Num; totalRatings?: number; positivePercentage?: Num; neutralPercentage?: Num; negativePercentage?: Num;
    trend?: Array<{ weekStart?: string; avgRating?: Num; count?: Num }>;
    feedbackThemes?: Array<{ theme: string; count?: Num }>;
  };
}
interface RevenueData {
  revenue?: { total?: Num; collected?: Num; outstanding?: Num; invoiceCount?: Num; avgPerScheduledHour?: Num; scheduledHours?: Num };
  ar?: { currentNotDue?: Num; d130?: Num; d3160?: Num; d6190?: Num; d90Plus?: Num; totalOutstanding?: Num };
  byPayer?: Array<{ payer: string; billed?: Num; collected?: Num; outstanding?: Num }>;
  byServiceType?: Array<{ serviceType?: string; revenue?: Num }>;
  byClient?: Array<Person & { revenue?: Num; outstanding?: Num }>;
}
interface PnlData {
  revenue?: { totalBilled?: Num; totalCollected?: Num };
  revenueByPayer?: Array<{ payerName: string; invoiceCount?: Num; billed?: Num; collected?: Num }>;
  expenses?: { total?: Num; byCategory?: Array<{ category?: string | null; categoryTotal?: Num }> };
  payroll?: { gross?: Num; total?: Num };
  delivered?: { hours?: Num; unvaluedHours?: Num };
  unbilledEst?: Num; earnedRevenue?: Num; netIncome?: Num; netIncomeCash?: Num; margin?: Num;
}
/** The drill-down reports: { rows, period }. */
type DrillRow = Record<string, unknown>;
interface DrillData { rows?: DrillRow[] }
type ReportData = OverviewData & HoursData & PerformanceData & SatisfactionData & RevenueData & PnlData & DrillData;

const REPORT_TYPES = [
  { value: 'overview', label: 'Overview' },
  { value: 'hours', label: 'Hours Worked' },
  { value: 'performance', label: 'Performance' },
  { value: 'satisfaction', label: 'Satisfaction' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'pnl', label: 'Profit & Loss' },
  { value: 'hours-by-payer', label: 'Hours by Payer' },
  { value: 'caregiver-utilization', label: 'Caregiver Utilization' },
  { value: 'client-visits-summary', label: 'Client Visits Summary' },
  { value: 'client-revenue-by-month', label: 'Client Revenue by Month' },
  { value: 'client-incidents', label: 'Client Incidents' },
];

// The GET-style drill-down reports (?startDate&endDate, ?format=csv); the rest are POSTed with the filters.
const GET_REPORTS = new Set(['pnl', 'hours-by-payer', 'caregiver-utilization', 'client-visits-summary', 'client-revenue-by-month', 'client-incidents']);

const n = (v: unknown): number => parseFloat(String(v ?? '')) || 0;
const money = (v: Num) => `$${n(v).toFixed(2)}`;
const nameOf = (r: { firstName?: unknown; lastName?: unknown }) => [r.firstName, r.lastName].filter(Boolean).join(' ');

// Ink for a figure on the card's surface, light and dark (homecare.css tokens).
const GOOD = 'var(--hc-green-ink)';
const WARN = 'var(--hc-warning-ink)';
const BAD = 'var(--hc-red-ink)';
const MUTED = 'var(--hc-muted)';

/** The file name the server gave (Content-Disposition), else ours. */
function fileNameOf(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : fallback;
}

interface Column {
  key: string; label: string; bold?: boolean; right?: boolean;
  format?: 'num' | 'pct' | 'hr' | 'date';
  value?: (r: DrillRow) => unknown;
}

const ReportsAnalytics = () => {
  const toast = useToast();
  const [reportType, setReportType] = useState('overview');
  const [dateRange, setDateRange] = useState({
    startDate: toLocalYMD(new Date(new Date().setMonth(new Date().getMonth() - 1))),
    endDate: toLocalYMD(new Date()),
  });
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [caregiverFilter, setCaregiverFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [caregivers, setCaregivers] = useState<Person[]>([]);
  const [clients, setClients] = useState<Person[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    if (reportType) generateReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, dateRange, caregiverFilter, clientFilter]);

  const loadFilters = async () => {
    try {
      const [cg, cl] = await Promise.all([
        api.get('/api/users/caregivers'),
        api.get('/api/clients', { limit: 1000 }),
      ]);
      setCaregivers(rows<Person>(cg));
      setClients(rows<Person>(cl));
    } catch (err) {
      console.error('Failed to load filters:', err);
    }
  };

  const generateReport = async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const data: ReportData = GET_REPORTS.has(reportType)
        ? await api.get(`/api/reports/${reportType}`, { startDate: dateRange.startDate, endDate: dateRange.endDate })
        : await api.post(`/api/reports/${reportType}`, {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          caregiverId: caregiverFilter || null,
          clientId: clientFilter || null,
        });
      if (ticket !== latest.current) return;
      setReportData(data);
    } catch (err) {
      if (ticket !== latest.current) return;
      setReportData(null);
      setError(errorMessage(err, 'Failed to generate report'));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  };

  const exportReport = async (format: 'csv' | 'pdf') => {
    try {
      // GET-style drill-downs support ?format=csv directly; everything else goes through POST /export (or /export-pdf).
      let res: Response;
      if (GET_REPORTS.has(reportType) && format === 'csv') {
        const qs = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate, format: 'csv' });
        res = await api.raw(`/api/reports/${reportType}?${qs.toString()}`);
      } else {
        res = await api.raw(`/api/reports/${reportType}/${format === 'pdf' ? 'export-pdf' : 'export'}`, {
          method: 'POST',
          body: JSON.stringify({
            startDate: dateRange.startDate, endDate: dateRange.endDate,
            caregiverId: caregiverFilter || null, clientId: clientFilter || null, format,
          }),
        });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Export failed');
      }
      const blob = await res.blob();
      saveBlob(blob, fileNameOf(res, `${reportType}-report-${dateRange.startDate}-to-${dateRange.endDate}.${format}`));
      toast.success(`${format.toUpperCase()} export downloaded!`);
    } catch (err) {
      toast.error('Failed to export: ' + errorMessage(err, 'Export failed'));
    }
  };

  const renderOverviewReport = () => {
    if (!reportData) return null;
    const { summary = {}, topCaregivers, topClients } = reportData;

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          <div className="hc-stat-card">
            <h3>Scheduled Hours</h3>
            <div className="value">{n(summary.totalHours).toFixed(2)}</div>
            <p className="hc-stat-subtext">Across all caregivers</p>
          </div>
          <div className="hc-stat-card">
            <h3>Revenue Billed</h3>
            <div className="value value-success">{money(summary.totalRevenue)}</div>
            <p className="hc-stat-subtext">Invoices + claims for the period</p>
          </div>
          <div className="hc-stat-card">
            <h3>Scheduled Visits</h3>
            <div className="value">{n(summary.totalShifts)}</div>
            <p className="hc-stat-subtext">In period</p>
          </div>
          <div className="hc-stat-card">
            <h3>Delivered vs Scheduled</h3>
            <div className="value" style={{ color: (summary.deliveredPct ?? 100) >= 90 ? GOOD : WARN }}>
              {summary.deliveredPct != null ? `${summary.deliveredPct}%` : 'N/A'}
            </div>
            <p className="hc-stat-subtext">{n(summary.payableHours).toFixed(2)}h payable · {n(summary.workedHours).toFixed(2)}h clocked</p>
          </div>
        </div>

        <div className="hc-card">
          <h3>📊 Top Performing Caregivers</h3>
          {topCaregivers && topCaregivers.length > 0 ? (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Scheduled Hours</th>
                  <th>Est. Labor Cost</th>
                  <th>Avg Rating</th>
                  <th>Clients</th>
                </tr>
              </thead>
              <tbody>
                {topCaregivers.map(cg => (
                  <tr key={cg.id}>
                    <td><strong>{cg.firstName} {cg.lastName}</strong></td>
                    <td>{n(cg.totalHours).toFixed(2)} hrs</td>
                    <td>{money(cg.estLaborCost)}</td>
                    <td>{n(cg.avgSatisfaction) ? <span>⭐ {n(cg.avgSatisfaction).toFixed(2)}</span> : 'N/A'}</td>
                    <td>{n(cg.clientsServed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No caregiver data available</p>
          )}
        </div>

        <div className="hc-card">
          <h3>👥 Most Active Clients</h3>
          {topClients && topClients.length > 0 ? (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Service Type</th>
                  <th>Hours</th>
                  <th>Revenue (billed)</th>
                  <th>Assigned Caregivers</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map(cl => (
                  <tr key={cl.id}>
                    <td><strong>{cl.firstName} {cl.lastName}</strong></td>
                    <td><span className="hc-badge hc-badge-success">{serviceLabel(cl.serviceType)}</span></td>
                    <td>{n(cl.totalHours).toFixed(2)} hrs</td>
                    <td>{money(cl.revenue)}</td>
                    <td>{n(cl.caregiverCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No client data available</p>
          )}
        </div>
      </div>
    );
  };

  const renderHoursReport = () => {
    if (!reportData) return null;
    const { hoursByWeek, hoursByType, caregiverBreakdown } = reportData;

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="hc-card">
            <h3>Hours by Service Type</h3>
            {hoursByType && hoursByType.length > 0 ? (
              <table className="hc-table">
                <thead>
                  <tr>
                    <th>Service Type</th>
                    <th>Hours</th>
                    <th>Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByType.map((type, idx) => (
                    <tr key={idx}>
                      <td>{serviceLabel(type.serviceType)}</td>
                      <td>{n(type.hours).toFixed(2)}</td>
                      <td>
                        <div style={{ width: '100px', height: '6px', background: 'var(--hc-line)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${n(type.percentage)}%`, height: '100%', background: 'var(--hc-blue-ink)' }}></div>
                        </div>
                        <small>{n(type.percentage).toFixed(2)}%</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No data available</p>
            )}
          </div>

          <div className="hc-card">
            <h3>Hours by Week</h3>
            {hoursByWeek && hoursByWeek.length > 0 ? (
              <table className="hc-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByWeek.map((week, idx) => (
                    <tr key={idx}>
                      <td>{week.weekStart ? formatDate(week.weekStart) : ''}</td>
                      <td>{n(week.hours).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No data available</p>
            )}
          </div>
        </div>

        <div className="hc-card">
          <h3>Caregiver Hours Breakdown</h3>
          {caregiverBreakdown && caregiverBreakdown.length > 0 ? (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Scheduled</th>
                  <th title="Clock-in to clock-out of completed punches">Worked (clocked)</th>
                  <th title="What payroll pays: approved shift reviews, else the punch's billable minutes">Payable</th>
                  <th title="Payable minus scheduled">Payable vs Sched</th>
                  <th>Clients</th>
                  <th>Avg Shift (sched)</th>
                </tr>
              </thead>
              <tbody>
                {caregiverBreakdown.map(cg => {
                  const sched = n(cg.totalHours);
                  const worked = n(cg.workedHours);
                  const payable = n(cg.payableHours);
                  const variance = payable - sched;
                  return (
                    <tr key={cg.id}>
                      <td><strong>{cg.firstName} {cg.lastName}</strong></td>
                      <td>{sched.toFixed(2)}</td>
                      <td><strong>{worked.toFixed(2)}</strong></td>
                      <td>{payable.toFixed(2)}</td>
                      <td style={{ color: Math.abs(variance) < 1 ? MUTED : variance < 0 ? BAD : WARN }}>
                        {variance >= 0 ? '+' : ''}{variance.toFixed(1)}h
                      </td>
                      <td>{n(cg.clientCount)}</td>
                      <td>{n(cg.avgShiftHours).toFixed(2)}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No caregiver data available</p>
          )}
        </div>
      </div>
    );
  };

  const renderPerformanceReport = () => {
    if (!reportData) return null;
    const { caregiverPerformance = [], punctuality = [] } = reportData;
    const punctualityById: Record<string, Punctuality> = Object.fromEntries(punctuality.map(p => [p.id, p]));
    const grace = reportData.onTimeRule?.graceMinutes ?? 7;

    return (
      <div>
        <div className="hc-card">
          <h3>Caregiver Performance Metrics</h3>
          {caregiverPerformance.length > 0 ? (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Avg Rating</th>
                  <th>Scheduled</th>
                  <th title="Clock-in to clock-out of completed punches">Worked (clocked)</th>
                  <th title="What payroll pays">Payable</th>
                  <th>Clients</th>
                  <th title={`Clock-in within ${grace} minutes of the scheduled start, either side. Early or late beyond that is off schedule.`}>On-Time %</th>
                  <th>GPS Capture</th>
                </tr>
              </thead>
              <tbody>
                {caregiverPerformance.map(perf => {
                  const avgRating = n(perf.avgRating);
                  const punct = punctualityById[perf.id];
                  return (
                    <tr key={perf.id}>
                      <td><strong>{perf.firstName} {perf.lastName}</strong></td>
                      <td>
                        {avgRating > 0 ? (
                          <span style={{ fontSize: '1.1em' }}>⭐ {avgRating.toFixed(2)} ({n(perf.ratingCount)})</span>
                        ) : 'N/A'}
                      </td>
                      <td>{n(perf.totalHours).toFixed(1)}</td>
                      <td><strong>{n(perf.workedHours).toFixed(2)}</strong></td>
                      <td>{n(perf.payableHours).toFixed(2)}</td>
                      <td>{n(perf.clientsServed)}</td>
                      <td>
                        {punct && punct.totalShifts > 0 ? (<>
                          <span style={{ color: n(punct.onTimePercentage) >= 90 ? GOOD : WARN }}>
                            {punct.onTimePercentage}% ({punct.onTimeCount} of {punct.totalShifts} on time)
                          </span>
                          {(punct.earlyCount > 0 || punct.lateCount > 0 || punct.unscheduledCount > 0) && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)' }}>
                              {[punct.earlyCount > 0 && `${punct.earlyCount} early`, punct.lateCount > 0 && `${punct.lateCount} late`, punct.unscheduledCount > 0 && `${punct.unscheduledCount} unscheduled`].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </>) : '—'}
                      </td>
                      <td>
                        {perf.gpsCapturePct != null ? (
                          <span style={{ color: n(perf.gpsCapturePct) >= 80 ? GOOD : WARN }}>{perf.gpsCapturePct}%</span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No performance data available</p>
          )}
          <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
            On time = clocked in within {grace} minutes of the visit's scheduled start, either side. More than that early or late is off schedule; a punch with no scheduled visit is unscheduled. Worked = clocked time; payable = what payroll pays.
          </p>
        </div>
      </div>
    );
  };

  const renderSatisfactionReport = () => {
    if (!reportData) return null;
    const satisfaction = reportData.satisfaction || {};
    const trend = satisfaction.trend || [];
    const themes = satisfaction.feedbackThemes || [];

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="hc-stat-card">
            <h3>Overall Satisfaction</h3>
            <div className="value" style={{ fontSize: '3rem' }}>
              {(satisfaction.totalRatings || 0) > 0 ? n(satisfaction.avgRating).toFixed(2) : 'N/A'}⭐
            </div>
            <p className="hc-stat-subtext">{satisfaction.totalRatings || 0} ratings</p>
          </div>

          <div className="hc-stat-card">
            <h3>Satisfaction Distribution</h3>
            <div style={{ fontSize: '0.9rem' }}>
              <p>😊 Positive (4-5⭐): {satisfaction.positivePercentage || 0}%</p>
              <p>😐 Neutral (3⭐): {satisfaction.neutralPercentage || 0}%</p>
              <p>🙁 Negative (1-2⭐): {satisfaction.negativePercentage || 0}%</p>
            </div>
          </div>
        </div>

        <div className="hc-card">
          <h3>Satisfaction Trends (by week)</h3>
          {trend.length > 0 ? (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Avg Rating</th>
                  <th>Trend</th>
                  <th>Ratings</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((row, idx) => {
                  const rating = n(row.avgRating);
                  const prev = idx > 0 ? n(trend[idx - 1].avgRating) : rating;
                  const change = rating - prev;
                  return (
                    <tr key={idx}>
                      <td>{row.weekStart ? formatDate(row.weekStart) : ''}</td>
                      <td>⭐ {rating.toFixed(2)}</td>
                      <td>
                        {change > 0.005 ? (
                          <span style={{ color: GOOD }}>↑ {change.toFixed(2)}</span>
                        ) : change < -0.005 ? (
                          <span style={{ color: BAD }}>↓ {Math.abs(change).toFixed(2)}</span>
                        ) : (
                          <span style={{ color: MUTED }}>→ Stable</span>
                        )}
                      </td>
                      <td>{n(row.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>No satisfaction data available</p>
          )}
        </div>

        <div className="hc-card">
          <h3>Feedback Themes</h3>
          {themes.length > 0 ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {themes.map((theme, idx) => (
                <div key={idx} style={{ padding: '1rem', background: 'var(--hc-subtle)', color: 'var(--hc-ink)', borderRadius: '6px' }}>
                  <strong>{theme.theme}</strong>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>
                    Mentioned {n(theme.count)} times
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p>No feedback themes available</p>
          )}
        </div>
      </div>
    );
  };

  const renderRevenueReport = () => {
    if (!reportData) return null;
    const { revenue = {}, ar = {}, byPayer = [], byClient = [], byServiceType = [] } = reportData;
    const revenueTotal = n(revenue.total);
    const collectionRate = revenueTotal > 0 ? (n(revenue.collected) / revenueTotal * 100) : 0;
    const flag = (v: Num, color: string): CSSProperties => ({ color: n(v) > 0 ? color : undefined });

    return (
      <div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="hc-stat-card">
            <h3>Billed</h3>
            <div className="value">{money(revenue.total)}</div>
            <div className="hc-stat-subtext">{n(revenue.invoiceCount)} invoices</div>
          </div>
          <div className="hc-stat-card">
            <h3>Collected</h3>
            <div className="value value-success">{money(revenue.collected)}</div>
            <div className="hc-stat-subtext">{collectionRate.toFixed(1)}% collected</div>
          </div>
          <div className="hc-stat-card">
            <h3>Outstanding</h3>
            <div className="value" style={flag(revenue.outstanding, BAD)}>{money(revenue.outstanding)}</div>
          </div>
          <div className="hc-stat-card">
            <h3>Scheduled Hours</h3>
            <div className="value">{n(revenue.scheduledHours).toFixed(1)}</div>
            <div className="hc-stat-subtext">{money(revenue.avgPerScheduledHour)}/scheduled hr</div>
          </div>
        </div>

        <div className="hc-card">
          <h3>📅 Accounts Receivable — Aging</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="hc-table">
              <thead><tr>
                <th>Current (not due)</th><th>1–30 days</th><th>31–60</th><th>61–90</th><th>90+ days</th><th>Total Outstanding</th>
              </tr></thead>
              <tbody><tr>
                <td>{money(ar.currentNotDue)}</td>
                <td>{money(ar.d130)}</td>
                <td style={flag(ar.d3160, WARN)}>{money(ar.d3160)}</td>
                <td style={flag(ar.d6190, WARN)}>{money(ar.d6190)}</td>
                <td style={{ ...flag(ar.d90Plus, BAD), fontWeight: 700 }}>{money(ar.d90Plus)}</td>
                <td><strong>{money(ar.totalOutstanding)}</strong></td>
              </tr></tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.8rem', color: MUTED, margin: '0.5rem 0 0' }}>Snapshot of all unpaid invoice balances as of today (not limited to the selected period).</p>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="hc-card">
            <h3>Revenue by Payer</h3>
            {byPayer.length > 0 ? (
              <table className="hc-table">
                <thead><tr><th>Payer</th><th>Billed</th><th>Collected</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {byPayer.map((p, i) => (
                    <tr key={i}>
                      <td><strong>{p.payer}</strong></td>
                      <td>{money(p.billed)}</td>
                      <td>{money(p.collected)}</td>
                      <td style={flag(p.outstanding, BAD)}>{money(p.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No data available</p>}
          </div>

          <div className="hc-card">
            <h3>Revenue by Service Type</h3>
            {byServiceType.length > 0 ? (
              <table className="hc-table">
                <thead><tr><th>Service Type</th><th>Revenue</th><th>%</th></tr></thead>
                <tbody>
                  {byServiceType.map((st, idx) => {
                    const r = n(st.revenue);
                    return (
                      <tr key={idx}>
                        <td>{serviceLabel(st.serviceType)}</td>
                        <td><strong>{money(r)}</strong></td>
                        <td>{revenueTotal > 0 ? ((r / revenueTotal) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p>No data available</p>}
          </div>
        </div>

        <div className="hc-card">
          <h3>Top Clients by Revenue</h3>
          {byClient.length > 0 ? (
            <table className="hc-table">
              <thead><tr><th>Client</th><th>Revenue</th><th>Outstanding</th></tr></thead>
              <tbody>
                {byClient.slice(0, 15).map(cl => (
                  <tr key={cl.id}>
                    <td>{cl.firstName} {cl.lastName}</td>
                    <td><strong>{money(cl.revenue)}</strong></td>
                    <td style={flag(cl.outstanding, BAD)}>{money(cl.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>No client data available</p>}
        </div>
      </div>
    );
  };

  const renderPnlReport = () => {
    if (!reportData) return null;
    const { revenue = {}, revenueByPayer = [], expenses = {}, payroll = {}, delivered = {},
      unbilledEst = 0, earnedRevenue = 0, netIncome = 0, netIncomeCash = 0, margin = 0 } = reportData as PnlData;
    const net = n(netIncome);
    const netCash = n(netIncomeCash);
    const deliveredHrs = n(delivered.hours);
    const unvaluedHrs = n(delivered.unvaluedHours);
    const unbilled = n(unbilledEst);
    const byCategory = expenses.byCategory || [];
    const sub: CSSProperties = { color: MUTED, fontSize: '0.9em' };
    return (
      <div>
        <div className="hc-card" style={{ background: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', borderLeft: '4px solid var(--hc-warning-ink)', marginBottom: '1rem' }}>
          <strong>⚠️ Earned-basis view built on delivered work.</strong> Delivered = payroll-reviewed shifts
          (what actually gets paid — including staff who don&apos;t use the app) plus clock entries not yet
          reviewed. Revenue = delivered hours &times; each client&apos;s contract rate; payroll = the same hours
          &times; pay rates + 7.65% est. employer tax. Directional view, not a filed P&amp;L.
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="hc-stat-card">
            <h3>Revenue (earned)</h3>
            <div className="value value-success">{money(earnedRevenue)}</div>
            <div className="hc-stat-subtext">{money(revenue.totalBilled)} billed · {money(revenue.totalCollected)} collected</div>
          </div>
          <div className="hc-stat-card">
            <h3>Payroll</h3>
            <div className="value">{money(payroll.total)}</div>
            <div className="hc-stat-subtext">{money(payroll.gross)} gross + est. tax</div>
          </div>
          <div className="hc-stat-card">
            <h3>Expenses</h3>
            <div className="value">{money(expenses.total)}</div>
          </div>
          <div className="hc-stat-card">
            <h3>Net Income (earned)</h3>
            <div className="value" style={{ color: net >= 0 ? GOOD : BAD }}>{money(net)}</div>
            <div className="hc-stat-subtext">{n(margin).toFixed(1)}% margin · cash basis {money(netCash)}</div>
          </div>
        </div>

        {(unbilled > 0.005 || unvaluedHrs > 0.01) && (
          <div className="hc-card" style={{ background: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)', borderLeft: '4px solid var(--hc-info-ink)', marginBottom: '1rem' }}>
            {unbilled > 0.005 && (
              <><strong>≈{money(unbilled)} of delivered work is not billed yet</strong> — generate the period&apos;s
              invoices (private pay) and claims (MCO/Medicaid/VA) to collect it. </>
            )}
            {unvaluedHrs > 0.01 && (
              <><strong>{unvaluedHrs.toFixed(1)} delivered hours are counted at $0</strong> — the client has no
              payer/care type set or no rate is on file for them. Fix the client profile or the rate table
              and this revenue appears.</>
            )}
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="hc-card">
            <h3>Revenue by Payer</h3>
            {revenueByPayer.length > 0 ? (
              <table className="hc-table">
                <thead><tr><th>Payer</th><th>Invoices</th><th>Billed</th><th>Collected</th></tr></thead>
                <tbody>
                  {revenueByPayer.map((p, i) => (
                    <tr key={i}><td><strong>{p.payerName}</strong></td><td>{n(p.invoiceCount)}</td><td>{money(p.billed)}</td><td>{money(p.collected)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No revenue data</p>}
          </div>
          <div className="hc-card">
            <h3>Expenses by Category</h3>
            {byCategory.length > 0 ? (
              <table className="hc-table">
                <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                <tbody>
                  {byCategory.map((e, i) => (
                    <tr key={i}><td>{e.category || 'Uncategorized'}</td><td>{money(e.categoryTotal)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No expenses recorded</p>}
          </div>
        </div>

        <div className="hc-card">
          <h3>P&amp;L Summary</h3>
          <table className="hc-table">
            <tbody>
              <tr><td>Revenue earned ({deliveredHrs.toFixed(1)} delivered hours &times; contract rates)</td><td style={{ textAlign: 'right' }}>{money(earnedRevenue)}</td></tr>
              <tr style={sub}><td style={{ paddingLeft: '1.25rem' }}>of which billed so far</td><td style={{ textAlign: 'right' }}>{money(revenue.totalBilled)}</td></tr>
              <tr style={sub}><td style={{ paddingLeft: '1.25rem' }}>not yet billed (invoices/claims to generate)</td><td style={{ textAlign: 'right' }}>{money(unbilled)}</td></tr>
              <tr><td>&minus; Payroll (incl. est. taxes)</td><td style={{ textAlign: 'right' }}>&minus;{money(payroll.total)}</td></tr>
              <tr><td>&minus; Expenses</td><td style={{ textAlign: 'right' }}>&minus;{money(expenses.total)}</td></tr>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--hc-line)' }}>
                <td>Net Income (earned basis)</td>
                <td style={{ textAlign: 'right', color: net >= 0 ? GOOD : BAD }}>{money(net)}</td>
              </tr>
              <tr style={{ color: MUTED }}>
                <td>Net cash flow (collected &minus; payroll &minus; expenses)</td>
                <td style={{ textAlign: 'right', color: netCash >= 0 ? GOOD : BAD }}>{money(netCash)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.8rem', color: MUTED, margin: '0.5rem 0 0' }}>
            Earned basis matches work done in the period against its costs; the cash line shows money actually
            in the door. Payroll = cleaned clocked hours &times; pay rate + 7.65% est. employer tax (the finalized
            number comes from the payroll run).
          </p>
        </div>
      </div>
    );
  };

  const fmtNum = (v: unknown): ReactNode => v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : String(v));
  const fmtPct = (v: unknown): ReactNode => v == null ? '—' : `${n(v).toFixed(1)}%`;

  // One Name column for a person (not First and Last split across two).
  const NAME_COL: Column = { key: 'name', label: 'Name', bold: true, value: (r) => nameOf(r) || '—' };

  // The drill-down reports' table: column defs over reportData.rows.
  const renderTable = (columns: Column[]) => {
    const list = reportData?.rows || [];
    if (list.length === 0) return <p className="text-muted text-center">No data for this period.</p>;
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="hc-table">
          <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.right ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i}>
                {columns.map(c => {
                  const raw = c.value ? c.value(r) : r[c.key];
                  let v: ReactNode;
                  if (c.format === 'num') v = fmtNum(raw);
                  else if (c.format === 'pct') v = fmtPct(raw);
                  else if (c.format === 'hr') v = raw != null ? `${n(raw).toFixed(2)}h` : '—';
                  else if (c.format === 'date') v = raw ? formatDate(String(raw)) : null;
                  else v = raw == null ? null : String(raw);
                  return <td key={c.key} style={{ textAlign: c.right ? 'right' : 'left', fontWeight: c.bold ? 700 : 400 }}>{v ?? '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderHoursByPayer = () => renderTable([
    { key: 'payerName', label: 'Payer', bold: true },
    { key: 'payerType', label: 'Type' },
    { key: 'activeClients', label: 'Clients', right: true, format: 'num' },
    { key: 'visits', label: 'Visits', right: true, format: 'num' },
    { key: 'totalHours', label: 'Clocked Hrs', right: true, format: 'hr' },
    { key: 'billableHours', label: 'Billable Hrs', right: true, format: 'hr' },
    { key: 'avgVisitHours', label: 'Avg Visit (clocked)', right: true, format: 'hr' },
    { key: 'firstVisit', label: 'First', format: 'date' },
    { key: 'lastVisit', label: 'Last', format: 'date' },
  ]);

  const renderCaregiverUtilization = () => renderTable([
    NAME_COL,
    { key: 'maxHoursPerWeek', label: 'Max/wk', right: true, format: 'num' },
    { key: 'capacityHours', label: 'Capacity (hrs)', right: true, format: 'num' },
    { key: 'actualHours', label: 'Billable (hrs)', right: true, format: 'hr' },
    { key: 'visits', label: 'Visits', right: true, format: 'num' },
    { key: 'utilizationPct', label: 'Util %', right: true, format: 'pct' },
  ]);

  const renderClientIncidents = () => renderTable([
    NAME_COL,
    { key: 'incidentCount', label: 'Total', right: true, format: 'num' },
    { key: 'criticalCount', label: 'Critical', right: true, format: 'num' },
    { key: 'severeCount', label: 'Severe', right: true, format: 'num' },
    { key: 'moderateCount', label: 'Moderate', right: true, format: 'num' },
    { key: 'minorCount', label: 'Minor', right: true, format: 'num' },
    { key: 'followupCount', label: 'Follow-up', right: true, format: 'num' },
    { key: 'earliest', label: 'First', format: 'date' },
    { key: 'latest', label: 'Last', format: 'date' },
  ]);

  const renderClientRevenueByMonth = () => renderTable([
    { key: 'month', label: 'Month', bold: true },
    { ...NAME_COL, label: 'Client' },
    { key: 'invoiceCount', label: 'Invoices', right: true, format: 'num' },
    { key: 'totalBilled', label: 'Billed ($)', right: true, format: 'num' },
    { key: 'totalPaid', label: 'Paid ($)', right: true, format: 'num' },
    { key: 'outstanding', label: 'Outstanding ($)', right: true, format: 'num' },
    { key: 'paidCount', label: 'Paid', right: true, format: 'num' },
    { key: 'overdueCount', label: 'Overdue', right: true, format: 'num' },
  ]);

  const renderClientVisitsSummary = () => renderTable([
    { ...NAME_COL, label: 'Client' },
    { key: 'payerName', label: 'Payer' },
    { key: 'careTypeName', label: 'Care Type' },
    { key: 'visits', label: 'Visits', right: true, format: 'num' },
    { key: 'distinctCaregivers', label: 'Caregivers', right: true, format: 'num' },
    { key: 'totalHours', label: 'Clocked Hrs', right: true, format: 'hr' },
    { key: 'billableHours', label: 'Billable', right: true, format: 'hr' },
    { key: 'firstVisit', label: 'First', format: 'date' },
    { key: 'lastVisit', label: 'Last', format: 'date' },
  ]);

  const renderReport = () => {
    switch (reportType) {
      case 'overview': return renderOverviewReport();
      case 'hours': return renderHoursReport();
      case 'performance': return renderPerformanceReport();
      case 'satisfaction': return renderSatisfactionReport();
      case 'revenue': return renderRevenueReport();
      case 'pnl': return renderPnlReport();
      case 'hours-by-payer': return renderHoursByPayer();
      case 'caregiver-utilization': return renderCaregiverUtilization();
      case 'client-visits-summary': return renderClientVisitsSummary();
      case 'client-revenue-by-month': return renderClientRevenueByMonth();
      case 'client-incidents': return renderClientIncidents();
      default: return null;
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2>📊 Reports & Analytics</h2>
        <AgencyTimezone onChange={generateReport} />
      </div>

      <div className="hc-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          {REPORT_TYPES.map(type => (
            <button
              key={type.value}
              className={`hc-btn ${reportType === type.value ? 'hc-btn-primary' : 'hc-btn-secondary'}`}
              onClick={() => setReportType(type.value)}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hc-card">
        <div className="filter-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={dateRange.startDate} onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })} />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={dateRange.endDate} onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })} />
          </div>

          <div className="form-group">
            <label>Caregiver (Optional)</label>
            <select value={caregiverFilter} onChange={(e) => setCaregiverFilter(e.target.value)}>
              <option value="">All Caregivers</option>
              {caregivers.map(cg => (
                <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Client (Optional)</label>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">All Clients</option>
              {clients.map(cl => (
                <option key={cl.id} value={cl.id}>{cl.firstName} {cl.lastName}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <button className="hc-btn hc-btn-secondary" onClick={() => exportReport('csv')}>📥 CSV</button>
            <button className="hc-btn hc-btn-secondary" onClick={() => exportReport('pdf')}>📄 PDF</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : error ? (
        <div className="hc-card" role="alert" style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', border: '1px solid var(--hc-danger-line)' }}>
          {error}
        </div>
      ) : (
        renderReport()
      )}
    </div>
  );
};

export default ReportsAnalytics;
