import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ─── Mini chart components (no deps) ──────────────────────────────

function BarChart({ data, valueKey = 'views', labelKey = 'date', height = 180, color = 'var(--admin-primary)' }) {
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted, #9ca3af)', fontSize: 13 }}>
      No data yet — views will appear as visitors browse the site.
    </div>
  );
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  const showEvery = Math.max(1, Math.floor(data.length / 7));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, paddingTop: 24, overflowX: 'auto' }}>
      {data.map((d, i) => {
        const h = Math.max(((d[valueKey] || 0) / max) * (height - 32), d[valueKey] ? 3 : 0);
        const showLabel = (i % showEvery === 0) || i === data.length - 1;
        const label = d[labelKey] ? d[labelKey].slice(5) : ''; // MM-DD
        return (
          <div key={i} title={`${d[labelKey]}: ${d[valueKey] || 0}`}
            style={{ flex: 1, minWidth: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            {d[valueKey] > 0 && <span style={{ fontSize: 8, color: 'var(--admin-text-muted,#9ca3af)', whiteSpace: 'nowrap' }}>{d[valueKey]}</span>}
            <div style={{ width: '100%', maxWidth: 24, background: color, borderRadius: '3px 3px 0 0', height: h, minHeight: d[valueKey] ? 3 : 0, transition: 'height .3s' }} />
            {showLabel && <span style={{ fontSize: 8, color: 'var(--admin-text-muted,#9ca3af)', marginTop: 2, whiteSpace: 'nowrap' }}>{label}</span>}
          </div>
        );
      })}
    </div>
  );
}

function MultiBarChart({ data, height = 180 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => (d.views || 0) + (d.leads || 0)), 1);
  const showEvery = Math.max(1, Math.floor(data.length / 7));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, paddingTop: 24 }}>
      {data.map((d, i) => {
        const viewH = Math.max(((d.views || 0) / max) * (height - 32), d.views ? 2 : 0);
        const leadH = Math.max(((d.leads || 0) / max) * (height - 32), d.leads ? 2 : 0);
        const showLabel = (i % showEvery === 0) || i === data.length - 1;
        return (
          <div key={i} title={`${d.date}: ${d.views} views, ${d.leads} leads`}
            style={{ flex: 1, minWidth: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, width: '100%', justifyContent: 'center' }}>
              <div style={{ width: '45%', maxWidth: 10, background: 'var(--admin-primary)', borderRadius: '2px 2px 0 0', height: viewH }} />
              <div style={{ width: '45%', maxWidth: 10, background: '#f59e0b', borderRadius: '2px 2px 0 0', height: leadH }} />
            </div>
            {showLabel && <span style={{ fontSize: 8, color: 'var(--admin-text-muted,#9ca3af)', marginTop: 2, whiteSpace: 'nowrap' }}>{d.date?.slice(5)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ data, size = 120 }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  let offset = 0;
  const r = 40, cx = 60, cy = 60, stroke = 16;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      {data.map((d, i) => {
        const pct = d.count / total;
        const dash = pct * circ;
        const gap = circ - dash;
        const rotate = offset * 360 - 90;
        offset += pct;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={colors[i % colors.length]} strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={0}
            transform={`rotate(${rotate} ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray .4s' }}
          >
            <title>{d.label || d.device}: {d.count} ({(pct * 100).toFixed(1)}%)</title>
          </circle>
        );
      })}
    </svg>
  );
}

function Funnel({ steps }) {
  if (!steps || steps.length === 0) return null;
  const max = steps[0]?.value || 1;
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((step, i) => {
        const pct = max > 0 ? (step.value / max) * 100 : 0;
        const dropOff = i > 0 && steps[i - 1].value > 0
          ? (((steps[i - 1].value - step.value) / steps[i - 1].value) * 100).toFixed(0)
          : null;
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 500 }}>{step.label}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {dropOff && <span style={{ color: '#ef4444', fontSize: 11 }}>↓ {dropOff}% drop</span>}
                <strong>{step.value.toLocaleString()}</strong>
              </span>
            </div>
            <div style={{ height: 10, background: '#f3f4f6', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: colors[i % colors.length], borderRadius: 5, transition: 'width .4s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, delta }) {
  return (
    <div style={{
      background: 'var(--admin-surface, white)',
      border: '1px solid var(--admin-border, #e5e7eb)',
      borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--admin-border, #e5e7eb)',
      borderRadius: 10, padding: '14px 16px'
    }}>
      <div style={{ fontSize: 11, color: 'var(--admin-text-muted, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--admin-text-muted, #9ca3af)', marginTop: 4 }}>{sub}</div>}
      {delta !== undefined && (
        <div style={{ fontSize: 11, color: delta >= 0 ? '#10b981' : '#ef4444', marginTop: 4 }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs yesterday
        </div>
      )}
    </div>
  );
}

// ─── Legend dot ────────────────────────────────────────────────────
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{item.label || item.source || item.device}</span>
          <strong>{(item.visits || item.count || 0).toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────
function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
        {action}
      </div>
      <div style={{ background: 'var(--admin-surface, white)', border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10, padding: '16px 20px' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────
function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [gaId, setGaId] = useState('');
  const toast = useToast();

  const load = useCallback(async (p = period) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch(`${API_BASE}/admin/analytics?period=${p}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setData(await res.json());
      } else {
        toast.error('Failed to load analytics');
      }
    } catch (e) {
      toast.error('Failed to load analytics');
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    load(period);
    // Load GA ID
    const token = localStorage.getItem('adminToken');
    fetch(`${API_BASE}/admin/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : {})
      .then(s => setGaId(s.googleAnalyticsId || s.gaId || s?.analytics?.googleAnalyticsId || ''))
      .catch(() => {});
  }, []);

  const fmt = n => {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  };

  const changePeriod = (p) => {
    setPeriod(p);
    load(p);
  };

  const s = data?.summary || {};
  const delta = (s.todayViews || 0) - (s.yesterdayViews || 0);

  return (
    <AdminLayout
      title="Analytics"
      subtitle={`Last ${period} days`}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[7, 30, 90].map(p => (
            <button key={p} onClick={() => changePeriod(p)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid var(--admin-border, #e5e7eb)',
                background: period === p ? 'var(--admin-primary)' : 'white',
                color: period === p ? 'white' : 'var(--admin-text)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer'
              }}>
              {p}d
            </button>
          ))}
          <button onClick={() => load(period)}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--admin-border, #e5e7eb)', background: 'white', cursor: 'pointer', fontSize: 12 }}>
            ↺ Refresh
          </button>
        </div>
      }
    >
      {gaId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          <span style={{ color: '#10b981' }}>✓</span>
          <span>Google Analytics connected: <strong>{gaId}</strong></span>
          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: 'auto', color: 'var(--admin-primary)', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>
            Open GA Dashboard →
          </a>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--admin-text-muted)' }}>Loading analytics…</div>
      ) : (
        <>
          {/* ── Summary stats ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Page Views" value={fmt(s.periodViews)} sub={`${fmt(s.totalViews)} all-time`} accent="#3b82f6" delta={delta} />
            <StatCard label="Unique Sessions" value={fmt(s.periodSessions)} sub="approx." accent="#8b5cf6" />
            <StatCard label="Today" value={fmt(s.todayViews)} sub={`Yesterday: ${fmt(s.yesterdayViews)}`} />
            <StatCard label="Leads (period)" value={fmt(s.periodLeads)} sub={`${fmt(s.newLeads)} unread`} accent="#f59e0b" />
            <StatCard label="Conversion Rate" value={`${s.conversionRate}%`} sub="leads ÷ views" accent="#10b981" />
          </div>

          {/* ── Views + Leads chart ── */}
          <Section title="Views & Leads Over Time"
            action={<div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--admin-primary)', display: 'inline-block' }} />Views</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />Leads</span>
            </div>}
          >
            <MultiBarChart data={data?.dailyViews} height={200} />
          </Section>

          {/* ── Sources + Devices ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <Section title="Traffic Sources">
              {data?.sources?.length > 0 ? (
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                  <DonutChart
                    data={data.sources.map(s => ({ label: s.label, count: s.visits }))}
                    size={120}
                  />
                  <div style={{ flex: 1 }}>
                    <Legend items={data.sources.map(s => ({ label: s.label, count: s.visits }))} />
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: 13, padding: '20px 0' }}>
                  Traffic source data will appear as visitors arrive.
                </div>
              )}
            </Section>

            <Section title="Device Breakdown">
              {data?.devices?.length > 0 ? (
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                  <DonutChart
                    data={data.devices.map(d => ({ label: d.device.charAt(0).toUpperCase() + d.device.slice(1), count: d.count }))}
                    size={120}
                  />
                  <div style={{ flex: 1 }}>
                    <Legend items={data.devices.map(d => ({ label: d.device.charAt(0).toUpperCase() + d.device.slice(1), count: d.count }))} />
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: 13, padding: '20px 0' }}>
                  Device data will appear as visitors arrive.
                </div>
              )}
            </Section>
          </div>

          {/* ── Conversion Funnel ── */}
          <Section title="Lead Conversion Funnel">
            <Funnel steps={data?.funnel} />
          </Section>

          {/* ── Top Pages ── */}
          <Section title="Top Pages">
            {data?.topPages?.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--admin-border, #e5e7eb)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: 11 }}>#</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: 11 }}>Page</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: 11 }}>Views (period)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: 11 }}>All-time</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--admin-text-muted)', fontSize: 11, width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPages.map((p, i) => {
                    const max = data.topPages[0]?.views || 1;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--admin-border, #e5e7eb)' }}>
                        <td style={{ padding: '8px', color: 'var(--admin-text-muted)', fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: '8px', fontWeight: 500 }}>/{p.page || '(homepage)'}</td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{p.views.toLocaleString()}</td>
                        <td style={{ padding: '8px', textAlign: 'right', color: 'var(--admin-text-muted)' }}>{(p.total || p.views).toLocaleString()}</td>
                        <td style={{ padding: '8px' }}>
                          <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                            <div style={{ height: '100%', width: `${(p.views / max) * 100}%`, background: 'var(--admin-primary)', borderRadius: 3 }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: 13, padding: '20px 0' }}>No page data yet.</div>
            )}
          </Section>

          {/* ── Lead Sources + UTM ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <Section title="Where Leads Come From">
              {data?.leadSources?.length > 0 ? (
                <Legend items={data.leadSources.map(s => ({ label: s.label, count: s.count }))} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: 13, padding: '20px 0' }}>No lead source data yet.</div>
              )}
            </Section>

            <Section title="UTM Campaigns">
              {data?.utmCampaigns?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.utmCampaigns.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--admin-border, #f3f4f6)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{c.campaign}</span>
                      <strong>{c.visits.toLocaleString()} visits</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: 13, padding: '20px 0' }}>
                  No UTM campaigns tracked yet. Add <code>?utm_campaign=name</code> to links in your ads, emails, or social posts.
                </div>
              )}
            </Section>
          </div>

          {/* ── How it works ── */}
          <div style={{ padding: '14px 16px', background: 'var(--admin-bg, #f9fafb)', border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10, fontSize: 12, color: 'var(--admin-text-muted)' }}>
            <strong style={{ color: 'var(--admin-text)' }}>📊 How tracking works</strong><br />
            Page views, device type, and traffic source are tracked automatically on every page load with no external scripts. UTM parameters are captured from ad and email links. Session tracking uses anonymous browser session IDs. For geographic data and deeper behavior analytics, connect Google Analytics in{' '}
            <a href="/admin/settings" style={{ color: 'var(--admin-primary)' }}>Site Settings</a>.
          </div>
        </>
      )}
    </AdminLayout>
  );
}

export default AdminAnalytics;
