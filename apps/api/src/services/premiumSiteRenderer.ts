/**
 * premiumSiteRenderer â€” renders a single page of the multi-page premium
 * preview from pre-composed sections + settings.
 *
 * Distinct from previewRenderer (which runs the full generate() pipeline
 * to produce a standard-template preview). The premium preview's
 * sections are already composed by composeSite() and persisted on the
 * tenant â€” this renderer just turns them into HTML at request time.
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
// Picks the template dir for a given industry. Delegates to the central
// industryRouting helper so this file stays in sync — earlier versions
// duplicated the industry sets here and silently drifted (e.g. food_truck
// wasn't in this file's roster and was rendering through the contractor
// template, silently dropping every food-truck-specific section partial).
import { premiumWebsiteTemplateFor } from '../config/industryRouting'
export function pickPremiumTemplateDir(industry?: string | null): string {
  return path.join(TEMPLATES_ROOT, premiumWebsiteTemplateFor(industry || undefined))
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
 * hrefs with â€” for the public preview we use the route stem so nav
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
  // Anchor hrefs (`#menu`, `#schedule`) for single-page verticals are
  // passed through unprefixed; route hrefs get the preview base path.
  const nav = (settings.nav && settings.nav.length ? settings.nav : DEFAULT_NAV).map(item => ({
    label: item.label,
    href: item.href.startsWith('#')
      ? item.href
      : previewBasePath + (item.href.startsWith('/') ? item.href : '/' + item.href),
  }))
  const isOnePage = (settings as any).layoutMode === 'single-page'
  const homeHref = previewBasePath
  const contactHref = isOnePage ? '#contact' : previewBasePath + '/contact'

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
  inlined = injectFeedbackWidget(inlined)

  return { html: inlined, bytes: inlined.length }
}

function injectFeedbackWidget(html: string): string {
  // "Request changes" button paired with the "Approve & buy" CTA. Opens
  // a modal with a textarea, POSTs to /public/intake/<id>/feedback.
  // Positioned to the LEFT of the buy widget so they don't overlap.
  const widget = `
<style data-feedback-widget>
  #__fb_fab{position:fixed;bottom:20px;right:380px;z-index:2147483645;background:#fff;color:#1a2e22;border:1px solid #1a2e22;border-radius:999px;padding:14px 22px;font:600 14px/1 'Inter',system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.15)}
  #__fb_fab:hover{background:#f5f5f0;transform:translateY(-1px)}
  @media (max-width: 720px){#__fb_fab{right:20px;bottom:80px}}
  #__fb_modal{display:none;position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);align-items:center;justify-content:center;padding:20px}
  #__fb_modal.show{display:flex}
  #__fb_card{background:#fff;border-radius:16px;max-width:520px;width:100%;padding:28px 28px 22px;box-shadow:0 24px 80px rgba(0,0,0,.4);font-family:'Inter',system-ui,-apple-system,sans-serif}
  #__fb_card h2{margin:0 0 8px;font-size:20px;color:#1a1a1a}
  #__fb_card p{margin:0 0 16px;color:#666;font-size:14px;line-height:1.5}
  #__fb_textarea{width:100%;min-height:140px;padding:12px 14px;border:1px solid #d1d5db;border-radius:8px;font:14px/1.5 'Inter',system-ui,-apple-system,sans-serif;color:#1a1a1a;resize:vertical;box-sizing:border-box}
  #__fb_textarea:focus{outline:none;border-color:#1a2e22;box-shadow:0 0 0 3px rgba(26,46,34,.15)}
  #__fb_actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
  #__fb_cancel{background:transparent;color:#666;border:none;padding:10px 16px;font:600 13px/1 'Inter',sans-serif;cursor:pointer;border-radius:6px}
  #__fb_cancel:hover{background:#f5f5f5;color:#1a1a1a}
  #__fb_submit{background:#1a2e22;color:#fff;border:none;padding:10px 22px;font:700 13px/1 'Inter',sans-serif;cursor:pointer;border-radius:6px}
  #__fb_submit:hover{background:#0f1f17}
  #__fb_submit:disabled{opacity:.55;cursor:wait}
  #__fb_status{margin-top:12px;font-size:13px;display:none}
  #__fb_status.ok{display:block;color:#0f5132}
  #__fb_status.err{display:block;color:#991b1b}
</style>
<button id="__fb_fab" type="button" aria-label="Talk to our team about this preview">Something's off</button>
<div id="__fb_modal" role="dialog" aria-modal="true" aria-labelledby="__fb_h">
  <div id="__fb_card">
    <h2 id="__fb_h">Tell us what's off</h2>
    <p>Use this if the <em>direction</em> isn't right â€” wrong industry, wrong tone, missing something important. For small edits (swap a photo, tweak copy, change a service title), you'll do those yourself in a simple editor once your site is live.</p>
    <textarea id="__fb_textarea" placeholder="e.g. I'm a food truck, not a restaurant. Or: the whole tone feels too corporate for what I do. Or: there's no menu section and I really need one."></textarea>
    <div id="__fb_status"></div>
    <div id="__fb_actions">
      <button id="__fb_cancel" type="button">Cancel</button>
      <button id="__fb_submit" type="button">Send to our team</button>
    </div>
  </div>
</div>
<script data-feedback-widget>
(function(){
  var fab=document.getElementById('__fb_fab'),modal=document.getElementById('__fb_modal'),card=document.getElementById('__fb_card'),ta=document.getElementById('__fb_textarea'),sub=document.getElementById('__fb_submit'),cancel=document.getElementById('__fb_cancel'),status=document.getElementById('__fb_status');
  function getId(){var m=(location.pathname||'').match(/\\/public\\/intake\\/([0-9a-f-]{36})\\/preview-premium/i);return m?m[1]:null}
  function open(){modal.classList.add('show');setTimeout(function(){ta.focus()},50)}
  function close(){modal.classList.remove('show');status.className='';status.textContent=''}
  fab.addEventListener('click',open);
  cancel.addEventListener('click',close);
  modal.addEventListener('click',function(e){if(e.target===modal)close()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('show'))close()});
  sub.addEventListener('click',function(){
    var id=getId(); if(!id){status.className='err';status.textContent='Could not detect this preview\\u2019s id.';return}
    var msg=(ta.value||'').trim(); if(!msg){status.className='err';status.textContent='Please tell us what you\\u2019d like changed.';return}
    sub.disabled=true; sub.textContent='Sending\\u2026'; status.className=''; status.textContent='';
    fetch('/api/v1/factory/public/intake/'+id+'/feedback',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg})
    }).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(o){
      if(o.ok){status.className='ok';status.textContent=(o.j&&o.j.message)||'Got it.';ta.value='';setTimeout(close,1800)}
      else{status.className='err';status.textContent=(o.j&&o.j.error)||'Could not send. Please try again.'}
      sub.disabled=false; sub.textContent='Send to our team';
    }).catch(function(){status.className='err';status.textContent='Network error. Please try again.';sub.disabled=false;sub.textContent='Send to our team'});
  });
})();
</script>`
  const closeBodyMatch = html.match(/<\/body>/i)
  if (!closeBodyMatch) return html + widget
  return html.replace(closeBodyMatch[0], widget + '\n' + closeBodyMatch[0])
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
  Approve & build my site â€” $499 launch
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
      else{fab.disabled=false;fab.textContent='Approve & build my site \\u2014 $499 launch';showError((o.j&&o.j.error)||'Could not start checkout. Try again or email support@twomiah.com.')}
    }).catch(function(){fab.disabled=false;fab.textContent='Approve & build my site \\u2014 $499 launch';showError('Network error. Try again or email support@twomiah.com.')});
  });
})();
</script>`
  const closeBodyMatch = html.match(/<\/body>/i)
  if (!closeBodyMatch) return html + widget
  return html.replace(closeBodyMatch[0], widget + '\n' + closeBodyMatch[0])
}
