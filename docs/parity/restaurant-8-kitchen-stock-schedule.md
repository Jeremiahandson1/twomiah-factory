# Restaurant 8 - Offer stock and schedule to a restaurant, opt-in, kitchen wording

`bar_stock` and `bar_schedule` are offered to `crm-restaurant` as opt-in (off by default) with kitchen wording. Test: `apps/unified/tests/restaurant-kitchen-stock-schedule.test.ts`, on a restaurant tenant (stock count, register sales, receiving, variance in dollars, below-par order; schedule, labor cost, publish, time off, PIN clock-in).

Three rows below were built after that (restaurant-bar parity #7, #8, #9). Each has its own feature id, registered hidden (not ready) and gated on both sides (the route and the menu item or tab): `bar_invoice_scan` (Stock > Invoices, and the phone), `bar_payroll_export` (Payroll, `bar:manage`), `bar_labor_forecast` (the Schedule page, `bar:update`). Tests: `apps/unified/tests/bar-invoice-scan.test.ts`, `tests/mobile/bar-invoice-scan.test.ts`, `apps/unified/tests/bar-payroll-export.test.ts`, `apps/unified/tests/bar-labor-forecast.test.ts`. Migration: `0058_bar_invoice_scan` (the only new table).

Leaders: Toast inventory / 7shifts scheduling - https://kb.7shifts.com ; BevSpot - https://www.bevspot.com/

| Leader capability | Ours | Mark |
|---|---|---|
| Count, receive, variance report | Present, in dollars | matches (counting and variance) |
| Recipe-based usage from sales | Recipes link stock to what the register sold | matches |
| Auto purchase orders by par | Drafts an order for the supplier | matches |
| Invoice scanning | Photograph or upload a supplier invoice (web: photo, JPEG/PNG/WebP/GIF, or PDF; phone: photo, online only). It is read into lines (item, size, quantity, price), matched to stock items, checked and corrected by a person, and only then received: one received order, so counts and each item's cost move exactly as "It came in" moves them. A duplicate invoice number from the same supplier is refused; hand matches are remembered for next time | matches on the flow. **Partly** on the reading itself - see below |
| Schedule with labor cost before publish | Yes | matches |
| POS-driven labor forecast | Sales by day and hour from the register's paid checks as the same-weekday, same-clock-hour average over the last N weeks that are over (4 unless the venue sets 2 to 8), with the number of days it was made from, and "not enough history" (fewer than 2 days) instead of a number. Confirmed private events are listed on their day, not added in. Staffing: hours per position that fit sales x the venue's target labor % (30 unless set) at the pay of the people who work each position, split as the last weeks' schedules split the hours, shown against the hours on the schedule; the week's labor % is shown once every open day has a forecast | matches. Not built: it does not write shifts for you; events are shown beside the number, not turned into sales; overtime is ignored in the suggestion; no weather or local-events signals |
| Time off, PIN clock-in | Yes | matches |
| Payroll export | A pay period's hours (time clock), overtime, tips, tip-outs and pooled tips per person, as Gusto's hours-and-tips upload, ADP's paydata import, or a plain spreadsheet. Cash tips already in hand are counted once | partly - the files are built from published pages, never uploaded to a real Gusto or ADP account (see below) |

## Invoice scanning: what is a real reader and what is not

- **Real reader:** Claude over Anthropic's Messages API (the same bare-fetch pattern as the other AI features, `ANTHROPIC_API_KEY`, usage reported), given the photo as an image block or the PDF as a document block, asked for JSON lines. Without a key the screen says so in the owner's words and nothing is read.
- **Never run against the live API.** The tests answer with a fake that returns what the API documents. How well it reads a real, smudged, folded invoice is **not known**; that is why a person checks every line before anything changes and nothing is ever received automatically.
- **Not a reader:** there is no OCR fallback and no template per supplier. A supplier invoice the model cannot read gives no lines and no scan is kept.
- Limits that are enforced: JPEG/PNG/WebP/GIF/PDF only, 10 MB (an image 5 MB, Anthropic's limit), 40 readings per company per day (each is a paid call), a failed reading leaves no row and no file.
- Matching is a suggestion by product words (size and pack words ignored). An exact name is "sure"; a partial one is flagged as a guess; below half the words no match is offered. A person's own match is remembered per supplier.
- Phone: online only. The offline queue does not hold photos, so a photo or a fix with no signal says it was not sent or saved; it is never queued.
- Not seen in a real browser or on a real phone.

## Payroll export: the rules and what could not be confirmed

**Overtime rule used (shown on the Payroll page):** hours worked past the venue's weekly threshold (setting, 40 by default, 1 to 80 in quarter hours) in the company's work week (company work-week start, Sunday unless set). Hours are counted in the order worked, so a week that began before the pay period brings its earlier hours; a week still running past the last day is not in this period. **Daily overtime (over 8 or 12 hours in a day, as California, Alaska, Nevada and Colorado require) is not calculated**, and the page says so for those states. Gusto and ADP add the overtime pay rate; the files carry hours, never wages.

**Tips:** each person's tips are counted once (`tips.report`, the nights that were closed). Cash already in hand - cash tips rung on our register (credited to whoever closed the check, as the pool credits it) plus the cash they declared (`declaredByPerson`) - is shown apart and taken off "tips on paycheck". A person who holds more cash than their share shows a negative figure in the spreadsheet and 0.00 in the Gusto/ADP files, with a warning. Nights with tips that were never closed with tip rules set are listed as a warning and are not in the file. Tips imported from another register (Toast, Square) are treated as paycheck tips.

**Gusto:** Gusto's CSV upload ("Smart Import") matches columns by name. The pages that could be read give no fixed employee template, no tip columns and no double-overtime column. The file uses First Name, Last Name, Email, Regular Hours, Overtime Hours, Total Hours (the repo's existing Gusto hours file) plus Paycheck Tips and Cash Tips when someone has tips. **Not confirmed:** that Gusto maps those two tip columns. Try one real file first.

**ADP:** the layout is the "EPI" paydata import as the 7shifts help page lists it (Co Code, Batch ID, File #, Employee Name, Temp Dept, Temp Rate, Reg Hours, O/T Hours, Hours 3/4, Earnings 5), file named `EPI<company code><batch>.csv`, tips in Earnings 5 under an earnings code the venue types (T by default; ADP's own table must have it). **Not confirmed:** ADP's own specification was not read (third-party pages only); the six-digit Batch ID a third party mentions is not enforced; each person's File # is typed by the venue and the ADP file is refused until every person with hours has one.

Nothing is sent to Gusto or ADP; the file is a download. A plain spreadsheet is always available. Not seen in a real browser.

## Labor forecast: what it is and is not

- Sales are net (subtotal less gift cards sold) of paid checks, bucketed by the clock hour on the company's clock; a night runs 4 AM to 4 AM, so 1 AM counts to the night before. Money is whole cents.
- A past day counts as a sample only if the register took sales that business day (a shut day is not a day of zero); inside a sample day an hour with no sales is a real zero. Hours are rounded one by one, so they can differ from the day's total by a few cents.
- The staffing figure is a guide to a labor budget, not a minimum crew; coverage warnings on the schedule still stand.
- Not seen in a real browser, and never run on a real venue's sales.
