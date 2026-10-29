import { getStore } from "@netlify/blobs";

// "Remind me" on the calendar: returns a one-event .ics with an alert 1 hour before.
// GET /remind.ics?d=2026-10-03&t=<title>&tm=<time>
// The query only *identifies* the stop — every word in the file comes from the saved
// schedule, so nobody can mint a potato-potahto.com calendar file with their own text.
// Served from a real URL (not a JS blob) because the Facebook/Instagram in-app
// browsers, where a lot of this traffic lands, drop blob downloads.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "America/Chicago";
const SITE = "https://potato-potahto.com";

// "4pm", "5:30pm", "11am" -> minutes past midnight. Same rules as app.js parseClock.
function parseClock(s) {
  const m = String(s || "").match(/(\d{1,2})(?::(\d{2}))?\s*([ap])/i);
  if (!m) return null;
  let h = (+m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return h * 60 + (m[2] ? +m[2] : 0);
}
function parseRange(s) {
  const parts = String(s || "").split(/[–—-]/);
  return { start: parseClock(parts[0]), end: parts.length > 1 ? parseClock(parts[1]) : null };
}

// Central-time wall clock on `iso` at `mins` -> UTC ms (DST-correct).
function ctToUtc(iso, mins) {
  const [y, mo, d] = iso.split("-").map(Number);
  const want = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    guess += want - wall;
  }
  return guess;
}
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// RFC 5545 text escaping + 75-octet line folding.
const txt = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export default async (req) => {
  const url = new URL(req.url);
  const d = url.searchParams.get("d") || "";
  const t = (url.searchParams.get("t") || "").trim();
  const tm = (url.searchParams.get("tm") || "").trim();
  if (!ISO_RE.test(d) || !t) return new Response("Bad request", { status: 400 });

  const cfg = await getStore("pp-site").get("config", { type: "json" });
  const ev = ((cfg && cfg.events) || []).find(e =>
    e.iso === d && String(e.t || "").trim() === t && String(e.time || "").trim() === tm);
  const r = ev && parseRange(ev.time);
  if (!ev || !r || r.start == null || /closed/i.test(ev.t || "")) {
    return new Response("That stop isn't on the schedule anymore.", { status: 404 });
  }

  const start = ctToUtc(d, r.start);
  let end = r.end != null ? ctToUtc(d, r.end) : start + 2 * 3600e3;
  if (end <= start) end = start + 2 * 3600e3;
  const title = String(ev.t).trim();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Potato-Potahto//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + d + "-" + Buffer.from(title + "|" + tm).toString("hex").slice(0, 40) + "@potato-potahto.com",
    "DTSTAMP:" + stamp(Date.now()),
    "DTSTART:" + stamp(start),
    "DTEND:" + stamp(end),
    "SUMMARY:" + txt("Potato-Potahto @ " + title),
    ev.loc ? "LOCATION:" + txt(ev.loc) : null,
    "DESCRIPTION:" + txt((ev.time ? ev.time + "\n" : "") + "Menu & schedule: " + SITE + "/#events"),
    "URL:" + SITE + "/#events",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + txt("Potato-Potahto in 1 hour — " + title),
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).map(fold);

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="potato-potahto-' + d + '.ics"',
      "cache-control": "no-store"
    }
  });
};

export const config = { path: "/remind.ics" };
