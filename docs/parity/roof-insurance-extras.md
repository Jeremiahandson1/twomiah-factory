# Roofing parity — insurance extras (gap 7)

Leader: AccuLynx (supplement tracker, mortgage checks). Read from AccuLynx's own page on 2026-10-30; where the page said
nothing about a point it is marked "not stated", never assumed.

Source
- AccuLynx: [Tips for Managing Your Roofing Permits, Mortgage Checks, & Supplements](https://acculynx.com/managing-insurance-restoration-roofing-jobs/). The page covers permits, mortgage checks and supplements. It does **not** mention held (recoverable) depreciation, a certificate of completion, or the mortgage company's endorsement as a status. Those two ideas come from the owner's brief, so the rows for them below are "beyond what the page states", not parity.

## The list, each marked

| # | What AccuLynx does (per its page) | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Supplements tracked in one area with statuses; created from the job file with a status and notes | Already built before this change: supplements numbered per claim, draft / submitted / approved / denied, with the amounts asked and approved and a trail (`server/crm/roof/insurance/insurance.ts`) | **Matches** (existing) |
| 2 | Add your own pre-set supplement statuses (under review, pending re-inspection, need more information from rep) | Our statuses are fixed (draft, submitted, approved, denied). Parity needs company-defined supplement statuses | **Not doing** (needs a supplement-status setting) |
| 3 | A "track" view of supplements in progress, in two columns (requested / in progress) | The claim page lists its own supplements. There is no list across all claims | **Not doing** (parity needs a cross-claim supplement list) |
| 4 | Mortgage check recorded on the job: company, amount, send date, tracking number | Each check keeps mortgage company, loan number, check number, amount, the day it arrived, the day it was sent, a tracking number, and notes (`mortgage_check`, `extras.ts`) | **Matches** |
| 5 | Track menu shows all mortgage checks in one place — "where in the pipeline the funds are" | **Insurance follow-ups** page lists every check not yet banked with its stage; the claim page lists that claim's checks | **Matches** |
| 6 | (not stated) The mortgage company's endorsement as a status | A check moves received → sent to the mortgage company → endorsed → deposited, each stamped with its day; going back a step clears the later days; every move is a line in the claim's trail | **Beats** (on what the page states) |
| 7 | (not stated) Held depreciation released by a certificate of completion | When a job whose claim holds depreciation is done (Final Inspection, or Invoiced / Collected reached without it) ONE reminder is made: a line in the claim's trail, a note on the job and a phone notice to the sales rep (else the owner). "Held" is the depreciation typed on the claim, else RCV less ACV. The claim page and the follow-ups list show it as "send the certificate" → "waiting on the carrier" → "released", with the amount released and any shortfall | **Beyond the page** (owner's brief) |
| 8 | Permits tracked with a payment amount and a status board | Not part of gap 7 | **Not doing** |

## What this change builds
- Not-ready feature `insurance_extras` ("Insurance Follow-ups"), offered to roofing and to no plan (`featureRegistry.ts`). Switched off: no reminder is made and the routes are shut.
- `server/crm/roof/insurance/extras.ts` at `/api/insurance-extras`: the depreciation list and per-claim state, "certificate sent", "released" (the carrier's money, so `insurance:approve`), and the mortgage check routes.
- Table `mortgage_check` and four columns on `insurance_claim` (migration `0041_roof_insurance_extras`). Nothing existing is rewritten.
- The reminder runs from `stageEffects.ts` `stageReached`, which Advance, the job form and a payment that collects the job all call.
- Screens: two cards on the claim page and an "Insurance follow-ups" page (`web/src/crm/pages/roof/insurance/InsuranceExtras.tsx`), shown only with the feature on.
- Permissions: reading is `insurance:read`; filing a check and sending the certificate are `insurance:create`; moving, editing a check is `insurance:update`; deleting is `insurance:delete`; recording the release is `insurance:approve`. Amounts are the books' (`invoices:read`): a seat without them sees the check or claim without the figure.

## Still needed for full parity (not in this change)
Rows 2 and 3 (company-defined supplement statuses, and a list of supplements across claims), and row 8. The phone app has no insurance claim screen today, so there is no phone screen for these cards; the reminder reaches the phone as a notice. Parity with a phone claim screen needs that screen built first.
