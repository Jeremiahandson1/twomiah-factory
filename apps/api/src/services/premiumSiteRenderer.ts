/**
 * premiumSiteRenderer — renders a single page of the multi-page premium
 * preview from pre-composed sections + settings.
 *
 * Distinct from previewRenderer (which runs the full generate() pipeline
 * to produce a standard-template preview). The premium preview's
 * sections are already composed by composeSite() and persisted on the
 * tenant — this renderer just turns them into HTML at request time.
 *
 * Returns a self-contained HTML page (CSS inlined) so the preview link
 * works without backend asset requests other than the page itself.
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import type { Section } from './sectionComposer'

const TEMPLATES_ROOT = path.resolve(__dirname, '../../../../templates')
const DEFAULT_TEMPLATE = 'website-premium-contractor'

// Resolve the right premium template dir for a tenant based on its
// products + industry. Mirrors the routing logic in
// services/generator.ts so previews land in the same template the deploy
// will use. Falls back to contractor when nothing matches — same behavior
// as the deploy throw, but for previews we render something rather than
// error (staff sees the wrong template instead of a 500, which is easier
// to debug).
const PREMIUM_ROOFING_INDUSTRIES = new Set([
  'roofing', 'roof', 'storm_restoration', 'siding_roofing',
])
const PREMIUM_HOMECARE_INDUSTRIES = new Set([
  'home_care', 'homecare', 'in_home_care', 'senior_care',
  'caregiving', 'companion_care',
])
const PREMIUM_DISPENSARY_INDUSTRIES = new Set([
  'dispensary', 'cannabis', 'cannabis_retail',
])
const PREMIUM_FIELDSERVICE_INDUSTRIES = new Set([
  'field_service', 'hvac', 'plumbing', 'electrical', 'appliance_repair',
  'cleaning', 'pest_control', 'locksmith', 'garage_door',
])
export function pickPremiumTemplateDir(industry?: string | null): string {
  if (industry && PREMIUM_ROOFING_INDUSTRIES.has(industry)) {
    return path.join(TEMPLATES_ROOT, 'website-premium-roofing')
  }
  if (industry && PREMIUM_HOMECARE_INDUSTRIES.has(industry)) {
    return path.join(TEMPLATES_ROOT, 'website-premium-homecare')
  }
  if (industry && PREMIUM_DISPENSARY_INDUSTRIES.has(industry)) {
    return path.join(TEMPLATES_ROOT, 'website-premium-dispensary')
  }
  if (industry && PREMIUM_FIELDSERVICE_INDUSTRIES.has(industry)) {
    return path.join(TEMPLATES_ROOT, 'website-premium-fieldservice')
  }
  return path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE)
}

export interface RenderedPage {
  html: string
  bytes: number
}

export interface PreviewSettings {
  companyName: string
  tagline?: string
  phone?: string
  email?: string
  seoTitle?: string
  seoDescription?: string
  contactCtaLabel?: string
  nav?: Array<{ label: string; href: string }>
}

export interface PageInput {
  slug: string  // 'home' | 'about' | 'services' | 'contact' | custom
  title?: string
  sections: Section[]
  metaTitle?: string
  metaDescription?: string
}

const DEFAULT_NAV: Array<{ label: string; href: string }> = [
  { label: 'Services', href: 'services' },
  { label: 'About', href: 'about' },
  { label: 'Contact', href: 'contact' },
]

/**
 * Render one page. previewBasePath is what the renderer prefixes nav
 * hrefs with — for the public preview we use the route stem so nav
 * links navigate within the preview (e.g.
 * /api/v1/factory/public/intake/:id/preview-premium/about).
 *
 * templateDir defaults to contractor for back-compat with callers that
 * pre-date the multi-industry split. New callers should pass the result
 * of pickPremiumTemplateDir(industry).
 */
export async function renderPremiumPage(
  page: PageInput,
  settings: PreviewSettings,
  previewBasePath: string,
  templateDir?: string,
): Promise<RenderedPage> {
  const resolvedDir = templateDir || path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE)
  const viewsDir = path.join(resolvedDir, 'views')
  const buildDir = path.join(resolvedDir, 'build')

  // Settings get a runtime-resolved nav + brand link aimed at this preview.
  const nav = (settings.nav && settings.nav.length ? settings.nav : DEFAULT_NAV).map(item => ({
    label: item.label,
    href: previewBasePath + (item.href.startsWith('/') ? item.href : '/' + item.href),
  }))
  const homeHref = previewBasePath
  const contactHref = previewBasePath + '/contact'

  const effectiveSettings = {
    ...settings,
    homeHref,
    contactHref,
    contactCtaLabel: settings.contactCtaLabel || 'Get in touch',
    seoTitle: page.metaTitle || settings.seoTitle || page.title || settings.companyName,
    seoDescription: page.metaDescription || settings.seoDescription || '',
    nav,
  }

  const homepage = { sections: page.sections }
  const currentPath = previewBasePath + (page.slug === 'home' ? '' : '/' + page.slug)

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings }) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, currentPath }) as string

  // Inline /styles/main.css so the preview is self-contained.
  let inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"']+)["']\s*\/?>/i, (_m, p) => {
    const cssPath = path.join(buildDir, 'styles', p)
    try { return '<style>\n' + fs.readFileSync(cssPath, 'utf8') + '\n</style>' }
    catch { return _m }
  })
  // "Approve & buy" floating CTA so the prospect can convert without
  // leaving the preview. The script extracts the intake id from
  // window.location.pathname and POSTs to .../checkout-premium, then
  // redirects to Stripe Checkout.
  inlined = injectApproveAndBuyWidget(inlined)

  return { html: inlined, bytes: inlined.length }
}

function injectApproveAndBuyWidget(html: string): string {
  const widget = `
<style data-buy-widget>
  #__buy_fab{position:fixed;bottom:20px;right:20px;z-index:2147483645;background:#1a2e22;color:#fff;border:none;border-radius:999px;padding:14px 22px;font:600 14px/1 'Inter',system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;border:2px solid #c89a4e}
  #__buy_fab:hover{background:#0f1f17;transform:translateY(-1px)}
  #__buy_fab:disabled{opacity:.6;cursor:wait}
  #__buy_dot{display:inline-block;width:7px;height:7px;border-radius:999px;background:#c89a4e;box-shadow:0 0 0 4px rgba(200,154,78,.25)}
  #__buy_status{position:fixed;bottom:88px;right:20px;z-index:2147483645;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;font:500 13px/1.4 system-ui;max-width:360px;display:none}
</style>
<button id="__buy_fab" type="button" aria-label="Approve and start checkout">
  <span id="__buy_dot" aria-hidden="true"></span>
  Approve & build my site — $499 launch
</button>
<div id="__buy_status" role="alert"></div>
<script data-buy-widget>
(function(){
  var fab=document.getElementById('__buy_fab'),status=document.getElementById('__buy_status');
  function showError(msg){status.textContent=msg;status.style.display='block';setTimeout(function(){status.style.display='none'},5000)}
  fab.addEventListener('click',function(){
    var m=(location.pathname||'').match(/\\/public\\/intake\\/([0-9a-f-]{36})\\/preview-premium/i);
    if(!m){showError('Could not detect this preview\\u2019s id. Try the link your contact sent you.');return}
    fab.disabled=true;fab.textContent='Starting checkout\\u2026';
    fetch('/api/v1/factory/public/intake/'+m[1]+'/checkout-premium',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({billingCycle:'monthly'})
    }).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(o){
      if(o.ok&&o.j&&o.j.url){location.href=o.j.url}
      else{fab.disabled=false;fab.textContent='Approve & build my site \\u2014 $499 launch';showError((o.j&&o.j.error)||'Could not start checkout. Try again or email hello@twomiah.com.')}
    }).catch(function(){fab.disabled=false;fab.textContent='Approve & build my site \\u2014 $499 launch';showError('Network error. Try again or email hello@twomiah.com.')});
  });
})();
</script>`
  const closeBodyMatch = html.match(/<\/body>/i)
  if (!closeBodyMatch) return html + widget
  return html.replace(closeBodyMatch[0], widget + '\n' + closeBodyMatch[0])
}
