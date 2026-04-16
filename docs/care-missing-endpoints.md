# Care CRM — Missing Backend Endpoints

These endpoints are called by the frontend but return 404. Each needs a real implementation.

## Context

- Template: `templates/crm-homecare/`
- Backend: Hono + Drizzle ORM + PostgreSQL
- All routes need `authenticate` middleware
- All responses should use snake_case keys (the Care frontend expects snake_case — see `toSnake()` in `clients.ts`)
- Schema: `templates/crm-homecare/backend/db/schema.ts`
- Existing routes: `templates/crm-homecare/backend/src/routes/`
- Mount in: `templates/crm-homecare/backend/src/index.ts`

---

## 1. GET /api/scheduling/coverage-overview

**Called by:** Schedule Hub → Tools → Coverage
**Query params:** `weekOf` (ISO date string, e.g. `2026-04-12`)
**Expected response:**
```json
{
  "weekOf": "2026-04-12",
  "days": [
    {
      "date": "2026-04-12",
      "dayOfWeek": "Sunday",
      "totalShifts": 5,
      "filledShifts": 3,
      "openShifts": 2,
      "totalHours": 40,
      "filledHours": 24,
      "coveragePercent": 60
    }
  ],
  "summary": {
    "totalShifts": 35,
    "filledShifts": 28,
    "openShifts": 7,
    "coveragePercent": 80
  }
}
```
**Implementation:** Query `schedules` table for the given week. Count shifts where `caregiverId` is assigned (filled) vs null (open). Group by day. Calculate hours from `startTime`/`endTime`.
**File:** Add to existing `templates/crm-homecare/backend/src/routes/scheduling.ts`

---

## 2. GET /api/billing/referral-source-rates

**Called by:** Billing page on load
**Expected response:**
```json
{
  "rates": [
    {
      "referralSourceId": "...",
      "referralSourceName": "Medicaid",
      "serviceCode": "T1019",
      "rate": 28.00,
      "unit": "hour",
      "effectiveDate": "2026-01-01"
    }
  ]
}
```
**Implementation:** Query `referral_sources` joined with `service_codes` or a `referral_source_rates` table if it exists. Check schema for rate-related tables. If no rates table exists, return rates derived from `service_codes` table (each service code has a `rate` column).
**File:** Add to existing `templates/crm-homecare/backend/src/routes/billing.ts`

---

## 3. GET /api/billing/invoice-payments

**Called by:** Billing page on load
**Query params:** `invoiceId` (optional), `startDate`, `endDate`
**Expected response:**
```json
{
  "payments": [
    {
      "id": "...",
      "invoiceId": "...",
      "amount": 336.00,
      "method": "check",
      "reference": "CHK-1234",
      "receivedAt": "2026-04-10T00:00:00Z",
      "createdAt": "2026-04-10T00:00:00Z"
    }
  ]
}
```
**Implementation:** Check schema for a `payments` or `invoice_payments` table. If it exists, query it with optional invoice/date filters. If not, this table needs to be created (migration + schema).
**File:** Add to existing `templates/crm-homecare/backend/src/routes/billing.ts`

---

## 4. GET /api/route-optimizer/config-status

**Called by:** Route Optimizer page on load
**Expected response:**
```json
{
  "configured": false,
  "provider": null,
  "message": "Route optimization requires a Google Maps API key. Set GOOGLE_MAPS_API_KEY in environment variables."
}
```
**Implementation:** Check if `GOOGLE_MAPS_API_KEY` env var is set. Return status.
**File:** Create new `templates/crm-homecare/backend/src/routes/routeOptimizer.ts`, mount at `/api/route-optimizer`

---

## 5. GET /api/route-optimizer/daily/:date

**Called by:** Route Optimizer → Daily Overview tab
**Query params:** date in URL path (ISO date)
**Expected response:**
```json
{
  "date": "2026-04-16",
  "caregivers": [
    {
      "id": "...",
      "name": "Maria Garcia",
      "shifts": [
        {
          "clientId": "...",
          "clientName": "Dorothy Williams",
          "address": "400 River Rd, Chippewa Falls",
          "startTime": "08:00",
          "endTime": "12:00",
          "lat": 44.9369,
          "lng": -91.3926
        }
      ],
      "totalMiles": null,
      "optimizedOrder": null
    }
  ]
}
```
**Implementation:** Query `schedules` for the given date, join with `clients` for addresses and `users` for caregiver names. Group shifts by caregiver. If Google Maps API key is configured, call Directions API to compute optimized route order + total miles.
**File:** Same `routeOptimizer.ts` as above

---

## 6. GET /api/users/caregivers

**Called by:** Incidents form, scheduling dropdowns, various pages that need a caregiver list
**Expected response:**
```json
[
  {
    "id": "...",
    "first_name": "Maria",
    "last_name": "Garcia",
    "email": "maria@chippewahomecare.com",
    "phone": "715-555-6001",
    "role": "caregiver",
    "is_active": true
  }
]
```
**Implementation:** Query `users` table where `role = 'caregiver'` and `isActive = true`. Return snake_case.
**File:** Add to existing `templates/crm-homecare/backend/src/routes/auth.ts` or create a simple endpoint in `index.ts`. Check if a `users.ts` route file exists.

---

## 7. GET /api/push/unread-count

**Called by:** Every page load (notification badge in nav)
**Expected response:**
```json
{
  "count": 0
}
```
**Implementation:** If a `notifications` table exists, count where `userId = currentUser.id` and `readAt IS NULL`. If no notifications table, return `{ count: 0 }`.
**File:** Create new `templates/crm-homecare/backend/src/routes/push.ts` or add to `index.ts`. Mount at `/api/push`.

---

## 8. Auth Token Expiry (Bug #9/#10)

**Not a missing endpoint — config issue.**

The JWT access token and refresh token expire too quickly (~20-30 min). Check:
- `templates/crm-homecare/backend/src/routes/auth.ts` — find where tokens are signed
- Look for `expiresIn` in `jwt.sign()` calls
- Access token should be ~1 hour, refresh token should be ~7 days
- Also check if the refresh endpoint (`POST /api/auth/refresh`) actually works — the frontend might not be calling it properly

**Fix:** Increase `expiresIn` for access token to `'1h'` and refresh token to `'7d'`.

---

## Priority Order

1. Bug #6 — coverage-overview (scheduling is core)
2. Bug #13 — /api/users/caregivers (blocks incident creation and many dropdowns)
3. Bug #8a/b — billing rates + payments (blocks invoice generation)
4. Bug #14 — push/unread-count (called on every page, floods console with 404s)
5. Bug #12 — route-optimizer (nice to have, can show "not configured" state)
6. Bug #9/10 — token expiry (auth config, not a new endpoint)

---

## How to Test

After building each endpoint:
1. Push to Factory repo
2. Wait for Factory API redeploy
3. "Update Code" on chippewa-home-care-agency-qa tenant
4. Wait for Render redeploy
5. Test in browser — the frontend already has the UI, it just needs the API to respond
