# Roofing — full live test, start to finish (for Claude in Chrome)

A real roofer's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the business up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (the roofer's own Stripe is not connected), texts (no Twilio number), QuickBooks, Google reviews, branded email, a hail-data provider, CompanyCam, the lender for financing. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** the Exterior Visualizer's "generate" button and AI call answering. Roof measurement reports are not part of this test.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Roofing**. Business name: `Chrome Test Roofing`. Email: `twomiah14+chromeroof@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password (Chrome pauses for it).
3. Go through every signup step. **Expect:** each step is clear; the website look pictures show a **roofing** site (not a builder or a salon); errors are in plain words (try leaving the name blank once).
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** clicks "Add promotion code", enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check the inbox of **twomiah14@gmail.com**. **Expect:** within about 15 minutes, an email saying the site is ready with a link to sign in. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Claude switches on the features that are not ready yet so they can be tested too. Wait for the go-ahead.

## B. First sign-in and setup

8. Open the sign-in link from the email and enter the email; 🙋 **PERSON:** types the password from step 2. **Expect:** the setup wizard ("Welcome, Chrome Test Roofing!") with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense; anything that needs an outside account says so in words.
10. 📱 **Dashboard:** numbers and tiles show, none says NaN or undefined; every tile opens the list it counts.
11. **Team:** add a manager `twomiah14+chromeroofmgr@gmail.com` (role **Manager**), a sales rep `twomiah14+chromeroofrep@gmail.com` (role **Sales rep**) and a crew member `twomiah14+chromeroofcrew@gmail.com` (role **Crew**). Chrome opens each invite in twomiah14's inbox; 🙋 **PERSON:** sets each password. Used in section N.
12. Open the public website. 📱 **Expect:** the roofer's site with its name and services; the Instant Estimator if it is on.

## C. Leads, contacts and the pipeline

13. Add a lead `Hank Homeowner`, 1200 Main St, Eau Claire, WI 54701, phone 715-555-0123. **Expect:** shows in Leads / Lead Inbox.
14. Convert the lead to a contact and a job (a retail roof replacement). **Expect:** the job appears on the **Pipeline**.
15. **Pipeline stages** (Settings): rename a stage, keep separate **Retail** and **Insurance** boards. **Expect:** saved; the board shows the new names.
16. **Statuses and checklists** (Settings): add a status under one milestone with a 3-item checklist. On the job, tick the checklist. **Expect:** saved and shown.
17. **Pipeline boards of your own**: make a board by sales rep, coloured, seen by everyone. **Expect:** it lists the right jobs.
18. Drag the job to the next stage on the board. **Expect:** it moves; the job's page agrees.

## D. Inspection, photos and the quote

19. On the job: add photos (any images). **Draw on a photo** — an arrow and a note. **Expect:** the marked copy is kept beside the original.
20. Make an **inspection report** with the photos; open its private link. **Expect:** a branded report; the PDF downloads.
21. Make a **Good / Better / Best** quote: three options with prices, a brand and a warranty each, photos on one. Add a **text line** (a heading with no price). **Expect:** totals right; the text line has no price.
22. **Preview as client:** **Expect:** exactly the customer's page — options, the deposit, the sign button — read only.
23. **Financing on each option** (if shown): **Expect:** each option shows an estimated monthly payment, or a clear "not connected" note for the lender.
24. Send the quote. Open the customer link in a private window; pick **Better**, sign. **Expect:** the job shows the signed option and its price.

## E. Pay options and invoices

25. On the signed estimate's page (customer link): **pay toward the approved estimate**. **Expect:** the payment page, or a polite "card payments are not set up" (no Stripe connected).
26. Make an invoice from the job. On the customer's invoice page, choose an amount to pay (**pay any amount**). **Expect:** the amount box works, or the polite not-connected note.
27. **Text invoices and receipts:** schedule the invoice's pay link to be texted every few days. **Expect:** saved (texts won't send on a test site — the reason says so).
28. **Card surcharge** (menu › **Card payments**): turn it on at 3% with the processor tick. **Expect:** saved; WI is capped at 3%; it says debit/prepaid never pay it.
29. **Payments and payouts** (menu › **Card payments**): **Expect:** a polite "connect Stripe first".
30. Record a cash payment on the invoice. **Expect:** the balance drops; the status changes to paid or partial.

## F. Homeowner portal

31. Switch on the homeowner's portal from Hank's contact record and open the link. **Expect:** his quote, invoice, job photos and documents you chose to share.
32. **Portal tools:** "see what the homeowner sees"; share a new photo and tell them; see when they last opened it. **Expect:** each works.
33. **Portal messages:** post a message on the job in the portal (as the homeowner) and answer it as the owner. **Expect:** both sides see the thread.
34. **Company documents** (Settings › Documents for every homeowner): add a warranty PDF. **Expect:** it shows in every homeowner's portal. Share **several files as a packet**. **Expect:** the packet opens.

## G. Insurance

35. Make an insurance job (a hail claim) with the carrier, claim number and adjuster. **Expect:** saved on the job.
36. **Insurance follow-ups:** a held-depreciation reminder; a mortgage-company check in endorsement; a supplement. **Expect:** each listed with its next step.

## H. Work orders and crews

37. **Crews:** make a crew; add the crew member from step 11 to it.
38. **Work orders from the proposal:** make a work order from the signed proposal. **Expect:** the scope and materials filled in, **no prices**. Save the scope as a template; use the template on a second work order.
39. **Send options:** send a work order by email with a CC; switch the crew page to Spanish; ask for approval. **Expect:** the crew page (private link) in Spanish; accept / reject works.
40. **Crew scheduling:** put the sent work order on the schedule; move it to another day. **Expect:** it moves (the crew text won't send on a test site — the reason says so). On the crew link: "I'm here", "Leaving for now", the on-site checklist, mark it in progress. **Expect:** the office sees each.
41. **CompanyCam** (if offered): **Expect:** a polite "connect your account" message.

## I. Materials

42. **Materials:** add a material order for the job. **Expect:** saved and listed.

## J. Storms, canvassing and territories

43. **Storm Leads:** open the list. **Storm Map:** "Check NOAA now". **Expect:** loads; the check works or says why not.
44. **Hail swaths** (Storm Map): **Expect:** a polite "connect a hail-data provider" message. **Storm lead scores** shown on leads where a storm exists.
45. **Territories:** make a territory from a **ZIP** (54701), one from a **city** (Eau Claire, WI) and one from a **county** (Eau Claire County). **Expect:** each outline shows on the map before saving.
46. **Territory tools:** import a KML file (any small KML), put one territory inside another, redraw a boundary. **Expect:** each saved; the nested one shows under its parent.
47. **Canvassing:** open the canvassing map; drop a door knock with a result. **Expect:** saved on the map.

## K. Commissions and reports

48. **Commissions:** a plan for the sales rep (a % of the contract); mark the job collected. **Expect:** the commission earned automatically; approve it; pay it; a statement.
49. Reports: revenue, outstanding, job costing / P&L for the job. **Expect:** the numbers match what you did.

## L. Other features

50. Pricebook: add two items; use one on a quote. **Expect:** price carried in.
51. Schedule: drag a job to another day (desktop). **Expect:** moved.
52. Documents, Lead Inbox, Reviews, Email inbox, Messages: each opens and says what it holds (or a polite not-connected note).
53. Exterior Visualizer: **open the page only — do not generate** (it costs money per use). **Expect:** the page loads.

## M. Every other page in the menu

54. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

55. Sign in as the **manager** (🙋 **PERSON** types the password). Quick pass of the menu. **Expect:** runs jobs and the pipeline; no Settings › billing or team-changing controls they shouldn't have.
56. Sign in as the **sales rep**. **Expect:** sees their own leads, jobs and commissions; cannot open other reps' commissions or company Settings.
57. Sign in as the **crew member**. **Expect:** sees their crew's work orders only; no prices, no company money; owner-only addresses typed in the bar are refused, not shown.

## O. Finish

58. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
59. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
