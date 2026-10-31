# Bar 13 - Fill-level slider per bottle on the blind count

Feature id: `stock_fill_levels` (hidden, not ready). Test: `apps/unified/tests/bar-menu-count-depth.test.ts`.

Leader: Backbar bottle slider - https://www.getbackbar.com/support/how-to-use-bottle-slider-inventory

| Leader capability | Ours | Mark |
|---|---|---|
| Slider per open bottle on the count | Fill slider per bottle on the web count screen | matches |
| Partial bottles add to the on-hand total | Level counted as a fraction of a bottle | matches |
| Blind count keeps expected hidden | Slider added to the blind count | matches |
| Phone count | A fill level field (no slider) | partly |
| Scale/weight integration | Not built | not doing |
