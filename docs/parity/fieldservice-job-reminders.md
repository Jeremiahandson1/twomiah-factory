# Parity: automatic reminders for office-booked jobs (field service and basic)

Branch `cloud/fieldservice-depth`, item 4. Feature id `job_reminders` (NOT READY, `hidden` in `featureRegistry.ts`).

**Leader reviewed:** Jobber, from its own help centre — [Assessment and visit reminders](https://help.getjobber.com/hc/en-us/articles/360033608974)
(read 2026-10-30). Housecall Pro and ServiceTitan were not reviewed for this item: their reminder pages were not fetched, so no
claim is made about them here.

**What was there:** the reminder runner existed but was on for the salon only (`appointmentReminders`, a flag per vertical, a
hardcoded text, no quiet hours, no opt-out check). Online-booked jobs already get a reminder from the booking engine
(`server/booking/extras.ts`); a job the office books (`booking_id` null, any source but `online_booking`) got nothing.

| # | Jobber (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Visit reminders have their own on/off switch | `Settings › Job Reminders`, **off until the owner switches it on**, per business (`company.settings.jobReminders`) | matches |
| 2 | Timing relative to the appointment (e.g. one day before); up to two reminders | One or two "hours before" steps, 1–168 hours each | matches |
| 3 | Or a fixed time of day | Not offered: steps are hours before the visit, always inside the sending window (row 6) | not doing — parity needs a "at HH:MM the day before" mode |
| 4 | Channels: email, and text (mobile numbers only) | Text and email, each switchable. Text goes to the contact's mobile, else their phone — the same number the on-my-way text uses; we cannot tell a landline from a mobile | matches, one difference (landline fallback) |
| 5 | Visit moved: reminders for the old time are cancelled, new ones scheduled | Each reminder is claimed against the visit's exact start; a moved visit has a new start, so it earns its own reminders and the old ones can never fire | matches |
| 6 | Quiet hours: none described (only: no text for all-day visits) | A sending window per business (default 8am–8pm on the company clock). Outside it nothing is sent; a reminder that comes due overnight goes at the window's opening | beats |
| 7 | All-day visits: text reminders never send | A job with no time counts as starting when the window opens that day, so it is reminded the day before, inside the window | beats |
| 8 | A visit moved into a reminder's window is reminded right away | Same: a job booked inside the window is reminded on the next pass (the hourly pass; Jobber says "within minutes") | matches (slower) |
| 9 | Text/email templates with variables | One text template with `{{customer_name}}`, `{{company_name}}`, `{{job}}`, `{{when}}`, `{{date}}`, `{{time}}`, `{{address}}`, `{{tech_name}}`; the email uses fixed wording | matches for text; email wording not editable |
| 10 | Text templates limited to 160 characters | 320 characters, with a live count | beats |
| 11 | A client who turned off reminders on their record is skipped | A contact who texted STOP (`optedOutSms`) is never texted; one who unsubscribed (`emailOptOut`) is never emailed; no number / no email is skipped and the log says why. There is **no reminders-only switch** on a contact | not doing the per-contact switch — parity needs one |
| 12 | Manual "Text/Email Reminder" from a visit | Not built | not doing — parity needs a job-page action, permission-gated, logged like the automatic ones |
| 13 | "Notify client?" prompt on reschedule | Not built | not doing — parity needs the prompt on the job and schedule edit paths |
| 14 | Client Hub confirm link; reply Yes/C to confirm | Not built | not doing — parity needs a confirm token on the portal, an inbound-text handler and a `confirmedAt` on the job |
| 15 | Client Communications report | Texts appear in the Two-Way Texting inbox; each send is logged in `reminder_log` (once per job, step and channel). No report screen | not doing — parity needs a report over `reminder_log` and the text log |

## Rules the build keeps

- Dedupe: `reminder_log` claim before sending, unique on (company, kind, job, step) — two overlapping passes cannot double-send.
- A text refused because texting is not set up or the wallet is empty is **held** and tried again; a carrier refusal is recorded once.
- Several steps already due (a job booked 3 hours out with 48h and 24h steps): only the latest reached is sent; the earlier ones are logged as superseded.
- Only jobs that are `scheduled` or `dispatched`; never cancelled, started or done.

## Left unbuilt in this PR (rows 3, 11-switch, 12, 13, 14, 15)

Each needs the "parity needs" column above. The feature is hidden until the owner has tested the built part.
