# Bar 11 - Menu "back at open", sections by time window, and item counts

Feature ids: `menu_dayparts` (hidden, not ready) and, from the 10/31 parity round, `menu_item_counts` (hidden, not ready). Tests: `apps/unified/tests/bar-menu-count-depth.test.ts` (7), `bar-menu-windows.test.ts` (3), `bar-item-counts.test.ts` (4).

Leader: Toast menu availability - https://support.toasttab.com/en/article/Settings-Menu-Availability ; Toast automatic stock refresh - https://doc.toasttab.com/doc/platformprerelease/platformRefreshingAMenuItemsStockAutomatically.html

| Leader capability | Ours | Mark |
|---|---|---|
| Section served in time windows, by day | Any number of windows per section - breakfast, lunch, happy hour, late night - each with its own days; the section is served in any of them. The first window stays in the three columns it always had, the rest in `available_windows`, so nothing already typed is lost. The website menu, online ordering, the kiosk and the register's picker leave a section outside every window, and the register refuses a line from it naming every window. Up to 8 windows, each checked in words | matches |
| 86 an item until the next day/open | "86 until we open" comes back at the next opening (kitchen hours, else bar, else 5 AM) on the venue clock | matches |
| Stock quantity refresh (a count that counts down and resets) | Staff set how many of an item are left ("12 left") and, if they like, what it refreshes to at open. Each sale takes one - on the register, a kiosk order or a website order - and at zero the item 86es itself; a held line taken off, a quantity lowered or a line voided gives the count back and brings a count-86 back on (an 86 by hand is left alone). The count comes back to its refresh figure at the next opening on the venue's clock, once per opening, on the menu's next read, or when staff set it. The register, the kiosk and online ordering carry the figure; the phone's 86 board sets it | matches |

Unverified: not seen in a real browser (the section's window list, the count control, "12 left" on the register and kiosk) or on a real phone.
