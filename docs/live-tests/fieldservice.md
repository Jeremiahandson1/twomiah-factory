# Field service (HVAC) — full live test, start to finish (for Claude in Chrome)

A real HVAC company's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the business up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (no Stripe connected), texts (no Twilio number — job reminders by text), QuickBooks, Google reviews, branded email, call tracking, the lender for financing. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** AI call answering and the help assistant's chat box (don't ask it questions). Tap to Pay and the tech's phone app are tested later with the person.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **HVAC**. Business name: `Chrome Test Heating`. Email: `twomiah14+chromehvac@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the look pictures show a **heating and air** site; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email with a sign-in link. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense.
10. 📱 **Dashboard:** numbers and tiles show, none NaN or undefined; every tile opens the list it counts.
11. **Team:** add a dispatcher/manager `twomiah14+chromehvacmgr@gmail.com`, a sales rep `twomiah14+chromehvacrep@gmail.com` and two techs `twomiah14+chromehvactech@gmail.com` and `twomiah14+chromehvactech2@gmail.com`. 🙋 **PERSON:** sets each password.
12. Open the public website. 📱 **Expect:** the company's site; **online booking** works — book a "Furnace tune-up" as a made-up customer. **Expect:** the booking arrives in the CRM.

## C. Jobs and dispatch

13. Add a customer `Hank Homeowner`, 1200 Main St, Eau Claire, WI 54701, phone 715-555-0123, with his furnace as equipment.
14. **Tech availability:** give tech 1 working hours and a day off next week. **Expect:** shown on the Dispatch Board; giving tech 1 a job on the day off warns.
15. Make a job "No heat" for Hank; assign tech 1 on the **Dispatch Board**; reassign to tech 2; set its status. **Expect:** the board and the job agree.
16. **Job reminders:** turn on reminders before booked jobs. **Expect:** saved; the reason says texts won't send without a number; the email reminder is listed.
17. **Job checklists:** build "Furnace tune-up" (5 items); fill it on the job and have the customer sign. **Expect:** kept on the job.
18. As **tech 1** (🙋 **PERSON** types the password) in the tech's mobile view at phone width: today's jobs, directions, on my way / on site / done, a photo, the checklist. **Expect:** the office sees each.
19. Schedule: drag a job to another day (desktop). **Expect:** moved.

## D. Quotes

20. Make a quote for a new furnace using the **flat-rate pricebook** (add two items first). Add a **text line** (heading, no price).
21. **Good / Better / Best:** three furnaces with prices, a brand and a warranty each. **Preview as client.** **Expect:** read-only, exactly the customer's page.
22. **Financing** (if shown): an estimate per month or a polite not-connected note.
23. Send the quote; open the customer link in a private window; pick **Better** and sign. **Expect:** the job shows the signed option.

## E. Plans and agreements

24. **Maintenance contracts:** sell Hank a two-visit yearly plan by the sales rep. **Expect:** the visits go on the schedule.
25. **Service agreements, warranties:** add one of each on Hank's furnace.
26. **Plan reports:** **Expect:** plans sold by rep, renewals coming due, ended plans.

## F. Invoices and payments

27. Make an invoice from the job; a **recurring invoice** for the plan. On the customer's invoice page: **Expect:** the pay page or a polite "card payments are not set up".
28. Record a cash payment. **Expect:** the balance drops; status paid or partial.

## G. Reports and money

29. **Reports, receivables aging, WIP, job costing:** **Expect:** numbers match.
30. **Team revenue reports:** **Expect:** revenue per tech, and quotes each rep and tech turned into work.
31. **Commissions:** a plan for the sales rep; mark the invoice paid. **Expect:** earned automatically; approve, pay, statement.

## H. Other features

32. Parts & inventory, inventory, equipment, fleet, time tracking, GPS tracking (says it needs the phone app), expenses, documents, support tickets: open each and add one thing. **Expect:** saved.
33. Client portal: switch it on for Hank and open it. **Expect:** his quote, invoice and jobs.
34. Lead Inbox, Reviews, Email inbox, Messages, Email marketing: each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

35. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

36. Sign in as the **manager**. **Expect:** dispatches and runs jobs; no billing or team-changing controls they shouldn't have.
37. Sign in as the **sales rep**. **Expect:** their own quotes, plans and commissions only; not company Settings.
38. Sign in as **tech 2**. **Expect:** their own jobs; no prices beyond what a tech should see, no company money; owner-only addresses typed in the bar are refused.

## O. Finish

39. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
40. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
