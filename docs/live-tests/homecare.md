# Home care — full live test, start to finish (for Claude in Chrome)

A real home care agency's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the agency up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards. **Use made-up people only** — no real client's name, birthday, medicine or insurance number anywhere.

**How to work through this:** do each step in order, as the **owner (admin)** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do, words are an agency's (clients, caregivers, visits — not jobs, quotes or crews). Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the agency's own accounts (expect a polite "not connected" message, not an error):** card or bank payments (no Stripe connected), texts (no Twilio number — family arrival texts, reminders by text), QuickBooks, ADP / Paychex / Gusto, background-check providers, Google reviews, branded email, call tracking. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** the **check scanner** on Billing (don't upload a check to be read), AI call answering, and the help assistant's chat box. The caregiver's phone app (clock-in with GPS, offline saves, signatures on the phone) is tested later with the person — where a step is the caregiver's, use the caregiver's web view, or skip it and say so.

You need one small CSV for section C — Chrome can make it: `first_name,last_name,phone` with three made-up clients.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Home Care / Healthcare**. Business name: `Chrome Test Home Care`. Email: `twomiah14+chromecare@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the look pictures show a **home care** site; the "moving from" choices are AxisCare / WellSky / AlayaCare; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email with a sign-in link. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the agency's details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense; anything that needs an outside account says so in words.
10. 📱 **Dashboard:** active clients, caregivers, today's shifts, clocked in, coverage gaps — none NaN or undefined; each tile opens what it counts.
11. **Users:** add an office manager `twomiah14+chromecaremgr@gmail.com`, two caregivers `twomiah14+chromecaregiver@gmail.com` and `twomiah14+chromecaregiver2@gmail.com`, and a viewer `twomiah14+chromecareview@gmail.com`. 🙋 **PERSON:** sets each password. Used in section N.
12. Open the public website. 📱 **Expect:** the agency's site; the careers page and the enquiry form.

## C. Clients and importing

13. **Clients:** add `Martha Client` (made-up), 1200 Main St, Eau Claire, WI 54701; a service type; a private-pay rate. Add her daughter `Dana Daughter` as family with `twomiah14+chromecarefam@gmail.com`.
14. **Client onboarding, client documents, care plans, referral sources:** start onboarding for Martha; add a document; build a care plan with three tasks; add a referral source. **Expect:** each saved.
15. **Import from a spreadsheet:** import the CSV of three clients; match the columns; preview. **Expect:** every row previewed before saving; then saved.
16. **Import wizard:** import again with the saved mapping, as an update. **Expect:** the mapping is remembered; the rows update, not duplicate. **Import every record kind:** open the list. **Expect:** authorizations, certifications, medicines, pay rates and the rest offered.
17. **Assisted migration:** open the page. **Expect:** it explains sending the old system's export to Twomiah; don't send anything real.

## D. Caregivers

18. **Caregivers:** open each caregiver; add skills, a gender and a language; add a certification expiring in 20 days. **Credential expiry reminders:** set the lead times. **Expect:** the reminder is listed.
19. **Applications, job postings, onboarding packets, performance, background checks:** add a job posting; open the careers page and apply as a made-up person; open the application. **Expect:** it arrives; background checks say "not connected".

## E. Scheduling

20. **Scheduling:** give Martha a weekly shift with caregiver 1. **Match on skills, gender and language:** set Martha's needs. **Expect:** suggested caregivers say why for each.
21. **Monthly and every-few-weeks shifts:** a shift every 2nd Tuesday; one every 3 weeks; one repeating shift on several weekdays. **Expect:** each on the calendar where it should be.
22. **Open shift offers:** make an open shift with a bonus; as caregiver 2 decline it with a reason. **Expect:** the office sees the decline and the offer record. **Pickup bonus and rewards:** **Expect:** the bonus and points listed.
23. **Visit optimizer** and **route / company optimizer:** pick several open visits and run it. **Expect:** suggestions with reasons, nothing changed until you accept.
24. **Live board, emergency coverage, shift approvals:** open each. **Expect:** today's visits; nothing blank.
25. **Caregiver not arrived alerts:** make a visit that started 30 minutes ago with no clock-in. **Expect:** a No-Show alert raised once on No-show alerts.
26. **Supervisory visits:** a 60-day cycle for Martha. **Expect:** planned on the calendar.

## F. The visit

27. **Clock-in and clock-out questions:** add a required safety question. **Visit items:** attach a form, an intervention and a goal to Martha's visits. **Required tasks:** mark one task required.
28. As **caregiver 1** (🙋 **PERSON** types the password) in the caregiver's web view: clock in to Martha's visit; answer the question; try to clock out without the required task. **Expect:** refused until it is done or skipped with a reason. Do the task; clock out. (GPS and the phone signature are tested later on the phone.)
29. **Medication reminders:** give Martha a medicine with a dose time. **Expect:** shown on the visit; a missed dose notifies the office.
30. **ADLs, medications (MAR), visit docs, incidents, form builder:** record one of each. **Expect:** saved.
31. **EVV:** **Expect:** the visit listed with its clock times and EVV status.

## G. Family

32. **Family portal:** open Dana's portal link. **Expect:** upcoming visits with their planned tasks, the task log, meals, vitals and the documents shared.
33. **Family requests:** as Dana, ask for a visit change. **Expect:** an office task; the office answers in the agency's words. **Family messages:** post and answer. **Expect:** both sides see the thread.
34. **Family arrival texts:** turn on for Dana. **Expect:** saved; the reason says texts won't send without the agency's number.

## H. Billing and payroll

35. **Payers & service codes, authorizations:** add a Medicaid payer and a service code; an authorization for Martha (40 hours). **Expect:** the visits count against it.
36. **Billing:** bill Martha's week. **Billing contacts:** Dana pays, two emails. **Expect:** the invoice goes to Dana.
37. **Split billing:** 60 % to the payer, the family pays the rest. **Expect:** the amounts add up to the visit's total, no one billed twice.
38. **Long-term care insurance billing:** add an LTC payer with policy and claim numbers; make a claim packet. **Expect:** cover sheet and items.
39. **Automatic payment:** **Expect:** a polite "connect Stripe first" (or Stripe's own page if it opens — don't enter a card).
40. **Claims, billing engine, billing import, portal claim days, client week:** open each. **Expect:** nothing blank or broken.
41. **Payroll and pay rules:** set Wisconsin overtime, paid travel between clients; run a pay period. **Expect:** hours and overtime right; the ADP / Paychex files download. **Payroll providers:** **Expect:** "not connected" for ADP, Paychex and Gusto.
42. **Home care invoices in QuickBooks:** **Expect:** "connect QuickBooks first".
43. **Expenses:** add one. **Expect:** saved.

## I. Reports

44. **Reports, revenue forecast, client margin and caregiver turnover:** **Expect:** numbers match what you did.
45. **Report builder:** build a report over visits, filter by caregiver, group by client; save it; schedule it weekly. **Expect:** saved and listed.
46. **Caregiver satisfaction and retention:** set a survey after the first visit. **Expect:** saved; a risk list shows.

## J. Compliance and communication

47. **Compliance, credentials, audit logs, login activity, communication log, SMS, alerts, messages, notifications, integrations, agency features:** open each. **Expect:** each loads; logins and changes from today are in the audit and login lists.

## M. Every other page in the menu

48. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

49. Sign in as the **office manager**. **Expect:** clients, the schedule, visits and the family portal; billing read only; no hiring of admins or company settings they shouldn't have.
50. Sign in as **caregiver 2**. **Expect:** their own schedule, their clients' care plans and visits, their own pay; no other caregivers' pay, no billing, no Lead Inbox; owner-only addresses typed in the bar are refused.
51. Sign in as the **viewer**. **Expect:** the directory, the week's visits, the caregiver list and the counts, read only; no medicines, insurance, rates, GPS or billing; nothing can be saved.

## O. Finish

52. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
53. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
