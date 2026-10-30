// The /demo page: one card per trade. A card opens the real CRM screens for that sample business (app.html, via /crm).
import { DEMO_TRADES } from '../../demo/trades'

const CSS = `
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--accent:#1d4ed8;--accent-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2e;--ink:#f1f5f9;--muted:#a9b6c9;--line:#2a3a56;--accent:#93c5fd;--accent-ink:#0b1220}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 18px 64px}
h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.2;margin:0 0 10px}
.lede{color:var(--muted);max-width:62ch;margin:0 0 8px}
.facts{margin:18px 0 28px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.facts li{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:.9rem;color:var(--muted)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:8px;border-top:5px solid var(--brand)}
.card h2{font-size:1.2rem;margin:0}
.card .biz{font-size:.88rem;color:var(--muted);margin:0}
.card p{margin:0;color:var(--ink)}
.card a{margin-top:auto;align-self:flex-start;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:700;border-radius:8px;padding:10px 16px}
.card a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.foot{margin-top:32px;color:var(--muted);font-size:.9rem}
`

const style = document.createElement('style')
style.textContent = CSS
document.head.appendChild(style)

const root = document.getElementById('picker')!
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n }

root.append(el('h1', 'Try the Twomiah CRM — free, no sign-up'))
root.append(el('p', 'These are the real CRM screens, running in your browser on sample data for a made-up business. Click anything, add things, move things around.', 'lede'))
const facts = el('ul', undefined, 'facts')
for (const f of ['Sample data only', 'Nothing is sent — no emails, texts or payments', 'Nothing is saved — reset any time']) facts.append(el('li', f))
root.append(facts)

const grid = el('div', undefined, 'grid')
for (const t of DEMO_TRADES) {
  const card = el('section', undefined, 'card')
  card.style.setProperty('--brand', t.primaryColor)
  card.append(el('h2', t.label), el('p', `${t.business} (sample)`, 'biz'), el('p', t.blurb))
  const open = el('a', `Open the ${t.label.toLowerCase()} demo`)
  open.href = `/crm?trade=${encodeURIComponent(t.id)}`
  card.append(open)
  grid.append(card)
}
root.append(grid)
root.append(el('p', 'Every business, person and number in the demo is made up. Closing the tab or pressing Reset demo puts everything back.', 'foot'))
