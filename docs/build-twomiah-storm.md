# Build "Twomiah Storm" — Real-Time Hail Swath Detection

## Goal

Build an owned, free, real-time hail tracking system that replaces the current stubbed `stormRadar.ts` service in the Roof CRM. Storm tier ($599/mo) tenants get hail swath maps within minutes of a storm passing — no third-party API keys, no per-report fees, no vendor dependency.

The core value proposition: **"first on the block."** The contractor who knocks first after a hailstorm gets the job. Speed is everything.

---

## Why Build vs Buy

| | HailTrace (buy) | Twomiah Storm (build) |
|---|---|---|
| Speed | ~15-30 min (meteorologist verified) | ~5-10 min (automated from radar) |
| Cost to tenant | $$/month subscription | $0 (included in Storm tier) |
| Cost to us | Per-report fees or partner agreement | AWS S3 reads (pennies) + compute |
| Accuracy | Meteorologist verified, fewer false positives | Radar-only, some false positives |
| Competitive advantage | Same tool competitors use | Unique, owned, faster |
| Dependency | Vendor can raise prices, change terms | We own it |

---

## Architecture Overview

```
NEXRAD Radar (160 stations, every 5-6 min)
    ↓
AWS S3 (noaa-nexrad-level3 bucket, public, free)
    ↓
[Twomiah Storm Worker] — polls S3 for new hail products
    ↓ parses binary NIDS format
    ↓ extracts hail size + geographic coordinates
    ↓ generates hail swath polygons
    ↓
PostgreSQL + PostGIS (storm_radar_event table)
    ↓
[CRM API] — matches swaths to tenant service area + existing contacts
    ↓
[Frontend] — StormRadarPage map overlay + push alerts
```

---

## Data Source: NEXRAD Level 3 Hail Products

NEXRAD (Next Generation Weather Radar) is a network of 160 Doppler radar stations across the US. Every 5-6 minutes, each station completes a full 360-degree scan. The NWS processes these scans into "Level 3" products — pre-computed derived data including hail detection.

### Key Products

| Product Code | Name | What It Contains |
|---|---|---|
| **N0H** | Digital Hail Index | Probability of hail + probability of severe hail at each radar bin |
| **N0X** | Digital One-Hour Max Hail Size | Maximum estimated hail diameter (inches) in the last hour |
| **NHI** | Hail Index | Legacy hail product with positive/probable/unknown classifications |
| **DVL** | Digital VIL (Vertically Integrated Liquid) | Can be used to infer hail potential when VIL > 50 kg/m² |

**N0H and N0X are the primary targets.** N0X gives you actual estimated hail size in inches per radar bin — this is the same MESH (Maximum Expected Size of Hail) algorithm that HailTrace uses under the hood.

### AWS S3 Access

- **Bucket:** `noaa-nexrad-level3` (public, no auth required)
- **Path pattern:** `{YYYY}/{MM}/{DD}/{STATION}/{STATION}_{YYYYMMDD}_{HHMM}_{PRODUCT}.gz`
- **Example:** `2026/04/14/KARX/KARX_20260414_2315_N0X.gz` (La Crosse WI radar, hail size product)
- **Format:** Gzipped NIDS (NEXRAD Information Dissemination Service) binary
- **Latency:** Files appear on S3 within ~2-5 minutes of the radar completing its scan
- **Cost:** Free to read (S3 requester-pays is NOT enabled on this bucket)

### Radar Station Coverage

Each NEXRAD station has a ~230km (~143 mile) radius. The 160 stations cover the entire continental US with significant overlap. For a tenant in Eau Claire, WI, the relevant station is **KARX** (La Crosse, WI — ~85 miles away). Most metro areas are covered by 2-3 overlapping stations.

You'll need a mapping of zip codes → nearest radar station(s) so each tenant's service area polls the right station(s).

---

## Binary Format: NIDS / ICD

NEXRAD Level 3 products use the NIDS binary format (defined in NWS ICD 2620010). This is NOT JSON/CSV — it's a packed binary format with headers, symbology layers, and radial/raster data.

### Structure (simplified)

```
[Message Header - 18 bytes]
  - message code, date, time, length, source station
[Product Description Block - 102 bytes]  
  - lat/lng of radar, product-specific parameters
  - for N0X: max hail size value, color table thresholds
[Symbology Block]
  - Layer 1: Radial data (most common for hail products)
    - Each radial: start angle, angle delta, num bins, bin values
    - Bin values map to hail probability or size via threshold table
```

### Parsing Options

1. **Python (easiest, most mature):**
   - `metpy` — MetPy's `Level3File` parser reads NIDS format natively. Well-maintained by Unidata.
   - `pyart` — ARM Radar Toolkit, also reads Level 3.
   - `nexradaws` — Python lib specifically for fetching NEXRAD from AWS.
   - A small Python microservice (Flask/FastAPI) could handle parsing and expose a JSON REST endpoint.

2. **JavaScript/TypeScript (harder, less ecosystem):**
   - No mature NIDS parser exists in JS/TS. You'd need to port the format parsing.
   - The format is well-documented (ICD 2620010) — it's tedious but not complex. ~500-800 lines of binary parsing code.
   - Using Bun's `Buffer` and `DataView` for binary reads.

3. **Recommended approach:**
   - **Python worker** (deployed as a separate Render service or Cloudflare Worker) that:
     - Polls S3 for new files every 2 minutes
     - Parses NIDS binary with MetPy
     - Extracts hail bin locations + sizes
     - Converts radar polar coordinates (azimuth + range) to lat/lng
     - POSTs results as JSON to the CRM API
   - **CRM API** (existing Hono/Bun) receives parsed hail data, stores in PostGIS, runs lead matching

---

## Database Schema

The existing `storm_radar_event` and `storm_radar_event_match` tables in `crm-roof/backend/db/schema.ts` are already designed for this. They were renamed from `stormEvent` duplicates earlier in this session.

### Existing tables (already in schema)

```sql
-- storm_radar_event: individual detected hail events from radar
storm_radar_event {
  id, company_id, provider ('nexrad'),
  provider_event_id (radar station + timestamp),
  event_type ('hail'),
  severity ('minor'|'moderate'|'severe'|'extreme'),
  hail_size_inches,
  wind_speed_mph,
  description,
  lat, lng,
  radius_miles,
  state, city, zip,
  started_at, ended_at,
  raw_payload (JSON — full parsed radar data),
  created_at, updated_at
}

-- storm_radar_event_match: contacts in the affected area
storm_radar_event_match {
  id, company_id,
  storm_radar_event_id,
  contact_id,
  distance_miles,
  status ('new'|'contacted'|'quoted'|'booked'|'not_interested'),
  contacted_at, notes,
  created_at, updated_at
}
```

### New table needed: `hail_swath`

```sql
CREATE TABLE hail_swath (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES company(id) ON DELETE CASCADE,
  radar_station TEXT NOT NULL,          -- e.g., 'KARX'
  scan_time TIMESTAMPTZ NOT NULL,       -- when radar completed the scan
  received_at TIMESTAMPTZ DEFAULT NOW(),-- when we processed it
  hail_polygons JSON NOT NULL,          -- GeoJSON FeatureCollection of hail swath polygons
                                        -- each feature has properties: max_size_inches, probability
  max_hail_inches DECIMAL(4,2),         -- largest stone detected in this scan
  affected_area_sq_miles DECIMAL(10,2), -- total area of hail swath
  property_count INTEGER,               -- estimated properties in swath (if parcel data available)
  status TEXT DEFAULT 'detected',       -- detected, verified, dismissed
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX hail_swath_company_id_idx ON hail_swath(company_id);
CREATE INDEX hail_swath_scan_time_idx ON hail_swath(scan_time);
CREATE INDEX hail_swath_radar_station_idx ON hail_swath(radar_station);
```

### PostGIS extension needed

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

PostGIS enables spatial queries like:
- `ST_DWithin(contact_location, hail_swath_centroid, radius)` — find contacts near hail
- `ST_Contains(hail_polygon, contact_point)` — is this contact inside the swath?
- `ST_Area(hail_polygon)` — compute affected area

---

## Implementation Plan

### Phase 1: Radar Ingestion Worker (Python microservice)

**File:** New standalone service, deployed as a separate Render web service or background worker.

**Tech:** Python 3.11+, MetPy, boto3 (AWS S3), FastAPI or Flask

**What it does:**
1. On startup, loads a config mapping: tenant service area zip codes → nearest NEXRAD station codes
2. Every 2 minutes, polls `s3://noaa-nexrad-level3/{today}/{station}/{station}_*_N0X.gz` for new files since last check
3. For each new file:
   a. Download + decompress gzip
   b. Parse NIDS binary with MetPy `Level3File`
   c. Extract radial hail data — each bin has an azimuth, range, and hail size value
   d. Convert polar (azimuth + range from radar) to lat/lng using radar station coordinates
   e. Filter for bins where hail_size >= 0.75" (roof damage threshold)
   f. Cluster nearby bins into contiguous swath polygons (convex hull or alpha shape)
   g. For each polygon: compute centroid, area, max hail size, bounding box
   h. POST to CRM API: `POST /api/storm-radar/ingest` with the swath data

**Key dependencies:**
- `metpy` — NIDS parsing
- `boto3` — S3 access (no credentials needed for public bucket)
- `shapely` — polygon geometry (clustering bins into swaths)
- `pyproj` — coordinate transformations (radar polar → WGS84 lat/lng)

**Estimated effort:** 3-5 days

### Phase 2: CRM API Endpoints (Hono/Bun)

**File:** Update existing `crm-roof/backend/src/routes/stormRadar.ts` and `services/stormRadar.ts`

**New/updated endpoints:**

```
POST /api/storm-radar/ingest          -- receive parsed hail data from Python worker
                                      -- auth via X-Factory-Key header (internal only)
                                      -- insert hail_swath + storm_radar_event records
                                      -- trigger lead matching

GET  /api/storm-radar/swaths          -- list recent hail swaths for this tenant's area
                                      -- supports date range, min hail size filters
                                      -- returns GeoJSON for map overlay

GET  /api/storm-radar/swaths/:id      -- single swath detail with matched contacts

POST /api/storm-radar/swaths/:id/match -- run/re-run lead matching for a swath
                                       -- find contacts with addresses inside or near the polygon
                                       -- create storm_radar_event_match records

GET  /api/storm-radar/alerts           -- unread hail alerts for this tenant
POST /api/storm-radar/alerts/:id/read  -- mark alert as read
```

**Lead matching logic:**
1. Get all tenant contacts with geocoded addresses (lat/lng on contact record)
2. For each contact, check `ST_DWithin(contact_point, swath_polygon, 0.5 miles)` using PostGIS
3. Create `storm_radar_event_match` for each hit with `status = 'new'`
4. Return count of matched leads

**Estimated effort:** 2-3 days

### Phase 3: Frontend — StormRadarPage (React)

**File:** Update existing `crm-roof/frontend/src/pages/storms/StormRadarPage.tsx`

**What to build:**
1. **Map view** (Google Maps or Mapbox) showing:
   - Hail swath polygons color-coded by severity (yellow < 1", orange 1-1.5", red 1.5-2", purple 2"+)
   - Tenant's service area boundary
   - Matched contact pins inside/near swaths
   - Click a swath → sidebar shows: time, max hail size, area, property count, matched leads
2. **Alert banner** at top when new hail detected in service area: "Hail detected! 1.5" stones near Eau Claire, WI — 23 contacts in affected area"
3. **Swath list view** — table of recent swaths with date, size, area, lead count, status
4. **Actions per swath:**
   - "Generate Canvassing Route" → creates a canvassing session from matched leads
   - "Send SMS Blast" → texts matched contacts: "Recent storms hit your area — free inspection?"
   - "Export Leads" → CSV of matched contacts with addresses
5. **Settings panel:**
   - Service area: zip codes or draw polygon on map
   - Alert preferences: min hail size to trigger alert, notification method (in-app, SMS, email)
   - Auto-match: toggle automatic lead matching on new swaths

**Estimated effort:** 3-5 days

### Phase 4: Push Notifications

**What to build:**
- When a new hail swath is detected in a tenant's service area, push a notification
- In-app notification (badge on Storm Radar nav item + toast)
- Optional SMS to admin phone via existing Twilio integration
- Optional email alert

**Estimated effort:** 1 day

---

## Radar Station Mapping

Each tenant needs to be mapped to 1-3 NEXRAD stations based on their service area. The worker only polls stations that have active tenants nearby (don't poll all 160 stations).

**Approach:** Maintain a lookup table of zip code centroids → nearest NEXRAD station(s) within 150 miles. When a tenant sets their service area (zip codes), resolve to station codes. Pre-computed mapping — the NEXRAD station list is static (~160 stations, coordinates are public).

**Data source for mapping:** https://www.ncdc.noaa.gov/nexradinv/ — full station list with coordinates.

---

## Performance Considerations

- **S3 polling frequency:** Every 2 minutes per active station. With 20 tenants across 10 stations, that's ~5 S3 LIST requests per minute. Negligible cost.
- **File size:** Each Level 3 product is ~5-50 KB compressed. Parsing is fast (<100ms per file with MetPy).
- **PostGIS queries:** With spatial indexes, matching 10,000 contacts against a polygon takes <500ms.
- **Total latency budget:** S3 poll (2 min max wait) + download+parse (1 sec) + POST to CRM (1 sec) + lead matching (1 sec) = **worst case ~3 minutes after radar scan, typical ~1-2 minutes**.

---

## What This Gives Storm Tier Tenants

For $0 extra (included in Storm tier $599/mo):
- Hail swath maps within ~5 minutes of a storm
- Automatic matching against their existing customer base
- One-click canvassing route generation from matched leads
- SMS/email blast to affected customers
- Historical hail data for insurance claim support
- No third-party API keys to manage
- No per-report fees

---

## What We DON'T Get (vs HailTrace)

- **No meteorologist verification** — we rely on radar algorithms, which can have false positives (rain/hail discrimination isn't perfect). HailTrace has humans confirming swaths.
- **No property count estimates** — unless we integrate parcel/address data (a separate dataset). We can count matched contacts but not total affected properties.
- **No pre-storm predictions** — this is post-storm detection only. HailTrace also does forecast-based positioning.

These gaps are acceptable for v1. Verification can be added later via NWS Local Storm Reports (ground-truth data that arrives 15-60 min after the storm). Property counts can be added by integrating census/parcel data.

---

## Open Questions

1. **Python worker deployment:** Separate Render service? Cloudflare Worker? Lambda? The worker needs to run continuously (polling every 2 min), so a Render background worker ($7/mo starter) is simplest.
2. **Contact geocoding:** Do contacts in the Roof CRM already have lat/lng? If not, we need to geocode addresses (Google Geocoding API, ~$5 per 1000 addresses) on contact creation.
3. **Service area definition:** Zip codes (simple) or draw-a-polygon on map (fancy)? Zip codes is fine for v1.
4. **Multi-tenant worker:** One shared worker polling all stations for all tenants, or one worker per tenant? Shared is much more efficient — poll each station once, fan out to all tenants in that station's coverage area.
5. **PostGIS availability:** Render Postgres supports PostGIS. Supabase supports PostGIS natively. Need to confirm which DB provider each tenant uses and ensure PostGIS extension is enabled.

---

## Estimated Total Effort

| Phase | Effort | Dependency |
|---|---|---|
| Phase 1: Python radar worker | 3-5 days | None |
| Phase 2: CRM API endpoints | 2-3 days | Phase 1 |
| Phase 3: Frontend StormRadarPage | 3-5 days | Phase 2 |
| Phase 4: Push notifications | 1 day | Phase 2 |
| **Total** | **~2 weeks** | |

---

## Files to Modify/Create

### New files
- `services/twomiah-storm/` — new Python microservice (standalone repo or subfolder)
  - `main.py` — FastAPI app with polling loop
  - `radar_parser.py` — NIDS binary parsing with MetPy
  - `swath_builder.py` — cluster radar bins into polygons with Shapely
  - `s3_poller.py` — poll AWS S3 for new radar files
  - `requirements.txt` — metpy, boto3, shapely, pyproj, fastapi, uvicorn
  - `render.yaml` — deployment config

### Modified files in crm-roof template
- `backend/db/schema.ts` — add `hailSwath` table
- `backend/db/migrations/0010_add_hail_swath.sql` — migration + PostGIS extension
- `backend/src/routes/stormRadar.ts` — replace stubs with real endpoints
- `backend/src/services/stormRadar.ts` — replace stubs with ingest + matching logic
- `frontend/src/pages/storms/StormRadarPage.tsx` — full map UI rebuild

### NOT modified
- All other CRM routes/pages — untouched
- Storm leads feature (`storms.ts`) — separate feature, untouched
- Canvassing feature — untouched (but Storm Radar can feed into it)

---

## References

- NEXRAD Level 3 on AWS: https://registry.opendata.aws/noaa-nexrad/
- NEXRAD product codes: https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar
- MetPy Level3File parser: https://unidata.github.io/MetPy/latest/api/generated/metpy.io.Level3File.html
- NIDS format spec (ICD 2620010): https://www.roc.noaa.gov/wsr88d/BuildInfo/Files.aspx
- NOAA SWDI (historical validation): https://www.ncei.noaa.gov/products/severe-weather-data-inventory
- HailScore (prior art, same approach): https://alexchicilo.medium.com/how-i-built-a-free-hail-damage-tool-using-4-5-million-noaa-radar-records-39bac6f0438e
- PostGIS spatial queries: https://postgis.net/docs/reference.html
- NEXRAD station list: https://www.ncdc.noaa.gov/nexradinv/
