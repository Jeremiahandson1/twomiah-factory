# Roofing parity — configurable pipeline (gap 8)

Leaders: AccuLynx (Workflow Manager) and JobNimbus (boards). Read from their own pages on 2026-10-30; where a page said
nothing about a point it is marked "not stated", never assumed.

Sources
- JobNimbus: [How do I add or edit a board?](https://support.jobnimbus.com/how-do-i-add-or-edit-a-board). Boards are made on the web version with a name, a record type (Jobs or Job Work Orders) and a colour; each column is usually tied to a workflow status; several boards are allowed; visibility is All team members / Just me / Specific groups; a record shows only in a column whose statuses match its workflow; boards filter by workflow/type, location, subcontractor, assignee and sales rep; deleting a board does not delete records. The page does **not** say whether a status can be renamed or reordered.
- JobNimbus: [What is a workflow?](https://support.jobnimbus.com/what-is-a-workflow) (read for the idea of workflows and statuses; nothing below depends on it beyond the board page).
- AccuLynx: [Workflow Manager and new financial worksheets](https://acculynx.com/workflow-manager-and-new-financial-worksheets/). A company can add statuses under the existing milestones, make customizable workflow statuses and checklists in its pipeline, and set different statuses for its trades, categories and work types. The page does **not** say whether a milestone can be renamed, and **no plan tier** is stated (it links a "Plan Options" page we did not read). A third-party blog (anyteamnames.com) says AccuLynx milestones cannot be renamed; that is not AccuLynx's own word and was not re-checked, so it is not relied on below.

## The list, each marked

| # | What the leader does (per its page) | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | JobNimbus: several boards, each with its own name | Two boards, Retail and Insurance (insurance jobs on Insurance, every other type on Retail), each nameable, plus "All jobs". Tabs on the desktop board and a board picker on the phone | **Matches** for two fixed boards |
| 2 | JobNimbus: make as many boards as you like | Two boards only; a company cannot add a third | **Not doing** |
| 3 | JobNimbus: board visibility by person or group | Every seat that may read jobs sees both boards | **Not doing** |
| 4 | JobNimbus: filter a board by assignee, rep, location, subcontractor | Not part of this change (the jobs list has its own filters) | **Not doing** |
| 5 | AccuLynx: add statuses under a milestone; checklists per status | Companies cannot add stages or checklists. Stages are the fixed pipeline the texts, reviews and the "paid means Collected" rule hang on | **Not doing** (deliberately; see below) |
| 6 | AccuLynx: different statuses by trade / category / work type | Different **names** per board (Retail vs Insurance), not different stages | **Partly matches** |
| 7 | Renaming a stage: not stated by either page | A company renames any stage, for everyone, and each board can use its own name for a stage. A blank box is today's name. Names show on the desktop board, jobs list, job page, reports, the job timeline, and on the phone (Pipeline, Jobs, Schedule, Job, Contact, Home stage rows) | **Beyond what the pages state** |

## Why only names change
A job is stored with a stage key (`invoiced`, `collected`, ...). The stage texts to homeowners (`AUTO_SMS`), the review request on `collected`, the measurement stage that is hidden while Measurement Reports is off, and "all invoices paid moves the job from `invoiced` to `collected`" (`collected.ts`) all work from the key. A company renames the label only, so none of them can break. No job status is rewritten and there is no data migration for existing jobs.

## What this change builds
- Not-ready feature `pipeline_boards` ("Pipeline Stages & Boards"), offered to roofing and to no plan. Switched off: the route is shut, the page carries no names, and every screen shows today's names.
- `server/crm/roof/pipeline.ts` at `/api/roof-pipeline`: GET (any seat that reads jobs) and PUT (`company:update`). Names are 40 characters at most, a board name 30, markup is stripped, a name that clashes with another stage (or another board) is refused, an unknown stage is refused, and an empty name goes back to today's. Stored in the new table `roof_pipeline_config` (migration `0044_roof_pipeline_config`), one row per company.
- Names reach the web page through the vertical screens JSON (`adminScreens.ts`, `app.ts`) and are read in one place, `web/src/crm/pages/roof/jobs/model.ts` `stageLabel`.
- Desktop: board tabs on the pipeline, jobs list filter and badge, job page badge, reports, timeline wording, and Settings › Pipeline stages (`PipelineSettingsPage.tsx`).
- Phone (same route as the desktop settings page, rule 10): `apps/mobile/src/pipeline/` (`labels.ts`, `useStageName.ts`) used by Pipeline (with a board picker), Jobs, Schedule, Job detail (steps, Advance button, toast), Contact detail and the Home stage rows. Nothing under `apps/mobile/src/offline/` was touched.

## Not verified / still needed
- The phone changes are covered by `tests/mobile/pipeline-labels.test.ts` (names, fallback, home rows, the screens use the hook). They were not run on a device or simulator.
- Timeline notes are stored as codes ("Status changed: a → b"); the desktop job timeline shows them in the company's names, but the phone's job notes list was not changed and may show the standard words.
- Reports use the company-wide name, not a board's own name.
- Parity rows 2 to 5 would need real configuration (more boards, visibility, added stages and checklists).
