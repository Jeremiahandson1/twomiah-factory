# Namecheap Production Go-Live

The "buy a domain" flow on both the intake form (`/start`) and the
premium admin's Domain page is wired to Namecheap. Sandbox is verified
end-to-end (`scripts/test-namecheap-register.ts`); production is gated
on Namecheap activating API access for your real account.

Until you complete the steps below, the "buy" path returns
`503 — Domain purchase is not configured on this environment` and the
admin UI silently falls back to "BYOD only." Nothing else breaks.

## What blocks production

Namecheap requires one of these on your account before they enable API
access:

- **$50 minimum account balance**, OR
- **20+ domains** registered on the account, OR
- **$50+ in purchases over the last 2 years**

You can hit any one — the $50 deposit is the fastest. Per the
`project_v1_deploy_config` memory, deferring this until launch was an
intentional decision.

## Steps to enable

### 1. Top up your Namecheap balance — ~5 min

1. Sign in at https://namecheap.com
2. Profile → Account Funds → Add Funds → **$50** via card or PayPal
3. Wait for the balance to clear (instant for card, ~1 business day for ACH)

### 2. Request API access — ~24h turnaround

1. Profile → Tools → Namecheap API Access
2. Toggle **API Access** to ON
3. Namecheap reviews; they email you within a business day

### 3. Generate API credentials

Once API is enabled:

1. Same Tools → Namecheap API Access page
2. Copy your **API Key** (visible only on this page — store immediately)
3. Note your **API User** (same as your Namecheap username) and
   **Username** (same)
4. Add your factory's outbound IP to the **Whitelisted IPs** list.
   You can find your factory's outbound IP at
   https://api.render.com/v1/services/<factory-service-id> →
   `externalIpAddress`. Test in sandbox first to confirm.

### 4. Set production env vars on the factory

On the factory Render service (`twomiah-factory-api`) → Environment:

```
NAMECHEAP_API_USER=<your Namecheap username>
NAMECHEAP_USERNAME=<same as API_USER>
NAMECHEAP_API_KEY=<from step 3>
NAMECHEAP_CLIENT_IP=<your factory's outbound IP — same as whitelisted IP>
NAMECHEAP_SANDBOX=false
```

If sandbox was previously enabled (`NAMECHEAP_SANDBOX=true`), flip it
to `false` or delete the variable entirely.

Save → factory auto-redeploys. The `isRegistrarConfigured()` check in
`apps/api/src/services/registrar/index.ts` flips to true on next boot.

### 5. Sanity check

Run the existing diagnostic script against production:

```bash
cd apps/api
bun run scripts/test-namecheap-register.ts
```

The script does a full lifecycle check (availability → register a test
domain → fetch info → unlock → fetch EPP code). It uses a throwaway
domain so you don't accidentally claim something. **Costs you the
registration fee** (~$8-15) since it's running against production.

If you'd rather not pay for a throwaway, the cheapest verification is
just the availability check — call
`POST /api/v1/factory/public/domain/check` with any domain and confirm
you get a real `available: bool` back (not a 503).

### 6. Confirm the customer-facing flow

1. Go to https://platform.twomiah.com/start
2. Walk to the "Domain" step
3. Type a domain. You should see live availability + suggestions.
4. Approve a test intake (or skip ahead to a tenant's `/admin/domain`)
5. Try the **Buy a new one** tab — type a domain, click **Register**
6. Should flow through to a Stripe Checkout (price = registration fee
   + first year markup) and on success register the domain + start
   the wireDomainInfrastructure pipeline

## Failure modes after go-live

### "Domain registration failed: invalid IP"

The factory's outbound IP changed (Render rotates these occasionally).
Update `NAMECHEAP_CLIENT_IP` env var + re-add the new IP to Namecheap's
whitelist.

### "Domain registration failed: insufficient funds"

Your Namecheap account balance dropped below the registration cost.
Top it up via the same Account Funds flow.

### Sandbox-vs-prod credential mismatch

Sandbox API keys (issued in the sandbox dashboard) do NOT work against
production. If you copied a sandbox key into production env vars by
mistake, every call returns `Authentication failed`. Re-issue from the
**production** API access page.

## Cost model

- Namecheap charges registration fees per TLD (~$8/yr for `.com`,
  ~$5/yr for `.co`, ~$30/yr for `.app`)
- We mark up at signup to cover renewal + transfer-out support
- WHOIS Privacy is included free with every Namecheap registration
- Auto-renew is enabled by default to prevent customer domains from
  expiring out of our control

## How to disable in a hurry

If something goes sideways post-launch and you need to stop new
registrations:

1. Delete the `NAMECHEAP_API_KEY` env var from the factory
2. Factory redeploys; `isRegistrarConfigured()` returns false
3. Buy flow returns 503; BYOD continues working unaffected
4. Customers who already registered are unaffected — their domains
   are owned by them on Namecheap's side, we just can't issue NEW
   ones until the key is restored

---

Last updated: 2026-06-06. Author: Claude.
