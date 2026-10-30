# Landscaping parity — gap 4: measure from the satellite map, price, add to a quote

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own pages. Marks: **matches**, **beats**,
**not doing (why)**, **NOT BUILT (what parity needs)**. "UNCONFIRMED" = no official page could be read.

**Status: the server is built and proven. The map screen is WRITTEN BUT NOT TESTED — there is no Google Maps browser key in
the build environment, so the drawing has never run. Do not call this done until someone draws a shape on a real property.**

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | Click corners on the satellite view, area updates live, several areas per property — Yardbook ([lot measurement](https://support.yardbook.com/faq-i-want-to-measure-lot-sizes-using-satelite-images/)); Jobber's manual route is Google Maps' own measure tool ([measure property](https://help.getjobber.com/es/articles/how-to-measure-property-distance-and-size/)) | **matches (written, untested on screen)**: Area Pricing › "Measure on the Satellite Map": pick a property, choose lawn / beds / hardscape / driveway / whole lot, click corners, Finish; corners are draggable; live area; the property's address centres the map. |
| 2 | Area saved on the property by type; add to or replace the existing size — Yardbook (four checkboxes) | **matches**: the property's lawn/bed/hardscape/lot/driveway columns are set to the sum of its shapes of that type; saving the whole set replaces it; a type never drawn keeps what was typed by hand. |
| 3 | Cut-outs from a shape — Aspire PropertyIntel ([advanced features](https://www.youraspire.com/blog/propertyintel-new-advanced-features)) | **matches**: a shape can "cut out of" an area (a bed inside a lawn); never below zero. |
| 4 | The measured value feeds the price and the quote — Jobber (Deep Lawn square footage on the quote; [measure](https://help.getjobber.com/es/articles/how-to-measure-property-distance-and-size/)); Aspire takeoffs → kits ([property takeoffs](https://guide.youraspire.com/docs/property-takeoffs-screen)) | **beats**: Area Pricing's rule is unchanged (max(min charge, area ÷ 1,000 × rate)) and now reads the drawn areas; "Add to quote" on the price puts the line on a new quote or on one of the customer's open quotes, as a normal line or an option the customer can tick (server `POST /api/area-pricing/quote/add`, price recomputed server-side). The quote form's own "Add area-priced line" (already there) reads the same areas. |
| 5 | Aerial AI detection of surfaces — Aspire ProMaps; Jobber Deep Lawn; LMN via Attentive.ai (press) | **not doing**: needs a paid imagery/AI provider. Hand-drawn shapes are the "polygons on Google Maps" the brief asked for. |
| 6 | Measure on uploaded PDF plans / takeoffs for installs — Aspire | **not doing** (brief: takeoffs for installs are out of scope now). |
| 7 | PDF/print export of the measurements — Yardbook | **NOT BUILT.** Parity needs an export of the shapes over the satellite image. |
| 8 | Overlapping shapes merged — Aspire | **NOT BUILT.** Overlaps are summed (draw a cut-out for the overlap). Parity needs a union step. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-measure.test.ts` (6). Migration 0045 `site_shape` (corners, area type, add/cut, server-measured
area). `GET/PUT /api/area-pricing/sites/:id/shapes` (contacts:read / contacts:update), `POST /api/area-pricing/quote/add`
(quotes:update). The area is worked out by the server from the corners (sphere formula, within 1% of a flat measurement; the
figure typed by the screen is ignored); a viewer is refused; a shape with fewer than three corners, an unknown area type or a
corner off the planet is refused in words with nothing saved; a closed quote refuses an added line.

## Not checked

- **The map.** `MeasureMap.tsx` loads Google Maps with the browser key the server serves (`GOOGLE_MAPS_BROWSER_KEY`); with no key it
  says so and manual entry still works. Google's Drawing library is being retired, so corners are collected with plain map clicks.
  It type-checks and builds; it has not been run.
- Accuracy vs. the leaders is that of Google's imagery and the person clicking.
