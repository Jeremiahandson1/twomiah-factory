import { getStore } from "@netlify/blobs";

// Shared site config (today's spot, order-ahead, events, menu, page copy, volunteer capture).
// GET  -> returns the stored config (or {} if never set)
// POST -> requires header  x-admin-key: <ADMIN_KEY env var>  then saves config

const s = (v, n) => String(v == null ? "" : v).slice(0, n);
const b = (v) => !!v;
// Default-true boolean: missing/null/undefined → true; only explicit false → false.
// Use for new "section enabled" toggles so existing saved configs keep showing sections.
const bt = (v) => v !== false;

// ---- Events + the past-event archive ----------------------------------------
// The live config is baked into every page load by the edge function, so the
// events list is capped. To keep it small without losing history, every save
// moves events dated before the 1st of THIS month (Central Time) out of the live
// config and into a separate "archive" blob. The cutoff is deliberately month-
// aligned: the month a visitor is looking at is always complete in the live
// payload, so the calendar never renders blank days while it lazy-loads the
// archive. The public calendar fetches the
// archive on demand only when a visitor pages back past the live months; the
// admin can view it and remove a wrong entry via ?archive=1.
const EVENTS_MAX = 300;   // live events (admin.html mirrors this number)
const ARCHIVE_MAX = 2000; // oldest entries drop off past this
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanEvent(e) {
  return {
    iso: s(e && e.iso, 24),
    m: s(e && e.m, 6),
    d: s(e && e.d, 6),
    t: s(e && e.t, 120),
    time: s(e && e.time, 60),
    loc: s(e && e.loc, 200),
    link: s(e && e.link, 500),
    label: s(e && e.label, 60)
  };
}
// The archive cutoff (Central Time): the EARLIER of the 1st of this month and
// MIN_LIVE_DAYS ago. Anything dated before it is archived on the next save.
//
// Both bounds matter:
//  - the 14-day floor keeps a stop in the live list while it's still recent. A
//    month-aligned cutoff on its own dumps all of September on Oct 1 — including
//    Sep 30, one day old.
//  - the 1st-of-this-month bound means nothing in the month currently on screen is
//    ever archived, so the calendar's default view is never missing days.
// The cutoff CAN land mid-month in a past month, so app.js pulls the archive before
// drawing any month earlier than this one.
const MIN_LIVE_DAYS = 14;
function archiveCutoff() {
  const todayCT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const [y, m] = todayCT.split("-").map(Number);
  const firstOfMonth = y + "-" + String(m).padStart(2, "0") + "-01";
  const floor = new Date(todayCT + "T12:00:00Z");
  floor.setUTCDate(floor.getUTCDate() - MIN_LIVE_DAYS);
  const floorIso = floor.toISOString().slice(0, 10);
  return floorIso < firstOfMonth ? floorIso : firstOfMonth;
}
const isPast = (e, cutoff) => ISO_RE.test(e.iso) && e.iso < cutoff && !!e.t;
const evKey = (e) => [e.iso, e.t, e.time, e.loc].map(v => String(v || "").trim().toLowerCase()).join("|");
const byIso = (a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0);
// Strong consistency for the archive's read-modify-write so back-to-back saves can't drop entries.
const archiveStore = () => getStore({ name: "pp-site", consistency: "strong" });
async function readArchive() {
  const j = await archiveStore().get("archive", { type: "json" });
  return (j && Array.isArray(j.events)) ? j.events.map(cleanEvent).filter(e => ISO_RE.test(e.iso)) : [];
}
async function writeArchive(list) {
  list.sort(byIso);
  if (list.length > ARCHIVE_MAX) list = list.slice(list.length - ARCHIVE_MAX);
  await archiveStore().setJSON("archive", { events: list, updatedAt: new Date().toISOString() });
  return list;
}

// GPS check-in position. Returns null unless lat/lng are real, in-range numbers —
// a half-written or spoofed payload must not put a pin in the wrong hemisphere.
function cleanCoords(c) {
  if (!c || typeof c !== "object") return null;
  const lat = Number(c.lat), lng = Number(c.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null; // null island — almost always a bad read
  const acc = Number(c.acc);
  const at = Date.parse(c.at);
  return {
    lat: Math.round(lat * 1e6) / 1e6,   // ~0.1 m — more precision than GPS gives anyway
    lng: Math.round(lng * 1e6) / 1e6,
    acc: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null,
    at: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString()
  };
}

function cleanItem(it) {
  return {
    name: s(it && it.name, 120),
    desc: s(it && it.desc, 400),
    price: s(it && it.price, 20)
  };
}
function cleanCategory(c) {
  return {
    name: s(c && c.name, 60),
    sub: s(c && c.sub, 200),
    priceHead: s(c && c.priceHead, 40),
    items: Array.isArray(c && c.items) ? c.items.slice(0, 30).map(cleanItem) : []
  };
}
function cleanPill(p) {
  if (typeof p === "string") return { name: s(p, 80), desc: "", fire: false };
  return {
    name: s(p && p.name, 80),
    desc: s(p && p.desc, 300),
    fire: b(p && p.fire)
  };
}

// Thank-You wall partner. The link must be http(s) and the logo a same-site image path
// (built-in img/partners/* or an admin upload under /img/gallery/*), so a typo can't
// turn a tile into a javascript: link or hotlink someone else's server.
function cleanPartner(p) {
  const url = s(p && p.url, 500).trim();
  const logo = s(p && p.logo, 300).trim();
  return {
    name: s(p && p.name, 120).trim(),
    url: /^https?:\/\/[^\s"<>]+$/i.test(url) ? url : "",
    logo: /^\/?img\/[\w./-]+$/.test(logo) && !logo.includes("..") ? logo : ""
  };
}

export default async (req) => {
  const store = getStore("pp-site");

  const url = new URL(req.url);
  const wantArchive = url.searchParams.get("archive") === "1";

  // Past-event archive, read by the public calendar when a visitor pages back in time.
  if (req.method === "GET" && wantArchive) {
    return Response.json({ events: await readArchive() }, {
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      }
    });
  }

  if (req.method === "GET") {
    const data = await store.get("config", { type: "json" });
    return Response.json(data || {}, {
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      }
    });
  }

  // Auth probe — admin.html calls this on unlock to validate the password
  // without modifying any data. Returns 200 if x-admin-key matches, 401 otherwise.
  if (req.method === "HEAD" || (req.method === "POST" && url.searchParams.get("verify") === "1")) {
    const key = req.headers.get("x-admin-key") || "";
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response("OK", { status: 200 });
  }

  if (req.method === "POST") {
    const key = req.headers.get("x-admin-key") || "";
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    let body;
    try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

    // Archive edit — the ONLY archive write the admin can make is removing entries
    // it names, so a stale tab can never wipe history. Body: { remove: [ {iso,t,time,loc}, ... ] }
    if (wantArchive) {
      const drop = new Set((Array.isArray(body.remove) ? body.remove : []).slice(0, 200).map(e => evKey(cleanEvent(e))));
      const list = await writeArchive((await readArchive()).filter(e => !drop.has(evKey(e))));
      return Response.json({ ok: true, events: list });
    }

    const menu = body.menu || {};
    const pageCopy = body.pageCopy || {};
    const vol = body.volunteerCapture || {};
    const rev = body.reviewCapture || {};
    const soc = body.socialLinks || {};
    const cutoff = archiveCutoff();
    const toArchive = (Array.isArray(body.events) ? body.events.map(cleanEvent) : []).filter(e => isPast(e, cutoff));
    // An admin tab opened before partners existed POSTs without the key. Keep what's
    // stored rather than wiping Aaron's list (the stale-tab problem that hit `places`).
    let partners;
    if (Array.isArray(body.partners)) {
      partners = body.partners.slice(0, 40).map(cleanPartner).filter(p => p.name || p.logo);
    } else {
      let prev = null;
      try { prev = await store.get("config", { type: "json" }); } catch (_) {}
      partners = prev && Array.isArray(prev.partners) ? prev.partners.slice(0, 40).map(cleanPartner) : [];
    }

    const clean = {
      today: {
        live: b(body.today && body.today.live),
        loc: s(body.today && body.today.loc, 200),
        hours: s(body.today && body.today.hours, 100),
        note: s(body.today && body.today.note, 200),
        // HH:MM (Central Time) — drives the "closes in …" countdown on the today bar.
        closeAt: s(body.today && body.today.closeAt, 10),
        // Exact parked position from the staff check-in page. ENHANCES the label rather
        // than replacing it: the venue name still comes from the calendar or the manual
        // override — these coords just make the map link a precise pin instead of a text
        // search, which matters at festivals where the street address is half a block off.
        // Stale coords are ignored by the renderers, and "We're closed" clears them.
        coords: cleanCoords(body.today && body.today.coords)
      },
      // Today's rotating toppings strip. Carry-forward by design: the list keeps
      // showing across days until Aaron changes it; `updated` stamps the last change.
      dailyToppings: {
        enabled: b(body.dailyToppings && body.dailyToppings.enabled),
        items: Array.isArray(body.dailyToppings && body.dailyToppings.items)
          ? body.dailyToppings.items.slice(0, 30).map(t => s(t, 60)).filter(Boolean)
          : [],
        updated: s(body.dailyToppings && body.dailyToppings.updated, 20)
      },
      orderAhead: {
        enabled: b(body.orderAhead && body.orderAhead.enabled),
        url: s(body.orderAhead && body.orderAhead.url, 500)
      },
      doordash: {
        enabled: b(body.doordash && body.doordash.enabled),
        url: s(body.doordash && body.doordash.url, 500)
      },
      // Gallery slideshow — admin-uploaded photos. Each {url, cap}. Empty list = use built-in defaults.
      gallery: Array.isArray(body.gallery)
        ? body.gallery.slice(0, 40).map(g => ({
            url: s(g && g.url, 300),
            cap: s(g && g.cap, 120)
          })).filter(g => g.url)
        : [],
      // Thank-You wall. Each {name, url, logo}. Empty list = the built-in tiles in index.html.
      partners,
      ticker: Array.isArray(body.ticker)
        ? body.ticker.slice(0, 20).map(t => s(t, 200)).filter(Boolean)
        : [],
      tickerEnabled: bt(body.tickerEnabled),
      eventsEnabled: bt(body.eventsEnabled),
      featuredEvent: {
        enabled: b(body.featuredEvent && body.featuredEvent.enabled),
        title: s(body.featuredEvent && body.featuredEvent.title, 160),
        date: s(body.featuredEvent && body.featuredEvent.date, 80),
        time: s(body.featuredEvent && body.featuredEvent.time, 60),
        location: s(body.featuredEvent && body.featuredEvent.location, 200),
        blurb: s(body.featuredEvent && body.featuredEvent.blurb, 240),
        description: s(body.featuredEvent && body.featuredEvent.description, 4000),
        ctaLabel: s(body.featuredEvent && body.featuredEvent.ctaLabel, 40) || "Learn More",
        partners: s(body.featuredEvent && body.featuredEvent.partners, 400),
        startDate: s(body.featuredEvent && body.featuredEvent.startDate, 20),
        endDate: s(body.featuredEvent && body.featuredEvent.endDate, 20),
        autoHide: b(body.featuredEvent && body.featuredEvent.autoHide)
      },
      // Live events only — anything older than the archive cutoff is split off below.
      events: (Array.isArray(body.events) ? body.events.map(cleanEvent) : [])
        .filter(e => !isPast(e, cutoff))
        .slice(0, EVENTS_MAX),
      // Saved places — admin-only presets for pre-filling new events
      places: Array.isArray(body.places)
        ? body.places.slice(0, 40).map(p => ({
            name: s(p.name, 80),
            t: s(p.t, 120),
            time: s(p.time, 60),
            loc: s(p.loc, 200),
            link: s(p.link, 500),
            label: s(p.label, 60)
          }))
        : [],
      menu: {
        enabled: bt(menu.enabled),
        kick: s(menu.kick, 60),
        headline: s(menu.headline, 200),
        sub: s(menu.sub, 400),
        note: s(menu.note, 400),
        categories: Array.isArray(menu.categories) ? menu.categories.slice(0, 10).map(cleanCategory) : [],
        // Topping pill sections (Loaded / Crunch / Dust / Sauce — and any future ones Aaron adds).
        // 12 sections cap, 40 pills per section.
        pillSections: Array.isArray(menu.pillSections) ? menu.pillSections.slice(0, 12).map(sec => ({
          title: s(sec && sec.title, 60),
          sub: s(sec && sec.sub, 200),
          items: Array.isArray(sec && sec.items) ? sec.items.slice(0, 40).map(cleanPill) : []
        })) : []
      },
      pageCopy: {
        enabled: bt(pageCopy.enabled),
        orderKick: s(pageCopy.orderKick, 80),
        orderHeadline: s(pageCopy.orderHeadline, 200),
        orderSub: s(pageCopy.orderSub, 400),
        cateringTitle: s(pageCopy.cateringTitle, 80),
        cateringBody: s(pageCopy.cateringBody, 400)
      },
      volunteerCapture: {
        enabled: b(vol.enabled),
        kick: s(vol.kick, 60),
        headline: s(vol.headline, 200),
        sub: s(vol.sub, 400),
        recipientEmail: s(vol.recipientEmail, 160)
      },
      reviewCapture: {
        enabled: bt(rev.enabled),
        kick: s(rev.kick, 60),
        headline: s(rev.headline, 200),
        sub: s(rev.sub, 400),
        googleUrl: s(rev.googleUrl, 500),
        recipientEmail: s(rev.recipientEmail, 160)
      },
      socialLinks: {
        enabled: bt(soc.enabled),
        tagline: s(soc.tagline, 120),
        facebook: s(soc.facebook, 500),
        instagram: s(soc.instagram, 500),
        tiktok: s(soc.tiktok, 500),
        snapchat: s(soc.snapchat, 500),
        youtube: s(soc.youtube, 500)
      },
      hero: {
        enabled: bt(body.hero && body.hero.enabled),
        headline: s(body.hero && body.hero.headline, 240),
        tagline: s(body.hero && body.hero.tagline, 400)
      },
      mission: {
        enabled: bt(body.mission && body.mission.enabled),
        kick: s(body.mission && body.mission.kick, 60),
        quote: s(body.mission && body.mission.quote, 600),
        p1Title: s(body.mission && body.mission.p1Title, 80),
        p1Body: s(body.mission && body.mission.p1Body, 400),
        p2Title: s(body.mission && body.mission.p2Title, 80),
        p2Body: s(body.mission && body.mission.p2Body, 400),
        p3Title: s(body.mission && body.mission.p3Title, 80),
        p3Body: s(body.mission && body.mission.p3Body, 400)
      },
      // Price guarantee + Meal Match Mission. bt() so a stale admin tab that POSTs
      // without this key leaves the band switched on rather than silently hiding it.
      guarantee: {
        enabled: bt(body.guarantee && body.guarantee.enabled),
        kick: s(body.guarantee && body.guarantee.kick, 80),
        headline: s(body.guarantee && body.guarantee.headline, 200),
        lead: s(body.guarantee && body.guarantee.lead, 800),
        matchEnabled: bt(body.guarantee && body.guarantee.matchEnabled),
        matchTitle: s(body.guarantee && body.guarantee.matchTitle, 80),
        matchBody: s(body.guarantee && body.guarantee.matchBody, 600)
      },
      purpose: {
        enabled: bt(body.purpose && body.purpose.enabled),
        kick: s(body.purpose && body.purpose.kick, 60),
        headline: s(body.purpose && body.purpose.headline, 240),
        body: s(body.purpose && body.purpose.body, 6000),
        close: s(body.purpose && body.purpose.close, 600)
      },
      // Server-stamped on every save. The admin compares its load-time value
      // against this on save to detect stale-tab overwrites.
      updatedAt: new Date().toISOString()
    };

    await store.setJSON("config", clean);

    // Move the past events into the archive (dedupe so a stale tab re-sending
    // already-archived rows adds nothing). Failure here never fails the save.
    let archived = 0;
    if (toArchive.length) {
      try {
        const list = await readArchive();
        const seen = new Set(list.map(evKey));
        for (const e of toArchive) { const k = evKey(e); if (!seen.has(k)) { seen.add(k); list.push(e); archived++; } }
        if (archived) await writeArchive(list);
      } catch (_) { archived = -1; }
    }
    // The admin swaps its list for `events` so its view matches what's live.
    return Response.json({ ok: true, updatedAt: clean.updatedAt, events: clean.events, archived });
  }

  return new Response("Method Not Allowed", { status: 405 });
};
