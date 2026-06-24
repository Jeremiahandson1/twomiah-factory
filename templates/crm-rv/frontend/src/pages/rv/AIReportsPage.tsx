import { useState } from 'react';
import { Bot, Send, Loader2, Sparkles } from 'lucide-react';
import api from '../../services/api';

const SUGGESTIONS = [
  'How many units did we sell last month, and total gross?',
  'Show my aged inventory — longest in stock, with prices.',
  'Which salesperson has the most closed deals this quarter?',
  "What's in service right now and the open RO value?",
  'Which leads are stalled and need follow-up today?',
  'Break down inventory by category and condition.',
];

// Compact Markdown → JSX renderer (no dependency). Handles headings, bold,
// bullets, numbered lists, and pipe tables — enough for Claude's reports.
function renderMarkdown(md: string) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: JSX.Element[] = [];
  let i = 0;
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((p, k) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={k}>{p.slice(2, -2)}</strong> : <span key={k}>{p}</span>);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // table
    if (line.includes('|') && lines[i + 1]?.includes('---')) {
      const head = line.split('|').map(s => s.trim()).filter(Boolean);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length));
        i++;
      }
      out.push(
        <div key={out.length} className="overflow-x-auto my-3">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50"><tr>{head.map((h, k) => <th key={k} className="px-3 py-2 text-left font-semibold border-b">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b last:border-0">{r.map((cell, ci) => <td key={ci} className="px-3 py-2">{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { const lvl = h[1].length; const sz = lvl === 1 ? 'text-xl' : lvl === 2 ? 'text-lg' : 'text-base'; out.push(<p key={out.length} className={`${sz} font-bold mt-4 mb-1`}>{inline(h[2])}</p>); i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      out.push(<ul key={out.length} className="list-disc pl-5 my-2 space-y-1">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      out.push(<ol key={out.length} className="list-decimal pl-5 my-2 space-y-1">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ol>);
      continue;
    }
    out.push(<p key={out.length} className="my-2 leading-relaxed">{inline(line)}</p>);
    i++;
  }
  return out;
}

export default function AIReportsPage() {
  const [question, setQuestion] = useState('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(q?: string) {
    const ask = (q ?? question).trim();
    if (!ask) return;
    setQuestion(ask); setLoading(true); setError(null); setReport(null);
    try {
      const res = await api.post('/api/ai-reports/generate', { question: ask });
      setReport(res);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong generating the report.');
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white"><Bot size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">AI Reports</h1>
          <p className="text-sm text-gray-500">Ask anything about your dealership — inventory, sales, service, leads. Answered from your live data.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-5">
        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
            placeholder="e.g. How many boats did we sell last month and what was the gross?"
            className="flex-1 p-3 border rounded-lg resize-none h-20 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={() => run()} disabled={loading || !question.trim()}
            className="px-5 self-stretch rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {SUGGESTIONS.map((s, k) => (
            <button key={k} onClick={() => run(s)} disabled={loading}
              className="text-xs px-3 py-1.5 rounded-full bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 border border-gray-200 disabled:opacity-50 inline-flex items-center gap-1">
              <Sparkles size={12} /> {s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-5 bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">{error}</div>}

      {loading && !report && (
        <div className="mt-5 bg-white rounded-xl border p-8 text-center text-gray-500">
          <Loader2 className="animate-spin mx-auto mb-2" /> Reading your data and writing the report…
        </div>
      )}

      {report && (
        <div className="mt-5 bg-white rounded-xl border shadow-sm p-6">
          <div className="text-xs text-gray-400 mb-3 flex flex-wrap gap-x-4 gap-y-1">
            <span>Analyzed: {report.rowsAnalyzed?.units} units · {report.rowsAnalyzed?.leads} leads · {report.rowsAnalyzed?.service} service ROs · {report.rowsAnalyzed?.invoices} invoices</span>
            <span>{report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''}</span>
          </div>
          <div className="text-gray-800">{renderMarkdown(report.report || '')}</div>
        </div>
      )}
    </div>
  );
}
