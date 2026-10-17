# website-premium-bar

The premium website for bars, taverns, pubs and taprooms. Paired with the **crm-bar** CRM.
Reference tenant: Amber Inn Bar & Grill, Eau Claire, WI (his content pack: `amber-inn/factory-content/`).

It is the current premium standard (the same SQLite schema, admin, lead forwarding, service areas, projects,
security headers and content checklist as every `website-premium-*` template) plus the bar's look and sections.

## What makes it a bar's site

1. **The Tonight Board answers "should I go there right now?"** — kitchen open/closed with a countdown, bar
   hours, what's on tap, tonight's game and special, how busy. It replaces the hero on the home page.
2. **Bar hours ≠ kitchen hours**, everywhere: the board, the hours table and the `BarOrPub` JSON-LD (the kitchen
   is a `department`).
3. **The menu is real HTML with real prices** and `Menu / MenuSection / MenuItem` JSON-LD. Signature items get
   their own page at `/<section>/<item>`. Never a PDF, never an image.
4. **The story** is section content: a timeline (or an old book) on `/story`, each era also at `/story/<era>`.
5. **Dark-first leather cover** look. The owner's own art dresses it: photos tagged `brand-leather`,
   `brand-corner`, `brand-rivet` and `header-logo` in the admin (no art → flat leather, drawn corners).

## Where the facts come from

The bar's CRM owns every changing fact — menu, 86, specials, taps, hours, the bartender's live status, public
events — on one database the register will share. `lib/bar.ts` reads them (server side, cached ~20 s) from
`{CRM_API_URL}/api/public/bar/{live,menu,taps,hours,events}`. Deploy sets `CRM_BAR=1` for the bar vertical.
Off, or the CRM unreachable, every section falls back to a correct static line ("being set up — call us").

- `/api/live` re-serves the live state to the board's poller (`build/scripts/live.js`, every 60 s).
- `POST /api/speakeasy` passes the door's password guess to the CRM, which holds the password and the reward.
- Party enquiries and Regulars sign-ups post to `/api/leads` (`formType: 'party' | 'regulars'`), are saved and
  emailed to the owner, and are forwarded to the CRM's `/api/webhooks/leads` with their fields.

## Layout (bar-specific)

```
lib/bar.ts                 the CRM reader + the `site` bundle every bar partial reads
lib/hours/                 the hours engine (pure; tests) — openingHoursSpecification for the JSON-LD
lib/schema-org/            BarOrPub / Menu / MenuItem / Event / FAQ / Breadcrumb JSON-LD
views/sections/tonight/    the board          views/sections/taps/       the tap wall
views/sections/menu/       sections, item-hero (+ the shared cards, live)
views/sections/timeline/   eras, era, book    views/sections/hours/      bar + kitchen table
views/sections/visit/      find us            views/sections/events/     list, recurring
views/sections/parties/    enquiry form       views/sections/regulars/   sign-up
views/sections/speakeasy/  the door game      build/fonts, build/styles/fonts.css   self-hosted faces
```

## Run

```bash
bun install
bun run start          # SQLite at persistent/site.db (SITE_DB_PATH); CRM_BAR=1 CRM_API_URL=… for live facts
bun test lib           # hours engine + booking
```
