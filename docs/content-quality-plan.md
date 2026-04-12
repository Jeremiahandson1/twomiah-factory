# Content Quality Plan — Twomiah Factory

## Problem
AI-generated website content is generic. All verticals get the same prompt structure.
A home care agency and a roofing company read like they were written by the same intern.

## Solution: Industry Content Packs + AI Customization

### Phase 1: Create per-vertical content packs (manual, one-time)

Each vertical gets a `content-pack.json` with pre-written, high-quality base content:

```
templates/website-contractor/content-pack.json
templates/website-fieldservice/content-pack.json
templates/website-homecare/content-pack.json
templates/website-dispensary/content-pack.json
```

Each pack contains:
- **6-8 real service descriptions** for that industry (not AI-generated)
- **5 blog post topics** with outlines (headlines, key points, word count targets)
- **Industry-specific trust badges** (e.g., "NATE Certified" for HVAC, "VA Approved" for home care)
- **Tone guide** (professional + warm for home care, direct + technical for HVAC)
- **FAQ content** per service (real questions customers ask)
- **Testimonial templates** (realistic customer scenarios)

### Phase 2: Change the AI prompt to customize, not create

Instead of:
> "Generate website content for an HVAC business"

Use:
> "Here is pre-written content for an HVAC business. Customize it for
> Valley HVAC QA in Eau Claire, WI. Replace generic references with
> specific local details. Adjust the tone to match a family-owned
> business serving the Chippewa Valley. Keep the technical accuracy
> of the originals."

This is 10x better because:
- The base content is already good (written by a human who knows the industry)
- The AI only handles localization (city names, phone numbers, service areas)
- Factual accuracy is preserved (the AI doesn't make up HVAC specs)
- The tone stays consistent across the vertical

### Phase 3: Split the generation into focused passes

Instead of one 12K-token call for everything:

1. **Pass 1: Homepage** (hero, CTA, about section, trust badges)
2. **Pass 2: Services** (customize each service from the pack)
3. **Pass 3: Blog posts** (expand outlines from the pack into full articles)
4. **Pass 4: Legal pages** (privacy policy, terms — these can stay as-is)

Each pass gets a focused prompt with just the context it needs.

### Phase 4: Quality gates

Before the content goes into the zip:
- Check for unresolved placeholders ({{COMPANY_NAME}}, lorem ipsum)
- Check word counts (services > 50 words, blog posts > 300 words)
- Check that city/state appear in SEO titles and descriptions
- Check that phone number appears in CTA sections
- Flag any content that matches the base pack verbatim (should be customized)

## Industry-Specific Content Guidance

### Contractor (General)
- Tone: Confident, straightforward, "we show up on time"
- Trust: Licensed & insured, BBB rated, warranty backed
- Services: Roofing, siding, windows, gutters, remodeling, new construction
- Blog: Seasonal maintenance, material comparisons, cost guides

### HVAC / Field Service
- Tone: Technical but accessible, emergency-ready
- Trust: NATE certified, EPA licensed, 24/7 emergency
- Services: AC repair, furnace install, duct cleaning, heat pumps, water heaters
- Blog: "When to replace your furnace", "AC troubleshooting", energy savings tips

### Home Care
- Tone: Warm, compassionate, family-focused
- Trust: Licensed, background-checked, VA approved, HIPAA compliant
- Services: Personal care, companion care, respite care, memory care, skilled nursing
- Blog: Caregiver tips, senior safety, when to seek home care, family resources

### Roofing
- Tone: Direct, inspection-driven, insurance-savvy
- Trust: GAF certified, insurance claim specialists, free inspections
- Services: Shingle, metal, flat roof, storm damage, inspections, gutters
- Blog: Storm damage signs, insurance claim process, material comparison

### Dispensary
- Tone: Educated, compliant, welcoming
- Trust: State licensed, lab tested, certified budtenders
- Services: Flower, edibles, concentrates, pre-rolls, accessories, delivery
- Blog: Strain guides, consumption methods, wellness benefits, new arrivals

## Implementation Priority
1. Create content packs for the 3 most mature verticals (contractor, HVAC, home care)
2. Update contentGenerator.ts to load the pack and customize instead of generate from scratch
3. Add quality gate checks before zip creation
4. Backfill roofing and dispensary packs
