# Cloudflare WAF rules for tenant sites

These rules apply to a customer's `*.twomiah.app` zone (or their custom
domain proxied through Cloudflare). Apply via the dashboard or the API
once per zone. Free plan supports up to 5 custom rules; all 5 below fit.

## Rule 1 — Block admin from outside expected geographies

Useful for a one-person operation. Skip if the customer travels.

- **Expression:**
  ```
  (http.request.uri.path contains "/api/admin/" and not ip.geoip.country in {"US" "CA" "MX"})
  or
  (http.request.uri.path eq "/admin" and not ip.geoip.country in {"US" "CA" "MX"})
  ```
- **Action:** Block

## Rule 2 — Challenge unauthenticated login attempts at high rate

- **Expression:**
  ```
  http.request.uri.path eq "/api/admin/login"
  and cf.threat_score gt 10
  ```
- **Action:** Managed Challenge

## Rule 3 — Block known-bad bots

- **Expression:**
  ```
  cf.client.bot
  and not cf.verified_bot
  ```
- **Action:** Block

(Allows Googlebot, Bingbot, etc; blocks scrapers.)

## Rule 4 — Block path traversal probes

- **Expression:**
  ```
  http.request.uri.path contains ".."
  or http.request.uri.path contains "%2e%2e"
  ```
- **Action:** Block

## Rule 5 — Rate-limit contact form

Use Cloudflare's Rate Limiting (not WAF) rule:

- **Endpoint:** `https://*.twomiah.app/api/leads`
- **Threshold:** 10 requests per 10 minutes per IP
- **Action:** Block for 1 hour

## Provisioning automation

To roll these out across all customer zones, see
`apps/api/scripts/apply-cloudflare-waf.ts` (TODO).
