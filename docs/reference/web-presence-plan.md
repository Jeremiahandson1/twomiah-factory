Build the $19/month "Web presence" plan: a ONE-PAGE website with lead capture, each customer's own Netlify site with its editor built in
(the Potato-Potahto pattern), set up by the Factory. Built SWITCHED OFF; nothing advertised until tested end to end. Report and STOP
after the build and its tests.

SETUP
git fetch origin && git checkout -B cloud/web-presence origin/engine
Read docs/PROJECT_BRIEF.md first, then: the unified site renderer (apps/unified/server/site/*, apps/unified/site/views — the looks,
palette/feel, structuredData, sitemap/robots/llms), the free preview (apps/api/src/unified/preview.ts, apps/unified/server/site/
signupPreview.ts — the renderer already draws a site with no tenant server), the signup and composer (apps/api/src/routes/factory/
intake.ts, services/signupSite.ts, sectionComposer.ts, instantComposer.ts), the domain flow (lifecycle.ts internal/domain/*,
billing.ts registration, services/cloudflare.ts, registrar/namecheap.ts), Stripe (services/factoryStripe.ts) and pricing
(apps/api/src/config — planSeats.ts, packages/tenant-backend/src/plans.ts). The Potato-Potahto site is the proven pattern, in daily use by its owner — READ docs/reference/potato-potahto/ FIRST (the editor,
its Netlify functions, the edge injection, and README.md: its 16 editor sections and the 9 lessons to keep). Its shape: a static site on Netlify + netlify/functions/site.mjs (GET config / POST config
behind an admin key) + Netlify Blobs storage ("pp-site") + an edge function that injects the saved config into each page as it is
served (edits go live with no redeploy) + admin.html (a hand-built editor). Push ONLY to cloud/web-presence. Never push to engine or main.

THE OWNER'S DECISIONS (2026-10-29), settled:
- $19/month, "Web presence": the business is found online and people can contact it. Not the CRM, bookings, phone app, live menu,
  food-truck tracker or store — those stay the $49 / $99 plans, and moving up is one step.
- Each customer gets ITS OWN Netlify site under the Twomiah Netlify team, with its editor built in and its content in that site's own
  Netlify Blobs — no shared Twomiah database, no shared editor server (the owner's security rule: no customer data pooled).
- Leads are EMAILED to the owner only (Netlify Forms catches the submission; nothing stored by Twomiah).
- Same AI-written site and the same looks as every Twomiah site — drawn by the SAME renderer, never a second template system.
- ONE PAGE (owner, 10/29: "the netlify sites shouldnt be multi pages"). A single home page carrying the sections a web presence
  needs — hero, what they do, about, service area, hours, reviews if the owner gave any, contact details and the lead form — with
  in-page links (#services, #contact) instead of a menu of pages. No /services/<slug> pages, no blog, no extra pages; the only
  other files are the legal pages a form needs (privacy) and the sitemap/robots/llms for that one page. The composer composes
  one page for this plan; the editor edits that one page — the owner can ADD sections (from the same section library and the
  compatibility table, cloud/site-layouts), show, hide, reorder and change their layout; never add pages. Moving up to the full
  plan is what unlocks more pages.
- TWO FORMS, each switched on or off by the owner in their editor (owner, 10/29): a LEAD CAPTURE form ("Get a quote" / "Contact
  us") and a NOW HIRING form (job applications). Either, both or neither may be on; a form that is off is absent from the page
  (no section, no link, no endpoint left open). Both are emailed to the owner only.

WHAT EACH TRADE'S EDITOR OFFERS (owner-approved 10/29 — a fixed rule, not a judgement call):
  Everyone:       hero, about, what we do (services), gallery, reviews (Google review link + private feedback to the owner), hours,
                  service area, contact, social links, announcement ticker, and the two forms (lead capture, now hiring)
  Food truck:     + today's spot, saved places, schedule/events with archive, menu, order-ahead link
  Restaurant/café:+ menu, events, order-ahead or delivery link
  Bar:            + events, menu/specials
  Salon / spa:    + service menu with prices, team
  Contractors, roofing, landscaping, field trades: + project gallery (before/after), service area map, partners/suppliers wall
  Home care:      + "how care works" steps, service area (never medical wording)
  Shop:           + featured products (pictures and a "visit us" / "call us" link — no checkout; checkout is the full plan)
Rules: (1) a trade's extra sections exist ONLY for that trade; (2) the table lives in ONE place in code, keyed by the same trade
setting the full product uses (apps/api/src/config/industryRouting.ts → the unified vertical), so it cannot drift from it; (3) the
AI's first site uses only that trade's sections; (4) changing the trade updates what can be added, and nothing already on the page
is removed. TEST: for every trade, the editor offers exactly its row (no other trade's section — a roofer is never offered today's
spot), the composer emits only allowed sections, and a change of trade keeps existing sections. Mutation-test the table lookup.

THE BUILD
1. Publishing: the Factory renders the composed site with the unified renderer to static pages + assets (what the preview already
   does, without the sample banner), and creates/updates the customer's Netlify site through the Netlify API (a Factory env
   NETLIFY_AUTH_TOKEN + NETLIFY_TEAM — the owner sets these; never in code). One deploy at signup; the editor's edits do NOT
   redeploy (step 2). Sitemap, robots, llms.txt and structured data come out of the renderer as for every site.
2. The editor, per site: BUILD ON THE POTATO EDITOR (docs/reference/potato-potahto) — keep its 9 lessons (README) and offer its proven
   CMS options ONLY as the trade table below allows (THE TRADE DECIDES — owner, 10/29: a roofer must never get a food-truck editor).
   Generalised to the Twomiah section library, not one truck's fields; the site ships its own small editor page, function and edge function (the Potato pattern, generalised):
   the editable content is the site's own model — business name, phone, email, hours, service area, the sections' words and photos,
   services, the look, palette and feel within the same safe lists the full editor uses — saved to that site's Blobs and injected at
   serve time. Photo uploads to the same Blobs (size/type checked). Readability rules hold whatever is chosen (the contrast guards).
3. Sign-in: NOT one shared password (Potato's ADMIN_KEY). The owner signs in with a link the Factory emails (short-lived, single-use,
   bound to that site), exchanged at the site's function for a session that site's secret signs (per-site secret set by the Factory
   as a Netlify env var). Rate-limit sign-in. Sign out ends the session. A support person reaches a site only through the Factory.
4. The two forms, each with an on/off switch in the editor, each handled by Netlify Forms with an email to the owner (the inbox the
   owner sets per form), spam-protected (honeypot + rate limit), "sent" shown only after Netlify accepted it, nothing stored by
   Twomiah, and the privacy page says where each form goes:
   - Lead capture: name, phone and/or email, message, and the trade's one or two fields at most.
   - Now hiring: the job(s) the owner lists in the editor (title, a few lines, full/part-time), the applicant's name, phone, email,
     a short "about you", availability, and an optional resume upload within Netlify Forms' file limits (type and size checked;
     say the limits). Applicant data is personal: no applicant detail in page source, analytics or logs; the email is the record.
   A form switched off is removed from the published page and its endpoint refuses submissions.
5. Domains: the existing buy-a-domain and bring-your-own flows, pointed at the Netlify site (custom domain + SSL through the Netlify
   API; Cloudflare DNS as for every Twomiah domain), with the same honest "live only when it opens" status and the Namecheap
   verify-email step.
6. Plan, billing and lifecycle: a $19 Stripe price (built in Stripe TEST mode; the live price is the owner's to create), a "Web
   presence" plan in the one plan catalogue, signup choosing it (twomiah.com signup — behind the switch, hidden until on), cancel ->
   the Netlify site removed at the end of the paid period, and "Upgrade to the full plan" -> a unified tenant built with the site's
   content carried over, then the Netlify site retired once the new one is live.
7. Watching Netlify: the Factory reads the team's credit usage and alerts the owner (the existing alerts) before credits run low;
   each site's usage visible to staff.
8. The switch: everything above behind one Factory setting (e.g. WEB_PRESENCE_ON, default off). Off: no signup option, no page
   mentions it, the API refuses to create one. (Owner's rules: an untested feature stays off on every path; don't advertise until live.)

TESTS AND CHECKS
- Unit/integration tests with the Netlify API and Netlify Forms stood in (never a live call from a test): publish creates/updates
  exactly one site per customer; the editor saves, injects and survives a redeploy; sign-in link expired / reused / wrong site all
  refused, and a session from site A cannot edit site B; uploads type/size refused; each form's "sent" only on acceptance; a form switched off is absent from the page and refuses a submission; the hiring form's resume type/size refused; adding a section on the one page (never a new page); cancel and
  upgrade paths; the switch off refuses every path.
- Render the published site for three trades in each look, 1440 and 390, light and dark; Lighthouse mobile/desktop on the rendered
  pages (it should be fast — static); the readability and structured-data checks pass.
- Run the Factory and unified tests you touched (one file at a time), the guards (scripts/check-unified-*.ts, contrast, fence,
  business-day), type checks (scripts/check-unified-types.ts — the Factory baseline may only go down), `bun run build:web`.

REPORT (plain words, short): what was built per step; the security design of sign-in and per-site storage; the tests run; what needs
the owner (Netlify token + team, the live Stripe price, one real end-to-end test signup on a throwaway domain, then the switch); what
is left; the commit SHA on cloud/web-presence. STOP.
