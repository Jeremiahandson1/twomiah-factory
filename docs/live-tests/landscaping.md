# Landscaping — full live test, start to finish (for Claude in Chrome)

A real lawn and landscape company's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the business up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (no Stripe connected), texts (no Twilio number), QuickBooks, Google reviews, branded email, call tracking, the lender for financing, the aerial-detection provider ("Find areas from the air"). If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** AI call answering and the help assistant's chat box (don't ask it questions). The phone app is tested later with the person — where a step is the crew's phone, use the crew's web view instead, or skip it and say so.

You need one small site-plan picture or PDF for section E (any image of a yard drawing will do).

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Landscaping / Lawn Care**. Business name: `Chrome Test Lawn`. Email: `twomiah14+chromelawn@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the website look pictures show a **landscaping** site; errors are in plain words (try leaving the name blank once).
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check the inbox of **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email with a sign-in link. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense; anything that needs an outside account says so in words.
10. 📱 **Dashboard:** numbers and tiles show, none says NaN or undefined; every tile opens the list it counts.
11. **Team:** add a manager `twomiah14+chromelawnmgr@gmail.com` and two crew members `twomiah14+chromelawncrew@gmail.com` (crew lead) and `twomiah14+chromelawncrew2@gmail.com`. 🙋 **PERSON:** sets each password. Used later and in section N.
12. Open the public website. 📱 **Expect:** the company's site with its name and services; online booking if it is on.

## C. Customers, measuring and the quote

13. Add a customer `Hank Homeowner`, 1200 Main St, Eau Claire, WI 54701, phone 715-555-0123.
14. **Area-based pricing:** draw the lawn and a bed on the satellite map for Hank's property. **Expect:** each shape's area shows; save. **Find areas from the air:** **Expect:** a polite "not connected" for the provider.
15. **Print measurements:** **Expect:** a PDF with the shapes over the satellite picture, labelled, with the total.
16. **Budget, overhead and markup:** build the year's budget (sales, field labour with burden, equipment, materials, overhead). **Expect:** a markup / hourly rate worked out; saved.
17. **Markup defaults:** set labour / material markup. On a quote line with a cost, **Expect:** the price fills in and the margin shows.
18. Make a quote for Hank: weekly mowing priced by the measured area, plus a mulch job. Add a **picture on a line** and a **text line** (heading, no price). **Expect:** totals right.
19. **Good / Better / Best:** three options (basic mow / mow + trim / full care). **Preview as client.** **Expect:** read-only, exactly the customer's page.
20. **Financing** (if shown): an estimate per month or a polite not-connected note.
21. Send the quote; open the customer link in a private window; pick an option and sign. **Expect:** the job shows the signed option.

## D. Routes and the season

22. **Recurring route board:** make a Tuesday route, put Hank's weekly mow on it with two more stops (make two more customers). Drag the stops into a new order. **Expect:** saved in order.
23. **Route seasons:** give the route a season (April–October) and next season's renewal. **Crew clashes:** give the same crew a second route at the same time. **Expect:** a clash warning.
24. **Copy routes:** copy Tuesday's route to Thursday; save it as a route template; start a new route from the template. **Expect:** stops in order, crew, start time and season carried.
25. **More repeat patterns:** a job every 10 days skipping Sundays; one on the 1st and 3rd Friday; one yearly. **Expect:** the visits show on the schedule where they should.
26. **Rain day:** push Tuesday to Wednesday; undo it; push a run of three days at once. **Expect:** visits move and come back on undo.
27. **Maintenance contracts:** a plan with included visits for the season. **Expect:** the visits go on the schedule.

## E. Plan takeoffs

28. Upload the site plan; set its scale from a known length; measure an area, a length and a count. Put them on a quote. **Expect:** the quantities carry onto the lines.

## F. The crew's day

29. As the owner, open the **map of the day** for the crew. **Expect:** stops numbered in route order, next stop marked.
30. Sign in as the **crew lead** (🙋 **PERSON** types the password) in the crew view: start each crew member's **timer** on the first visit and stop it; record **materials used** (from the price book and one typed in); mark the second visit **Could not do it** (locked gate, needs rebooking); **Finish Day.** **Expect:** an end-of-day recap.
31. Back as the owner: **Expect:** the skipped visit is flagged for rebooking; the materials and hours show on the visit; **Crew Score** compares budget hours to actual.
32. **Job checklists:** build a checklist for "Spring cleanup"; fill it in on a visit and have the customer sign. **Draw on a photo** of the visit (an arrow and a note). **Expect:** the marked copy is kept beside the original.

## G. Visit messages

33. **Visit-done messages:** turn on; finish a visit with a note and an after-photo. **Expect:** the message is listed (it won't send by text on a test site — the reason says so).
34. **Visit messages office screen:** **Expect:** each message — sent, when, how, any failure, a copy of what the customer got. Change the wording; **Expect:** saved.
35. **Feedback after a visit:** open the rating link from the message as the customer; give 2 stars with a comment. **Expect:** the rating shows beside the visit and a low one is flagged to the office.

## H. Snow

36. **Snow & ice billing:** a per-push customer, a per-inch customer and a seasonal contract. **Snow tools:** depth bands (0–2", 2–4", 4"+); change one visit's price with a reason; salt by amount; the forecast. **Expect:** each saved; the seasonal contract's visits are not charged one by one.

## I. Invoices and payments

37. Make an invoice from a finished visit; a **recurring invoice** for the monthly plan. **Expect:** saved.
38. On the customer's invoice page: **Expect:** the pay page or a polite "card payments are not set up".
39. Record a cash payment. **Expect:** the balance drops; status paid or partial.

## J. Reports and other features

40. **Reports, Receivables aging, WIP, job costing:** **Expect:** the numbers match what you did.
41. **Commissions:** a plan for a crew member; mark an invoice paid. **Expect:** earned automatically; approve, pay.
42. Pricebook and flat-rate pricebook, dispatch board, time tracking, GPS tracking (says it needs the phone app), equipment, fleet, parts & inventory, expenses, warranties, service agreements, documents, support tickets: open each and add one thing. **Expect:** saved.
43. Schedule: drag a job to another day (desktop). **Expect:** moved.
44. Client portal: switch it on for Hank and open it. **Expect:** his quote, invoice and visits.
45. Lead Inbox, Reviews, Email inbox, Messages, Email marketing: each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

46. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

47. Sign in as the **manager**. **Expect:** runs routes, jobs and the schedule; no billing or team-changing controls they shouldn't have.
48. Sign in as the **second crew member**. **Expect:** today's stops only (a "Today" tab); no prices, no company money; owner-only addresses typed in the bar are refused, not shown.

## O. Finish

49. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
50. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
