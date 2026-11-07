# Bar & grill — full live test, start to finish (for Claude in Chrome)

A real bar and grill's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set it up, then use every feature — taps, the register and grill, stock, staff and tips, regulars, gift cards and events. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the bar's own accounts (expect a polite "not connected" message, not an error):** taking cards online or on a card reader (no Stripe connected — card tabs, the kiosk's pay step, online ordering's pay step, event autopay and bank payments), texts (no Twilio number), QuickBooks, Toast / Square, Google reviews, branded email, call tracking. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (they cost money per use):** **Invoice Scanning's "read" step** (open the page only), AI call answering, and the help assistant's chat box.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Bar & Grill / Tavern / Pub**. Business name: `Chrome Test Tap`. Email: `twomiah14+chromebar@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the look pictures show a **bar** site; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard (Bar Settings too). **Expect:** each makes sense.
10. 📱 **Tonight:** kitchen and bar open, how busy, the note, tonight's special, the game, an event. **Expect:** live on the website.
11. **Team:** add a manager `twomiah14+chromebarmgr@gmail.com`, a bartender `twomiah14+chromebartender@gmail.com` and a barback `twomiah14+chromebarback@gmail.com`. 🙋 **PERSON:** sets each password.

## C. Menu and taps

12. **Menu:** Wings $12, Burger $14, Fries $5 with sizes. **Taps:** two beers with pour sizes (pint, pitcher). **Expect:** both on the website with real prices.
13. **86** the Wings. **Menu by time of day:** a late-night menu after 10 pm. **Item counts:** 2 Burgers left; sell 2. **Expect:** it 86es itself.

## D. Register and grill

14. **Register:** open a bar tab; a pint and Wings; send to the grill. Open the grill screen in another tab. **Expect:** the food arrives, paced.
15. Cash, split, a void (asks for a manager). **Expect:** each recorded.
16. **Card tabs / card reader:** **Expect:** a polite "connect Stripe first".
17. **Kiosk:** order under a table number. **Expect:** arrives on the register; pay step says card payments aren't set up.
18. **Online ordering** on the website: the cart works; pay step says card payments aren't set up. **Orders:** listed.

## E. Regulars and gift cards

19. **Regulars / loyalty rewards:** add a regular; give points on a sale. **Expect:** their points show.
20. **Gift cards:** sell a $25 gift card for cash; redeem $10 on a tab. **Expect:** the balance is $15.

## F. Stock

21. **Stock:** a keg and a case of bottles; a recipe for a cocktail. **Expect:** the pour cost shows.
22. **Count** and **fill-level count** (slide a bottle to a third). **Expect:** the variance reads the count. **Reorder:** what to order and to whom.
23. **Invoice Scanning:** open the page only — **do not upload.**

## G. Staff and tips

24. **Schedule:** build next week; gaps and labor cost before publishing. **Availability**, **shift swaps** (manager approves), **time off** — as the bartender (🙋 **PERSON** types the password) and the owner. **Expect:** each works and nothing moves before approval.
25. **Labor forecast:** **Expect:** a forecast, or it says there's not enough history yet.
26. **Tips:** pool by role and hours with a barback tip-out; the bartender declares cash tips at clock-out; a manager corrects one. **Expect:** the close-out shows who gets what. **Tips from another register:** a polite "connect Toast / Square".
27. **Payroll:** **Expect:** the export file with hours, overtime, tips and tip-outs per person.
28. **Time tracking, expenses:** add one of each.

## H. Events

29. **Spaces** ("Party Room", 30 standing, minimum spend), **catering menus**, **events**: confirm one; a second for the same room and time is refused. **Room calendar & waitlist.** **Holds that lapse.**
30. **Event proposals & contracts:** send to two signers; sign in a private window. **Expect:** booked when accepted.
31. **Deposits, reminders, bank payments:** each pay link says card payments aren't set up. **Guest count cutoff, run of show / BEO, minimums, event reports, marketing spend, reports by email, form rooms & embeds:** each saved or shown.

## I. Other features

32. Invoices, contacts, documents, support tickets, QuickBooks, Lead Inbox, Reviews, Email inbox, Messages, Email marketing, Reports, Receivables aging, call tracking, AI receptionist (settings page only): each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

33. Open **every** item in the owner's menu and every Settings tab (Bar Settings, Register Settings), one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

34. Sign in as the **manager**. **Expect:** runs the register, schedule and stock; approves voids and swaps; no billing or team-changing controls they shouldn't have.
35. Sign in as the **bartender**. **Expect:** the register, tabs, their own shifts and tips; no costs, payroll or other staff's pay; owner-only addresses typed in the bar are refused.
36. Sign in as the **barback**. **Expect:** their own shifts and tips only.

## O. Finish

37. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
38. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
