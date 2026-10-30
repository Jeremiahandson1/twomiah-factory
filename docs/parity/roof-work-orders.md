# Roofing parity — work orders for crews and subs (gap 5)

Leaders: Roofr (Work Orders 2.0, crew approval), AccuLynx (labor tickets, Crew App). Read from their own pages on
2026-10-30; where a page said nothing about a point it is marked "not stated" and nothing is assumed. Roofr's older
"How to create a work order" page redirected to the help-centre home and was **not read**.

Sources
- Roofr: [Work Orders 2.0](https://roofr.com/product-blog/work-orders-2-0-work-orders-that-actually-work), [How to manage Roofr work orders](https://help.roofr.com/en/articles/15634536-how-to-manage-roofr-work-orders), [How to manage crew approval](https://help.roofr.com/en/articles/15554163-how-to-manage-crew-approval), [Material and Work Orders (collection)](https://help.roofr.com/en/collections/19672985-material-and-work-orders)
- AccuLynx: [New ways to make scheduling and ordering easy for roofers](https://acculynx.com/new-ways-to-make-scheduling-and-ordering-for-easy-for-roofers/), [Improving collaboration with subcontractors and crews](https://acculynx.com/improving-collaboration-with-subcontractors-and-crews/)

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Make a work order from material orders (their line items come across) — Roofr | A work order copies the lines of a material order on the same job (for example one made by the material list, `docs/parity/roof-material-list.md`) and takes lines typed in. Prices are **never** copied: the crew sees description, quantity and unit | **Matches** (material orders) |
| 2 | Make it from proposals; labour and "other" lines populate it — Roofr | Not built. Parity needs the signed quote's lines (labour included) offered as the scope | **Not doing** |
| 3 | Scope / instructions, typed or from a saved template; save instructions as a template — Roofr | Scope is typed on each order. No templates | **Matches** (typed) · templates **Not doing** |
| 4 | Photos attached — Roofr (job card, CompanyCam), AccuLynx (labor ticket photos) | The job's own photos are picked onto the order and shown on the crew's page (served by the link only, never by a public file address) | **Matches** (job photos) · CompanyCam **Not doing** |
| 5 | Attach the measurement report — Roofr | Not built | **Not doing** |
| 6 | Send by text or email; CC others — Roofr | Text, through the shared sender (it refuses an opted-out number or a business whose texting is not set up, and says so; the office can copy the link instead). No email, no CC | **Matches** (text) · email **Not doing** |
| 7 | "Translate to Spanish" before sending — Roofr | Not built | **Not doing** |
| 8 | Crew approval: the lead accepts by entering their full name; rejects with a reason and name — Roofr | Same: accept needs a name; reject needs a name and a reason; both are recorded on the order and as a note on the job | **Matches** |
| 9 | Approval switched on or off per crew, and per order — Roofr | Every order asks for an answer | **Not doing** (always asks) |
| 10 | A rejected order: the office changes the crew and sends again — Roofr | Editing a rejected order returns it to a draft (the old answer cleared); change the crew and send it again | **Matches** |
| 11 | How the crew receives it: Roofr's link / text / login — **not stated**; AccuLynx: the crew installs the Crew App | A text with a private link; the page opens in the phone's browser with **no sign-in** and no app | **Different, by design** |
| 12 | Complete the work with photos and a note — Roofr: completion workflow **not stated** (only a "completed" status); AccuLynx: photo sharing for progress, checking off labour-checklist items, no completion action stated | The crew adds photos (taken on the phone) after accepting, and presses "Mark this work done" with an optional note. Their photos are also the job's photos (type "during" or "after") | **Matches** the gap; leaders' completion step **not stated** |
| 13 | Statuses on the job card — Roofr: draft, sent, in progress, completed (changeable by the office) | draft, sent, accepted, rejected, completed, cancelled; the office cannot set them by hand, they move only by what is done | **Matches** (different words, no "in progress") |
| 14 | An activity log of each send and answer — Roofr (sends tracked; actions in work-order history and job activity) | Each text, accept, reject, completion and cancellation is a note on the job | **Matches** |
| 15 | What the sub may see, and for how long — AccuLynx (the office sets the Job File information and its duration) | Fixed: the scope, address, start date, material list (no prices) and the photos picked; never the homeowner's name or phone, a price, or any other record. The link runs 30 days from the send and at least a week past the start | **Matches** in effect; the office cannot widen or shorten it per order |
| 16 | Reschedule notifications to crews — AccuLynx ("instant notifications ... through the mobile Crew App") | Changing a sent order does not text anyone; the office presses "Text again" | **Not doing** |
| 17 | Calendar event when sent — Roofr (Elite); a scheduler of labour and deliveries — AccuLynx | Not built. The order's start date is on the order, not on the schedule screen | **Not doing** |
| 18 | Custom on-site checklists for subs; attendance (arrive / leave) alerts — AccuLynx | Not built | **Not doing** |
| 19 | Crew roster with leads, trades and certification expiry; text crews from the job — Roofr (some subscribers) | Crews have a foreman and a phone (existing); no trades or certificates. The work-order text is sent through the shared sender and filed against the job | **Partly** |
| 20 | A native crew app — AccuLynx (Pro and Elite; reader comment: an add-on) | The link is a web page for a phone browser. The phone app was not changed | **Not doing** |
| 21 | Delete — Roofr | A draft or a cancelled order can be removed; a sent one is cancelled (the crew's link then says so) | **Matches** |

## The private link (the gap's own test)
- Looked up by exact match on a 64-hex random token (the shared document-link token: 32 random bytes, `newDocumentToken`), so it cannot be guessed; a wrong, malformed or unknown token gets the same "not valid".
- Expires: 30 days from the send, never before a week after the start; then it answers "run out" (410), and sending again makes a new link and kills the old one.
- It names one row. No request id picks a work order, and a photo is served only when it is on that order's own lists. It opens none of the company's other doors.
- Not built: rate limiting of wrong guesses on the link (the token's size is the protection).

## What this change builds
- `work_order` table (migration `0041_roof_work_order`), `server/crm/roof/workOrders.ts` (office: `/api/work-orders`, `jobs:read` to read, `jobs:dispatch` to make, change, send and cancel, `jobs:delete` to remove), `server/crm/roof/crewLink.ts` (crew: `/api/crew-link/:token`, public).
- The not-ready feature `roof_work_orders`.
- Screens: a Work orders card on the job (`JobWorkOrders.tsx`) and the crew's page `/w/<token>` (`CrewLinkPage.tsx`).
- Proof: `tests/roof-work-orders.test.ts`.

## Still needed for full parity (not in this change)
Rows 2, 3 (templates), 5, 6 (email), 7, 9, 16, 17, 18, 19 (trades and certificates), 20.
