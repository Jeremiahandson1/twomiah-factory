# Home care parity: caregiver credential and certification expiry tracking

Research date: 2026-10-30. All wording is paraphrased from the pages listed. This is the thinnest topic: the leaders publish very little detail on it.

## Leaders checked

- AxisCare: [product tours list](https://axiscare.com/product-tours-ungated), [features overview](https://axiscare.com/overview/), [scheduling page](https://axiscare.com/scheduling). help.axiscare.com could not be opened (fetch blocked).
- AlayaCare: [Matchmaker article](https://alayacare.com/?p=5760), [Perfect Pair article](https://alayacare.com/?p=5370), [Employee Finder blog](https://alayacare.com/?p=5118). No help-centre page found.
- WellSky Personal Care: [private duty product page](https://wellsky.com/solutions/home/private-duty), [product page](https://wellsky.com/?p=49584), [scheduling landing page](https://info.wellsky.com/Scheduling-LP.html). No help-centre page found.

## Capabilities

"Our status" is checked against the code on branch cloud/homecare-depth on 2026-10-30. Paths are inside `apps/unified`. The reminders are the "Credential expiry reminders" feature (`care_cert_reminders`), switched off until the owner turns it on. Code: `server/crm/homecare/core/certReminders.ts` and `server/data/homecareCertReminders.ts`. Tests: `tests/homecare-depth-people.test.ts` (real database, fake phone push, no real device).

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| A certifications feature exists, covering monitoring of caregiver (and client) certifications and handling renewals. Only the tour title and a one-line summary were readable; the tour itself was not opened | AxisCare | [product tours list](https://axiscare.com/product-tours-ungated) | **matches** for caregivers (not clients). The office keeps credential records per caregiver with an expiry date (this already existed), and the new reminders watch them. A record with a new expiry date starts the reminders over (the test changes the date directly in the database, so the office screen's renewal path was not exercised). Credentials for clients are not tracked. What AxisCare's tour actually shows was never read, so "matches" rests on the one-line summary. Proof: `tests/homecare-depth-people.test.ts` (renewal restarts reminders). |
| Schedulers are notified when a caregiver's qualifications are about to expire. This is a marketing claim in an article that lists what matching software should do and then says the product has it all | AlayaCare | [Matchmaker article](https://alayacare.com/?p=5760) | **beats**, against what is documented (one marketing sentence with no lead times or recipients). Ours tells the caregiver and the office, at 30 days, 14 days and on the expiry day, once for each step, and flags the caregiver in scheduling after it has expired. The flag is a warning, not a block. It is untested with a real phone, and the leaders may do more than their pages say. Proof: `tests/homecare-depth-people.test.ts`. |
| Searchable record of employee skills, licences and certifications, used to support matching | AlayaCare | [Perfect Pair article](https://alayacare.com/?p=5370) | **not doing** for the "searchable" part. The record exists: credentials per caregiver with type and expiry, listable for one caregiver or the whole company (up to 500), and skills are kept as a separate list that the matching feature uses. But there is no credential search or filter screen, and matching does not require a credential; an expired one only lowers a caregiver's score. Files: `server/crm/homecare/hr/certifications.ts`, `server/crm/homecare/core/matchTraits.ts`. |

## Gaps and uncertainty

- Lead times (for example 30/60/90 days before expiry): not found for any leader.
- Who is notified (caregiver, office, both): only "schedulers" is stated, and only for AlayaCare, only in marketing copy.
- Whether an expired caregiver is blocked or flagged when scheduling: not found for any leader. AlayaCare's Employee Finder lists skills, availability and similar factors but no credential-validity check; AxisCare's scheduling page does not mention credentials.
- WellSky Personal Care: not found. The pages read mention screening and training tools but no expiry tracking.
- AxisCare's features overview and Care Vision page do not mention credential expiry.
- Notification channel (email, dashboard, push): not found.
- Searches surfaced other vendors' docs on this topic (for example CareSmartz360 compliance dashboard); they were not opened because they are not among the three named leaders.

## Status summary
- Built: a check that runs every few minutes and, for each active credential of a working caregiver, sends one reminder at 30 days, 14 days and on the expiry day. The caregiver gets an in-app notice and a phone push (their own notification settings apply to the push); the office gets one notice per credential. Each step is sent once, and a new expiry date starts again. A credential that lapsed more than a week ago is not announced out of the blue. Tested in `tests/homecare-depth-people.test.ts`.
- Built: an expired caregiver is marked "Expired credential" in the ranked caregiver list on the Schedule Hub (lower score, never hidden), and creating a shift for them still works. The same warning is in the reply when a shift is created and in the open-shift caregiver list, but no screen shows those two; only the ranked list does, and it shows just the first four reasons per person.
- Not built: email reminders, other lead times (60 or 90 days), reminders for client records, a credential search screen, and blocking an expired caregiver from a shift (a design choice: it is a flag only).
- The older "certification alerts" list in the office alerts area is not filled by anything, including these reminders. Reminders appear as notifications instead.
- The owner must check by hand: turn the feature on for one test agency, add a credential expiring in 14 days to a test caregiver with the app, and confirm the notice and the phone push arrive and the office sees one notice; then expire one and confirm the warning shows in the caregiver ranking.

## Parity build, 10/31 (branch cloud/homecare-parity) — row 1 of docs/parity brief "homecare.md"

Status: **built** (not seen in a real browser or on a real phone). Everything below is behind `care_cert_reminders` (still hidden).

- Lead times the agency picks: any of 90 / 60 / 30 / 14 / 0 days (`company.settings.certReminders.leadDays`; 30, 14, 0 until it picks). Credentials › Reminders.
- Email reminders as well as app and phone push, to the caregiver and the office, switchable (`email`).
- Credentials for clients (`client_credential`): the office is reminded the same way; the client is not messaged.
- A credential search screen across every caregiver (type, caregiver, expired, expiring within N days): `GET /api/credentials/search`, page Credentials.
- The office "certification alerts" list (`certification_alerts`) is filled by the same scan, kept true on renewal, and shows every expired credential however long ago (reminders keep their one-week grace).
- An agency setting to **block** an expired caregiver (`blockExpired`). It applies to every door that places a caregiver: Schedule Hub create (single, repeating, split), `/api/schedules`, `/api/schedules-all/:id`, `/api/scheduling/schedules`, reassign, open-shift claim / smart-fill / approve / notify, and auto-fill (which skips them). It is judged on the shift's own date, so someone whose credential lapses before that date is refused for it.
- The "Expired credential" warning is now on the shift-create reply of the Schedule Hub (`credentialWarnings`) and shown on the saved-shift message, on the open-shift "Mark available" list and `/api/open-shifts/:id/eligible-caregivers`, and the ranked list shows every reason (it cut off after four).
- Tests: `tests/homecare-parity-credentials.test.ts` (19 tests; fails without the change). The original `tests/homecare-depth-people.test.ts` is unchanged and passes.
- Not done: a credential's own "renewal" screen (a new expiry date is still entered as a new record or by the existing certification routes). The owner still checks by hand with a real phone and a real mailbox.
