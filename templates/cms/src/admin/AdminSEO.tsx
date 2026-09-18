import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getSiteSettings } from './api';
import { auditHtml, parseSitemapPaths, toPath, type AuditReport, type CheckStatus } from '../seo/auditEngine';
import './AdminSEO.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_ICON: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✕', info: 'ℹ' };

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--admin-success, #16a34a)';
  if (score >= 55) return 'var(--admin-warning, #d97706)';
  return 'var(--admin-error, #dc2626)';
}

/** Fetch a same-origin page's rendered HTML. */
async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface SiteRow { path: string; report: AuditReport | null; error?: string }

function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    <svg width={size} height={size} className="seo-ring" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="seo-ring-track" strokeWidth={10} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={scoreColor(score)} strokeWidth={10} fill="none"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="47%" className="seo-ring-num" textAnchor="middle" dominantBaseline="middle" fill={scoreColor(score)}>{score}</text>
      <text x="50%" y="63%" className="seo-ring-label" textAnchor="middle" dominantBaseline="middle">/ 100</text>
    </svg>
  );
}

export default function AdminSEO() {
  const toast = useToast();
  const [pages, setPages] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [selected, setSelected] = useState('/');
  const [report, setReport] = useState<AuditReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Site-wide audit
  const [siteRows, setSiteRows] = useState<SiteRow[]>([]);
  const [siteRunning, setSiteRunning] = useState(false);
  const [siteProgress, setSiteProgress] = useState({ done: 0, total: 0 });

  const knownPaths = useMemo(() => new Set(pages), [pages]);

  // ─── Load pages (sitemap) + derive keywords from the site's own settings ───
  useEffect(() => {
    (async () => {
      setLoading(true);
      // Pages from sitemap.xml (same source Google uses); fallback to a minimal set.
      let paths: string[] = [];
      try {
        const xml = await (await fetch('/sitemap.xml', { credentials: 'same-origin' })).text();
        paths = parseSitemapPaths(xml);
      } catch { /* ignore */ }
      if (!paths.length) paths = ['/'];
      if (!paths.includes('/')) paths.unshift('/');
      setPages(paths);

      // Derive target keywords: "<service> <city>" plus geo — editable by the user.
      const derived: string[] = [];
      try {
        const settings: any = await getSiteSettings().catch(() => null);
        const city = clean(settings?.city);
        const state = clean(settings?.state);
        const company = clean(settings?.companyName || settings?.siteName);
        let services: any[] = [];
        try {
          const r = await fetch(`${API_BASE}/admin/services-data`, { credentials: 'same-origin' });
          if (r.ok) services = await r.json();
        } catch { /* ignore */ }
        services.forEach((s) => { const t = clean(s?.title || s?.name); if (t && city) derived.push(`${t} ${city}`); else if (t) derived.push(t); });
        if (city && state) derived.push(`${city} ${state}`);
        if (company) derived.push(company);
      } catch { /* ignore */ }
      setKeywords(dedupe(derived).slice(0, 12));
      setLoading(false);
    })();
  }, []);

  const runPage = useCallback(async (path: string) => {
    setAnalyzing(true); setReport(null);
    try {
      const html = await fetchHtml(path);
      setReport(auditHtml(html, { url: path, targetKeywords: keywords, knownPaths }));
    } catch (e: any) {
      toast.error(`Could not analyze ${path}: ${e.message}`);
    }
    setAnalyzing(false);
  }, [keywords, knownPaths, toast]);

  const runSite = useCallback(async () => {
    setSiteRunning(true);
    setSiteRows(pages.map((p) => ({ path: p, report: null })));
    setSiteProgress({ done: 0, total: pages.length });
    const rows: SiteRow[] = [];
    // Sequential to be gentle on the site; sites are small (dozens of pages).
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      try {
        const html = await fetchHtml(p);
        rows.push({ path: p, report: auditHtml(html, { url: p, targetKeywords: keywords, knownPaths }) });
      } catch (e: any) {
        rows.push({ path: p, report: null, error: e.message });
      }
      setSiteProgress({ done: i + 1, total: pages.length });
      setSiteRows([...rows, ...pages.slice(i + 1).map((pp) => ({ path: pp, report: null }))]);
    }
    setSiteRunning(false);
    toast.success(`Audited ${rows.length} pages.`);
  }, [pages, keywords, knownPaths, toast]);

  const addKeyword = () => { const k = keywordInput.trim(); if (k) { setKeywords(dedupe([...keywords, k])); setKeywordInput(''); } };

  // Aggregate + duplicate detection across the site
  const siteSummary = useMemo(() => {
    const done = siteRows.filter((r) => r.report);
    if (!done.length) return null;
    const avg = Math.round(done.reduce((a, r) => a + (r.report!.score), 0) / done.length);
    const titleMap = new Map<string, number>();
    const descMap = new Map<string, number>();
    done.forEach((r) => {
      const t = r.report!.page.title.trim().toLowerCase();
      const d = r.report!.page.description.trim().toLowerCase();
      if (t) titleMap.set(t, (titleMap.get(t) || 0) + 1);
      if (d) descMap.set(d, (descMap.get(d) || 0) + 1);
    });
    const dupTitles = [...titleMap.values()].filter((n) => n > 1).length;
    const dupDescs = [...descMap.values()].filter((n) => n > 1).length;
    return { avg, count: done.length, dupTitles, dupDescs };
  }, [siteRows]);

  return (
    <AdminLayout
      title="SEO Analyzer"
      subtitle="Audit your live pages for on-page SEO — scored like the pros, tuned to your keywords"
      actions={<button className="admin-btn admin-btn-primary" disabled={siteRunning || loading} onClick={runSite}>{siteRunning ? `Auditing ${siteProgress.done}/${siteProgress.total}…` : 'Audit whole site'}</button>}
    >
      <div className="admin-section seo-controls">
        <div className="seo-control-row">
          <label>Page</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loading}>
            {pages.map((p) => <option key={p} value={p}>{p === '/' ? '/ (home)' : p}</option>)}
          </select>
          <button className="admin-btn admin-btn-primary" disabled={analyzing || loading} onClick={() => runPage(selected)}>{analyzing ? 'Analyzing…' : 'Analyze page'}</button>
        </div>

        <div className="seo-control-row seo-keywords">
          <label>Target keywords</label>
          <div className="seo-chips">
            {keywords.map((k) => (
              <span key={k} className="seo-chip">{k}<button onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label={`Remove ${k}`}>×</button></span>
            ))}
            <input value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKeyword()} placeholder="add keyword…" />
          </div>
        </div>
        <p className="seo-hint">Keywords are auto-derived from your services and city. Edit them to match what you want to rank for, then re-analyze.</p>
      </div>

      {/* Site-wide results */}
      {siteRows.some((r) => r.report) && (
        <div className="admin-section">
          <div className="seo-site-header">
            <h3>Site audit</h3>
            {siteSummary && (
              <div className="seo-site-stats">
                <span><strong style={{ color: scoreColor(siteSummary.avg) }}>{siteSummary.avg}</strong> avg score</span>
                <span>{siteSummary.count} pages</span>
                {siteSummary.dupTitles > 0 && <span className="seo-warn-pill">{siteSummary.dupTitles} duplicate titles</span>}
                {siteSummary.dupDescs > 0 && <span className="seo-warn-pill">{siteSummary.dupDescs} duplicate descriptions</span>}
              </div>
            )}
          </div>
          <table className="seo-table">
            <thead><tr><th>Page</th><th>Score</th><th>Issues</th><th>Top issue</th><th></th></tr></thead>
            <tbody>
              {[...siteRows].sort((a, b) => (a.report?.score ?? 999) - (b.report?.score ?? 999)).map((r) => {
                const topFail = r.report?.categories.flatMap((c) => c.checks).find((c) => c.status === 'fail')
                  || r.report?.categories.flatMap((c) => c.checks).find((c) => c.status === 'warn');
                return (
                  <tr key={r.path}>
                    <td className="seo-td-path">{r.path === '/' ? '/ (home)' : r.path}</td>
                    <td>{r.report ? <span className="seo-badge" style={{ background: scoreColor(r.report.score) }}>{r.report.score}</span> : r.error ? <span className="seo-badge seo-badge-err">err</span> : <span className="seo-dots">…</span>}</td>
                    <td>{r.report ? `${r.report.summary.fail} fail · ${r.report.summary.warn} warn` : ''}</td>
                    <td className="seo-td-top">{topFail?.message || (r.error ? r.error : '')}</td>
                    <td>{r.report && <button className="admin-btn admin-btn-sm" onClick={() => { setSelected(r.path); setReport(r.report); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>View</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Single-page report */}
      {report && (
        <div className="admin-section seo-report">
          <div className="seo-report-head">
            <ScoreRing score={report.score} />
            <div className="seo-report-meta">
              <div className="seo-grade" style={{ color: scoreColor(report.score) }}>Grade {report.grade}</div>
              <div className="seo-url">{report.url === '/' ? '/ (home)' : report.url}</div>
              <div className="seo-summary">
                <span className="seo-count seo-pass">{report.summary.pass} passed</span>
                <span className="seo-count seo-warn">{report.summary.warn} warnings</span>
                <span className="seo-count seo-fail">{report.summary.fail} failed</span>
              </div>
              <div className="seo-stats">
                <span>{report.stats.words} words</span>
                <span>{report.stats.title} title chars</span>
                <span>{report.stats.description} desc chars</span>
                <span>{report.stats.h1} H1</span>
                <span>{report.stats.images} images</span>
                <span>{report.stats.internalLinks} internal links</span>
              </div>
            </div>
          </div>

          {report.categories.map((cat) => (
            <div key={cat.id} className="seo-cat">
              <div className="seo-cat-head">
                <h4>{cat.label}</h4>
                {cat.score !== null && <span className="seo-cat-score" style={{ color: scoreColor(cat.score) }}>{cat.score}</span>}
              </div>
              <ul className="seo-checks">
                {cat.checks.map((ch) => (
                  <li key={ch.id} className={`seo-check seo-check-${ch.status}`}>
                    <span className="seo-check-icon">{STATUS_ICON[ch.status]}</span>
                    <div className="seo-check-body">
                      <div className="seo-check-line"><span className="seo-check-label">{ch.label}</span>{ch.value ? <span className="seo-check-value">{ch.value}</span> : null}</div>
                      <div className="seo-check-msg">{ch.message}{ch.recommendation ? <span className="seo-check-rec"> → {ch.recommendation}</span> : null}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!report && !siteRows.some((r) => r.report) && !analyzing && !loading && (
        <div className="admin-section seo-empty">
          <p>Pick a page and hit <strong>Analyze page</strong>, or <strong>Audit whole site</strong> to score every page at once.</p>
        </div>
      )}
    </AdminLayout>
  );
}

// ── helpers ──
function clean(v: any): string { const s = String(v ?? '').trim(); return /\{\{.*\}\}/.test(s) ? '' : s; }
function dedupe(arr: string[]): string[] { return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))); }
