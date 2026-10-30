# Bar 11 - Menu "back at open" and sections by time window

Feature id: `menu_dayparts` (hidden, not ready). Test: `apps/unified/tests/bar-menu-count-depth.test.ts` (7 tests).

Leader: Toast menu availability - https://support.toasttab.com/en/article/Settings-Menu-Availability ; Toast automatic stock refresh - https://doc.toasttab.com/doc/platformprerelease/platformRefreshingAMenuItemsStockAutomatically.html

| Leader capability | Ours | Mark |
|---|---|---|
| Section served in a time window, by day | One window per section, with days; hidden from website, kiosk, online ordering and register picker; register refuses a line | partly - one window per section, Toast allows several |
| 86 an item until the next day/open | "86 until we open" comes back at the next opening (kitchen hours, else bar, else 5 AM) on the venue clock | matches |
| Stock quantity refresh (set a count that resets) | Not built; an 86 is on/off, not a quantity | not doing - quantity belongs to the stock module |
