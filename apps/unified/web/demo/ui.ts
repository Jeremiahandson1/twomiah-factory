// What the visitor sees of the demo itself: the banner (what this is, Reset, the way back to the list) and a small notice for
// anything the demo turned off. Drawn outside the CRM's own page, in its own styles, so it reads the same on every screen,
// light and dark.
const STYLE = `
#demo-banner{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;padding:7px 12px;background:#1e293b;color:#fff;font:600 13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center}
#demo-banner .demo-actions{display:flex;gap:8px;align-items:center}
#demo-banner button,#demo-banner a{font:600 12px/1 system-ui,sans-serif;border-radius:6px;padding:6px 10px;cursor:pointer;text-decoration:none;border:1px solid #fbbf24}
#demo-banner button{background:#fbbf24;color:#111827}
#demo-banner a{background:transparent;color:#fff;border-color:#94a3b8}
#demo-banner button:focus-visible,#demo-banner a:focus-visible{outline:2px solid #fff;outline-offset:2px}
#demo-notice{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483001;max-width:min(92vw,460px);padding:10px 16px;border-radius:8px;background:#111827;color:#fff;font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid #475569}
html.demo-on body{overflow:hidden}
html.demo-on #root{position:absolute;top:var(--demo-bar,40px);left:0;right:0;bottom:0;overflow:auto;transform:translateZ(0)}
html.demo-on #root .h-screen{height:100%}
html.demo-on #root .min-h-screen{min-height:100%}
`

export function mountBanner(onReset: () => void) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)
  document.documentElement.classList.add('demo-on')
  const bar = document.createElement('div')
  bar.id = 'demo-banner'
  bar.setAttribute('role', 'region')
  bar.setAttribute('aria-label', 'Demo notice')
  const text = document.createElement('span')
  text.textContent = 'Demo — sample data, nothing is real or sent'
  const actions = document.createElement('span')
  actions.className = 'demo-actions'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.id = 'demo-reset'
  reset.textContent = 'Reset demo'
  reset.addEventListener('click', onReset)
  const all = document.createElement('a')
  all.href = '/'
  all.textContent = 'All demos'
  actions.append(reset, all)
  bar.append(text, actions)
  document.body.prepend(bar)
  const size = () => document.documentElement.style.setProperty('--demo-bar', `${bar.offsetHeight}px`)
  size()
  new ResizeObserver(size).observe(bar)
}

let timer: ReturnType<typeof setTimeout> | undefined
/** A short notice at the foot of the page (one at a time; the newest replaces the last). */
export function showNotice(message: string) {
  let el = document.getElementById('demo-notice')
  if (!el) {
    el = document.createElement('div')
    el.id = 'demo-notice'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = message
  clearTimeout(timer)
  timer = setTimeout(() => el?.remove(), 4500)
}
