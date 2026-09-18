# CRM Re-Test — VET (Vet Test, after T12)

Tenant: https://vettest-b52599-vet-api.onrender.com/crm
Login: twomiah14@gmail.com / TestPass123!
Practice on file: Vet Test · 123 Main St, Columbus OH 43004 · 614-555-0190

Every item the T12 report left open has been worked — 4 highs, 11 mediums, 12 lows and the new off-by-one.
This is the list to re-run. Each line says **where**, **what to do**, and **what should happen now**, with the
old behaviour in brackets so a regression is obvious. The commit is named so a failure can be traced.

One item, **L10, was not a bug** — see the bottom.

---

## Highs

- [ ] **H2 — invoice send failures are visible.** Invoices › open one › Send, with the owner's email set to
  something undeliverable (`@example.com`). A red error appears naming the failure and the invoice stays in
  its current status. [Was: HTTP 502 and the screen did nothing at all.]
- [ ] **H3 — wellness plans bill.** Wellness Plans › enrol a patient on a monthly plan. An invoice is raised
  for the first period and the enrolment shows a renewal date. Open the page again — no second invoice for
  the same period. [Was: nothing billed, `renewsAt` null, fourth build running.] (#226)
- [ ] **H5 — online booking keeps the species.** Book online (the public widget) for a **cat**, then a
  **bird**, then something odd like **"Kitty"** or **"unicorn"**. Patients › the new charts read cat, avian,
  cat, other — not dog. A word we cannot place is kept verbatim in the chart notes. [Was: every booked
  patient stored as a dog.] (#225)
- [ ] **H6 — the owner portal is a vet portal.** Contacts › an owner with portal access › open their portal
  link. It shows their pets, vaccinations due and next appointment. [Was: projects, change orders, lien
  waivers and RFIs — the construction portal.] (#227)
- [ ] **N1 — the booking window agrees with itself.** Public booking widget: the last date the picker offers
  is bookable, and a date one day past the window is refused with "Please choose a date within 30 days."
  [Was: the picker stopped a day short of what the API accepted.] (#230)

## Mediums

- [ ] **M1 — the Owners search box is a normal width.** Owners (was Contacts) › the search box and the type
  filter sit side by side. [Was: search 54px wide, the filter taking the whole row.] (#231)
- [ ] **M2 — a long name does not grow its row.** Owners › find the long-name record. Its row is the same
  height as the others and the name ellipsises; hover shows the full name. [Was: an 84px row against 42px.]
  (#232)
- [ ] **M3 — "Appointments Today" counts what is happening.** Dashboard. Cancel one of today's appointments
  and the count drops by one. [Was: cancelled and no-show appointments counted.] (#228)
- [ ] **M4 — Recent Visits show money.** Dashboard › Recent Visits. Each line carries its total. [Was: $0 on
  every visit.] (#228)
- [ ] **M5 — one appointment per room.** Appointments › book "Room 7" at 11:00, then try a second
  appointment in the same room at the same time with a different vet. Refused: "Room 7 is already booked for
  that time." [Was: both accepted and stacked on the schedule.] (#229)
- [ ] **M6 — files and bills belong to the animal.** Patients › open a chart. There is a **Documents** tab
  (upload a file — it stays with this pet, not the owner's other pet) and an **Invoices** tab showing what
  this animal has cost. Bill a visit and the invoice appears there. [Was: neither record type could point at
  a patient, and the chart had no Documents tab.] (#234, #235)
- [ ] **M7 — prescriptions record who wrote them, and check the chart.**
  - Patients › a chart › Prescriptions › Add. The form has a **Prescriber** (defaulted to you). Save; the
    script reads "Prescribed by …". [Was: `prescriberId` null on every prescription.]
  - Put `penicillin` in that patient's Allergies, then prescribe **Amoxicillin**. A warning names the chart
    entry and the drug class and offers **Prescribe anyway** — which works, and lands in the audit log.
    Prescribing something unrelated is unaffected. [Was: no warning anywhere.] (#233)
- [ ] **M8 — refill counts are real.** Same form: refills of **-6** is refused. (#229)
- [ ] **M9 — reminders leave a trace.** Reminders › Due. Tick a row, send. The **Reminded** column changes
  from "Not yet" to "Today", and sending again reads "· 2×". An owner with no mobile number is reported as
  failed and records nothing. [Was: no trace on the row and no field in the API.] (#236)
- [ ] **M10 — the invoice PDF names the practice.** Invoices › open one › download the PDF. The header
  carries 123 Main St, Columbus OH 43004, the phone and the email under the practice name. [Was: the name
  and nothing else.] (#237)
- [ ] **M11 — the clinic does not talk like a contractor.** (#238)
  - Sidebar "Owners" opens a page headed **Owners**, with Owner / Enquiry / Supplier tiles and no
    Subcontractors. [Was: headed "Contacts" with Leads, Clients, Subcontractors, Vendors.]
  - Tasks › new task: **no Project selector**. [Was: a Project dropdown whose only option was None.]
  - Appointments: types read "Wellness exam", "Sick visit", "Euthanasia". [Was: raw lowercase values.]

## Lows

- [ ] **L1 — a lab status comes from a list.** Patients › Lab Results › Add. "saffron" is refused, naming the
  real statuses; "Abnormal" saves as abnormal. (#229)
- [ ] **L2 — Edit Patient names the owner.** Patients › a chart › Edit. The owner field shows the owner's
  name. [Was: "Selected owner".] (#240)
- [ ] **L3 — an address can be posted.** Owners › new owner. State "VVVVV" and an 11-digit ZIP are refused;
  "wisconsin" saves as WI. Worth spot-checking on a non-vet CRM too — the rule is shared. (#229)
- [ ] **L4 — /crm/dashboard resolves.** Type the URL. It lands on the dashboard. [Was: the 404 page — and in
  all eight CRMs, not only the vet.] (#240)
- [ ] **L5 — the rabies tag carries over.** Patients › a chart with a rabies tag › Vaccinations › Add Vaccine
  › tick "Rabies vaccine". The tag is already filled in, and still editable. (#240)
- [ ] **L6 — the feature copy is honest.** Settings › Features (and the Factory build wizard). Patient
  Records no longer promises a photo, Appointments is a "day schedule" rather than a calendar, and
  Prescriptions says what it records and that dispensing/EPCS are not included. (#241)
- [ ] **L7 — a recall says something.** Reminders › Due › tick a row › Send. The default message reads
  "{{pet_name}} is due for {{vaccine}} on {{due_date}}" and the text that goes out names the pet, the
  vaccine and the date. An owner with two pets due gets one message naming both. [Was: "your pet is due for
  care" to everybody.] (#239)
- [ ] **L8 — allergies are loud.** Patients › a chart with allergies. They show as an amber alert beside the
  medical alert, not as a detail row next to Colour. (#239)
- [ ] **L9 — the species chips add up.** Dashboard. The chips total the headline patient count, and a legacy
  "Dog" record buckets with "dog". (#228)
- [ ] **L11 — the booker's name survives.** Book online using an email that already belongs to an owner, but
  type a different name. The appointment carries "Booked by <name> (account: <owner>)" and the contact on
  file is unchanged. [Was: the typed name vanished.] (#240)

## Not a bug — please do not re-report without a measurement

- **L10 — "a new socket connects on every page navigation".** Measured with Chrome over the DevTools
  protocol against this tenant: logging in and loading /crm opens 2 sockets (one per document load), then
  **ten** sidebar navigations opened **zero** more and closed none, with frames still arriving on the
  original connection. `SocketProvider` sits above the router, so the connection survives navigation; what
  looks like reconnection in a network panel is socket.io's own transport traffic on the one socket.
  `scratchpad/cdp-socket-count2.ts` reproduces the measurement — run it before changing the provider.
  See `docs/INTENDED_BEHAVIOUR.md`. (#241)

---

*Written 2026-09-18, covering #225–#241. All nine tenants were redeployed and the work verified live before
this list was handed over.*
