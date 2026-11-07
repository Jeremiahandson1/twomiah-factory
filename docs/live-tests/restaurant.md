# Restaurant — full live test, start to finish (for Claude in Chrome)

A real restaurant's whole path: sign up on twomiah.com, pay (with a coupon), get the site built, sign in, set it up, then use every feature — the register and kitchen, the menu, stock, staff, and private events. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do. Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the restaurant's own accounts (expect a polite "not connected" message, not an error):** taking cards online or on a card reader (no Stripe connected — card tabs, the kiosk's pay step, online ordering's pay step, event autopay and bank payments), texts (no Twilio number), QuickBooks, Toast / Square, Google reviews, branded email. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (it costs money per use):** **Invoice Scanning's "read" step** (don't upload an invoice to be read — open the page only), and the help assistant's chat box.

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Restaurant / Café**. Business name: `Chrome Test Kitchen`. Email: `twomiah14+chromefood@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step is clear; the look pictures show a **restaurant** site; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email. Write down the site's address.
7. **Tell Claude Code the site is built** (paste the site address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard. **Expect:** each makes sense.
10. 📱 **Dashboard / Tonight:** set the kitchen open, how busy, a note and tonight's special. **Expect:** saved; shows live on the website.
11. **Team:** add a manager `twomiah14+chromefoodmgr@gmail.com`, a server `twomiah14+chromefoodserver@gmail.com` and a cook `twomiah14+chromefoodcook@gmail.com`. 🙋 **PERSON:** sets each password.

## C. Menu

12. **Menu:** add a Burger $14, Fries $5 (with sizes) and a Salad $11 with an add-on. **Expect:** the website menu shows them with real prices.
13. **86** the Salad with one tap. **Expect:** the website and the register show it as out.
14. **Menu by time of day:** lunch 11–3, dinner 4–10; put the Salad in lunch only. **Expect:** shown only in its hours on the website and the register; an 86 comes back when set.
15. **Item counts:** set 3 Burgers left; sell 3 on the register. **Expect:** it 86es itself at zero.

## D. Register and kitchen

16. **Register:** open a table tab; add a Burger and Fries; send to the grill screen. Open the grill screen in another tab. **Expect:** the order arrives, paced.
17. A walk-up order; take **cash**; **split** a check two ways; **void** a line (it asks for a manager). **Expect:** each recorded.
18. **Card tabs / card reader:** **Expect:** a polite "connect Stripe first".
19. **Order kiosk:** open the kiosk; order under a name with a size and an add-on. **Expect:** the order arrives on the register; the pay step says card payments aren't set up.
20. **Online ordering:** on the website, add to cart and check out. **Expect:** the cart works; the pay step says card payments aren't set up.
21. **Orders:** **Expect:** today's orders listed.

## E. Stock

22. **Stock & costing:** add ground beef by the case and a recipe for the Burger. **Expect:** the plate's cost shows.
23. **Count:** do a count; **fill-level count** on an open bottle (slide to half). **Expect:** the variance reads the count.
24. **Reorder:** **Expect:** what to reorder and the order to the supplier.
25. **Invoice Scanning:** open the page only — **do not upload.**

## F. Staff

26. **Schedule:** build next week; see gaps and labor cost before publishing; publish. **Staff availability:** as the server (🙋 **PERSON** types the password) say when they can work; a shift outside it is flagged.
27. **Shift swaps:** as the server, give a shift to the cook; as a manager approve. **Expect:** it moves only after approval.
28. **Time off:** ask as the server; decide as the owner.
29. **Labor forecast:** **Expect:** a sales forecast by day and hour and the staff each position needs (may say there's not enough history yet).
30. **Tips:** **tip pooling** by role and hours with a tip-out to the kitchen; **declared cash tips** at clock-out (as the server); a manager corrects one. **Tips from another register:** **Expect:** a polite "connect Toast / Square".
31. **Payroll export:** **Expect:** a file with hours, overtime, tips and tip-outs per person.

## G. Private events

32. **Spaces:** add "Back Room", 40 seated, minimum spend $800. **Food & beverage minimums** by day of the week. **Catering menus:** a per-head package with courses and choices.
33. **Website event enquiries:** fill the website's event form (the form offers the rooms and whether each looks free). **Expect:** it opens in the event book.
34. **Events:** move the enquiry to confirmed; a second enquiry for the same room and time **is refused** (double-book protection). **Room calendar & waitlist:** put the second one on the waitlist.
35. **Holds that lapse:** a hold ending in 3 days. **Expect:** the reminder is listed.
36. **Event proposals & contracts:** a contract template with merge fields; send a proposal with two signers; open it in a private window, choose and sign as the client. **Expect:** the event books when accepted.
37. **Deposits & balances, payment reminders:** a staged schedule. **Expect:** each pay link opens a polite "card payments are not set up"; **bank (ACH) payments** say the same.
38. **Guest count cutoff:** lock 7 days before. **Run of show / BEO:** print it. **Expect:** minute by minute.
39. **Event reports:** source and year reports; **marketing spend** per source; **reports by email** weekly. **Expect:** saved.
40. **Event form rooms & campaign embeds:** **Expect:** the embed code shows.

## H. Other features

41. Invoices, contacts, documents, support tickets, QuickBooks, Lead Inbox, Reviews, Email inbox, Messages, Email marketing, Reports, Receivables aging: each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

42. Open **every** item in the owner's menu and every Settings tab (Register Settings too), one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

43. Sign in as the **manager**. **Expect:** runs the register, schedule and stock; approves voids and swaps; no billing or team-changing controls they shouldn't have.
44. Sign in as the **server**. **Expect:** the register, their own shifts and tips; no costs, no payroll, no other staff's pay; owner-only addresses typed in the bar are refused.
45. Sign in as the **cook**. **Expect:** the grill screen and their shifts only.

## O. Finish

46. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
47. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
