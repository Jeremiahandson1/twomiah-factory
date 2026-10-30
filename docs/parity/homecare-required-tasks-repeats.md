# Home care parity: required tasks that gate clock-out, and recurring schedules

Research date: 2026-10-30. All wording is paraphrased from the pages listed.

## Leaders checked

- AxisCare: [mobile tutorial PDF](https://static.axiscare.com/master/documents/AxisCareMobileTutorial.pdf), [caregiver guide copy hosted by a franchise](https://www.amadaseniorcare.com/colorado-springs-staffing/wp-content/uploads/sites/147/2021/03/AxisCare-Mobile-Caregiver-Guide.pdf), [scheduling page](https://axiscare.com/scheduling). help.axiscare.com could not be opened (fetch blocked).
- AlayaCare: customer-hosted copies of AlayaCare how-tos (Help at Home), plus [scheduling benefits](https://alayacare.com/?p=26569). AlayaCare's own help centre was not found.
- WellSky Personal Care: [App Store listing](https://apps.apple.com/app/id1304726452), [product page](https://wellsky.com/?p=49584). No help-centre page found.

## Required tasks

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Admin setting to require ADLs and notes before clock-out; the clock-out button stays greyed out until done | AxisCare | [mobile tutorial PDF](https://static.axiscare.com/master/documents/AxisCareMobileTutorial.pdf) | `matches` for tasks the office marks required: the server refuses the clock-out (409, plain words, naming the tasks) until each is done or skipped with a reason. There is no setting to require notes. Whether the phone also greys the button was not checked; the phone only tags the task "Required" (`apps/mobile/src/care/components/VisitParts.tsx`). Not run on a real phone. Proof: `tests/homecare-depth-visits.test.ts`; code `server/crm/homecare/visits/timeTracking.ts`, `server/crm/homecare/core/requiredTasks.ts` |
| Caregiver must mark each activity complete or incomplete before clocking out when the agency requires it | AxisCare | [caregiver guide copy](https://www.amadaseniorcare.com/colorado-springs-staffing/wp-content/uploads/sites/147/2021/03/AxisCare-Mobile-Caregiver-Guide.pdf) | `matches`. A required task must be marked done, or skipped or refused with a written reason, before clock-out. Proof: `tests/homecare-depth-visits.test.ts` |
| Clock-out is blocked until all service tasks for the visit are finished | AlayaCare | [Offline guide PDF](https://support.helpathome.com/hc/en-us/article_attachments/8771300732439), [Clocking in and out](https://support.helpathome.com/hc/en-us/articles/8718663391639) | `matches` for required tasks only. Ours blocks only the tasks the office marked required; other tasks never block. The leader's pages say all service tasks. The office's force clock-out is never blocked. The phone-call (IVR) clock-out does not check required tasks (`server/crm/homecare/visits/ivr.ts`). Proof: `tests/homecare-depth-visits.test.ts` |
| A comment bubble beside each task lets the caregiver explain why it was not done | AlayaCare | [Home visit walkthrough](https://support.helpathome.com/hc/en-us/articles/8718710149271) | `matches`. A task has a note. On a required task, skip is refused without a note and the phone opens the note box when Skip is pressed. Proof: `tests/homecare-depth-visits.test.ts`; phone screen `apps/mobile/src/care/components/VisitParts.tsx` (not run on a real phone) |
| Client signature required on every visit; if the client cannot sign, the caregiver picks a reason from a list | AlayaCare | [Home visit walkthrough](https://support.helpathome.com/hc/en-us/articles/8718710149271), [Offline guide PDF](https://support.helpathome.com/hc/en-us/article_attachments/8771300732439) | `not doing` in this item. Required client signature, and a reason list for when a client cannot sign, are not built here. Whether the product has a signature feature elsewhere was not checked |
| Nursing and DD staff must finish required forms inside the visit before clock-out | AlayaCare | [Offline guide PDF](https://support.helpathome.com/hc/en-us/article_attachments/8771300732439) | `not doing`. Only client tasks can be required; there are no required forms inside a visit. The existing VA visit-note rule (a note is needed to clock out for VA clients) is older and is not part of this item |
| System can confirm every assigned service task was completed (EVV material) | AlayaCare | [EVV brochure PDF](https://alayacare.com/wp-content/uploads/2023/06/electronic-visit-verification.pdf) | `not doing`. There is no report or EVV check that every assigned task was done. Only tasks marked required are checked, and only at clock-out |
| Phone fallback to complete tasks and clock out | AlayaCare | [Offline guide PDF](https://support.helpathome.com/hc/en-us/article_attachments/8771300732439) | `not doing`. A caregiver can clock out by phone call (IVR), but that path does not check required tasks and the call cannot mark tasks done. A clock-out the phone app saved while offline is recorded and flagged for the office instead of being refused. Proof: `tests/homecare-depth-visits.test.ts` (offline flag); `server/crm/homecare/visits/ivr.ts` (no check) |

## Recurring schedule patterns

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Create recurring shifts, or many shifts at once, from several views. Specific patterns (weekly, every N weeks, monthly) are not spelled out | AlayaCare | [scheduling benefits](https://alayacare.com/?p=26569) | `matches`. Repeating shifts: every week, every other week, every 3 to 12 weeks, and monthly on the same weekday of the month (the 2nd Tuesday; a start on a 5th weekday means the last one). Monthly and every-3-or-more-weeks need the repeat feature; weekly and every other week never did. The leader's page names no patterns, so which of ours it also has is unknown. Edited shifts follow the same rules. One weekday per repeating shift. Proof: `tests/homecare-depth-visits.test.ts`; code `server/crm/homecare/core/repeats.ts`, `server/data/homecareCore.ts` |

## Gaps and uncertainty

- Skip-with-reason on a required task: not found for AxisCare (the tutorial says nothing about skipping; the franchise guide only says complete or incomplete). For AlayaCare, a per-task comment exists, but one walkthrough does not state that completion is mandatory while two others say clock-out is blocked, so the documents disagree or differ by configuration.
- WellSky Personal Care: tasks can be managed in the mobile app per its listing, but required-task enforcement was not found.
- Recurring patterns (weekly, every N weeks, monthly): not found for AxisCare or WellSky. The AxisCare tutorial only mentions a calendar of next-week visits. AlayaCare confirms recurring shifts exist but not which cadences.
- AxisCare scheduling page and features overview do not mention recurrence.
- All AxisCare detail comes from a mobile tutorial PDF of unknown date and a 2021 franchise-hosted copy; newer behaviour may differ.

## Status summary
- Built: required tasks (feature `care_required_tasks`) and monthly or every-3-to-12-weeks shifts (feature `care_shift_repeats`), both hidden until switched on. A required task blocks clock-out until done, or skipped or refused with a written reason. A clock-out the phone app saved while offline is recorded and flagged for the office, not blocked. Tested in `tests/homecare-depth-visits.test.ts` against a test database.
- Not built: required client signature, required forms inside a visit, a check that every assigned task was done, and required tasks on the phone-call (IVR) clock-out, which skips the check today (`server/crm/homecare/visits/ivr.ts`). The IVR gap needs a decision: block the call-in clock-out, or flag it for the office like an offline one.
- Known limits: a required task applies to every visit for that client. The task's "days of the week" and "time of day" are free text and are not used, so a task meant for Tuesdays only would block every visit. Only a weekly task already done earlier in the week is let through. A repeating shift has one weekday.
- Not tested on a real phone: the phone app tags required tasks and opens the reason box on Skip, and the server refusal message is plain words, but the screen was not run on a device and the greyed-out button was not checked.
- Owner must check by hand: make one task required on a test client, try to clock out from a real phone with and without it done, and create a monthly and an every-3-weeks shift and look at the dates on the calendar.
