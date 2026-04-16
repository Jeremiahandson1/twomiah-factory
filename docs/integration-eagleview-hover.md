# EagleView + HOVER BYOA Integration Plan

## Overview

Add Bring-Your-Own-Account (BYOA) integrations for EagleView and HOVER into the Roof CRM template. Tenants connect their own EagleView/HOVER accounts via OAuth, then order reports and capture requests directly from the CRM dashboard. Results flow into the existing measurement report system.

**Two modes (future):**
1. **BYOA** (this plan) — tenant plugs in their own API credentials, pays EagleView/HOVER directly
2. **Twomiah-brokered** (later) — we resell at volume discount once we've negotiated partner pricing

---

## Provider Summary

### EagleView
- **What:** Aerial roof measurements from satellite imagery (facet-by-facet, pitch, area, waste factors)
- **Auth:** OAuth 2.0 (24hr access tokens, 30-day refresh tokens)
- **API:** REST at restdoc.eagleview.com
- **Developer portal:** developer.eagleview.com (self-service signup, sandbox available)
- **Pricing:** $33-$90/report depending on tier (Silver/Gold/Platinum volume discounts)
- **Partner program:** 48 active partners, apply at eagleview.com/partnerinfo/
- **Data returned:** Facet measurements, pitch calculations, waste factor suggestions, aerial imagery, PDF reports

### HOVER
- **What:** 3D property models from smartphone photos (measurements, material estimates, visualization)
- **Auth:** OAuth 2.0 Authorization Code Grant (2hr access tokens with refresh)
- **API:** REST v3 at developers.hover.to
- **Developer portal:** developers.hover.to (self-service, 3 free projects)
- **Pricing:** $25/job (Starter), Pro/Enterprise volume tiers
- **Partner program:** hover.to/partners/ (marketplace integrations)
- **Data returned:** 3D models, measurements, material estimates, JSON/PDF/XLSX/SKP exports
- **Capture flow:** Creates a "Capture Request" that sends SMS/email to property owner prompting them to use HOVER's native iOS/Android app for 8 photos. NOT embeddable — users must download HOVER's app.
- **Webhooks:** Job status updates (processing, complete, failed)

---

## What We're Building

### Tenant Experience

1. Admin goes to Settings > Integrations
2. Enters their EagleView or HOVER API credentials (client ID + secret)
3. Clicks "Connect" — OAuth redirect to provider, authorize, redirect back
4. Green "Connected" badge appears
5. From the Measurements page, new buttons: "Order EagleView Report" / "Request HOVER Capture"
6. EagleView: enter address → report ordered → webhook fires when complete → appears in measurements list
7. HOVER: enter address + contact info → SMS sent to homeowner → they capture with HOVER app → webhook fires when complete → appears in measurements list

### How It Fits Into Existing System

- EagleView/HOVER results store in the existing `measurementReport` table with `provider` set to `'eagleview'` or `'hover'`
- Same `MeasurementsPage` UI shows all reports regardless of provider — just with a provider badge
- Same credit system does NOT apply to BYOA — tenant pays their provider directly
- `roofReport` table is NOT modified — if a tenant wants to create a full roof report from EagleView data, they use the existing "create from measurement" flow

---

## Files Changed

### Schema (`backend/db/schema.ts`)

**New table: `providerIntegration`** — add after `qbIntegration` (line ~531)

Follows the `qbIntegration` pattern exactly:

```
providerIntegration {
  id:              text PK (CUID)
  companyId:       text FK → company (cascade delete)
  provider:        text NOT NULL  -- 'eagleview' | 'hover'
  clientId:        text           -- tenant's OAuth app client ID
  clientSecret:    text           -- tenant's OAuth app client secret
  accessToken:     text           -- OAuth access token
  refreshToken:    text           -- OAuth refresh token
  tokenExpiresAt:  timestamp      -- when access token expires
  realmId:         text           -- provider-specific account/org ID
  webhookSecret:   text           -- for verifying inbound webhooks
  connected:       boolean DEFAULT false
  lastSyncedAt:    timestamp (nullable)
  createdAt:       timestamp DEFAULT now()
  updatedAt:       timestamp DEFAULT now()
}
UNIQUE constraint on (companyId, provider)
Index on companyId
```

**Extend `measurementReport`** — add 3 columns:

```
externalProvider:  text           -- 'eagleview' | 'hover' | null (null = google_solar)
externalOrderId:   text           -- provider's order/job ID for polling
externalStatus:    text           -- provider's status string (for debugging)
```

### New Backend Files (4)

#### `services/eagleview.ts`

```
Exports:
  getAuthUrl(companyId)           -- build OAuth redirect URL using tenant's stored clientId
  handleCallback(code, companyId) -- exchange code for tokens, store in providerIntegration
  disconnect(companyId)           -- clear tokens
  getStatus(companyId)            -- return connection status
  refreshTokenIfNeeded(companyId) -- check tokenExpiresAt, refresh 24hr tokens
  orderReport(companyId, {address, city, state, zip, jobId?, productType?})
                                  -- call EagleView REST API to place order
                                  -- create measurementReport with provider='eagleview', status='processing'
                                  -- return report record
  getReport(companyId, orderId)   -- fetch completed report data from EagleView
  mapToMeasurementReport(evData)  -- transform EagleView response to measurementReport shape:
                                     totalSquares, totalArea, segments (array of facets),
                                     pitchDegrees, rawData
```

#### `services/hover.ts`

```
Exports:
  getAuthUrl(companyId)           -- build OAuth redirect URL
  handleCallback(code, companyId) -- exchange code, store tokens
  disconnect(companyId)           -- clear tokens
  getStatus(companyId)            -- connection status
  refreshTokenIfNeeded(companyId) -- check tokenExpiresAt, refresh 2hr tokens
  createCaptureJob(companyId, {address, contactEmail, contactPhone, contactName})
                                  -- call HOVER API to create capture request
                                  -- HOVER sends SMS/email to contact to download app and capture
                                  -- create measurementReport with provider='hover', status='processing'
                                  -- return report record
  getJobMeasurements(companyId, jobId)
                                  -- fetch completed 3D measurements from HOVER
  mapToMeasurementReport(hoverData)
                                  -- transform HOVER response to measurementReport shape:
                                     totalSquares, totalArea, segments, rawData
```

#### `routes/providerIntegrations.ts` — mounted at `/api/integrations`

Follows `quickbooks.ts` pattern. All routes authenticated except callbacks.

```
PUT  /api/integrations/:provider/credentials  -- save clientId + clientSecret (BYOA step 1)
GET  /api/integrations/:provider/connect      -- initiate OAuth redirect
GET  /api/integrations/:provider/callback     -- OAuth callback (NO auth middleware)
POST /api/integrations/:provider/disconnect   -- clear tokens
GET  /api/integrations/:provider/status       -- connection status
```

`:provider` is validated to be `'eagleview'` or `'hover'`.

State parameter in OAuth encodes `{companyId, provider}` for callback routing.

On successful callback, redirects to `/crm/settings?connected={provider}`.

#### `routes/webhooks.ts` — mounted at `/api/webhooks`

NO auth middleware. Verifies webhook signatures using `providerIntegration.webhookSecret`.

```
POST /api/webhooks/eagleview   -- EagleView report completion callback
                               -- find measurementReport by externalOrderId
                               -- fetch full report data via eagleview.getReport()
                               -- update measurementReport: status='complete', populate
                                  totalSquares, totalArea, segments, pitchDegrees, rawData

POST /api/webhooks/hover       -- HOVER job status callback
                               -- on status='complete': fetch measurements via hover.getJobMeasurements()
                               -- update measurementReport same as above
                               -- on status='failed': update status='failed'
```

### Modified Backend Files (2)

#### `routes/measurements.ts` — add 2 endpoints

```
POST /api/measurements/order-eagleview
  -- body: {address, city, state, zip, jobId?}
  -- checks providerIntegration for eagleview connection
  -- calls eagleview.orderReport()
  -- does NOT deduct credits (tenant pays EagleView directly)
  -- returns measurementReport with status='processing'

POST /api/measurements/order-hover
  -- body: {address, city, state, zip, jobId?, contactEmail, contactPhone, contactName}
  -- checks providerIntegration for hover connection
  -- calls hover.createCaptureJob()
  -- does NOT deduct credits
  -- returns measurementReport with status='processing'
```

Existing endpoints are NOT modified. Google Solar ordering continues to work exactly as before.

#### `index.ts` — mount 2 new routes

```
import providerIntegrations from './routes/providerIntegrations.ts'
import webhooks from './routes/webhooks.ts'

app.route('/api/integrations', providerIntegrations)
app.route('/api/webhooks', webhooks)
```

### Frontend Files (2)

#### `data/features.ts` — add 2 feature IDs

```
eagleview_integration: 'eagleview_integration',
hover_integration: 'hover_integration',
```

#### `pages/settings/SettingsPage.tsx` — add 2 integration panels

After the existing QuickBooks section, add EagleView and HOVER panels. Same UI pattern:

**EagleView Panel** (shown when `useFeature('eagleview_integration')`):
- Header: "EagleView Integration" with EagleView logo placeholder
- Step 1: Text inputs for Client ID and Client Secret, "Save Credentials" button
- Step 2: "Connect to EagleView" button → `window.location.href = '/api/integrations/eagleview/connect'`
- Connected state: green badge, account info, "Disconnect" button
- Help text: "Enter your EagleView developer credentials from developer.eagleview.com"

**HOVER Panel** (shown when `useFeature('hover_integration')`):
- Same layout as EagleView
- Help text: "Enter your HOVER API credentials from developers.hover.to"

### Files NOT Changed

- `routes/roofReports.ts` — untouched
- `RoofReportsPage.tsx` — untouched
- `routes/quickbooks.ts` — untouched
- `services/quickbooks.ts` — untouched
- `services/googleSolar.ts` — untouched
- `services/roofReport.ts` — untouched
- All existing schema columns — untouched
- All other routes — untouched

---

## Data Flow

### EagleView Order

```
User clicks "Order EagleView Report" on MeasurementsPage
  → POST /api/measurements/order-eagleview {address, city, state, zip}
  → Check providerIntegration for eagleview connection
  → Refresh OAuth token if needed
  → Call EagleView REST API to place order
  → Insert measurementReport:
      provider: 'eagleview'
      externalProvider: 'eagleview'
      externalOrderId: EV order ID
      status: 'processing'
  → Return report to frontend (shows "Processing..." in list)

  ... EagleView processes report (minutes to hours) ...

EagleView sends webhook → POST /api/webhooks/eagleview
  → Verify webhook signature
  → Find measurementReport by externalOrderId
  → Fetch full report via eagleview.getReport()
  → Map EagleView facets/pitch/waste to measurementReport fields:
      totalSquares, totalArea, segments, pitchDegrees, rawData
  → Update status: 'complete'
  → Report now appears as completed in MeasurementsPage
```

### HOVER Capture

```
User clicks "Request HOVER Capture" on MeasurementsPage
  → POST /api/measurements/order-hover {address, contactEmail, contactPhone, contactName}
  → Check providerIntegration for hover connection
  → Refresh OAuth token if needed
  → Call HOVER API to create capture request
  → HOVER sends SMS/email to homeowner with app download link
  → Insert measurementReport:
      provider: 'hover'
      externalProvider: 'hover'
      externalOrderId: HOVER job ID
      status: 'processing'
  → Return report to frontend

  ... Homeowner downloads HOVER app, takes 8 photos ...
  ... HOVER processes 3D model (hours to days) ...

HOVER sends webhook → POST /api/webhooks/hover
  → Verify webhook signature
  → Find measurementReport by externalOrderId
  → Fetch measurements via hover.getJobMeasurements()
  → Map HOVER measurements to measurementReport fields
  → Update status: 'complete'
```

---

## Feature Gating

Both integrations are gated behind feature flags:
- `eagleview_integration` — enables EagleView settings panel + order button
- `hover_integration` — enables HOVER settings panel + order button

**Decision: available on all tiers.** BYOA costs us nothing to operate (tenant pays the provider directly). Making it available everywhere increases CRM stickiness. Can always gate to higher tiers later if needed.

---

## Migration

New SQL migration: `0009_add_provider_integrations.sql`

```sql
CREATE TABLE provider_integration (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  client_id TEXT,
  client_secret TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  realm_id TEXT,
  webhook_secret TEXT,
  connected BOOLEAN DEFAULT false NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(company_id, provider)
);
CREATE INDEX provider_integration_company_id_idx ON provider_integration(company_id);

ALTER TABLE measurement_report ADD COLUMN external_provider TEXT;
ALTER TABLE measurement_report ADD COLUMN external_order_id TEXT;
ALTER TABLE measurement_report ADD COLUMN external_status TEXT;
```

---

## Decisions (resolved)

1. **Pricing tiers** — All tiers. BYOA is free for us to operate; maximizes stickiness.
2. **Webhook URL registration** — Auto-register during OAuth if the provider API supports it, otherwise tenant pastes the URL manually in their provider dashboard. Determined per-provider during implementation.
3. **EagleView product types** — PremiumReport only to start (the standard roofer estimate report). Add other types later if tenants request them.
4. **HOVER export format** — JSON measurements only. No 3D model files (SKP). We just need the numbers for the measurement table.
5. **MeasurementsPage UI** — Single "Order Report" button that opens a provider picker modal (Google Solar / EagleView / HOVER). Cleaner than inline buttons for 3 providers.
6. **Error handling for disconnected accounts** — Toast notification: "Your {provider} connection has expired. Please reconnect in Settings." with a link to the settings page.
