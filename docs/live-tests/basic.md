# Basic (Other / local services) — full live test, start to finish (for Claude in Chrome)

A local service business that picked **Other** at signup: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set it up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (no Stripe connected), texts (no Twilio number), QuickBooks, Google reviews, branded email, call tracking, the lender for financing. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** AI call answering and the help assistant's chat box. Tap to Pay and the phone app are tested later with the person.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Other**. Business name: `Chrome Test Services`. Email: `twomiah14+chromebasic@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. Services: "Window washing, Gutter cleaning". 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the look pictures show a **general local-services** site; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense.
10. 📱 **Dashboard:** numbers and tiles show, none NaN or undefined; every tile opens the list it counts.
11. **Team:** add a manager `twomiah14+chromebasicmgr@gmail.com`, a sales rep `twomiah14+chromebasicrep@gmail.com` and a worker `twomiah14+chromebasicworker@gmail.com`. 🙋 **PERSON:** sets each password.
12. Open the public website. 📱 **Expect:** the business's site with its services; **online booking** works — book a window washing as a made-up customer. **Expect:** it arrives in the CRM.

## C. Jobs and quotes

13. Add a customer `Hank Homeowner`, 1200 Main St, Eau Claire, WI 54701, phone 715-555-0123.
14. Make a quote from the **pricebook** (add two items first). Add a **text line** (heading, no price). **Good / Better / Best:** three options. **Preview as client.** **Expect:** read only, exactly the customer's page.
15. **Financing** (if shown): an estimate per month or a polite not-connected note.
16. Send the quote; sign **Better** in a private window. **Expect:** the job shows the signed option.
17. **Tech availability:** the worker's hours and a day off. **Dispatch board:** assign the job; reassign; set status. **Expect:** the board warns on the day off.
18. **Job reminders:** turn on. **Expect:** saved; texts won't send — the reason says so.
19. **Job checklists:** build one; fill it on the job; the customer signs.
20. Schedule: drag a job to another day (desktop). **Expect:** moved.

## D. Invoices and payments

21. Make an invoice from the job; a **recurring invoice**. On the customer's invoice page: **Expect:** the pay page or a polite "card payments are not set up".
22. Record a cash payment. **Expect:** the balance drops; status paid or partial.

## E. Reports and money

23. **Reports, receivables aging, WIP, job costing, team revenue, plan reports:** **Expect:** numbers match.
24. **Commissions:** a plan for the sales rep; mark the invoice paid. **Expect:** earned automatically; approve, pay.

## F. Other features

25. Service agreements, warranties, time tracking, GPS tracking (says it needs the phone app), equipment, fleet, inventory, expenses, documents, support tickets, multi-location: open each and add one thing. **Expect:** saved.
26. Client portal: switch it on for Hank and open it. **Expect:** his quote, invoice and jobs.
27. Lead Inbox, Reviews, Email inbox, Messages, Email marketing: each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

28. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there; nothing uses a specific trade's words (no "roof", "crew route", "caregiver").

## N. Roles

29. Sign in as the **manager**. **Expect:** runs jobs and the schedule; no billing or team-changing controls they shouldn't have.
30. Sign in as the **sales rep**. **Expect:** their own quotes and commissions only.
31. Sign in as the **worker**. **Expect:** their own jobs; no company money; owner-only addresses typed in the bar are refused.

## O. Finish

32. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
33. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
