import { getStore } from "@netlify/blobs";

// Edge SSR: bake the latest shared site config into the index.html response,
// so the initial paint matches the post-fetch state (no CLS, no client-side fetch needed).
// The page-side JS reads from #pp-data instead of calling /.netlify/functions/site.
export default async (request, context) => {
  const response = await context.next();
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return response;

  let data = {};
  try {
    const store = getStore("pp-site");
    data = (await store.get("config", { type: "json" })) || {};
  } catch (_) {
    // Blob unavailable — fall through with empty data; client-side defaults kick in.
  }

  let html = await response.text();

  // Every replacement below splices admin-authored config into the page. Passed as a
  // STRING, replace() would interpret $$, $&, $` , $' and $1 inside that config as
  // substitution patterns and corrupt it — a menu price of "$10" against a capturing
  // regex became "$1"+"0". lit() hands replace() a function, which takes the value
  // literally. Use it for anything carrying config data.
  const lit = (s) => () => s;

  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  html = html.replace(
    /<script type="application\/json" id="pp-data">[\s\S]*?<\/script>/,
    lit(`<script type="application/json" id="pp-data">${payload}</script>`)
  );

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Pre-render dynamic content so initial paint matches the post-JS state — eliminates CLS
  // from app.js rebuilding sections after FCP. Admin edits any of this via the manager.
  if (data.hero && data.hero.headline) {
    html = html.replace(
      /<h1 id="heroHeadline">[\s\S]*?<\/h1>/,
      lit(`<h1 id="heroHeadline">${data.hero.headline}</h1>`)
    );
  }
  if (data.hero && data.hero.tagline) {
    html = html.replace(
      /<p class="l" id="heroTagline">[\s\S]*?<\/p>/,
      lit(`<p class="l" id="heroTagline">${data.hero.tagline}</p>`)
    );
  }

  // Price guarantee band. Server-rendered so the "family of four" price claim and
  // the Meal Match numbers are in the HTML crawlers and link-preview scrapers see —
  // neither runs app.js. Admin copy is trusted HTML (<b> etc), same as hero/purpose.
  const g = data.guarantee;
  if (g && g.enabled === false) {
    html = html.replace(/<section class="guarantee" id="guarantee"(?![^>]*hidden)/, '<section class="guarantee" id="guarantee" hidden');
  } else if (g) {
    // Replacer FUNCTION, not a string: admin copy is full of prices, and in a
    // replacement string "$10" means capture-group-1 followed by "0".
    const set = (id, tag, value) => {
      if (!value) return;
      html = html.replace(
        new RegExp(`<${tag}([^>]*\\bid="${id}"[^>]*)>[\\s\\S]*?</${tag}>`),
        (_m, attrs) => `<${tag}${attrs}>${value}</${tag}>`
      );
    };
    set("gKick", "p", g.kick);
    set("gHeadline", "h2", g.headline);
    set("gLead", "p", g.lead);
    if (g.matchEnabled === false || !(g.matchTitle || g.matchBody)) {
      html = html.replace(/<div class="g-match" id="gMatch"(?![^>]*hidden)/, '<div class="g-match" id="gMatch" hidden');
    } else {
      set("gMatch", "div",
        (g.matchTitle ? `<span class="g-title">${g.matchTitle}</span>` : "") +
        (g.matchBody ? `<p>${g.matchBody}</p>` : ""));
    }
  }

  // Menu. Until this existed the crawlable HTML held the ORIGINAL hardcoded menu, so
  // Aaron's admin edits were invisible to Google and to link-preview scrapers (neither
  // runs app.js) — six of his published items appeared nowhere in the served HTML.
  // This must emit byte-identical markup to renderMenu() in app.js, or app.js's repaint
  // visibly rewrites the section. Both pass admin copy through as raw HTML (<b> etc).
  const menu = data.menu;
  if (menu && menu.enabled === false) {
    html = html.replace(/<section class="menu" id="menu"(?![^>]*hidden)/, '<section class="menu" id="menu" hidden');
  } else if (menu && (Array.isArray(menu.categories) || Array.isArray(menu.pillSections))) {
    const v = (x) => (x == null ? "" : String(x));
    // Chip Challenge request button — same string as CHIP_BTN in app.js renderMenu().
    const CHIP_BTN = `<button type="button" class="chip-req" data-chip>\u{1F525} Request a challenge date</button>`;
    const CHIP_THUMB = `<button type="button" class="chip-thumb" data-chip aria-label="See the Chip Challenge poster and request a date"><img src="img/chip-challenge-320.webp" alt="" width="88" height="88" loading="lazy" decoding="async"></button>`;
    const isChip = (it) => /chip[\s-]*challenge/i.test(it.name || "");
    const pill = (p) => {
      const o = typeof p === "string" ? { name: p, desc: "", fire: false } : (p || {});
      return `<span class="${"pill" + (o.fire ? " fire" : "")}">${v(o.name)}` +
        (o.desc ? `<span class="x">${v(o.desc)}</span>` : "") + `</span>`;
    };
    const leftCols = (menu.categories || []).map((c) => {
      const subLine = (c.sub || c.priceHead)
        ? ` <small><span>${v(c.sub)}</span>` + (c.priceHead ? `<span class="mph">${v(c.priceHead)}</span>` : "") + `</small>`
        : "";
      return `<div class="mcat">${v(c.name)}${subLine}</div>` +
        (c.items || []).map((it) =>
          `<div class="mi${isChip(it) ? " chip-card" : ""}">` + (isChip(it) ? CHIP_THUMB : "") +
          `<span class="n">${v(it.name)}` +
          (it.desc ? `<span class="d">${v(it.desc)}</span>` : "") +
          (isChip(it) ? CHIP_BTN : "") +
          `</span><span class="p">${v(it.price)}</span></div>`).join("");
    }).join("");
    const pillCols = (menu.pillSections || []).map((s) =>
      `<div class="mcat">${v(s.title)}` + (s.sub ? ` <small>${v(s.sub)}</small>` : "") + `</div>` +
      `<div class="pills">${(s.items || []).map(pill).join("")}</div>`).join("");
    const inner = `<div>` +
      `<p class="kick">${v(menu.kick)}</p>` +
      `<h2 class="sec">${v(menu.headline)}</h2>` +
      `<p class="sub">${v(menu.sub)}</p></div>` +
      `<div class="mcols"><div>${leftCols}</div>` +
      `<div>${pillCols}` + (menu.note ? `<p class="note" style="margin-top:14px">${v(menu.note)}</p>` : "") + `</div></div>`;
    // Non-greedy to the first </div> that closes out the section — menuWrap's own.
    // Replacer FUNCTION: menu prices like "$10" would otherwise be read as $1 + "0".
    html = html.replace(
      /<div class="wrap" id="menuWrap">[\s\S]*?<\/div>(\s*)<\/section>/,
      (_m, ws) => `<div class="wrap" id="menuWrap">${inner}</div>${ws}</section>`
    );
  }

  // Thank-You wall. Only when Aaron has saved a list; otherwise index.html's built-in
  // tiles stand. Must match partnerTile() in app.js byte for byte.
  if (Array.isArray(data.partners) && data.partners.length) {
    const tile = (p) => {
      const name = esc(p.name || "");
      const inner = p.logo ? `<img loading="lazy" decoding="async" src="${esc(p.logo)}" alt="${name}">` : name;
      const cls = "partner-tile" + (p.logo ? "" : " missing");
      return p.url
        ? `<a class="${cls}" href="${esc(p.url)}" target="_blank" rel="noopener" title="${name}">${inner}</a>`
        : `<div class="${cls}">${inner}</div>`;
    };
    const tiles = data.partners.map(tile).join("");
    // Grid close + wrap close + section close marks the end, so tiles that are <div>s
    // (no link) can't end the match early.
    html = html.replace(
      /<div class="partners-grid" id="partnersGrid">[\s\S]*?<\/div>(\s*<\/div>\s*<\/section>)/,
      (_m, tail) => `<div class="partners-grid" id="partnersGrid">${tiles}</div>${tail}`
    );
  }

  // Sync the ticker. If API ticker is empty or disabled, hide the static ticker.
  if (data.tickerEnabled === false || !Array.isArray(data.ticker) || data.ticker.length === 0) {
    html = html.replace(
      /<div class="ticker" id="ticker"(?![^>]*hidden)/,
      '<div class="ticker" id="ticker" hidden'
    );
  } else {
    const items = data.ticker.map(s => `<span>${esc(s)}</span>`).join('');
    html = html.replace(
      /<div class="ticker" id="ticker"[^>]*><div>[\s\S]*?<\/div><\/div>/,
      lit(`<div class="ticker" id="ticker"><div>${items}${items}</div></div>`)
    );
  }

  // Today bar, resolved from the schedule. Manual "Today's Spot" wins when it's on;
  // otherwise this derives the answer from the events Aaron already maintains, so the
  // most-asked question ("where are you today?") stops depending on him flipping a
  // toggle mid-service. MUST match resolveTodaySpot()/todayBarHtml() in app.js —
  // a test renders the page and diffs the SSR markup against app.js's repaint.
  {
    const ctNowMin = () => {
      const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date()).split(":");
      return ((+hm[0]) % 24) * 60 + (+hm[1]);
    };
    const ctToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const CLOSED = /closed/i;
    const parseClock = (s) => {
      const m = String(s || "").match(/(\d{1,2})(?::(\d{2}))?\s*([ap])/i);
      if (!m) return null;
      let h = (+m[1]) % 12;
      if (/p/i.test(m[3])) h += 12;
      return h * 60 + (m[2] ? +m[2] : 0);
    };
    const parseRange = (s) => {
      const p = String(s || "").split(/[–—-]/);
      return { start: parseClock(p[0]), end: p.length > 1 ? parseClock(p[1]) : null };
    };
    const pad2 = (n) => String(n).padStart(2, "0");
    const daysUntil = (iso) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
      const t = ctToday().split("-"), p = iso.split("-");
      return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t[0], t[1] - 1, t[2])) / 864e5);
    };
    const whenLabel = (iso) => {
      const n = daysUntil(iso);
      if (n === 0) return "today";
      if (n === 1) return "tomorrow";
      const p = String(iso).split("-"), dt = new Date(p[0], p[1] - 1, p[2]);
      if (n != null && n < 7) return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dt.getDay()];
      return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()] + " " + dt.getDate();
    };
    const countdown = (closeAt) => {
      if (!/^\d{1,2}:\d{2}$/.test(closeAt || "")) return "";
      const diff = (+closeAt.split(":")[0]) * 60 + (+closeAt.split(":")[1]) - ctNowMin();
      if (diff <= 0) return "closed for today";
      if (diff < 60) return `closes in ${diff} min`;
      const h = Math.floor(diff / 60), m = diff % 60;
      return `closes in ${h}h${m ? " " + m + "m" : ""}`;
    };
    const resolve = () => {
      const t = data.today;
      // Venue NAME for display, street address for the map link — mirrors app.js.
      const label = (e) => (e.t || "").trim() || (e.loc || "").trim();
      const mapQ  = (e) => (e.loc || "").trim() || (e.t || "").trim();
      if (t && t.live && t.loc) return { mode: "manual", loc: t.loc, mapQ: t.loc, hours: t.hours, closeAt: t.closeAt, note: t.note };
      const evs = (data.events || []).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.iso || ""));
      if (!evs.length) return null;
      const today = ctToday(), now = ctNowMin();
      const mine = evs.filter(e => e.iso === today);
      const open = mine.filter(e => !CLOSED.test(e.t || ""))
        .sort((a, b) => (parseRange(a.time).start || 0) - (parseRange(b.time).start || 0));
      for (const e of open) {
        const r = parseRange(e.time);
        if (r.start != null && r.end != null && now >= r.start && now < r.end)
          return { mode: "open", loc: label(e), mapQ: mapQ(e), hours: e.time, closeAt: pad2(Math.floor(r.end / 60)) + ":" + pad2(r.end % 60), iso: today };
      }
      for (const e of open) {
        const r = parseRange(e.time);
        if (r.start != null && now < r.start) return { mode: "later", loc: label(e), mapQ: mapQ(e), hours: e.time, iso: today };
      }
      const nextUp = evs.filter(e => e.iso > today && !CLOSED.test(e.t || ""))
        .sort((a, b) => a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : (parseRange(a.time).start || 0) - (parseRange(b.time).start || 0))[0];
      if (mine.length && open.length === 0)
        return { mode: "closed", loc: nextUp && label(nextUp), mapQ: nextUp && mapQ(nextUp), hours: nextUp && nextUp.time, iso: nextUp && nextUp.iso };
      if (nextUp) return { mode: "next", loc: label(nextUp), mapQ: mapQ(nextUp), hours: nextUp.time, iso: nextUp.iso };
      return null;
    };
    // A GPS check-in is trusted only on the same Central-time day and within a bounded
    // window, so a forgotten "We're here" can't strand yesterday's pin. Mirrors app.js.
    const COORDS_MAX_HOURS = 14;
    const freshCoords = () => {
      const c = data.today && data.today.coords;
      if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") return null;
      const at = Date.parse(c.at);
      if (!at) return null;
      if ((Date.now() - at) / 36e5 > COORDS_MAX_HOURS) return null;
      const ctOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms));
      if (ctOf(at) !== ctOf(Date.now())) return null;
      return c;
    };

    const s = resolve();
    if (s) s.coords = freshCoords();
    if (s && s.loc) {
      // Fresh check-in pins the exact spot; otherwise search the address.
      const mapHref = `https://www.google.com/maps/search/?api=1&query=${
        s.coords ? encodeURIComponent(s.coords.lat + "," + s.coords.lng) : encodeURIComponent(s.mapQ || s.loc)}`;
      const lead = s.mode === "closed" ? `<b>CLOSED TODAY</b> — next up ${esc(whenLabel(s.iso))}: `
                 : s.mode === "next"   ? `<b>NEXT UP</b> ${esc(whenLabel(s.iso))}: `
                 : `<b>TODAY:</b> `;
      const closeTxt = (s.mode === "open" || s.mode === "manual") ? countdown(s.closeAt) : "";
      const inner = `<a class="todaybar-map" href="${mapHref}" target="_blank" rel="noopener" aria-label="Open in maps"><span class="pin">\u{1F4CD}</span>${lead}${esc(s.loc)}</a>${s.hours ? ' · ' + esc(s.hours) : ''}${closeTxt ? ` · <span class="tb-close" id="tbClose" data-close="${esc(s.closeAt || '')}">${esc(closeTxt)}</span>` : ''}${s.note ? ' — ' + esc(s.note) : ''} <a href="#events">Full schedule →</a>`;
      html = html.replace(
        /<div class="todaybar" id="todayBar"[^>]*><\/div>/,
        lit(`<div class="todaybar" id="todayBar">${inner}</div>`)
      );
    }
  }

  // Sync the Today's Toppings strip — same markup app.js renders, so no CLS.
  const dt = data.dailyToppings;
  if (dt && dt.enabled && Array.isArray(dt.items) && dt.items.length) {
    const pills = dt.items.map((x, i) => `<span class="tp" style="animation-delay:${i * 90}ms">${esc(x)}</span>`).join("");
    html = html.replace(
      /<div class="toppingsbar" id="toppingsBar"[^>]*><\/div>/,
      lit(`<div class="toppingsbar" id="toppingsBar"><b>\u{1F954} TODAY’S TOPPINGS</b>${pills}</div>`)
    );
  }

  // --- SEO: structured data kept in sync with the admin-managed config ---

  // Keep the business block's sameAs list matching the configured social links.
  const soc = data.socialLinks || {};
  const sameAs = ["facebook", "instagram", "tiktok", "snapchat", "youtube"]
    .map(k => soc[k]).filter(u => u && /^https?:/.test(u));
  if (sameAs.length) {
    html = html.replace(/"sameAs":\s*\[[^\]]*\]/, lit(`"sameAs": ${JSON.stringify(sameAs)}`));
  }

  // Upcoming schedule as schema.org Events (skips past dates and "Trailer Closed" rows).
  const ctOffset = (iso) => {
    try {
      const s = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "longOffset" })
        .format(new Date(iso + "T12:00:00Z"));
      const m = s.match(/GMT([+-]\d{2}:\d{2})/);
      return m ? m[1] : "-05:00";
    } catch { return "-05:00"; }
  };
  const parseTimes = (str) => {
    const out = []; const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi; let m;
    while ((m = re.exec(str || "")) && out.length < 2) {
      let h = +m[1] % 12; if (m[3].toLowerCase() === "pm") h += 12;
      out.push(String(h).padStart(2, "0") + ":" + (m[2] || "00"));
    }
    return out;
  };
  const todayCT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const evGraph = (Array.isArray(data.events) ? data.events : [])
    .filter(e => e && e.t && e.iso && /^\d{4}-\d{2}-\d{2}$/.test(e.iso) && e.iso >= todayCT && !/closed/i.test(e.t))
    .slice(0, 25)
    .map(e => {
      const [st, en] = parseTimes(e.time);
      const off = ctOffset(e.iso);
      const ev = {
        "@type": "Event",
        "name": "Potato-Potahto at " + e.t,
        "startDate": st ? `${e.iso}T${st}:00${off}` : e.iso,
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "eventStatus": "https://schema.org/EventScheduled",
        "image": "https://potato-potahto.com/pp-logo-full-og.jpg",
        "organizer": { "@id": "https://potato-potahto.com/#business" },
        "performer": { "@id": "https://potato-potahto.com/#business" },
        "location": { "@type": "Place", "name": e.loc || e.t, "address": e.loc || "Eau Claire, WI" }
      };
      if (en) ev.endDate = `${e.iso}T${en}:00${off}`;
      if (e.link) ev.url = e.link;
      return ev;
    });
  if (evGraph.length) {
    const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": evGraph }).replace(/</g, "\\u003c");
    html = html.replace(
      /<script type="application\/ld\+json" id="pp-events-ld">[\s\S]*?<\/script>/,
      lit(`<script type="application/ld+json" id="pp-events-ld">${ld}</script>`)
    );
  }

  return new Response(html, {
    status: response.status,
    headers: response.headers
  });
};

export const config = { path: "/" };
