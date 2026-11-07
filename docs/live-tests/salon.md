# Salon — full live test, start to finish (for Claude in Chrome)

A real customer's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set the business up, then use every feature. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on. Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide).

**Things that cannot work without the business's own accounts (expect a polite "not connected" message, not an error):** taking cards (the salon's own Stripe is not connected), card readers, texts, QuickBooks, Google reviews, branded email. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

---

## A. Signup and payment (a person enters the coupon and card)

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose a salon / hair salon business. Business name: `Chrome Test Salon`. Email: `twomiah14+chromesalon@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password (Chrome pauses for it).
3. Go through every signup step. **Expect:** each step is clear, nothing is cut off on 📱 phone width, the salon choice is offered, errors are in plain words (try leaving the name blank once).
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** clicks "Add promotion code", enters the coupon and a card (Stripe keeps it; the coupon makes the charge $0), and pays; then Chrome carries on. **Expect:** the plan and price shown match what was picked, and the coupon takes it to the right amount.
5. **Expect:** after paying, a page saying the site is being built. Note the time.
6. Check the inbox of **twomiah14@gmail.com**. **Expect:** a confirmation/receipt from Stripe and, within about 15 minutes, an email saying the site is ready with a link to sign in. (If it takes longer than 15 minutes, a "still working" email should arrive — note it.) Write down the site's address from the email.
7. **Tell Claude Code the site is built** (paste the site address). Claude switches on the features that are not ready yet, so they can be tested too. Wait for the go-ahead.

---

## B. First sign-in and setup

8. Open the sign-in link from the email and enter the email; 🙋 **PERSON:** types the password from step 2. **Expect:** the setup wizard ("Welcome, Chrome Test Salon!") with the business details filled in from the signup.
9. Walk every step of the wizard (Verify info, Integrations, Branded email, Need help, All set). **Expect:** each step makes sense; anything that needs an outside account says so in words.
10. 📱 **Dashboard:** numbers and tiles show, none says NaN or undefined; every tile you click opens the list it counts.
11. **Team:** Settings › Team → add a manager `twomiah14+chromesalonmgr@gmail.com` and a stylist `twomiah14+chromesalonstaff@gmail.com`. **Expect:** an invitation email for each in twomiah14's inbox; Chrome opens each; 🙋 **PERSON:** sets each password. Used in section N.
12. Open the public website (the site address without /login). 📱 **Expect:** the salon's site with its name, a Book button, and the services once they are added (section C).

## C. Service Menu (and service steps)

13. Menu › **Service Menu**. Add: `Cut` — hair — 30 min — $40 — **Bookable online** ticked.
14. Add: `Full Colour` — colour — 90 min — $120 — Bookable online ticked — rebook every 42 days.
15. Add: `Blow Dry` — hair — 30 min — $35 — Bookable online ticked.
16. Edit **Full Colour** → give it **steps**: hands-on 30 min, processing 45 min, hands-on 15 min (they must add up to 90). **Expect:** saved; a wrong total is refused in words.
17. Edit **Cut** → set a "from" price (price is a starting price). **Expect:** saved; online it shows as "from $40".

## D. The Book's settings

18. Settings › Team: add one more stylist with no login (a chair-only member) if the page offers it.
19. Settings › **The Book**: try each switch — stylists see only their own book; choose-your-stylist online (and "choice required"); patch-test rule and the offered patch-test appointment. **Expect:** each saves with a confirmation, and its words say what it does.
20. Settings › **The Book** › **Your client app**: tick **List my salon in the directory**. **Expect:** "Your salon is listed in the directory".
21. Menu › **Time off**: add a day off for the stylist next week. **Expect:** saved.

## E. The Book (appointments)

22. 📱 Menu › **The Book**. Book `Cut` for a new client `Ana Test` tomorrow at 10:00 with the staff stylist. **Expect:** it appears in the stylist's column at 10:00, 30 min long.
23. Try to book another client with the same stylist at 10:00. **Expect:** refused, saying the stylist is busy.
24. Book `Full Colour` for `Bea Test` at 13:00 with the stylist. Then book a `Cut` for someone else at 13:30 with the same stylist. **Expect:** allowed — 13:30–14:15 is the colour's processing step, when the stylist is free. A cut at 14:15 is refused.
25. **Several services in one visit:** New appointment → `Full Colour` + **Add another service** → `Cut` with a different stylist → tick **At the same time as the first service** → tick **The client asked for this stylist** on one. **Expect:** one visit, two lines, price $160, the heart shown.
26. Open that visit → **Edit services** → add `Blow Dry` at the end, move it to another stylist, remove the cut → **Save services**. **Expect:** saved; the price and end time update; a clash with another booking is refused in words.
27. Block time: drag or add a blocked hour (lunch) for the stylist. **Expect:** shown on the grid; online booking will not offer it (checked in section H).
28. Drag an appointment to a new time (desktop). **Expect:** it moves; the client's online booking page follows.
29. Check a client in, then complete the visit. **Expect:** status changes; completing makes the sale (an invoice).

## F. Clients

30. 📱 Menu › **Clients** → `Ana Test`. Fill in: hair type, an allergy, a patch-test date and result, preferences, pronouns. **Expect:** saved, shown on the chart.
31. Add a **formula** for her colour visit (products, shades, developer, processing time). **Expect:** kept and shown in past visits.
32. Check the client's lifetime value, visit count and "due back" date look right after the completed visit.

## G. Checkout, gift cards, retail, tips

33. Open the sale from step 29 (Invoices). **Expect:** a line per service, the right total.
34. Menu › **Gift cards** → sell a $50 card to `Ana Test`, paid in cash. **Expect:** a card number; its balance $50.
35. On the sale, pay part with the gift card (its number) and the rest in cash. **Expect:** the sale is paid; the gift card balance drops by what was used.
36. Menu › **Retail** → add a product (shampoo, $20, 10 in stock, reorder at 3). Sell 1 onto a client's sale. **Expect:** stock drops to 9; the sale has the line.
37. Tips: on a sale, set a tip split between two stylists. **Expect:** saved; the percentages must add to 100.
38. Settings › **Card readers** and the sale's card-reader panel. **Expect:** a clear "connect Stripe first" message (no Stripe on a test site) — not an error.

## H. Online booking (the public booking page)

39. Open <the site address>/book in a private window (not signed in). 📱 **Expect:** the services from steps 13–15, "from $40" on Cut.
40. Pick `Full Colour` → **+ Add another service** → `Cut`. **Expect:** days and times reload; only times where both fit are offered; the stylist's day off (step 21) and blocked hour (step 27) are never offered.
41. If "choose your stylist" is on: choose a stylist for each service. **Expect:** only that stylist's times.
42. Book it with name `Online Test`, email `twomiah14+onlinetest@gmail.com`, phone `715-555-0199`. **Expect:** a confirmation page naming **Full Colour + Cut**.
43. Open the booking's own page (the link on the confirmation). **Expect:** both services named; **no Reschedule button**; a line saying to get in touch to move it; Cancel works.
44. Back in the admin: **The Book** shows it as one visit with two lines, each stylist only held for their own part.
45. Book a single `Cut` online, then **Reschedule** it from its page to another time. **Expect:** moved; the Book follows.

## I. Forms, patch tests, client portal and client app

46. Settings › **Intake & consent forms**: make a consent form for Full Colour ("before confirming" ticked). Book Full Colour online again. **Expect:** the booking waits for the form; filling it in confirms the booking; the answers land on the client's chart.
47. Patch-test rule on (step 19): book Full Colour online as a client with no patch test. **Expect:** refused in words, offering the patch-test appointment if one is set.
48. Client portal: from a client's chart, send or open their portal link. **Expect:** upcoming and past visits, gift-card balance, membership, loyalty points; "Book again" works.
49. On a phone (📱 or Chrome's phone mode) in the portal: **Expect:** an "Add to home screen" offer when the browser offers it; the installed app is in the salon's name and colour.
50. Open <the site address>/api/client-app/listing. **Expect:** the salon's card (name, address, booking link, services) — and no client names anywhere.

## J. Memberships, loyalty, booth rent

51. Menu › **Memberships**: make a monthly plan with 2 credits; enroll `Ana Test` (paid in cash). Redeem one credit on a visit. **Expect:** 1 credit left.
52. Menu › **Loyalty**: turn it on; complete a paid visit. **Expect:** points awarded once; tiers shown.
53. Menu › **Booth rent**: add a renter, weekly rent. **Expect:** an invoice on the due day; the ledger and statement.

## K. Rebooking and automatic messages

54. Menu › **Rebooking**: **Expect:** `Ana Test` due back per the Full Colour interval; the list of who has lapsed.
55. Settings › **Automatic messages**: switch on rebook and win-back with quiet hours; run a preview. **Expect:** the preview lists who would be messaged (texts will not send on a test site — that's fine).

## L. Reports and commissions

56. 📱 Menu › **Client reports**: retention, rebook rate per stylist, retail by item. **Expect:** numbers match what you did above.
57. Menu › **Commissions**: set a service rate and a retail rate; approve the stylist's earned commission; pay it out. **Expect:** a statement.
58. Reports (main menu): revenue for this week matches the paid sales above; receivables aging shows the unpaid ones.

## M. Every other page in the menu

59. Open **every** item in the owner's menu and settings, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

60. Sign out. Sign in as the **manager** (from step 11; 🙋 **PERSON** types the password). Repeat a quick pass of the menu. **Expect:** no Settings › billing or team-changing controls they should not have; can run the Book and checkout.
61. Sign in as the **staff stylist** (from step 11; 🙋 **PERSON** types the password). **Expect:** sees their own work; **never sees a price, a total or the company's money**; cannot open Commissions, Reports or Settings. Try typing an owner-only address (for example `/crm/commissions`) in the bar — **expect** it refused, not shown.
62. Settings › The Book → "stylists see only their own book" ON, then as staff: **expect** only their own appointments.

## O. Finish

63. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
64. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription). **Expect:** the site no longer loads.
