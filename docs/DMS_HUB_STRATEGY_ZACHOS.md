# How Twomiah becomes "the hub" for Zacho — the STRATEGY (recovered from prior research)

> Source: prior session `9326a94d-5a5f-436a-ba81-b45e7048b69b` (TwomiahFactory project folder) + ~80 research sub-agents. This was worked out extensively and then lost (original scoping was in a temp file `C:\tmp\dms-scoping.md`, now gone). **This doc is the durable record — do not lose it again.** Supersedes the "replace Lightspeed" framing in DMS_STRATEGY_ZACHOS.md as the LEAD.

## The core conclusion (the thing I kept getting wrong)
**Do NOT lead with "replace the DMS."** Become the **access / aggregation layer + CRM + AI brain** that sits on top of Zacho's existing stack.
- **Replace DP360** (the add-on CRM). We ARE the CRM.
- **KEEP Lightspeed** (the DMS) — integrate with it, don't rebuild it (at first).
- Lead the pitch with **CRM + AI + integration** (where we win *today*), and **grow into the deep DMS** (accounting/GL, OEM parts/warranty, title/reg, floorplan) later, on the *same* unified `crm-rv` data model. "The aggregator is the strategy. The DMS, if it ever comes, is something you grow into from there — not the thing you lead with."

The dealer's daily pain = **triple entry**: enter a customer in DP360 → re-enter in DealerTrack → re-enter in Lightspeed. Our wedge = enter once, we push out to F&I (DealerTrack/RouteOne) and into the DMS (Lightspeed).

## The full "own the stack" shape + SEQUENCE (website is the LEAD)
- **REPLACE Dealer Spike** (website + shopper tools + syndication) → our `website-rv`. **This is the land motion — do it FIRST.**
- **REPLACE DP360** (CRM) → our `crm-rv`. Built-but-held, **deployed on conversion** (no idle cost).
- **KEEP + integrate Lightspeed** (DMS) via 3PA; **grow into** the deep DMS later.

Sequence decided: **website → CRM → DMS.** ("The CRM is built, held, deployed-on-conversion — land-and-expand with no idle cost and a one-step flip.")

**THE WEDGE (Dealer Spike structurally CANNOT match this):** the **one-click flip**. A dealer starts on our cheap website while keeping their current DMS; their inventory is already ingested into `crm-rv`; converting them to our CRM later "isn't a migration — it's just **turning the CRM on**." *"Dealer Spike is website + marketing that integrates with whatever DMS the dealer runs — they don't own a DMS, so they can't offer 'become your DMS, one click, data already there.' That land-and-expand wedge is ours alone."*

### Dealer Spike replacement — built vs honest gaps (prior research, feature benchmark + Gaps A–E)
Built / at-parity on the surface a shopper + dealer touch: **inventory search/filter/detail** (the keystone), **payment calc / financing pre-qual / trade-in on unit pages** (Gap A), **reserve unit + Stripe deposit** (Gap B, their buy-online equivalent), **inventory syndication** as a public tokenized pull feed `GET /api/public/feed/:token/inventory.(json|csv|xml)` that RV Trader / Cycle Trader / Boat Trader pull on a schedule, **lead capture** (marketplace sources wired), **SEO** (dynamic sitemap + per-unit Vehicle JSON-LD, Gap D).
**Honest GAPS — deliberately NOT overclaimed:** Dealer Spike's **managed digital-marketing/SEO-as-a-service** (they're a real agency; our Ads is a product, not a managed service), **live money features** (Octane/NADA/Black Book currently stubbed/lead-capture), **200+ OEM integrations**, **360 tours**, and **scale/track record**.

### Where the website's inventory DATA comes from (NOT a live 3PA pull in V1)
A **feed importer in the website backend** (`inventoryImport.ts`): ingests the **dealer's own DMS export/feed** (presets for **Lightspeed / Motility / DX1 / Blackpurl**), upsert by (vin, companyId), daily cron. **Land phase** = dealer's DMS export → `crm-rv` (so the later flip = "turn the CRM on"). **Post-flip** = our own `crm-rv unit` table. Nightly Lightspeed→website (Dealer Spike's CMF# method) maps to this daily importer, not a real-time API. ⚠️ Honest caveat: the DMS importer presets are reasonable field mappings **not yet validated against a real dealer's export** — validating them against Zacho's actual Lightspeed/Dealer Spike export is the #1 de-risk.

### Already built in prior sessions (not net-new)
`website-rv` template + RV content pack (6 depts), the syndication pull feed (deploy-verified), the reserve+deposit flow, the lead inbox, SEO markup, the `inventoryImport.ts` DMS importer, AND a branded **"Zacho Sports Center" demo tenant** seeded with 60 real Zacho units (parsed from public listing pages — the bot-protected API scrape was refused as over the line). Scripts: `provision-zacho-demo.ts`, `test-compose-zacho.ts`. So the website-replacement is largely BUILT — the gate is the dealer's real export + the honest gaps above.

## HOW we integrate with Lightspeed — the 3PA seat (the key unlock)
- Lightspeed integration = the **Third Party Access (3PA) program** + API agreement. It exposes read/sync of **Deal Detail, Service Detail, Invoice Detail, inventory, parts/pricing**; RO submission exists.
- Cost: **~$2,000/location setup + ~$175/mo/location, paid by the dealer**, and Lightspeed approves each developer at its discretion.
- **THE UNLOCK:** DP360 is almost certainly already syncing with Zacho's Lightspeed — so **Zacho already pays that 3PA line item for DP360↔Lightspeed.** We **slot into the seat DP360 already occupies.** No new cost, no new integration — same 3PA fee, same data, our CRM+AI on top.
- **OPEN QUESTION (unresolved):** does 3PA allow **write-back** of a deal *into* Lightspeed, or read-only? Public evidence points to read/consume-oriented. (The "you can write/POST" language is Lightspeed **Retail**, a different product — a false friend.) → **Ask the GM: what does DP360 write into Lightspeed today?** If DP360 writes deals in, the write path is open on his account.

## HOW we get parts data WITHOUT OEM approval (the "hard part," solved)
Tiered bootstrap — launchable day one, zero OEM pre-approval:
1. **Dealer BYO OEM price files** — Zacho downloads Yamaha/Polaris/BRP price files from his own dealer portal and uploads them. **We never touch OEM data — the dealer does.** (Importer already shipped: commit `18ddd26`, the `/oem-parts/import` BYO tool.)
2. **Aftermarket distributor feeds** — Parts Unlimited, Tucker, WPS, Drag Specialties. Open, no OEM approval — but ride **the dealer's own distributor account** (Zacho has WPS/Tucker). (This session's Phase 3 catalogFeed.)
3. **Migration baseline** — pull the dealer's existing priced inventory off the old DMS.
4. **License a catalog spine** for fiche/supersessions/broad SKUs — **ARI / PartSmart / DataSmart** (LeadVenture; 125+ mfrs, ~10M SKUs, integrates 90+ DMSs) OR, to avoid a competitor-owned vendor, **Snap-on (SBS) EPC / PMPro** (independent; ask for the data-feed/embed tier, 888-543-0894). **No OEM relationship required** — proven because Blackpurl pulls parts from PartSmart/HLSM/Snap-On today.

**⚠️ CORRECTION (GM/user, 2026-07-08): Snap-on does NOT buy us out of OEM approval.** Even pulling OEM catalog data *through* Snap-on EPC, **each OEM still has to approve us first.** So the earlier "license Snap-on → no OEM relationship needed" claim was WRONG. Snap-on/aggregators are a redistribution rail, not an approval bypass, for OEM data. (This answers the prior "ask Dan" open question — pessimistic: per-OEM approval IS required for OEM data.)

**So the ONLY genuinely no-approval-on-our-end parts routes are:**
1. **Aftermarket distributor feeds** (Parts Unlimited/Tucker/WPS) — not OEM data, no OEM approval; rides the dealer's distributor accounts.
2. **Dealer BYO OEM price files** — the dealer downloads HIS OEM price file from HIS dealer portal (his authorization) and uploads it to us. We never receive data from the OEM, so no OEM approves *us*. This is the real OEM-pricing route with no approval.

**Everything else OEM (fiche/exploded diagrams, live supersessions, real-time OEM stock, electronic OEM ordering, warranty filing) needs per-OEM approval/certification — the moat.** ← This is precisely why we KEEP Lightspeed: it already holds those OEM certs. We land on CRM + website + aftermarket/BYO parts + counter/service; **Lightspeed keeps doing the OEM-gated parts flows until we earn our own certs.** So OEM approval is NOT a launch blocker — it's the grow-into moat, and Lightspeed covers it in the meantime.

## The real moat (honest — relationship-gated, not engineering)
**OEM certification** for inventory feeds, parts ordering, and especially **warranty-claim submission** — each OEM (Polaris, BRP, Honda, Yamaha, Indian) is a months-long, relationship-gated approval you can't parallelize or ship past. **There is NO neutral multi-OEM warranty service bureau** — warranty stays OEM-direct. **PDS (Powersports Data Standards)** certification is becoming *required* by some OEMs to serve franchised dealers at all — so it's table-stakes medium-term, pursued in parallel via Motive Retail.

## Buy-vs-build (decided)
| Module | Verdict |
|---|---|
| Parts catalog data | **License** (ARI/PartSmart or Snap-on) — don't build |
| Accounting/GL | **Integrate** QuickBooks/Sage to launch; native GL later (this session built native GL) |
| Title/registration/DMV | **Integrate Vitu** (50-state API; bought DealerTrack's Reg&Title) — never build 50 states |
| F&I lender submission | **Integrate** RouteOne + DealerTrack |
| Warranty | OEM-direct, certification campaign |

## Phasing
- **Phase 1 (quarters):** assemble the licensable/integrable rails onto crm-rv → "a credible DMS minus OEM depth." Replace DP360, integrate Lightspeed via 3PA seat, parts bootstrap, license catalog spine.
- **Phase 2 (1–2+ yrs):** per-OEM warranty/ordering certification ("the long pole") + PDS.
- **Phase 3:** native GL + scale.

## Competitive frame
Kill Lightspeed's **"API tax"** (its loudest grievance). Cloud/mobile-native, support-as-a-product, **AI-native** (the real 2026 edge), all-in-one. **Blackpurl** = proof a cloud-native Lightspeed challenger works; our edge over Blackpurl = native AI + unified CRM.

## Zacho's REAL software spend (from the GM, 2026-07-08) — the ROI story
Format = **$amount / #stores / #months it covers** (i.e. billed quarterly). Zacho runs **3 stores**.

| Tool | Billed | Annual | Our move |
|---|---|---|---|
| **Lightspeed** (DMS) | $12,500 / 3 / 3mo | **$50,000/yr** | KEEP + integrate (3PA) now; the big grow-into prize later |
| **Dealer Spike** (website) | $2,850 / 2 / 3mo | **$11,400/yr** | **REPLACE** (website-rv) — the lead |
| **Covideo** (video msg/walkaround — *this is the "SONM eVideo" mystery, solved*) | $2,685 / 2 / 3mo | **$10,740/yr** | Absorb into comms/AI layer (needs video build) |
| **DP360** (CRM) | $1,500 / 3 / 3mo | **$6,000/yr** | **REPLACE** (crm-rv) |
| **Kenect** (texting/reviews) | (amt TBD) | ~$4,000/yr | Absorb (crm-rv has SMS+reviews) |
| **DealerTrack** (F&I) | (amt TBD) | — | KEEP + integrate (F&I submission) |

**Known annual spend so far: ~$78k+/yr** (Lightspeed 50k + DealerSpike 11.4k + Covideo 10.7k + DP360 6k), + DealerTrack + Kenect.
**Displaceable WITHOUT touching the DMS (land phase):** DP360 $6k + Dealer Spike $11.4k = **$17.4k/yr certain**; + Covideo $10.7k + Kenect ~$4k if we absorb comms = **up to ~$32k/yr** — while *keeping* his $50k Lightspeed. **The $50k Lightspeed is the eventual grow-into prize.** This is the ROI pitch: cut ~$17–32k/yr day one, kill triple-entry, keep his DMS.

## Zacho facts
- **Zacho Sports Center** (zachosports.com, 715-723-0264), powersports + marine, Eau Claire/Chippewa Falls WI. Brand colors #E67A22 / #E60000.
- **The user's friend is the GM.** Parts rep "Dan" (Snap-on) = the parts-authorization contact.
- **Brands:** Indian, Honda, Yamaha, CFMoto (+ ATV/UTV); Bennington, Crestliner (boats); E-Z-GO. Authorized Polaris/Honda/Yamaha/BRP.
- **Stack:** Dealer Spike (website, dealer id 2140600) + **Lightspeed EVO** (DMS) + **DP360** (CRM) + DealerTrack (F&I) + Kenect (texting).
- **Decided:** we replace DP360, keep+integrate Lightspeed, enter-once → push to F&I + DMS.
- Demo: branded "Zacho Sports Center" tenant on website-rv + crm-rv, seeded with **60 real Zacho units** parsed from public listing pages (NOT scraped from the bot-protected API — that was refused as over the line). Scripts `provision-zacho-demo.ts` / `test-compose-zacho.ts`.

## DISCOVERY / INTAKE — exactly what to collect from Zacho to finalize will/won't (2026-07-08)
GM = **Chance**. Ask three people. Each item notes what it RESOLVES.

### From Chance (GM)
- **Contract end dates** for every tool (Lightspeed, DP360, Dealer Spike, Covideo, Kenect, DealerTrack). → can't switch mid-contract without penalty; sets the timeline. (Costs already known; still need DealerTrack + Kenect $ amounts.)
- **Confirm store coverage** (Lightspeed/DP360 = 3 stores, Dealer Spike/Covideo = 2 — confirm).
- **A real Lightspeed EXPORT** — customers, units/inventory (with cost), **parts with on-hand qty + cost**, vendors. → THE #1 de-risk: validates our importer against a real DMS feed AND powers the live demo.
- **His Dealer Spike inventory feed / CMF#** and whether Dealer Spike runs his **SEO/ads as a managed service** or he just has the website. → determines if "managed marketing" is a real gap he'll miss (the one thing we don't match).
- **What DP360 actually does with Lightspeed today — does it WRITE deals back into Lightspeed or only read?** (ask his DP360 rep / screen-share). → resolves the last open technical question (3PA write-back) and confirms we can take DP360's 3PA seat.
- **His #1 pain** (almost certainly triple-entry) → what to lead the pitch on.

### From the Parts guy
- **Which OEM dealer portals** he downloads price files from (Polaris/Yamaha/Honda/BRP/Indian/CFMoto) + **a SAMPLE price file from each**. → confirms our importer maps his real columns (the parts validation).
- **Which aftermarket distributors** he buys from (WPS / Tucker / Parts Unlimited / Drag) and whether he has **online accounts / API access**. → WPS API = the automatable aftermarket rail.
- **What he does in Lightspeed's parts that he can't live without** — fiche/exploded diagrams, electronic OEM ordering (DEX), real-time OEM stock, supersessions, **warranty parts claims**. → this IS the "stays on Lightspeed until we're certified" list.
- **How often OEM prices update** → the re-upload cadence.

### From the F&I guy
- **DealerTrack vs RouteOne** (which/both) + **which lenders**, and **DealerTrack cost**.
- **How a deal flows today**: DP360 → DealerTrack → Lightspeed — exactly which fields get re-keyed where, and **does DealerTrack push the funded deal back into Lightspeed or is it manual re-entry?** → defines exactly what "enter once" has to automate.
- **F&I menu/products** sold (service contracts, GAP, tire/wheel, etc.) → for the desking/F&I module.

**Output:** with the above we can hand Chance a finalized "here's exactly what we run for you / what stays on Lightspeed / what it costs / what you save."

## Texting — Kenect-proofing (from real Kenect complaints, 2026-07-08)
Replacing Kenect; avoid its documented failure modes:
1. **Contact-sync hell (Kenect's #1 flaw)** — theirs breaks because it's a SEPARATE system syncing contacts out of the firm's CRM; number changes orphan threads, "stuck" contacts, no force-sync. **We = CRM + texting in ONE DB → that whole class doesn't exist.** BUT our `sms_conversation` is keyed by `phone_number` (soft link to contactId) → still BUILD: number-change continuity (keep/merge the thread) + multiple numbers per contact + staff picks the texting number.
2. **Number hostage (charged $5,100, wouldn't release/port the number)** — ARCHITECTURE + POLICY: **dealer OWNS their texting number and can port out.** Bring-their-own Twilio or provision-with-written-release. Today it's a single `TWILIO_PHONE_NUMBER` env → must become dealer-owned. NEVER hold it hostage.
3. **Contract traps / auto-renew** → policy = month-to-month, no punitive lock-in, data+number leave with you. This is a SELLING POINT vs Kenect.
4. **Support ignores tickets, only upsells** → support-as-a-product edge.
5. **"Managed Conversations" vague/overpromised** → if we offer AI auto-reply, state precisely what it does; don't oversell.
Intake sheet for Chance generated: `TwomiahFactory/docs/Zacho_Discovery_Intake.pdf`.

## Immediate next actions (for the GM, the user's friend)
1. **Export his real inventory/customer/parts data** out of Lightspeed/Dealer Spike → run through our importer (validates it against a real DMS feed + produces the side-by-side demo).
2. Ask: **what does DP360 currently read/write into Lightspeed** (settles the 3PA write-back question + confirms we can take DP360's seat).
3. Ask (Dan/OEMs): **can Zacho authorize our access to his OEM data through his dealer authorization**, or is per-vendor OEM approval required.
