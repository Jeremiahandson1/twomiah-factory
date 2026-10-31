# Restaurant (private events) 7 - Lead source picker and reports

Feature ids: `event_reports` (hidden, not ready), `event_marketing_spend` (hidden; spend and its columns in the report) and `event_report_schedules` (hidden; reports by email). Tests: `restaurant-event-depth.test.ts` ("#7 where enquiries come from") and `restaurant-event-reports.test.ts`.

Leader: Tripleseat reports (lead source, conversion) - https://support.tripleseat.com/hc/en-us/sections/115002902667-Leads-Lead-Forms ; https://tripleseat.com/features/

| Leader capability | Ours | Mark |
|---|---|---|
| Lead source picked from a list | Short list the venue keeps; off, free text as before | matches |
| Report by source: enquiries, booked, lost | Counts by source | matches |
| Value of what booked by source | Value of booked events per source | matches |
| Marketing spend / cost per lead | Spend is typed in dollars per source per month (Event insights page; kept as whole cents; a seat that may change invoices enters it, one that may read invoices sees it). The source report then shows, per source and in total, what was spent, the cost per enquiry, the cost per booked event, and the value booked for every dollar spent. A month's spend is spread evenly over its days, so a week or part-month report takes its share, rounded once to whole cents. A source with no spend shows no cost, not zero | matches |
| Scheduled report email | A report (where enquiries come from, or events booked each month against last year) is emailed weekly (a chosen weekday) or monthly (a chosen day, 1st to 28th) at 8 in the morning on the venue's clock to chosen seats. Only active seats with an email and the right to read reports can be chosen. Weekly covers the seven days before, monthly the month before. A seat without the right to read money gets the counts and no money columns. Sent once per due day (claimed in the reminder log, so two instances send one); a schedule is first sent on the first due day after it was made; a day with no email delivered is tried again. "Send now" shows what a schedule sends. Edit, pause and remove are in the same panel | matches |

Not built: other reports on a schedule (only the two above); a time of day other than 8; a day of the month after the 28th (so every month has it); spend by campaign rather than by source; spend from an ad account (it is typed in).

Unverified: the emails were rendered through the app's own email template and checked for their words and columns; none was delivered by a real mail service, none opened in a mail program. The screens (spend entry, source report columns, schedule list and form) were loaded in headless Chrome against the test server (see restaurant-4-room-calendar.md for what was done): spend 500 typed and saved and shown again on reload, and a weekly schedule made and listed. The report's spend columns and the schedule's "Send now" button were not looked at in that run. Nothing was seen on a real phone.
