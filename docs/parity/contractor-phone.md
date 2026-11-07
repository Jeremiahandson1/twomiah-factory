# Contractor phone app — parity with Buildertrend, JobTread and Jobber's apps

Brief row 11 (contractor, 10/31 round). Written 2026-11-07 from the leaders' own pages (sources at the end), checked against our
phone (`apps/mobile`): the shared jobs dashboard, jobs, quotes, invoices, the clock and contacts — and nothing of a project.
Marks: **built** · **partly** (what is missing is named) · **not built**.

| Leader feature | Ours before row 11 | Mark after |
|---|---|---|
| Projects on the phone, each with its tools (BT, JobTread) | the Active projects tile listed them; a row opened nothing | built (11a) — the project page with its tools |
| Daily logs written on site: weather, notes, crew, delays, photos (BT: "document every detail"; JobTread daily logs with photos) | none on the phone | built (11a) — today's log, kept with no signal; photos taken or picked, kept with no signal |
| Punch list: add items, check them off (BT To-Do's / punch list) | none | built (11a) — add (no signal: one item however often sent), mark done, photos |
| To-dos: a list with due dates and checklists, done from the phone (JobTread to-dos) | none | built (11a) — the project's to-dos, mark done with no signal |
| Time clocked on site against the job (BT time clock; JobTread time tracking) | the clock took a job | built (11a) — a project and one of its cost codes (codes by name only) |
| Change orders created and approved from the phone, with e-signature (BT) | none | 11b |
| Selections on the phone (BT) | none | 11b |
| Files and plans viewed on the go (JobTread file viewer) | none | 11b |
| Inspections on the phone | none (roofing has its own) | 11b |
| Offline: "essential tasks available without service" (BT) | the queue, used by jobs, canvassing, home care | built — every 11a save goes through the queue, each safe to send twice |

## How each offline save is safe to send twice (the queue is at-least-once)

- **Today's daily log** — `PUT /api/daily-logs/mine/:projectId/today`: the person's log for that project today, written over if it
  is already there (rule 4 of the daily log: one per person per project per day). Never a second log, never a 409.
- **Photos** — the queue's two steps: the file to `/:id/photos/file` named from the save (a retry replaces it), then
  `/:id/photos/saved` with the addresses; a photo already on the record is not added again.
- **A new punch item** — the phone names its id; a second send of the same id answers the item already made.
- **Done** (punch item, to-do) — the same answer twice.

## Sources

- Buildertrend mobile app — https://buildertrend.com/app/
- Buildertrend for project managers — https://buildertrend.com/construction-project-manager-software/
- JobTread mobile app — https://www.jobtread.com/features/mobile-app ; daily logs — https://www.jobtread.com/daily-logs ; improved file viewer (2023-10-19) — https://www.jobtread.com/product-updates/2023-10-19-improved-file-viewer
