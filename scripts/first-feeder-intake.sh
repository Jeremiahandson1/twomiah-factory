#!/usr/bin/env bash
# First Feeder — internal Twomiah dropship store (birding). Submits the factory
# intake; the store vertical routes businessType=dropshipping → website-store +
# crm-store. Rate limit on /public/intake is 3/hour/IP — if you get
# "Too many requests", wait and re-run. Plan: C:\ALL TWOMIAH PRODUCTS\BIRDING_STORE_PLAN.md
set -euo pipefail

curl -sS -m 60 -X POST https://twomiah-factory-api.onrender.com/api/v1/factory/public/intake \
  -F "businessName=First Feeder" \
  -F "businessType=dropshipping" \
  -F "contactEmail=twomiah14@gmail.com" \
  -F "ownerName=Jeremiah Phillips" \
  -F "city=Eau Claire" \
  -F "state=WI" \
  -F "requestedDomain=firstfeeder.com" \
  -F "description=First Feeder is the starter store for new birders. Birding just became a young person's hobby — participation among 18–24s is up over 1,000% since 2018 and the Merlin app passed 4.8 million US users — but the old bird stores still sell seed to retirees. We curate the first feeder, the first journal, the first harness: quality gear from American brands like Droll Yankees and Aspects, plus our own life-list journals, state checklists and sticker packs. Based in Eau Claire on the Mississippi Flyway. Everything ships from US warehouses in 2–5 days." \
  -F "services=First Feeder Kit (tube feeder + pole hook + life-list journal + sticker sheet + field card)
Tube, hopper and suet feeders
Hummingbird feeders
Heated bird baths
Binocular harnesses and lens kits
Life-list journals and field notebooks
State bird checklists
Bird sticker packs and prints
Smart feeders" \
  -F "goals=Online orders
Email waitlist signups
Gift orders" \
  -F "serviceAreas=Eau Claire
Wisconsin
Minnesota
Nationwide shipping" \
  -F "primaryColor=#2E5A3B" \
  -F "secondaryColor=#F3F5EE" \
  -F "accentColor=#D8A400" \
  -F "wantsCrm=true" \
  -F "notes=Internal Twomiah store (dropshipping via Gold Crest Distributing + Printful). Store vertical: website-store + crm-store. Not a billed client." \
  | tee /tmp/first-feeder-intake.json
echo ""
