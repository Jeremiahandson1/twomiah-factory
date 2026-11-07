# Contractor — full live test, start to finish (for Claude in Chrome)

A real general contractor's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the business up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (the contractor's own Stripe is not connected), texts (no Twilio number), QuickBooks, Google reviews, branded email, call tracking, the lender for financing. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** the Exterior Visualizer's "generate" button, AI call answering, and the help assistant's chat box (don't ask it questions). The phone app is tested later with the person — skip anything that says "on the phone".

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **General Contractor**. Business name: `Chrome Test Builders`. Email: `twomiah14+chromegc@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password (Chrome pauses for it).
3. Go through every signup step. **Expect:** each step is clear; the website look pictures show a **builder's** site (not a roofer or a salon); errors are in plain words (try leaving the name blank once).
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** clicks "Add promotion code", enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check the inbox of **twomiah14@gmail.com**. **Expect:** within about 15 minutes, an email saying the site is ready with a link to sign in. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Claude switches on the features that are not ready yet so they can be tested too. Wait for the go-ahead.

## B. First sign-in and setup

8. Open the sign-in link from the email and enter the email; 🙋 **PERSON:** types the password from step 2. **Expect:** the setup wizard ("Welcome, Chrome Test Builders!") with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense; anything that needs an outside account says so in words.
10. 📱 **Dashboard (owner):** numbers and tiles show, none says NaN or undefined; every tile opens the list it counts. **Owner dashboard** shows "needs you today" (quotes with no answer, bills due, jobs nobody is on) and who is on which job. The **pipeline strip** shows count and $ at each stage.
11. **Collapse the menu to icons:** fold the left menu to the narrow rail; reload. **Expect:** it stays folded; hovering an icon names it.
12. **Team:** add a manager `twomiah14+chromegcmgr@gmail.com`, a sales rep `twomiah14+chromegcrep@gmail.com` and a crew member `twomiah14+chromegccrew@gmail.com`. Chrome opens each invite in twomiah14's inbox; 🙋 **PERSON:** sets each password. Used in section N.
13. Open the public website. 📱 **Expect:** the builder's site with its name and services.

## C. Leads

14. Add a lead `Hank Homeowner`, 1200 Main St, Eau Claire, WI 54701, phone 715-555-0123, wants a kitchen remodel. **Expect:** shows in Leads / Lead Inbox.
15. **Site visit:** book the site visit from the lead onto the schedule; move it to another time; then cancel and re-book it. **Expect:** the schedule agrees each time.
16. Add a second lead `Lucy Lost`; mark it **Lost** with the reason "Price". **Expect:** it leaves the open list; the lost-reasons report counts it.
17. Convert Hank to a contact and a **project** (kitchen remodel).

## D. Estimating and the quote

18. **Markup defaults** (Settings): labour 30 %, material 20 %, sub 15 %. On a new quote, add a line with a cost. **Expect:** the price fills from the markup; the quote shows the margin as you build it.
19. **Formula estimating:** on the quote, add parameters (square feet 200, wall height 8). Make a line whose quantity is a formula over them (e.g. square feet × 1.1). Change square feet to 250. **Expect:** the line works itself out again.
20. Add a **picture on a quote line** and a **text line** (a heading, no price). **Expect:** totals right; the text line has no price.
21. **Good / Better / Best:** make the quote three options with prices, a brand and a warranty each. **Expect:** each option totals right.
22. **Preview as client.** **Expect:** exactly the customer's page — options, the deposit, the sign button — read only.
23. **Quote templates:** save this quote as a template; start a new quote from it; on an old quote use "Create similar". **Expect:** lines, sections and terms carried.
24. **Quote follow-up** (Settings): turn on a follow-up a few days after sending. **Expect:** saved; it says it stops once the customer answers.
25. **Financing** on the quote (if shown). **Expect:** an estimated monthly payment, or a clear "not connected" note for the lender.
26. Send the quote. Open the customer link in a private window; pick **Better** and sign. **Expect:** the project shows the signed option and its price.

## E. The project

27. **Project budget:** **Expect:** the budget by cost code, set by the approved quote. File a time entry and an expense under a cost code. **Expect:** that budget line shows what it really cost and the profit.
28. **Shared allowances:** make one allowance ($5,000 "Fixtures") covering two selections; pick selections that go $800 over. **Expect:** the overage is raised as a change order and shows on the revised budget and the WIP report.
29. **Selections:** the client picks a selection from the portal (section G); **Expect:** the office sees it.
30. **Schedule / Gantt:** add three tasks. **Link** task 2 to start after task 1 ends (+1 day lag). Move task 1 two days later. **Expect:** task 2 moves with it.
31. **Project templates:** save the project as a template, ticking budget, selections and links. Start a new project from it, ticking only some parts. **Expect:** only the ticked parts come in.
32. **Change order:** make one, send it, approve it as the client. **Expect:** the contract total changes.
33. **Daily log:** today's log with a photo and the weather. **RFIs, submittals, punch list:** add one of each. **Expect:** each listed.
34. **Inspections:** make an inspection. **Expect:** the right checklist is attached by itself (by the project's type); answer pass / fail / N/A; a failed line adds a punch-list item; the customer signs the checklist. **Expect:** the signed record is kept.
35. **Bids, takeoffs:** open Bid Management and Takeoff Tools; add one of each. **Expect:** saved.

## F. Buying and paying subs

36. **Purchase order** to a vendor for the project; send it. Open the **vendor portal** link (private window); acknowledge it and submit an invoice. **Expect:** the office sees both; it shows on Bills & Payables.
37. **Vendor bill:** record it and a payment against it. **Expect:** committed vs billed on the project agree.
38. **Lien waivers, draw schedules, AIA G702/G703:** make a draw schedule and one draw request; open the AIA forms. **Expect:** the numbers agree with the contract.

## G. Client portal

39. Switch on Hank's portal; choose per project what he sees: the schedule, daily logs and photos you shared, his to-dos, the payment schedule. Open the link. **Expect:** only what you chose shows.
40. In the portal: answer a to-do, see the payment schedule, sign something to e-sign. **Expect:** the office sees each.

## H. Invoices and payments

41. Make an invoice from the project. **Card, bank or both:** set this invoice to bank only. **Expect:** saved; the customer page offers only bank (or the polite not-connected note).
42. **Invoice installments:** split the invoice into three with their own due dates. **Expect:** the portal shows each; reminders are listed.
43. **Tips on invoices:** turn on; on the customer's invoice page the tip box shows (it won't charge — no Stripe).
44. **Pay any amount / pay from the estimate** on the customer pages. **Expect:** the amount box works or the polite not-connected note.
45. **Text invoices and receipts:** schedule the pay link to be texted every few days. **Expect:** saved (texts won't send on a test site — the reason says so).
46. **Card surcharge** (Settings › Card payments): 3 % with the processor tick. **Expect:** WI capped at 3 %; debit and prepaid never pay it.
47. **Payments and payouts:** **Expect:** a polite "connect Stripe first".
48. Record a cash payment. **Expect:** the balance drops; the status changes to paid or partial.

## I. Reports and money

49. **Reports:** revenue, outstanding, job costing / P&L. **Receivables aging** and the **WIP report.** **Expect:** the numbers match what you did.
50. **Commissions:** a plan for the sales rep (a % of the contract); mark the invoice paid. **Expect:** earned automatically; approve, pay, statement.

## J. Other features

51. Pricebook: add two items; use one on a quote. **Dispatch board, time tracking, equipment, fleet, warranties, service agreements, recurring invoices, inventory, documents, support tickets:** open each and add one thing. **Expect:** saved.
52. Schedule: drag a job to another day (desktop). **Expect:** moved.
53. Lead Inbox, Reviews, Email inbox, Messages, Email marketing: each opens and says what it holds (or a polite not-connected note).
54. Exterior Visualizer: **open the page only — do not generate.**

## M. Every other page in the menu

55. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

56. Sign in as the **manager** (🙋 **PERSON** types the password). **Expect:** runs projects and jobs; no billing or team-changing controls they shouldn't have.
57. Sign in as the **sales rep**. **Expect:** their own leads, quotes and commissions; not other reps' commissions or company Settings.
58. Sign in as the **crew member**. **Expect:** the **crew dashboard** (my jobs today and next, my hours this week, my tasks); no prices, no company money; owner-only addresses typed in the bar are refused, not shown.

## O. Finish

59. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
60. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
