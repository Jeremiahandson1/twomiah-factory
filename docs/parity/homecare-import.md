# Home care parity: onboarding imports

Researched 2026-10-30 from public help and product pages only. All wording is paraphrased. Page contents were read through a summarising fetch step, so engineers should re-open a link before building to a detail.

## Leaders checked

- AxisCare (the help.axiscare.com help centre could not be fetched in this environment; public axiscare.com pages used instead): https://axiscare.com/blog/best-practices-for-data-migration-in-home-care/
- WellSky Personal Care (formerly ClearCare): https://info.wellsky.com/WellSkyPersonalCare.html
- AlayaCare: https://alayacare.com/ (no public import documentation found)
- Reference vendors, NOT named leaders, used because they publish real importer docs: CareSmartz360, CareLineLive, ShiftCare, VisualCare, Healthy Roster, SKED, Birdie, HHAeXchange.

## Capability table

| Capability | Leader(s) that have it | Source link | Our status |
|---|---|---|---|
| Vendor-run migration: the vendor's team loads the agency's data through an API, with a named migration specialist through go-live (claims onboarding in as little as 45 days) | AxisCare | https://axiscare.com/blog/best-practices-for-data-migration-in-home-care/ | TBD |
| Record groups the AxisCare migration advice talks about: client records, caregiver profiles, schedules, authorizations, billing, compliance data (page does not say which ones AxisCare itself loads) | AxisCare | https://axiscare.com/blog/best-practices-for-data-migration-in-home-care/ | TBD |
| Staged test migration plus record-count comparison old vs new, and named owners signing off billing, scheduling, HR data (advice to the agency, not a tool feature) | AxisCare | https://axiscare.com/blog/best-practices-for-data-migration-in-home-care/ | TBD |
| Customised onboarding and support for agencies switching from another system (no detail on records or method) | WellSky Personal Care | https://info.wellsky.com/WellSkyPersonalCare.html | TBD |
| Self-serve importer with separate imports for clients, caregivers and staff, driven by a downloadable sample spreadsheet whose header row must be kept | Reference: CareSmartz360 | https://www.intercom.help/caresmartz/en/articles/10514239-using-the-self-serve-data-migration-tool | TBD |
| Upload-time validation: mandatory-field and format errors listed per row and column, then a scrollable final review before the import is saved | Reference: CareSmartz360 | https://www.intercom.help/caresmartz/en/articles/10514239-using-the-self-serve-data-migration-tool | TBD |
| Templates for carers (main record, journal, training, leave, important contacts) and clients (main record, journal, reviews, important contacts); max 200 rows per file | Reference: CareLineLive | https://help.carelinelive.com/en/articles/9231-import-templates | TBD |
| Matching of existing carers/clients by reference code, UUID, or first name + last name + postcode (or a custom field); linked values such as teams must exactly match existing names | Reference: CareLineLive | https://help.carelinelive.com/en/articles/9231-import-templates | TBD |
| Multiple contracts per person in one cell separated by semicolons; custom fields as columns with a fixed prefix; contracts share one start date editable afterwards | Reference: CareLineLive | https://help.carelinelive.com/en/articles/9231-import-templates | TBD |
| CSV or XLSX wizard (up to 1,000 rows, 3 MB) that auto-matches column headings to fields with a confidence rating and lets the user fix or skip each mapping | Reference: ShiftCare | https://help.shiftcare.com/en/articles/10255134-import-and-update-client-staff-via-csv | TBD |
| Duplicate handling by key: clients matched on display name, staff on email; a match updates the profile, no match creates one; export-edit-reimport supported | Reference: ShiftCare | https://help.shiftcare.com/en/articles/10255134-import-and-update-client-staff-via-csv | TBD |
| Pre-commit preview: every row checked, bad cells flagged and editable inline, count of valid rows shown, error rows skipped at commit, then a created/updated/failed summary | Reference: ShiftCare | https://help.shiftcare.com/en/articles/10255134-import-and-update-client-staff-via-csv | TBD |
| Bulk attach of documents to clients and qualifications to staff, with its own attached/skipped/failed summary | Reference: ShiftCare | https://help.shiftcare.com/en/articles/10255134-import-and-update-client-staff-via-csv | TBD |
| Create-only CSV import of Clients, Workers and Expenses with a date-format choice, manual column pairing, a Preview Import step and a sent/created summary; cannot update existing records | Reference: VisualCare | https://help.visualcare.com.au/operations/import-csv | TBD |
| Import history with rollback: removes profiles the import created plus invitations and permission changes; does NOT undo edits to pre-existing profiles; user confirms first | Reference: Healthy Roster (2.0 tier only) | https://healthyroster.helpdocs.io/article/j1sr4qy3kc-understanding-and-reverting-import-history | TBD |
| Importer that detects and skips duplicates, saves mappings as reusable templates, accepts CSV, XLSX or pasted data; reversal only by contacting support within 30 days and only if records are unedited | Reference: SKED (appointment scheduling, not home care specific) | https://intercom.help/sked-help-center/en/articles/14137551-data-importer-overview | TBD |
| Support-assisted import: agency emails a completed CSV template (carers: name, phone, email; clients: name, birth date as YYYY-MM-DD, address) and the vendor loads it | Reference: Birdie | https://help.birdie.care/en/articles/9584094-import-clients-and-carers-into-birdie | TBD |
| Bulk caregiver import requested through a support portal; the process guide (template, file preparation, processing) is a separate PDF that was not opened | Reference: HHAeXchange | https://info.hhaexchange.com/caregiverbulkimport | TBD |

## Gaps and uncertainty

- AlayaCare: no public help page on importing clients, employees, schedules or payers was found. Not found.
- WellSky Personal Care: only a marketing statement about customised onboarding was found; file format, mapping, preview, duplicates, undo are all not found.
- AxisCare: migration is described as staff-run via API. File format, field mapping, preview, duplicate handling, dry run and undo are not found. help.axiscare.com was blocked, so a self-serve importer may exist that this research could not see.
- Authorizations, certifications and payers/contacts as importable record types: no leader page confirms any of them. Only CareLineLive (contacts, training) and the AxisCare advice article (authorizations named generically) come close.
- Dry run as a separate mode: not found anywhere. The closest are preview-before-commit steps (CareSmartz360, ShiftCare, VisualCare).
- Undo/rollback: confirmed only for Healthy Roster (new records only) and SKED (via support, 30 days). No leader documents undo.
- Duplicate handling is documented only as key-based match-and-update (ShiftCare, CareLineLive) or skip (SKED). CareSmartz360, VisualCare and Birdie say nothing.
- Reference vendors are not market leaders; treat them as design patterns, not parity targets.
