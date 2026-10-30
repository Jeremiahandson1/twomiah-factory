# Restaurant 8 - Offer stock and schedule to a restaurant, opt-in, kitchen wording

No new feature id. `bar_stock` and `bar_schedule` are offered to `crm-restaurant` as opt-in (off by default) with kitchen wording. Test: `apps/unified/tests/restaurant-kitchen-stock-schedule.test.ts`, on a restaurant tenant (stock count, register sales, receiving, variance in dollars, below-par order; schedule, labor cost, publish, time off, PIN clock-in).

Leaders: Toast inventory / 7shifts scheduling - https://kb.7shifts.com ; BevSpot - https://www.bevspot.com/

| Leader capability | Ours | Mark |
|---|---|---|
| Count, receive, variance report | Present, in dollars | matches (counting and variance) |
| Recipe-based usage from sales | Recipes link stock to what the register sold | matches |
| Auto purchase orders by par | Drafts an order for the supplier | matches |
| Invoice scanning | Not built | not doing (stated out of scope) |
| Schedule with labor cost before publish | Yes | matches |
| Time off, PIN clock-in | Yes | matches |
| Payroll export, POS-driven labor forecasts | Not built | not doing |
