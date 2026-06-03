/**
 * Preview renderer — the "show-first" draft.
 *
 * Turns a GenerateConfig into a single self-contained HTML file (the homepage)
 * the customer can look at and react to. This is DELIBERATELY separate from the
 * factory deploy pipeline: it does NOT create a GitHub repo, a Render service,
 * or a database. It reuses only the fast, local generate() step (which performs
 * all token substitution + AI content), then renders the template's own EJS
 * views offline and inlines the CSS/JS so the result opens anywhere.
 *
 * If the customer approves and buys, THAT is when the real factory pipeline
 * (deployCustomer) runs to give them their actual owned site. Never deploy here.
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import AdmZip from 'adm-zip'
import { generate, type GenerateConfig } from './generator'

export interface PreviewResult {
  html: string
  slug: string
  buildId: string
}

/**
 * Render the homepage of a draft site to self-contained HTML.
 * Always website-only — a preview never provisions CRM/pricing/vision.
 */
export async function renderHomepagePreview(config: GenerateConfig): Promise<PreviewResult> {
  const websiteConfig: GenerateConfig = { ...config, products: ['website'] }

  const result = await generate(websiteConfig)
  const extractDir = path.join(path.dirname(result.zipPath), result.buildId + '-preview')

  try {
    new AdmZip(result.zipPath).extractAllTo(extractDir, /* overwrite */ true)
    const websiteDir = path.join(extractDir, 'website')
    if (!fs.existsSync(websiteDir)) {
      throw new Error('Generated output has no website/ directory — cannot render preview')
    }
    const html = await renderWebsiteDir(websiteDir)
    // When the lead gave no real service areas, the site shows "Nearby City N"
    // placeholders — flag that in the preview so it reads as intentional.
    const hasRealCities = !!(config.company?.nearbyCities && config.company.nearbyCities.length)
    let finalHtml = hasRealCities ? html : injectPlaceholderDisclaimer(html)
    // Inject the "Request changes" widget so the prospect can tell us what to
    // change without leaving the preview. The widget reads the intake id from
    // window.location.pathname (the preview is served at
    // /api/v1/factory/public/intake/:id/preview), so we don't need to thread
    // the id through here.
    finalHtml = injectFeedbackWidget(finalHtml)
    return { html: finalHtml, slug: result.slug, buildId: result.buildId }
  } finally {
    // Disposable by design — preview artifacts must never accumulate.
    fs.rmSync(extractDir, { recursive: true, force: true })
    fs.rmSync(result.zipPath, { force: true })
  }
}

/**
 * Mirrors server-static.ts renderPage() for the `/` route: render home.ejs,
 * wrap it in base.ejs with the same locals, then inline assets.
 */
async function renderWebsiteDir(websiteDir: string): Promise<string> {
  const dataDir = path.join(websiteDir, 'data')
  const viewsDir = path.join(websiteDir, 'views')

  const loadJSON = (file: string, fallback: any) => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) }
    catch { return fallback }
  }

  const settings = loadJSON('settings.json', {})
  const navConfig = loadJSON('nav-config.json', {})
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items
    : Array.isArray(navConfig) ? navConfig : []

  // JSON-LD defensive escapers — mirror the template's server-static.ts so
  // structured-data blocks render the same way offline as they do live.
  const _jsonStr = (v: any) => JSON.stringify(v == null ? '' : String(v))
  const _plainDesc = (html: any, max = 300) => String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&(#x27|#39|apos);/gi, "'")
    .replace(/&(quot|#34);/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, max)

  // CSS-background helper used by service.ejs/home.ejs hero (Claflin 3.9).
  // Previews don't carry image-meta.json so no WebP companion exists; always
  // returns the plain url() form, matching the no-WebP branch of the real
  // bgWithWebp in each template's server-static.ts.
  const bgWithWebp = (imgUrl: string) => (imgUrl && typeof imgUrl === 'string') ? `url('${imgUrl}')` : ''

  const shared: Record<string, any> = {
    settings,
    menuItems,
    BASE_URL: '',
    hasVisualizer: false,
    hasEstimator: false,
    _jsonStr,
    _plainDesc,
    bgWithWebp,
    homepage: loadJSON('homepage.json', {}),
    services: loadJSON('services.json', []),
    testimonials: loadJSON('testimonials.json', []),
    title: settings.seoTitle || settings.companyName || settings.title || 'Website Preview',
    description: settings.seoDescription || 'Professional services',
    canonicalUrl: '',
  }

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), shared) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { ...shared, body }) as string

  // Scroll-reveal sections start at opacity:0 and only appear once JS fires on
  // scroll. In a static preview that can make sections (e.g. Services) look
  // empty, so force all reveal content visible.
  const safety = '<style>.animate-on-scroll{opacity:1 !important;transform:none !important}</style>'
  const withSafety = html.includes('</head>') ? html.replace('</head>', safety + '</head>') : safety + html

  return inlineAssets(withSafety, websiteDir)
}

/**
 * Inline local stylesheets and scripts (served at /styles/* and /scripts/* from
 * the template's build/ dir) so the HTML is one portable file. External URLs
 * (the Google Fonts CDN) are left untouched.
 */
function inlineAssets(html: string, websiteDir: string): string {
  const buildDir = path.join(websiteDir, 'build')

  const readBuildFile = (urlPath: string): string | null => {
    const clean = urlPath.split('?')[0].split('#')[0].replace(/^\//, '')
    const filePath = path.resolve(buildDir, clean)
    if (!filePath.startsWith(buildDir)) return null // guard against path traversal
    try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
  }

  // <link rel="stylesheet" href="/styles/x.css"> → <style>…</style>
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i)
    if (!m || !m[1].startsWith('/')) return tag
    const css = readBuildFile(m[1])
    return css != null ? `<style>\n${css}\n</style>` : tag
  })

  // <script src="/scripts/main.js"></script> → <script>…</script>
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi, (tag, src) => {
    if (typeof src !== 'string' || !src.startsWith('/')) return tag
    const js = readBuildFile(src)
    return js != null ? `<script>\n${js}\n</script>` : tag
  })

  return html
}

/**
 * Append a floating "Request changes" widget to <body>. The widget is the
 * customer-facing half of the show-first iteration loop: prospect opens
 * preview, taps the floating button, writes what they want changed, submits.
 * Backend route is POST /api/v1/factory/public/intake/:id/feedback —
 * the widget derives :id from window.location.pathname.
 *
 * Everything inline so the saved preview_html stays self-contained.
 */
function injectFeedbackWidget(html: string): string {
  const widget = `
<style data-preview-widget>
  #__preview_fab{position:fixed;bottom:20px;right:20px;z-index:2147483646;background:#111827;color:#fff;border:none;border-radius:999px;padding:14px 20px;font:600 14px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;align-items:center;gap:8px}
  #__preview_fab:hover{background:#1f2937}
  #__preview_modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483647;display:none;align-items:flex-end;justify-content:center;padding:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
  #__preview_modal.open{display:flex}
  #__preview_card{background:#fff;border-radius:14px 14px 0 0;width:100%;max-width:520px;padding:24px;box-shadow:0 -10px 40px rgba(0,0,0,.2);max-height:90vh;overflow:auto}
  @media (min-width:640px){#__preview_modal{align-items:center;padding:20px}#__preview_card{border-radius:14px}}
  #__preview_card h3{margin:0 0 6px;font:600 18px/1.3 system-ui;color:#0f172a}
  #__preview_card p.__hint{margin:0 0 18px;color:#475569;font-size:13px;line-height:1.5}
  #__preview_card label{display:block;font:600 12px/1 system-ui;color:#0f172a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
  #__preview_card textarea,#__preview_card input{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;outline:none}
  #__preview_card textarea{min-height:140px;resize:vertical}
  #__preview_card textarea:focus,#__preview_card input:focus{border-color:#111827;box-shadow:0 0 0 3px rgba(17,24,39,.12)}
  #__preview_card .__row{margin-bottom:14px}
  #__preview_card .__actions{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
  #__preview_card button{font:600 14px/1 system-ui;padding:10px 16px;border-radius:8px;border:none;cursor:pointer}
  #__preview_card button.__cancel{background:transparent;color:#475569}
  #__preview_card button.__send{background:#111827;color:#fff}
  #__preview_card button.__send:disabled{background:#94a3b8;cursor:not-allowed}
  #__preview_status{margin-top:10px;font-size:13px;min-height:18px}
  #__preview_status.__ok{color:#15803d}
  #__preview_status.__err{color:#b91c1c}
</style>
<button id="__preview_fab" type="button" aria-label="Request changes to this preview">
  <span aria-hidden="true" style="display:inline-block;width:6px;height:6px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)"></span>
  Request changes
</button>
<div id="__preview_modal" role="dialog" aria-modal="true" aria-labelledby="__preview_title">
  <div id="__preview_card">
    <h3 id="__preview_title">What should we change?</h3>
    <p class="__hint">Tell us what you'd like different — copy, colors, layout, services, anything. We'll update this preview within one business day.</p>
    <form id="__preview_form">
      <div class="__row">
        <label for="__preview_msg">Changes you want</label>
        <textarea id="__preview_msg" name="message" required minlength="4" maxlength="5000" placeholder="e.g. Make the green darker, drop the third service, add a photo of the team on the about section…"></textarea>
      </div>
      <div class="__row">
        <label for="__preview_email">Email (optional, so we can reply)</label>
        <input id="__preview_email" name="contactEmail" type="email" autocomplete="email" placeholder="you@yourcompany.com">
      </div>
      <div class="__actions">
        <button type="button" class="__cancel" id="__preview_cancel">Cancel</button>
        <button type="submit" class="__send" id="__preview_send">Send</button>
      </div>
      <div id="__preview_status" role="status" aria-live="polite"></div>
    </form>
  </div>
</div>
<script data-preview-widget>
(function(){
  function $(id){return document.getElementById(id)}
  var fab=$('__preview_fab'),modal=$('__preview_modal'),cancel=$('__preview_cancel'),form=$('__preview_form'),send=$('__preview_send'),status=$('__preview_status'),msg=$('__preview_msg'),email=$('__preview_email');
  function open(){modal.classList.add('open');setTimeout(function(){msg.focus()},50)}
  function close(){modal.classList.remove('open');status.textContent='';status.className=''}
  fab.addEventListener('click',open);
  cancel.addEventListener('click',close);
  modal.addEventListener('click',function(e){if(e.target===modal)close()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('open'))close()});
  // Pull the intake id from the URL: /api/v1/factory/public/intake/:id/preview
  var idMatch=(location.pathname||'').match(/\\/public\\/intake\\/([0-9a-f-]{36})\\/preview/i);
  form.addEventListener('submit',function(e){
    e.preventDefault();
    if(!idMatch){status.textContent='Could not detect this preview\\u2019s id. Try the link your contact sent you.';status.className='__err';return}
    if(!msg.value.trim()){return}
    send.disabled=true;status.textContent='Sending\\u2026';status.className='';
    fetch('/api/v1/factory/public/intake/'+idMatch[1]+'/feedback',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg.value,contactEmail:email.value||undefined})
    }).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(o){
      send.disabled=false;
      if(o.ok){
        status.textContent=(o.j&&o.j.message)||"Got it. We\\u2019ll be in touch.";
        status.className='__ok';
        msg.value='';
        setTimeout(close,1800);
      }else{
        status.textContent=(o.j&&o.j.error)||'Something went wrong. Try again or email hello@twomiah.com.';
        status.className='__err';
      }
    }).catch(function(){send.disabled=false;status.textContent='Network error. Try again or email hello@twomiah.com.';status.className='__err'});
  });
})();
</script>`
  const closeBodyMatch = html.match(/<\/body>/i)
  if (!closeBodyMatch) return html + widget
  return html.replace(closeBodyMatch[0], widget + '\n' + closeBodyMatch[0])
}

/**
 * Prepend a banner to <body> noting the service-area cities are placeholders.
 * Only used when the lead supplied no real "areas you serve" list.
 */
function injectPlaceholderDisclaimer(html: string): string {
  const banner =
    '<div data-preview-disclaimer style="background:#fef3c7;color:#92400e;' +
    'font:600 13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 16px;' +
    'text-align:center;border-bottom:1px solid #f59e0b">' +
    'Preview note: the service-area cities below (&ldquo;Nearby City 1&rdquo;, etc.) are ' +
    'placeholders &mdash; your real local cities will appear here once added.' +
    '</div>'
  const m = html.match(/<body\b[^>]*>/i)
  if (!m) return banner + html
  return html.replace(m[0], m[0] + '\n' + banner)
}
