# Live test — parity tiers 2–3 (Claude in Chrome)

Four test sites, deployed from `engine` after PR #347 is released: **field service**, **contractor**, **store** and **roofing**.
Every tier 2–3 switch is on, and the forbidden ones stay off (measurement_reports, ai_call_answering, visualizer,
bar_invoice_scan, store_ai_writer). Password for every seat: `Password1`. Each step says what to do and what you should see.
Save a report per site to Downloads (`tier23-<trade>.md`): PASS / FAIL per step, with what you saw on each FAIL.

Before starting on each site, make two people so there is someone to dispatch: **Settings › Users**, add
"Tia Tech" (Field) and "Gus Tech" (Field).

---

## A. Field service

1. **Days off.** Settings › Days off: add next Friday ("Staff day"). Create a job on that day.
   → "The business is closed on … Book anyway, or pick another day." Book anyway works.
2. **Skills.** Settings › Skills: give Tia "Gas", give Gus "Gas, Install"; job type "Furnace install" needs "Gas, Install".
   - Create a "Furnace install" job for Tia. → It warns that Install is missing. Book anyway works.
   - Dispatch Board: tap **Move** on that job. → The banner names Gus ✓ first and Tia as "missing Install"; Tia's lane says "Missing Install", Gus's says "Has the skills".
3. **Service zones.** Settings › Service zones: "East" with ZIP 53714; tick Tia under "Who works East"; set "Jobs a day, at most" to 1. Save.
   - Create a job in 53714 for tomorrow. Then create a second one there for the same day. → "East is full on …: 1 of 1 jobs already booked there." Book anyway works.
   - New job in 53714, then **Find a time**. → "In East — showing the people who work East", only Tia offered, tomorrow listed as full.
   - Dispatch Board, zone filter "East". → Only Unassigned and Tia's lanes (plus anyone a shown job names).
4. **Where's my tech.** Start "On my way" on a job that has an address (Tia's seat), then open the link from the text log.
   → "Tia is on the way". With a location from the phone it shows the map and "About N minutes away". Starting the job → "has arrived".
5. **Photo folders.** On a job's photos, make a folder and move a photo into it.
6. **Change orders.** On a job: add a change order, then send it. The client signs it from the portal. → The approved amount is added to the job.
7. **Online booking in the portal.** Customer portal → **Book online** card → book a time. → The job appears on the schedule.
8. **Credit memos.** On a customer: Customer credit › $50 "Late arrival". → Listed as "Credit issued CM-0001" with a **PDF** button; the PDF opens.
   - Pay an invoice from it: Record payment › Account balance.
   - Reports: "collected" does NOT go up by the credit.
9. **Lead map.** Lead Map: leads with a location show as pins (they need the Google key, as before).
10. **Marketing ROI.**
    - Settings › Call tracking: a tracking number with source "Google Ads".
    - Marketing ROI: enter spend for Google Ads this month. The table has a **Calls** column.
    - "Where it came from" shows circles by ZIP, and the "Customers from" picker narrows the map to one source.
11. **Caller ID.** Log an inbound call from a customer's number (Call tracking, or the test webhook). → A pop at the bottom right shows their name, open jobs, what they owe, and **Open their record**.
12. **Website chat-to-text.** Open the public website. → "Text us" button bottom right. Send with the box ticked.
    → A lead in the Lead Inbox, and the message in Texting as from them. Unticked: a lead only.
13. **Scorecards.** Team Revenue: the technician and office scorecard tabs show each person's figures.
14. **Equipment / parts on the phone.** These need a real phone; the desktop part of it:
    - Settings › Users: Tia can see Inventory.
    - The PDF / phone steps go on the morning's phone list.

## B. Contractor

1. **Weekly client update.** Settings › Weekly Client Update: on, today, an hour ago.
   - Share a daily log and an OLD photo with a client who has a portal and an email.
   - Wait for the hourly pass (or ask Claude to run it). → One email with "Like this update, or reply".
   - Open that link: Like, then write a reply. → Settings shows "Liked it" and the reply. The customer's activity shows both.
2. **Builder's risk.** On a project: square feet 3,000 and builder's risk details.
   - Projects list: **Sq ft**, **Price / sq ft** and **Cost / sq ft** columns.
   - The project shows "Cost so far per sq ft".
3. **Bid packages.** On a project, a bid package with two lines; invite a vendor. The vendor submits prices from their link; award it. → A purchase order is made.
4. **Schedule baseline.** Gantt: on a project with tasks, Baseline › save. Move a task 3 days later.
   - → The grey ghost bar sits under the moved task.
   - "Show every project against its baseline" → the project shows "3 days late", Tasks late 1.
5. **Credit memos** (as A8) and **photo folders** (as A5).

## C. Store

1. **Texting (opt-in).** Settings: Texting is NOT listed. Switch Two-Way Texting on (Claude does this) → the Texting card appears.
2. **Stock by location.** Stock by location: add "Front shop" and "Back room". Give a product 5 at each.
   - Sell at the counter with "Selling at: Back room". → The back count drops.
   - Place an online order. → The order page shows "Filled from Front shop" with a picker. Change it to Back room. → The units move (front back up, back down).
   - Mark it sent. → The picker is gone, and the order says why.
3. **Sell at the counter.** Scan or type a SKU, cash. → Order made, picked up, receipt by email.
4. **Reports.** Store › Sales › **More reports**: try each of
   - Sales by customer, Sales by channel (Online store / At the counter), Sales by place, Taxes, Refunds given, Inventory value.
   - Each has a **Spreadsheet** button.
   - Saved and emailed reports: the report list includes the six new ones.
5. **Carrier rates.** Needs a real EasyPost key on the test store. Skip unless the owner adds one.
6. **Barcode.** Counter: a USB scanner (or typing a barcode) adds the exact product.

## D. Roofing

1. **Weekly client update** (as B1, using a job's shared photos / documents / inspection report and the roofer's posts).
2. **Skill matching** (as A2) and **days off** (as A1).
3. **Credit memos** (as A8).
4. **Lead map** (as A9).

## Phone (with the owner, real device)

- **Stock › scan a box's barcode.** → The part opens.
- On a part with stock, while a job is under way: **Use on a job**, pick the job and where it was taken from, then quantity. → "Added to the job"; the desktop job's parts list shows it.
- **More › Equipment** (barcode scanning on): scan the serial on a unit's data plate. → The unit opens with its customer, warranty and service history.
- **Where's my tech**: switch on "Share my location while working", start "On my way". → The customer link shows the map and the minutes.
