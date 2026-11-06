# Home care parity: visit optimizer (smart scheduling of vacant visits)

Research date: 2026-11-06. Wording paraphrased from the pages listed.

## Leaders checked

- AlayaCare: [Visit Optimizer launch (Home Care Magazine)](https://www.homecaremag.com/news/alayacare-launches-visit-optimizer-automation-vacant-visit-scheduling), [Meet Visit Optimiser (AlayaCare press release)](https://alayacare.com/en-au/meet-visit-optimiser-alayacares-new-solution-for-scheduling-open-visits/). A premium add-on; no help-centre article found.
- AxisCare: [AxisCare Intelligence](https://axiscare.com/axiscare-intelligence) (AI scheduling that favours caregiver preferences, availability and travel limits; no workflow described).
- WellSky Personal Care: nothing found on bulk filling of vacant visits.

## Capabilities

| Capability | Leader(s) | Source | Our status |
|---|---|---|---|
| Filter which vacant visits to fill | AlayaCare | press release | **matches** (row 14/15, hidden `care_visit_optimizer`): a date range (up to 31 days) and optionally one client. Proof: `tests/homecare-parity-row15.test.ts` |
| Objectives the scheduler sets: minimise travel time, maximise continuity, maximise skills matching, minimise wait times, optimise daily hours, optimise weekly hours | AlayaCare | press release | **matches**: the same six, each weighted Ignore / A little / Matters / Matters most, saved as the agency's settings and changeable per run. Travel is straight line × 1.3 at 30 mph from the visit before that day (else home), so it works without a maps key; wait is the gap after travel; daily hours over 8 and weekly over 40 count heavily. |
| Uses availability, client preferences, skills and service area | AlayaCare | Home Care Magazine | **matches**, with service area as distance: the rule auto-fill and the suggestion list use (do-not-use, time off, unavailable, outside their hours, an expired credential the agency blocks, a clash) and, with `care_match_prefs`, skills, certifications, gender, language, the home, must-haves and the caregiver's travel limit. |
| Bulk assign vacant visits | AlayaCare | both | **matches**: the scheduler reviews the proposed caregiver for each visit (with the next three), can pick another or leave it open, then assigns the chosen ones at once. Each is checked again at that moment; a stale one is refused with the reason, never forced. |
| Bulk offer vacant visits to care workers | AlayaCare | press release | **matches**: "Offer them instead" sends each chosen visit to its proposed caregiver and the next three through the open shift's own notify (push, in-app; credential blocks honoured). |
| Machine learning / AI | AlayaCare, AxisCare | both | **not doing.** Fixed, explained rules; every proposal says why (travel minutes, visits with the client, wait, hours that day and week, the match reasons). |
| Prescribed travel routes, map view | AlayaCare | Home Care Magazine | **not doing** here; the Route Optimizer screen (older code) orders one caregiver's day. |

## Status summary

- Built, hidden (`care_visit_optimizer`): Schedule → Visit optimizer. 9 tests through the real server and the pure rules.
- Owner must verify by hand: run it on a real week, check the proposals feel right, and try both assign and offer.
