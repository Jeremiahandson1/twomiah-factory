import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const PRIMARY = '{{PRIMARY_COLOR}}';

interface SeriesPoint { month: string; value: number; }

interface YoyMetric { current: number; sameMonthLastYear: number; deltaPct: number; }

interface SeasonalData {
  months: string[];
  series: { leads: SeriesPoint[]; unitsSold: SeriesPoint[]; repairOrders: SeriesPoint[] };
  yoy: {
    thisMonth: string;
    sameMonthLastYear: string;
    leads: YoyMetric;
    unitsSold: YoyMetric;
    repairOrders: YoyMetric;
  };
}

interface LeadSource { source: string; total: number; won: number; closeRate: number; }
interface LeadSourcesData { sources: LeadSource[]; }

const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n);

export default function ReportingPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [seasonal, setSeasonal] = useState<SeasonalData | null>(null);
  const [leadSources, setLeadSources] = useState<LeadSourcesData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [seasonalRes, sourcesRes] = await Promise.all([
        fetch('/api/reporting/seasonal', { headers }),
        fetch('/api/reporting/lead-sources', { headers }),
      ]);
      if (seasonalRes.ok) setSeasonal(await seasonalRes.json());
      if (sourcesRes.ok) setLeadSources(await sourcesRes.json());
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const sortedSources = leadSources?.sources
    ? [...leadSources.sources].sort((a, b) => b.total - a.total)
    : [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Reports</h1>
        <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Seasonal trends, year-over-year, and lead source performance</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
        </div>
      ) : (
        <>
          {/* YoY stat cards */}
          {seasonal?.yoy && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
              <YoyCard label="Leads" metric={seasonal.yoy.leads} yoy={seasonal.yoy} />
              <YoyCard label="Units Sold" metric={seasonal.yoy.unitsSold} yoy={seasonal.yoy} />
              <YoyCard label="Repair Orders" metric={seasonal.yoy.repairOrders} yoy={seasonal.yoy} />
            </div>
          )}

          {/* Seasonal monthly bar chart */}
          {seasonal?.series && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 20, marginBottom: 28 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: '#111827' }}>24-Month Trend</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>Monthly leads, units sold, and repair orders</p>
              <BarChartSeries title="Leads" months={seasonal.months} points={seasonal.series.leads} color={PRIMARY} />
              <BarChartSeries title="Units Sold" months={seasonal.months} points={seasonal.series.unitsSold} color="#16a34a" />
              <BarChartSeries title="Repair Orders" months={seasonal.months} points={seasonal.series.repairOrders} color="#2563eb" />
            </div>
          )}

          {/* Lead sources table */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>Lead Sources</h2>
            </div>
            {sortedSources.length === 0 ? (
              <p style={{ padding: 20, color: '#6b7280', fontSize: 14, margin: 0 }}>No lead source data yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={thStyle}>Source</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Leads</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Won</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Close Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSources.map((s, i) => (
                    <tr key={s.source || i} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>{s.source || 'Unknown'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(s.total)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(s.won)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{(s.closeRate ?? 0).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function YoyCard({ label, metric, yoy }: { label: string; metric: YoyMetric; yoy: SeasonalData['yoy'] }) {
  const delta = metric?.deltaPct ?? 0;
  const up = delta > 0;
  const down = delta < 0;
  const color = up ? '#16a34a' : down ? '#dc2626' : '#6b7280';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 20 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: 30, fontWeight: 700, color: '#111827' }}>{fmtNum(metric?.current ?? 0)}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color, fontWeight: 600, fontSize: 14 }}>
          <Icon size={15} /> {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
        </span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>vs {fmtNum(metric?.sameMonthLastYear ?? 0)} last year</span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af' }}>{yoy.thisMonth} vs {yoy.sameMonthLastYear}</p>
    </div>
  );
}

function BarChartSeries({ title, months, points, color }: { title: string; months: string[]; points: SeriesPoint[]; color: string }) {
  const max = Math.max(1, ...points.map(p => p.value));
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
        {points.map((p, i) => (
          <div key={p.month || i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${p.month}: ${fmtNum(p.value)}`}>
            <div style={{ width: '100%', height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0, background: color, borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#9ca3af' }}>
        <span>{months[0]}</span>
        <span>{months[months.length - 1]}</span>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 20px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '12px 20px', fontSize: 14, color: '#111827' };
