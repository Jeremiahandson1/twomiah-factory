# Home care into the unified app — the plan

Home care (`templates/crm-homecare`) was built separately, not copied from the base CRM, so it doesn't merge
the way the near-copies do (`docs/UNIFIED_MOVE_GUIDE.md`, step 3e). This is how it comes in. Measured on
branch `engine`, 2026-10-18.

## What it is

| | Home care | For comparison |
|---|---|---|
| Tables | 145 (20 share a name with the unified schema: audit, MFA, email aliases, leads, call tracking, ads, billing records) | base CRM 148 |
| Tables with no business id | 130 (one agency per database, so nothing needed one) | none in the unified schema |
| The business | `agencies` | `company` |
| People who sign in | `users`, with no business id; caregivers' facts on the row (certifications, pay rate, hire date, emergency contact, home position, IVR PIN) | `user`, `company_id` |
| Table names | 110 plural (`clients`, `schedules`, `evv_visits`…) | singular |
| Raw SQL | 978 calls across routes and services | only in `server/data/` |
| Inserts | 161 through Drizzle, 86 raw | |
| Routes | about 30,000 lines in 80+ files | base CRM ~9,000 |
| Screens | about 57,000 lines | base CRM ~13,000 |
| Its own suite | `tests/homecare`, 32 files | |

Its own billing — invoices, claims, EDI batches, remittances, payments matched to claims — is Medicaid and
private-pay billing for visits. It is a different thing from the CRM's invoices and stays its own module.

## Decisions (each follows the rulebook; none changes it)

1. **One business table, one people table (RULEBOOK §4).** `agencies` becomes `company`: the columns the
   company row lacks (legal name, licence number, NPI, Medicaid id, and the rest) are added to `company`,
   nullable. `users` becomes `user`: home care's caregiver columns are added to `user`, nullable, and every
   home-care user gets the agency's `company_id`. The cutover data move copies agency → company and users →
   user, column for column; ids are kept, so every reference to a user still resolves.
2. **Every top-level record carries `company_id` (RULEBOOK §2).** The 130 tables gain it (child rows — a
   line item, a visit's time change — reach it through their parent, as the rulebook says). Every insert
   sets it from the signed-in person's company, as all CRM code does; no default is invented for it. The
   cutover data move fills it with the agency's id.
3. **Names keep their spelling (RULEBOOK §2: "names inherited from existing tables keep their spelling").**
   The plural tables stay plural, so a tenant's rows move across unchanged. A home-care table whose name
   collides with a unified one (`invoices` beside the CRM's `invoice`, `payments` beside `payment`,
   `time_entries` beside `time_entry`, `expenses` beside `expense`) keeps its own: they are different
   records (a Medicaid visit invoice is not a contractor's invoice) and the names already differ.
4. **Raw SQL moves to `server/data/homecare*.ts` (RULEBOOK §2)**, one named function per query, returning
   camelCase. Replies through `reply.ts` (§3).
5. **Home care is a vertical (`verticals/homecare/settings.ts`) whose features switch on its add-on**
   (`server/crm/homecare/`, `web/src/crm/pages/homecare/`), behind the registry's home-care features; the
   CRM's shared modules it also uses (team, documents, leads, call tracking, AI receptionist, MFA, billing,
   email) are the engine's.

## Order of work

1. **Schema**: the agency and user columns onto `company` and `user`; home care's own tables as an add-on
   layer with `company_id`; one migration; re-measured against the template by script, as 0006 was.
2. **Sign-in and roles**: home care's roles (owner, admin, scheduler, caregiver …) onto the unified rungs
   via the vertical's role labels and extra permissions; the IVR PIN and the caregiver app's sign-in.
3. **Server**, in groups that can move in parallel, each with its suite files: clients and care plans;
   caregivers, scheduling and open shifts; EVV, IVR and GPS; authorizations, billing, claims, EDI and
   remittance; payroll (Gusto) and expenses; HR (applications, background checks, onboarding packets,
   certifications); family portal, messages and notifications; compliance, incidents and audit.
4. **Screens**, in the same groups.
5. **The suite**: `tests/homecare` on the unified app as `homecare`, every file passing or a documented
   divergence held by a unified test. Then measured in a browser, every role, both themes, phone and desktop.

Roofing, the store and the dispensary follow the same pattern after home care (SPEC §0 build order).
