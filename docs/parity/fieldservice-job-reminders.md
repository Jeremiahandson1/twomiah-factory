# Parity: automatic reminders for office-booked jobs (field service and basic)

Branch `cloud/fieldservice-parity`, item 5 (first built on `cloud/fieldservice-depth`, item 4). Feature id `job_reminders` (NOT READY, `hidden` in `featureRegistry.ts`).

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
| 3 | Or a fixed time of day | A second mode: up to two steps of "N days before, at HH:MM" on the company clock (0 days = the morning of). Still held to the sending window | matches |
| 4 | Channels: email, and text (mobile numbers only) | Text and email, each switchable. Text goes to the contact's mobile, else their phone — the same number the on-my-way text uses; we cannot tell a landline from a mobile | matches, one difference (landline fallback) |
| 5 | Visit moved: reminders for the old time are cancelled, new ones scheduled | Each reminder is claimed against the visit's exact start; a moved visit has a new start, so it earns its own reminders and the old ones can never fire | matches |
| 6 | Quiet hours: none described (only: no text for all-day visits) | A sending window per business (default 8am–8pm on the company clock). Outside it nothing is sent; a reminder that comes due overnight goes at the window's opening | beats |
| 7 | All-day visits: text reminders never send | A job with no time counts as starting when the window opens that day, so it is reminded the day before, inside the window | beats |
| 8 | A visit moved into a reminder's window is reminded right away | Same: a job booked inside the window is reminded on the next pass (the hourly pass; Jobber says "within minutes") | matches (slower) |
| 9 | Text/email templates with variables | A text template and an email subject and body, each with `{{customer_name}}`, `{{company_name}}`, `{{job}}`, `{{when}}`, `{{date}}`, `{{time}}`, `{{address}}`, `{{tech_name}}`, `{{confirm_link}}`; the visit-moved text is editable too | matches |
| 10 | Text templates limited to 160 characters | 320 characters, with a live count | beats |
| 11 | A client who turned off reminders on their record is skipped | A contact who texted STOP (`optedOutSms`) is never texted; one who unsubscribed (`emailOptOut`) is never emailed; no number / no email is skipped and the log says why. A contact also has a reminders-only switch (`job_reminders_off`, on the contact page): it stops the AUTOMATIC reminders and not a hand-sent one | matches |
| 12 | Manual "Text/Email Reminder" from a visit | "Customer reminders" card on the job page: Text reminder / Email reminder, `jobs:update`, a seat that is not the office only on its own jobs, logged like the automatic ones, with the list of what the customer was sent | matches |
| 13 | "Notify client?" prompt on reschedule | In-app dialog (text, email or both) after a job edit, a Schedule / Dispatch Board move, and a route re-time; sends the editable moved text once per move. **Bulk reschedule has no screen on the web today**, so there is no prompt to hang it on; the server clears the confirmation there | matches, except the bulk screen (none exists) |
| 14 | Client Hub confirm link; reply Yes/C to confirm | A private `/confirm-visit/<token>` page (no sign-in), a Confirm button under the portal's "Upcoming visits", and a text of Y / YES / C / CONFIRM that confirms the soonest visit they were reminded of; `job.confirmed_at` / `confirmed_via`, cleared when the visit moves, shown on the job | matches |
| 15 | Client Communications report | `Client Communications` (reports:read): every reminder and moved notice with result, who sent it, whether the visit was confirmed, the customers' texts back, filters, CSV | matches |

## Rules the build keeps

- Dedupe: `reminder_log` claim before sending, unique on (company, kind, job, step) — two overlapping passes cannot double-send.
- A text refused because texting is not set up or the wallet is empty is **held** and tried again; a carrier refusal is recorded once.
- Several steps already due (a job booked 3 hours out with 48h and 24h steps): only the latest reached is sent; the earlier ones are logged as superseded.
- Only jobs that are `scheduled` or `dispatched`; never cancelled, started or done.

## Left unbuilt

Nothing in this table. Not seen in a real browser or on a real phone: the pages are type-checked and the server is tested through the real app, but nobody has looked at the dialog, the confirm page or the report on a screen. The feature stays `hidden` until the owner has tried it.
