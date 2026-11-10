# Retail store — full live test, start to finish (for Claude in Chrome)

A real shop's whole path: sign up on twomiah.com, pay (with a coupon), get the online store built, sign in, set it up, then use every feature — products, the storefront, orders, customers, returns and marketing. **Claude in Chrome does every step itself.** It stops and asks the person only where it says **🙋 PERSON** — card and coupon details, and passwords (Chrome does not type those). After the person is done, Chrome carries on.

Use the **test inbox** (`twomiah14+…@gmail.com`) for every email address — that marks the site as a test site so it can be deleted cleanly afterwards.

**How to work through this:** do each step in order, as the **owner** unless the step says otherwise. Mark each step **PASS** or **FAIL**. For a FAIL, write what you saw (the words on screen, a screenshot) — not what you think caused it.
**Every page, every time, also check:** no "Something went wrong", no blank white page, nothing cut off or overlapping, buttons say what they do, words are a shop's (products, orders, customers — not jobs or quotes). Repeat any step marked 📱 at phone width (about 390 px wide) if the browser allows it.

**Things that cannot work without the shop's own accounts (expect a polite "not connected" message, not an error):** taking cards at checkout (no Stripe connected — checkout, fast checkout, refunds to a card), shipping labels, QuickBooks, Meta / Google Ads audiences, Google reviews, branded email. If one of these crashes or shows a raw error instead of a sentence, that is a FAIL.

**Do NOT use (it costs money per use):** the **Product Writer's "draft" button** (open it only — don't ask it to write), and the help assistant's chat box.

You need two or three small product photos (any images).

---

## A. Signup and payment

1. 📱 Go to https://twomiah.com and click the sign-up button for the CRM plan (it opens `twomiah.com/signup.html?plan=starter10`).
2. Choose **Retail Shop**. Business name: `Chrome Test Goods`. Email: `twomiah14+chromeshop@gmail.com`. Address: 214 Water St, Eau Claire, WI 54703. Phone: 715-555-0100. 🙋 **PERSON:** types the password.
3. Go through every signup step. **Expect:** each step speaks of products and a shop (no "services" step); the look pictures show a **shop**; "moving from" offers Shopify, WooCommerce and the rest; errors are in plain words.
4. At Stripe's payment page Chrome stops. 🙋 **PERSON:** enters the coupon and a card, and pays; then Chrome carries on.
5. **Expect:** a page saying the site is being built.
6. Check **twomiah14@gmail.com**. **Expect:** within about 15 minutes, the site-ready email. Write down the store's address.
7. **Tell Claude Code the site is built** (paste the address). Wait for the go-ahead.

## B. First sign-in and setup

8. Sign in from the email; 🙋 **PERSON:** types the password. **Expect:** the setup wizard with the details filled in.
9. Walk every step of the wizard and **Store Settings**. **Expect:** each makes sense.
10. 📱 **Dashboard:** the shop's home — sales, orders, low stock; none NaN or undefined.
11. **Team:** add a staff member `twomiah14+chromeshopstaff@gmail.com`. 🙋 **PERSON:** sets the password.

## C. Products

12. **Products:** add a T-shirt with sizes S / M / L and two colours (variants), prices and stock, and photos; a Mug with one price. **Expect:** saved; the storefront shows both.
13. **Product Writer:** skip on a test site — it is a paid AI feature that test sites never switch on, so it is correctly absent from the menu.
14. **Stock alerts:** set the T-shirt M / blue level to 2. **Supplier reorders:** add a supplier; draft a purchase order from what is low. **Expect:** saved.
15. **Discounts:** a 10 % code. **Gift cards, store loyalty, customer groups, shipping, product reviews:** open each and add one thing. **Expect:** saved.

## D. The storefront

16. 📱 Open the store in a private window. Browse; add the T-shirt (M / blue) and the Mug to the cart; enter the 10 % code and your region (US, WI) and press **Apply**. **Expect:** the discount, shipping, tax and total shown and right; the code and region stay in their boxes after applying a gift card or changing a quantity.
17. Check out. **Expect:** card payment says it isn't set up yet (no raw error).
18. **Customer accounts:** sign in as a shopper with `twomiah14+chromeshopper@gmail.com` (the emailed link or code from twomiah14's inbox). **Expect:** their orders, addresses and "order again".
19. **Fast checkout:** **Expect:** a polite note that it needs the shop's Stripe.

## E. Orders and returns

20. **Orders:** make an order by hand for the shopper (the CRM's "new order"), choose **Already paid in person › Cash**, fulfil it. **Expect:** the stock drops; when the T-shirt hits the alert level, one email is listed.
21. **Returns and exchanges:** the shopper starts a return from their account; approve it; receive the goods back; refund (cash, or the polite not-connected note for a card). **Expect:** the stock comes back.
22. **Post-purchase emails:** a first-order follow-up. **Expect:** saved and listed for the order.

## F. Customers and marketing

23. **Customers:** the shopper is listed with their order. **Segments:** "spent over $20". **Expect:** the shopper is in it.
24. **Audiences & purchase tags:** send the segment as a file. **Expect:** the file downloads (direct send says Meta / Google not connected).
25. **Email marketing, review requests:** switch them on in Settings › Features if needed; open each. **Expect:** loads.

## G. Reports and connections

26. **Sales:** over time, top products, repeat customers, average order. **Expect:** numbers match what you did.
27. **Apps & integrations:** **Expect:** one page listing payments, shipping, QuickBooks, email and the rest with their state.
28. **Store API:** make a key that can only read products; **Webhooks:** add an address for "order paid". **Expect:** saved; the key is shown once.

## H. Other features

29. Lead Inbox, Google reviews, Email inbox, domain, audit: each opens and says what it holds (or a polite not-connected note).

## M. Every other page in the menu

30. Open **every** item in the owner's menu and every Settings tab, one by one. **Expect:** each loads with no error; empty pages say what will appear there.

## N. Roles

31. Sign in as the **staff member**. **Expect:** orders and products; no billing, API keys or team-changing controls they shouldn't have; owner-only addresses typed in the bar are refused.

## O. Finish

32. Write up: total PASS / FAIL, and every FAIL with what was on screen. Send it back to Claude Code to fix.
33. When everything is fixed and re-checked, tell Claude Code to delete the test site (it also cancels its subscription).
