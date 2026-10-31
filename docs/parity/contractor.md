# Contractor / builder parity — Buildertrend, JobTread, Jobber

**Status (10/31).** The research was done before 10/30 from the vendors' own help pages (the checklist in the 10/30 follow-up
to the cloud session, "build each item to THIS checklist"); PR #173 built against it and is live since 10/31 (main
f855f4d65). Built features that are not yet tested stay hidden (`project_templates`, `inspection_checklists`, `ar_aging`,
`wip_report`, `job_budgets`). Marks: **built** · **partly** (what is missing is named) · **not built** · **beats** (the
leaders' pages do not document it). Checked against the code on 10/31 where the PR report did not say.

## Estimating (the biggest gap)

| Leader feature | Twomiah | Mark |
|---|---|---|
| Quote sections / groups (room by room, by cost-code group) | sections with subtotals on screen, PDF and the customer's page | built |
| Multi-line line descriptions | yes | built |
| Cost type per line (labour / material / sub / equipment / other) | `type` per line (labor, material, part, service, other) | built |
| **Default markup % per cost type**, overridable per line, markup or margin shown live | markup % per line from "our cost"; no default per cost type, no live margin column | partly |
| Allowance lines that become Selections allowances | an allowance line opens on Selections when the quote is approved | built |
| One allowance covering several selections; overages flowing to a revised budget | not stated in the build; not found in the code | not built |
| Quote templates (lines, deposit, message, terms) and "create similar" | not found | not built |
| Optional items (can be pre-selected; deposit recalculates when the client adds one) | optional lines ticked by office or customer, deposit follows (`quoteOptions.ts`) | built |
| Line images | not found on quote lines | not built |
| Automatic quote follow-up | not found | not built |
| Good / better / best options | one implementation for every quoting trade (10/31, `quote_proposals`, hidden) | built |
| **Approved quote → project budget** (original budget = the signed quote) | approved quote → budget by cost code; Job Costing's "Project budgets" panel | built |
| Bills / purchase orders linked to budget lines; projected profit per line | budget vs "spent so far" for the whole project — actual cost is not split by cost code | partly |
| A JobTread-style formula / parameter engine | — | not doing (owner: Takeoffs covers it) |

## Reports

| Leader feature | Twomiah | Mark |
|---|---|---|
| AR aging (current / 1–30 / 31–60 / 61–90 / 90+ by customer) | built (`ar_aging`); an invoice with no due date counts as current | built |
| WIP: contract value incl. approved change orders, cost to date, % complete by cost, earned revenue, billed, over/under billing | built (`wip_report`); % complete is cost-to-cost where a budget exists. Selection/allowance changes in the contract value: not stated | partly |
| Job profit list | built | built |

## Dashboard

| Leader feature | Twomiah | Mark |
|---|---|---|
| Cash collected vs owed, past due | on every trade's home screen | built |
| Unanswered leads | yes | built |
| Today's work | Today's board on for contractor | built |
| Pipeline strip: count and $ at each stage (leads → quotes → jobs → invoices) | only on the restaurant's dashboard | not built |
| "Needs me" list incl. quotes awaiting a reply | leads and overdue invoices yes; quotes awaiting reply no | partly |
| An owner view and a crew view | one view | not built |

## Lead inbox

| Leader feature | Twomiah | Mark |
|---|---|---|
| Convert straight to a quote, a job or a project | one step | built |
| A human "Spam" action (hidden from New and counts, undo) | yes — neither Jobber nor Housecall documents one | beats |
| Source tag | leads carry their source | built |
| A site-visit / assessment step a lead can be booked into | not found | not built |
| Lost with a reason | not found for contractor leads (roofing jobs and restaurant events have it) | not built |

## Inspections

| Leader feature | Twomiah | Mark |
|---|---|---|
| Checklist templates: pass / fail / n.a., note, photo per item | built (`inspection_checklists`) | built |
| A failed item creates a punch-list item | yes — no leader documents the link | beats |
| Signature | owner's decision: not now | not built |
| Auto-attach a checklist by job / project type | not stated, not found | not built |
| Filled in on the phone | no phone screen; the field role cannot answer checklists (owner's decision) | not built |

## Project templates

| Leader feature | Twomiah | Mark |
|---|---|---|
| Save any project as a template; start one from it (phases, to-dos, punch-list starter) | built (`project_templates`) | built |
| Template carries budget lines and selections; tick which parts to import | not stated, not found | not built |
| Task dependencies carried over | owner's decision: not now | not built |

## Navigation and pages

| Leader feature | Twomiah | Mark |
|---|---|---|
| Collapsible groups in workflow order, each trade its own order, every item in a group | built | built |
| Open / closed remembered per user | yes (per user, on that browser) | built |
| Collapse-to-icons rail | not found | not built |
| No blank pages while loading | every page says what it is loading | built |

## Pricing
Every feature included for every seat (seat plans only) — Jobber gates optional items, images and follow-ups to its Grow
plan. **beats**, on price.

## What is left, in the order a builder would feel it
1. Quote templates / "create similar" and automatic quote follow-up.
2. Default markup by cost type with a live margin column; line images.
3. Actual cost by cost code, so the budget shows profit per line and bills/POs post to budget lines.
4. Pipeline strip and an owner/crew dashboard split; "quotes awaiting reply" in the needs-me list.
5. Leads: site-visit booking, Lost with a reason.
6. Inspections on the phone (with the field role), signature, auto-attach by type.
7. Project templates carrying budget lines and selections; allowance → several selections and overage → revised budget.
