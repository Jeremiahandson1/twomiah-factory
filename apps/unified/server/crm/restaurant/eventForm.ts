// The event enquiry form on the web: rooms to choose from and a form per campaign (restaurant-bar parity #4; Tripleseat's lead form
// and its campaign forms). Behind 'event_form_campaigns' (not ready), gated on both sides: these routes by the registry, the
// screens and the website's room picker by the same switch.
//
//   venue   /api/event-campaigns        the venue's campaigns: a name, the lead source every enquiry through it is tagged with, and the
//                                       link and embed code (read: contacts:read, write: settings:update — what the proposal terms ask)
//   public  /api/event-form/rooms       the live rooms with their capacity, and for a date (and hours) whether each LOOKS free. Reading it
//                                       takes no hold and no waitlist place: an enquiry holds nothing.
//   public  /api/event-form/embed.js    the script a venue's other website loads to show a campaign's form in a frame
//   public  /api/event-form/<token>     the campaign's form as a page (the link), also what the frame shows
//
// The form posts to the website's own enquiry door (/api/leads, server/site/enquiryHandler.ts), so it keeps that door's limits,
// honeypot and "text me" consent; the campaign's token and the room ride in it and core/enquiry.ts reads them (eventEnquiry.ts formExtras).
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { and, asc, count, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { company, event, eventFormCampaign } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { EMBED_CSP } from '../../http/guards.ts'
import { escHtml } from '../../site/render.ts'
import { EVENT_SOURCES, sourceRefusal } from './eventSources.ts'
import { roomsForForm } from './eventSpaces.ts'
import { venueToday } from './eventBooking.ts'

const MAX_NAME = 80
export const campaignPath = (token: string) => `/api/event-form/${token}`
export const EMBED_SCRIPT_PATH = '/api/event-form/embed.js'
const sourceLabel = (id: string) => EVENT_SOURCES.find((s) => s.id === id)?.label || id

export function createEventCampaignRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const view = (r: any, enquiries: number) => ({
    id: r.id, name: r.name, source: r.source, sourceLabel: sourceLabel(r.source), active: r.active, token: r.token,
    path: campaignPath(r.token), embedScriptPath: EMBED_SCRIPT_PATH, enquiries,
  })

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select().from(eventFormCampaign).where(eq(eventFormCampaign.companyId, u.companyId)).orderBy(asc(eventFormCampaign.name))
    const counts = await db.select({ id: event.campaignId, n: count() }).from(event).where(eq(event.companyId, u.companyId)).groupBy(event.campaignId)
    const by = new Map<string, number>(counts.filter((x: any) => x.id).map((x: any) => [x.id, Number(x.n)]))
    return listAll(c, rows.map((r: any) => view(r, by.get(r.id) || 0)))
  })

  /** A campaign's name and source, checked; returns the first problem as a sentence. */
  const problem = (b: any, creating: boolean): string | null => {
    if (creating || 'name' in b) {
      if (typeof b.name !== 'string' || !b.name.trim()) return 'Give the campaign a name.'
      if (b.name.trim().length > MAX_NAME) return `A campaign name is ${MAX_NAME} characters or fewer.`
    }
    if (creating || 'source' in b) {
      if (typeof b.source !== 'string' || !b.source) return 'Choose the lead source every enquiry through this form is tagged with.'
      const bad = sourceRefusal(b.source)
      if (bad) return bad
    }
    if ('active' in b && typeof b.active !== 'boolean') return 'active must be true or false.'
    return null
  }

  app.post('/', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const bad = problem(b, true)
    if (bad) return fail(c, 400, bad)
    const [row] = await db.insert(eventFormCampaign).values({
      id: createId(), name: b.name.trim(), source: b.source, token: crypto.randomBytes(12).toString('hex'), companyId: u.companyId,
    }).returning()
    await audit.log({ action: 'create', entity: 'event_form_campaign', entityId: row.id, entityName: row.name, metadata: row, req: { user: u } })
    return one(c, view(row, 0), 201)
  })

  app.put('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(eventFormCampaign).where(and(eq(eventFormCampaign.id, c.req.param('id')), eq(eventFormCampaign.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Campaign not found')
    const bad = problem(b, false)
    if (bad) return fail(c, 400, bad)
    const set: any = { updatedAt: new Date() }
    if ('name' in b) set.name = b.name.trim()
    if ('source' in b) set.source = b.source
    if ('active' in b) set.active = b.active
    const [row] = await db.update(eventFormCampaign).set(set).where(eq(eventFormCampaign.id, existing.id)).returning()
    await audit.log({ action: 'update', entity: 'event_form_campaign', entityId: row.id, entityName: row.name, changes: audit.diff(existing, row), req: { user: u } })
    const [n] = await db.select({ n: count() }).from(event).where(eq(event.campaignId, row.id))
    return one(c, view(row, Number(n?.n || 0)))
  })

  // Deleting a campaign stops its link and embed; the enquiries it brought keep their lead source (only the campaign tie is dropped).
  app.delete('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const [existing] = await db.select().from(eventFormCampaign).where(and(eq(eventFormCampaign.id, c.req.param('id')), eq(eventFormCampaign.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Campaign not found')
    await db.delete(eventFormCampaign).where(eq(eventFormCampaign.id, existing.id))
    await audit.log({ action: 'delete', entity: 'event_form_campaign', entityId: existing.id, entityName: existing.name, metadata: existing, req: { user: u } })
    return one(c, view(existing, 0))
  })

  return app
}

// ── The public side ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** This tenant's one business (SPEC §2: one company per tenant database). */
async function theCompany(db: any): Promise<{ id: string; name: string } | null> {
  const [co] = await db.select({ id: company.id, name: company.name }).from(company).orderBy(asc(company.createdAt)).limit(1)
  return co ?? null
}

/** The script a venue's other website loads: it frames the campaign's form and sizes the frame to the page inside. */
const EMBED_JS = `(function () {
  var script = document.currentScript;
  var origin = '';
  try { origin = script && script.src ? new URL(script.src).origin : ''; } catch (e) { origin = ''; }
  function init() {
    var holders = document.querySelectorAll('.twomiah-event-form');
    Array.prototype.forEach.call(holders, function (holder) {
      if (holder.getAttribute('data-twomiah-ready')) return;
      var o = '';
      try { o = new URL(holder.getAttribute('data-site') || origin).origin; } catch (e) { return; }
      if (!/^https:\\/\\//.test(o) && !/^http:\\/\\/localhost(:\\d+)?$/.test(o)) return;
      var token = (holder.getAttribute('data-campaign') || '').replace(/[^0-9a-f]/g, '');
      if (!token) return;
      holder.setAttribute('data-twomiah-ready', '1');
      var frame = document.createElement('iframe');
      frame.src = o + '/api/event-form/' + token + '?embed=1';
      frame.title = 'Ask about an event';
      frame.style.cssText = 'width:100%;border:0;display:block;min-height:640px;';
      frame.setAttribute('loading', 'lazy');
      holder.appendChild(frame);
      window.addEventListener('message', function (ev) {
        if (ev.source !== frame.contentWindow || ev.origin !== o) return;
        var m = ev.data;
        if (!m || typeof m !== 'object' || m.type !== 'twomiah-event-form-height') return;
        var h = parseInt(m.height, 10);
        if (h > 0 && h < 20000) frame.style.height = h + 'px';
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
`

/** The page script: looks at the rooms for the date as it is typed, posts the form, says thanks in place, tells a framing page its height. */
const PAGE_JS = `(function () {
  var form = document.getElementById('ef'), note = document.getElementById('room-note'), room = document.getElementById('room'), msg = document.getElementById('msg');
  var t = document.getElementById('t'); if (t) t.value = String(Date.now());
  function height() { try { if (window.parent !== window) window.parent.postMessage({ type: 'twomiah-event-form-height', height: document.documentElement.scrollHeight }, '*'); } catch (e) {} }
  var dateEl = form.elements[form.getAttribute('data-date-field')], sizeEl = form.elements[form.getAttribute('data-size-field')];
  var pending = 0;
  function look() {
    if (!room) return;
    var q = '?date=' + encodeURIComponent(dateEl.value || '') + '&startTime=' + encodeURIComponent(form.elements.startTime.value || '') + '&endTime=' + encodeURIComponent(form.elements.endTime.value || '') + '&guests=' + encodeURIComponent(sizeEl.value || '');
    var mine = ++pending;
    fetch('/api/event-form/rooms' + q, { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || mine !== pending) return;
      var chosen = room.value;
      Array.prototype.forEach.call(room.options, function (o) {
        var r = j.data.filter(function (x) { return x.id === o.value; })[0];
        if (!r) return;
        var tail = r.looksFree === true ? ' \\u2014 looks free' : r.looksFree === false ? ' \\u2014 looks taken' : '';
        o.textContent = o.getAttribute('data-base') + tail + (r.fits === false ? ' (smaller than your group)' : '');
      });
      var pick = j.data.filter(function (x) { return x.id === chosen; })[0];
      if (!chosen) note.textContent = '';
      else if (pick && pick.looksFree === true) note.textContent = 'That room looks free on that day. Nothing is held for you until we confirm it with you.';
      else if (pick && pick.looksFree === false) note.textContent = 'That room looks taken at that time. You can still send your request, choose another room or another day, and we will get back to you.';
      else note.textContent = 'Choose a date and we will show whether the room looks free.';
      height();
    }).catch(function () {});
  }
  ['change', 'input'].forEach(function (ev) { [dateEl, sizeEl, form.elements.startTime, form.elements.endTime, room].forEach(function (el) { if (el) el.addEventListener(ev, look); }); });
  look(); height();
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {}; new FormData(form).forEach(function (v, k) { body[k] = String(v); });
    if (room && room.selectedIndex > 0) body.room = room.options[room.selectedIndex].getAttribute('data-base') || '';
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        msg.hidden = false; msg.className = x.ok ? 'ok' : 'bad';
        msg.textContent = x.ok ? (x.j.message || 'Thanks. We will be in touch soon.') : (x.j.error || 'That did not go through. Please try again.');
        if (x.ok) form.reset(); btn.disabled = false; height();
      }).catch(function () { msg.hidden = false; msg.className = 'bad'; msg.textContent = 'That did not go through. Please try again.'; btn.disabled = false; height(); });
  });
})();
`

const CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;background:#fff}main{max-width:40rem;margin:0 auto;padding:1rem}h1{font-size:1.4rem;margin:.2rem 0 1rem}
label{display:block;font-size:.9rem;font-weight:600;margin:.8rem 0 .25rem}input,select,textarea{width:100%;padding:.55rem .6rem;border:1px solid #bbb;border-radius:8px;font:inherit;background:#fff;color:inherit}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}@media(max-width:30rem){.row{grid-template-columns:1fr}}.hp{position:absolute;left:-9999px}
button{margin-top:1rem;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#c2410c;color:#fff;font:inherit;font-weight:600;cursor:pointer}button[disabled]{opacity:.6}
#room-note{font-size:.85rem;color:#444;margin:.3rem 0 0;min-height:1.2em}#msg{margin-top:1rem;padding:.7rem .9rem;border-radius:8px}#msg.ok{background:#e8f5e9;color:#14532d}#msg.bad{background:#fdecea;color:#7f1d1d}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}input,select,textarea{background:#1c1c1c;border-color:#555}#room-note{color:#bbb}#msg.ok{background:#14301c;color:#bbf7d0}#msg.bad{background:#3a1515;color:#fecaca}}`

export interface FormPage { venue: string; campaign: { token: string; name: string }; kind: 'events' | 'bar'; rooms: Awaited<ReturnType<typeof roomsForForm>>; today: string }

/** The campaign's form as a page: the restaurant's catering fields, or the bar's party fields. Works without script (a plain post). */
export function formPage(p: FormPage): string {
  const e = escHtml
  const bar = p.kind === 'bar'
  const dateField = bar ? 'requestedDate' : 'eventDate', sizeField = bar ? 'partySize' : 'headcount'
  const roomSelect = p.rooms.length ? `<label for="room">Room you would like</label>
<select id="room" name="spaceId"><option value="" data-base="">No preference</option>${p.rooms.map((r) => {
    const cap = [r.seatedCapacity ? `seats ${r.seatedCapacity}` : '', r.standingCapacity ? `standing ${r.standingCapacity}` : ''].filter(Boolean).join(', ')
    const base = r.name + (cap ? ` (${cap})` : '')
    return `<option value="${e(r.id)}" data-base="${e(base)}">${e(base)}</option>`
  }).join('')}</select><p id="room-note" aria-live="polite"></p>` : ''
  const fields = bar
    ? `<input type="hidden" name="formType" value="party">
<div class="row"><div><label for="name">Your name</label><input id="name" name="name" required autocomplete="name"></div><div><label for="phone">Phone</label><input id="phone" name="phone" type="tel" required autocomplete="tel"></div></div>
<label for="email">Email (optional)</label><input id="email" name="email" type="email" autocomplete="email">
<div class="row"><div><label for="d">Date you have in mind</label><input id="d" name="requestedDate" type="date" min="${e(p.today)}"></div><div><label for="g">How many people</label><input id="g" name="partySize" type="number" min="1" max="2000" inputmode="numeric"></div></div>
<label for="occ">What is the occasion</label><input id="occ" name="occasion" maxlength="80">`
    : `<div class="row"><div><label for="name">Your name</label><input id="name" name="name" required autocomplete="name"></div><div><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"></div></div>
<div class="row"><div><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel"></div><div><label for="d">Event date</label><input id="d" name="eventDate" type="date" required min="${e(p.today)}"></div></div>
<div class="row"><div><label for="g">Headcount</label><input id="g" name="headcount" type="number" required min="1" max="2000" inputmode="numeric"></div><div><label for="vt">Event type</label><select id="vt" name="venueType"><option>Wedding</option><option>Birthday</option><option>Corporate</option><option>Community</option><option>Other</option></select></div></div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Ask about an event at ${e(p.venue)}</title><style>${CSS}</style></head>
<body><main><h1>Ask about an event at ${e(p.venue)}</h1>
<form id="ef" method="post" action="/api/leads" data-date-field="${dateField}" data-size-field="${sizeField}">
<input type="hidden" name="campaign" value="${e(p.campaign.token)}"><input type="hidden" name="source" value="${e('Event form — ' + p.campaign.name)}"><input type="hidden" name="t" id="t" value="${Date.now()}">
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
${fields}
<div class="row"><div><label for="st">Start time (optional)</label><input id="st" name="startTime" type="time"></div><div><label for="et">End time (optional)</label><input id="et" name="endTime" type="time"></div></div>
${roomSelect}
<label for="m">Anything else we should know</label><textarea id="m" name="${bar ? 'message' : 'notes'}" rows="4"></textarea>
<button type="submit">Send my request</button><p id="msg" role="status" hidden></p></form></main>
<script>${PAGE_JS}</script></body></html>`
}

export function createEventFormPublicRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()

  // The rooms and whether they look free. A look only: nothing is held, nobody is put on a list. No prices.
  app.get('/rooms', async (c) => {
    const co = await theCompany(db)
    if (!co) return fail(c, 404, 'Not found')
    return listAll(c, await roomsForForm(db, co.id, { date: c.req.query('date'), startTime: c.req.query('startTime'), endTime: c.req.query('endTime'), guests: c.req.query('guests') }))
  })

  app.get('/embed.js', (c) => c.body(EMBED_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }))

  app.get('/:token', async (c) => {
    const co = await theCompany(db)
    const token = c.req.param('token')
    if (!co || !/^[0-9a-f]{24}$/.test(token)) return fail(c, 404, 'Not found')
    const [camp] = await db.select().from(eventFormCampaign).where(and(eq(eventFormCampaign.companyId, co.id), eq(eventFormCampaign.token, token), eq(eventFormCampaign.active, true))).limit(1)
    if (!camp) return fail(c, 404, 'Not found')
    const html = formPage({
      venue: co.name, campaign: { token: camp.token, name: camp.name }, kind: d.settings?.websiteForms === 'bar' ? 'bar' : 'events',
      rooms: await roomsForForm(db, co.id, {}), today: await venueToday(db, co.id),
    })
    // Framed by any https page: that is what an embed is (the booking pages' policy, http/guards.ts EMBED_CSP).
    c.header('Content-Security-Policy', EMBED_CSP)
    c.header('Cache-Control', 'no-store')
    return c.html(html)
  })
  return app
}
