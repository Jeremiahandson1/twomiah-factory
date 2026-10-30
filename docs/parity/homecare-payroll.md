# Home care parity: payroll, overtime, travel, mileage, payroll files

Researched 2026-10-30 from public help and product pages only. All wording is paraphrased. Page contents were read through a summarising fetch step, so re-open a link before building to a detail.

## Leaders checked

- AxisCare (help.axiscare.com was blocked in this environment): https://axiscare.com/press/axiscare-launches-full-service-payroll-solution , https://info.adp.com/axiscare
- WellSky Personal Care (formerly ClearCare): https://netchex.com/wellsky-integration/ , third-party guide https://www.acciyo.com/clear-care-payroll-step-by-step-guide-to-processing-and-exporting-caregiver-pay-data/
- AlayaCare: https://alayacare.com/platform/overview/optimize-payroll-and-hr-functions/ , https://alayacare.com/wp-content/uploads/2025/02/California-Compliance-Checklist-3-Software.pdf
- Payroll vendors: Paychex https://myapps.paychex.com/pngHelp_static/helpHtml/Standard_Payroll_Import_Overview.htm ; ADP Marketplace https://apps.adp.com/en-US/apps/372723/automated-paydata-integration-for-adp-workforce-now/features ; Gusto https://support.gusto.com/payroll/payroll-settings/CSV-Upload/999913061/Upload-employees-hours-and-earnings-to-payroll.htm
- Reference vendors (NOT named leaders): Axxess AgencyCore, HomeTrak, ShiftCare, CareSmartz360, Connecteam, ClickTime, Timeero, HHAeXchange, eCaring.

## Overtime, travel, mileage

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Weekly overtime threshold (example 40) and optional daily threshold (example 8), rate normally 1.5x, switched on per caregiver | Reference: HomeTrak. ClearCare guide also mentions a weekly threshold | https://hometrak.atlassian.net/wiki/spaces/HCV6/pages/25985107/Setup+Overtime | TBD |
| Daily and weekly limits with warn-or-block behaviour and a cap on hours payable over the limits | Reference: Axxess AgencyCore | https://www.axxess.com/help/wp-content/uploads/sites/2/2022/01/Home-Care-Payroll-and-Reports-Manual-January-2022.pdf | TBD |
| Overtime follows federal and state labour rules incl. breaks, holidays, overnight stays; base and overtime rates applied to time cards | AlayaCare (general claim, no rule detail) | https://alayacare.com/?p=7858 | TBD |
| Daily overtime, weekly overtime with different thresholds for facility vs non-facility staff, consecutive-day premium, blended regular rate without stacking premiums, overnight shift handling, audit trail | AlayaCare (California checklist) | https://alayacare.com/wp-content/uploads/2025/02/California-Compliance-Checklist-3-Software.pdf | TBD |
| Double time: over 12 hours in a day paid at 2.0x; over 8 hours paid 1.5x; overnight shifts split at midnight per calendar day | Reference: ShiftCare | https://help.shiftcare.com/en/articles/15799019-california-daily-overtime-compliance-paychex | TBD |
| Seventh consecutive day in the work week: first 8 hours 1.5x, beyond that 2.0x; paid leave and holidays do not count toward the streak, sleepovers do | Reference: ShiftCare | https://help.shiftcare.com/en/articles/15799019-california-daily-overtime-compliance-paychex | TBD |
| Per pay code switch to exclude its services from the overtime calculation | Reference: HHAeXchange | https://knowledge.hhaexchange.com/provider/Content/Documentation/Admin/Admin-C-Pay-Code-S.htm | TBD |
| Paid travel: hourly travel rate; travel pay only when a per-visit travel flag is set; cap on paid minutes (20 min gap with 15 min cap pays 15); computed when payroll is finalised | Reference: HomeTrak | https://hometrak.atlassian.net/wiki/spaces/HCV6/pages/25985101/Payroll+Options+-+Setup | TBD |
| Travel calculated from scheduled location vs GPS clock-in/out, or as time between shifts; agency sets a travel pay rate | WellSky Personal Care (third-party blog, hedged) | https://www.acciyo.com/clear-care-payroll-step-by-step-guide-to-processing-and-exporting-caregiver-pay-data/ | TBD |
| Travel hours from visit notes plus estimated time from caregiver and client addresses (editable); default reimbursement rate overridable per task; rounding applies to travel | Reference: Axxess AgencyCore | https://www.axxess.com/help/agencycore/financial | TBD |
| Travel policy paid or unpaid, applied automatically; driving distance between shifts calculated and carried into payroll export | Reference: eCaring | https://ecaring.com/payroll | TBD |
| Mileage: per-caregiver default per-mile rate; travel miles vs errand miles; miles must be entered on the schedule before pay | Reference: HomeTrak | https://hometrak.atlassian.net/wiki/spaces/HCV6/pages/25985101/Payroll+Options+-+Setup | TBD |
| Mileage tracked and reported; rate set to IRS rate or agency policy (third-party blog) ; WellSky visit data into Netchex includes mileage | WellSky Personal Care | https://netchex.com/wellsky-integration/ | TBD |
| Mileage system-calculated between visit addresses (completed visits only), company or per-user rate | Reference: Axxess AgencyCore | https://www.axxess.com/help/agencycore/financial | TBD |
| GPS clock-in and EVV time records from the caregiver app feed payroll; payroll tax filing quarterly/annually; weekly or biweekly runs | AxisCare | https://axiscare.com/press/axiscare-launches-full-service-payroll-solution | TBD |

## Payroll file formats (ADP, Paychex, Gusto)

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Vendor files: ADP as .csv and Paychex as .txt, plus detailed Excel (25+ columns) for other vendors | Reference: Axxess AgencyCore | https://www.axxess.com/help/agencycore/billing/payroll-export-center/ | TBD |
| Payroll report export (CSV/Excel) formatted for ADP and Paychex | WellSky Personal Care (third-party blog) | https://www.acciyo.com/clear-care-payroll-step-by-step-guide-to-processing-and-exporting-caregiver-pay-data/ | TBD |
| ADP integration listed for AxisCare members (payroll, HR); no file or data-flow detail published | AxisCare | https://info.adp.com/axiscare | TBD |
| Direct payroll integrations for AlayaCare are described generically; ADP, Paychex, Gusto not named | AlayaCare | https://alayacare.com/platform/overview/optimize-payroll-and-hr-functions/ | TBD |
| CONFIRMED ADP layout, 11 columns A-K (home-care vendor file): A company code, B batch name, C payroll file number (must equal ADP ID), D regular hours, E overtime hours only, F department code, G pay rate (OT rows base rate; mileage rows mileage rate), H expense code fixed EXP, I expense amount, J shift code HOL or MIL, K holiday hours or mileage units | Reference: CareSmartz360 | https://www.intercom.help/caresmartz/en/articles/1884057-understanding-the-payroll-export-file-for-adp | TBD |
| CONFIRMED ADP Workforce Now paydata columns in order: Co Code (3 chars), Batch ID (6 digits YYMMDD), File # , Temp Dept, Temp Rate (blank), Reg Hours, O/T Hours (1.5x), then repeating Hours 3 Code + Hours 3 Amount pairs. File name must not be changed | Reference: Connecteam | https://help.connecteam.com/en/articles/9296467-how-to-use-adp-workforce-now-export-template | TBD |
| Variant of the same ADP layout: Company Code, Batch ID, File Number, Employee Name, Temp Rate, Reg Hours (includes OT), OT Hours left empty, then code/amount pairs; headers must not be renamed or reordered | Reference: ClickTime | https://support.clicktime.com/hc/en-us/articles/41018977335565-Export-Payroll-Data-to-ADP | TBD |
| ADP's own marketplace listing: integration sends regular and overtime hours, extra hour codes with amounts, earnings with extra codes; file number required, third after company code and batch ID | ADP (payroll vendor) | https://apps.adp.com/en-US/apps/372723/automated-paydata-integration-for-adp-workforce-now/features | TBD |
| ADP import path: Process > Utilities > Import > Paydata, file named EPI + company code + 2 digits (.csv); batch then added in Manage Payroll | Reference: Compt guide | https://compt.helpscoutdocs.com/article/119-how-to-manually-upload-a-compt-payroll-report-to-adp-workforce-now | TBD |
| ADP mileage as its own earnings code (non-taxable, set up with ADP rep); regular, OT and double-OT each mapped to an earnings code | Reference: Timeero | https://help.timeero.com/exporting-time-and-mileage-to-adp-workforce-now | TBD |
| CONFIRMED Paychex Standard Payroll Import (Paychex own doc): .csv, fixed column order, all columns present, header row optional. Required: Client ID (A, max 8), Worker ID (B, max 10), Pay Component (E, max 20). Other cols: C Org, D Job Number, F Rate, G Rate Number 1-6, H Hours, I Units, J Line Date mm/dd/yyyy, K Amount, L Check Seq Number | Paychex | https://myapps.paychex.com/pngHelp_static/helpHtml/SPI_Specification_Sheet.htm and https://myapps.paychex.com/pngHelp_static/helpHtml/Standard_Payroll_Import_Overview.htm | TBD |
| Paychex further rules: columns M-Q are overrides and Check Template (payroll checks use A-Q); R-AK are manual-check tax fields; version header row starting with 2 needed for check templates/manual checks; one file at a time; any failed line fails the whole check; [Pay] in Pay Component for a standard check | Paychex | https://myapps.paychex.com/pngHelp_static/helpHtml/Standard_Payroll_Import_Overview.htm | TBD |
| Paychex hours export where the vendor sends hours only and Paychex applies rates using the 1.5x and 2.0x export codes entered by the agency (daily and 7th-day OT merged into one 1.5x line) | Reference: ShiftCare | https://help.shiftcare.com/en/articles/15799019-california-daily-overtime-compliance-paychex | TBD |
| Home-care Paychex minimal layout: worker ID, hours, rate, line date; ADP minimal: file number, regular hours, overtime hours, temporary rate | Reference: Zingage | https://help.zingage.com/articles/3031196651-required-columns-for-payroll-ready-exports | TBD |
| Gusto Smart Import: CSV or Excel auto-mapped, blank template offered; import replaces entries for the payroll, zero overwrites, blank keeps; Gusto remembers column mapping, matches employees by name | Gusto | https://support.gusto.com/payroll/payroll-settings/CSV-Upload/999913061/Upload-employees-hours-and-earnings-to-payroll.htm | TBD |
| Gusto overtime: non-exempt staff need a workweeks column (date range, hours, earnings) so Gusto can compute regular rate of pay | Gusto | https://support.gusto.com/payroll/payroll-settings/CSV-Upload/999913061/Upload-employees-hours-and-earnings-to-payroll.htm | TBD |

## Gaps and uncertainty

- AxisCare: help.axiscare.com not fetchable. Overtime rules, travel, mileage and ADP/Paychex/Gusto file formats are not found in AxisCare material. Its tip sheet only says travel time must be accounted for.
- AlayaCare: travel time, mileage, double time and named ADP/Paychex/Gusto exports not found.
- WellSky Personal Care: no first-party payroll page found; the travel, mileage and export statements come from a third-party blog (hedged) and a Netchex page. Netchex page does not confirm overtime or travel transfer.
- ADP: no ADP-authored column spec was fetched; the layout above is consistent across three vendors but column D differs (Temp Dept vs Employee Name) and mileage/expense codes (EXP, MIL, HOL) are CareSmartz360 conventions, not ADP rules. Treat the ADP file as needing a live ADP sandbox test.
- ADP's separate Payroll Data Input API (protected PDF) was not opened.
- Paychex SPI: the spec sheet did not state which fields beyond A, B, E are required; it also did not say CSV vs fixed-width (the overview says .csv).
- Gusto: no named home care leader exports to Gusto; the employee-hours column headers were not published (a second Gusto page did not mention the workweeks column, so verify). Contractor CSV headers exist but are out of scope.
- Federal weekly 40-hour rule is only implied by threshold examples; no leader page describes it by name. State rules beyond California not found.
- Paid-travel calculation formula between visits (e.g. which gaps count, rounding) is not published by any leader.
