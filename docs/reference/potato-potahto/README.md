# Potato-Potahto — the editor pattern the $19 Web presence plan builds on

A REFERENCE COPY, not built or deployed from here. The live site (potato-potahto.com) is a Twomiah-built static site on Netlify that a
food-truck owner edits every day; its editor is the proven pattern for the Web presence plan (cloud-web-presence round). Copied
2026-10-29 from `C:\ALL TWOMIAH PRODUCTS\potato-potahto-mockup` (not a git repo): the editor and the Netlify functions only — no photos,
PDFs or node_modules. The owner's personal email in the editor's example text is replaced with owner@example.com. No secret is in these
files: the admin key is the Netlify env var ADMIN_KEY.

## The files
- `admin.html` — the owner's editor (16 sections, below). Unlock with the admin key (probed against the function), edit, save.
- `netlify/functions/site.mjs` — GET the saved config / POST it behind the key; cleans every field to a type and a length.
- `netlify/edge-functions/inject-pp-data.mjs` — bakes the saved config into index.html as it is served: an edit shows on the next
  page load with NO redeploy (no deploy credits), and the first paint already has the data (no layout shift, no client fetch).
- `netlify/functions/upload-image.mjs` + `gallery-img.mjs` — the editor resizes in the browser, uploads WebP (JPEG for Safari), stored
  in Blobs under a content hash, served by gallery-img.
- `netlify/functions/remind.mjs` — a one-event .ics "remind me" file built only from the saved schedule.

## The editor's sections (what a real owner uses)
Today's Spot (where the truck is, hours, close time, map coords) · Today's Toppings · Social links (Facebook, Instagram, TikTok,
Snapchat, YouTube) · Top ticker (an announcement bar) · The Spread (gallery) · Partners (thank-you wall) · Order ahead (a link, off
by default) · DoorDash · Featured event (dates, auto-hide after) · Saved places · Events / pop-ups (with an archive) · Hero / mission /
purpose · Menu (items, descriptions, prices, "fire" marks) · Catering section · Reviews & feedback (a Google review link + a private
feedback form to the owner's inbox) · Volunteer / get-in-touch form (to an inbox the owner sets).

## The lessons in this code — keep them
1. **Edits without redeploys**: content in the site's own Blobs, injected at the edge. Deploy only for a code change.
2. **A section's on/off defaults to ON** for configs saved before the toggle existed (`bt = v => v !== false`) — adding a toggle
   never hides a section an owner already had.
3. **Every saved field is cleaned to a type and a maximum length** on the server, not only in the editor.
4. **Config spliced into HTML is passed to replace() as a function** (`lit()`), so a "$10" price is never read as a `$1` pattern
   (the bug it fixed), and JSON in the page escapes `<`.
5. **Keep the live payload small**: past events move to an archive blob on save; the page lazy-loads the archive only when asked.
6. **Images are resized in the browser before upload** and stored by content hash.
7. **Downloads are real URLs, not blobs** — Facebook/Instagram in-app browsers drop blob downloads.
8. **A form's recipient is the owner's setting**, per form.
9. **Generated files carry only saved data** — remind.mjs takes the query only to identify an event, every word comes from the schedule.

## What the Web presence plan must do differently
- **Sign-in**: one shared ADMIN_KEY is fine for one truck, not for paying customers — an emailed single-use sign-in link per site,
  a per-site secret, rate limits, sign-out (see the round's step 3).
- **Generic content**: the sections are the Twomiah section library (the AI-written site, the looks, layouts, palette and feel),
  not one truck's custom fields — but food-truck sections (today's spot, events, menu) should be available to a food truck.
- **One page**, with sections the owner can add, and the two forms (lead capture, now hiring) each switched on/off.
