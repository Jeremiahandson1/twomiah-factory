# Home care parity: supervisory / nurse-supervisor visits

Research date: 2026-10-30. All wording is paraphrased from the pages listed.

## Leaders checked

- AxisCare: [features overview](https://axiscare.com/overview/), [Care Vision](https://axiscare.com/care-vision/), [product tours list](https://axiscare.com/product-tours-ungated). help.axiscare.com could not be opened (fetch blocked).
- AlayaCare: [Employee Finder blog](https://alayacare.com/?p=5118), [scheduling benefits](https://alayacare.com/?p=26569), [mobile app menu](https://support.helpathome.com/hc/en-us/articles/10931551109527). No help-centre page found.
- WellSky Personal Care: [private duty product page](https://wellsky.com/solutions/home/private-duty), [product page](https://wellsky.com/?p=49584). No help-centre page found.
- Adjacent references (NOT one of the three named leaders, included only because the named leaders yielded nothing): HHAeXchange and Axxess help pages.

## Capabilities

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Supervisory-visit scheduling or due/overdue tracking | Not found for AxisCare, AlayaCare or WellSky Personal Care | see Leaders checked | Built from the owner's brief, not from any leader. No comparison is made with AxisCare, AlayaCare or WellSky because none was found. Agency picks 60 or 90 days (default 90); one client can have their own number of days (0 to 365) or none; due date is last visit (or start date) plus the days; overdue after that date, due soon in the last 14 days; shown on the dashboard. Proof: `tests/homecare-depth-supervisory.test.ts`; code `server/crm/homecare/core/supervisory.ts`, `server/crm/homecare/clients/supervisoryVisits.ts` |
| Visit type for a 6-month supervisory cycle set up on contract service codes by an admin | HHAeXchange (adjacent, not a named leader) | [Schedule Supervisory Visits](https://knowledge.hhaexchange.com/provider/Content/Documentation/Admin/Admin-B-Schedule-Supervisory-Visits-Annual-Assessments-S.htm) | `not doing`. Our cycle is 60 or 90 days (or a number of days set on one client), not 6 months and not tied to contract service codes. Proof of what we do: `tests/homecare-depth-supervisory.test.ts` |
| A "visits due" report with a due-date column that staff use to pick who needs a follow-up visit, then create the visit on the calendar | HHAeXchange (adjacent) | [Schedule Supervisory Visits](https://knowledge.hhaexchange.com/provider/Content/Documentation/Admin/Admin-B-Schedule-Supervisory-Visits-Annual-Assessments-S.htm) | `not doing` as described. Our due list has a due date and a status per client, but it does not put a visit on the calendar. The office records the visit after it has happened. Proof of what we do: `tests/homecare-depth-supervisory.test.ts` |
| Supervisory visit started from a clinical visit note in the mobile app, targeted at a 14-day aide supervision cycle, documented in a note with template comments and e-signature | Axxess (adjacent) | [Supervisory Visits in Mobile Visit Notes](https://www.axxess.com/help/axxesscare/software-updates/supervisory-visits-in-mobile-visit-notes/) | `not doing`. Ours is entered by the office on the web, not started from a phone visit note. There is no e-signature, no note templates, and no 14-day cycle (the shortest cycle is a whole number of days on one client). The short form holds: visit date, home or phone visit, what the client said, whether the plan is followed, how the caregiver is doing, concerns, follow-up notes. Proof of the form: `tests/homecare-depth-supervisory.test.ts` |
| Caregivers answer custom questions at clock in/out and the office gets a dashboard alert needing acknowledgement (general visit-check feature, not a supervisory visit) | AxisCare | [Care Vision](https://axiscare.com/care-vision/) | `not doing`. This item does not build questions at clock in or out, and it is not a supervisory visit feature. Whether the product has something similar elsewhere was not checked |

## Gaps and uncertainty

- Nothing on supervisory or nurse-supervisor visits was found in any AxisCare, AlayaCare or WellSky page opened. Absence from marketing pages does not prove the feature is missing; it may live in help articles that could not be reached (help.axiscare.com was blocked, and no AlayaCare or WellSky help centre surfaced in search).
- Cadence options (60/90 days or similar): not found for the named leaders. The adjacent references show 6 months (HHAeXchange) and 14 days (Axxess), which are regulatory-context specific.
- Forms: Axxess uses a supervisory visit note; HHAeXchange page mentions none. Nothing for the named leaders.
- Overdue flags and dashboards: HHAeXchange page describes none beyond the report's due-date column; Axxess page describes none.
- The HHAeXchange and Axxess pages concern agencies with clinical oversight and may not map to non-medical home care.

## Status summary
- Built (feature `care_supervisory_visits`, hidden until switched on), from the owner's brief and not copied from any leader: the agency picks a 60 or 90 day rule, one client can have their own number of days or none, a short form records each visit, and the dashboard shows overdue and due-soon clients. Office-only (needs permission to update clients). Tested in `tests/homecare-depth-supervisory.test.ts` against a test database.
- No parity is claimed with anyone. Supervisory visits were not found at AxisCare, AlayaCare or WellSky Personal Care (help centres could not be reached, so absence is not proof). The two adjacent products (HHAeXchange, Axxess) do things we do not.
- Not built: putting the visit on the calendar, starting it from the phone, e-signature, note templates, reminders by text or email, and a cycle tied to service codes. These need a decision on who does the visit and where.
- Owner must check by hand: whether 60 or 90 days (and the 14-day "due soon" window) is what your agency's rules actually require, and whether the form's questions are the ones you want. Nothing here is checked against any state rule.
