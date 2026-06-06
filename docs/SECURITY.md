# Security at Twomiah Premium

Last updated: 2026-06-05.

This document describes what Twomiah does to keep your website, admin
account, and customer data safe. We aim to be specific and honest about
what we do and don't do today.

If you find a vulnerability, please email **security@twomiah.com**. We
will acknowledge within 1 business day. We do not currently run a paid
bug bounty but credit researchers in this document.

## Architecture

- Every customer site runs on its own Render web service with its own
  PostgreSQL database. There is no shared application server or
  multi-tenant database — a software bug or breach in one customer's
  site cannot expose any other customer's data.
- All traffic is HTTPS-only with HSTS enabled (1 year, includeSubDomains).
- DNS is on Cloudflare. Static assets are cached behind Cloudflare's
  edge so most denial-of-service attempts terminate before reaching
  your origin.

## Authentication

- Passwords are hashed with bcrypt (cost factor 10). We never store or
  log the plaintext.
- Sign-in tokens are short-lived JWTs (12 hours) delivered in an
  **httpOnly + Secure + SameSite=Strict** cookie. This means:
  - JavaScript on the page cannot read your token (defense against XSS).
  - The browser refuses to send the cookie on cross-site requests
    (defense against CSRF).
- The `/login` endpoint is rate-limited (10 attempts per IP per 10
  minutes). After the limit you receive a 429 with a Retry-After.
- Optional two-factor authentication using TOTP (compatible with Google
  Authenticator, 1Password, Authy, etc.) with 10 single-use recovery
  codes shown once at setup.
- "Sign out everywhere" force-invalidates every existing session and
  re-issues a single new one for the current tab.
- Passwords must be at least 10 characters and mix letters with a
  number or symbol. Common-password defaults are rejected.

## Email handling

- Email addresses can be verified via a one-time link (7-day expiry).
  Unverified emails still receive transactional mail but are flagged in
  the admin UI.
- Password reset links expire in 1 hour and are single-use. We store
  only a SHA-256 hash of the token; the plaintext lives only in your
  inbox.
- A login notification email is sent every successful sign-in with the
  time, IP address, and user-agent. The email contains a one-click
  password-reset link in case it wasn't you.

## Application security

- All database queries use Drizzle ORM with parameterized statements —
  SQL injection is structurally impossible in our code path.
- HTML output uses EJS auto-escaping. Blog post markdown is rendered
  server-side with HTML escaping applied before markdown parsing; link
  URLs are scheme-validated to block `javascript:`, `data:`, and
  `vbscript:` payloads.
- Strict Content-Security-Policy locks script execution to our own
  origin. Frame embedding is blocked (`X-Frame-Options: DENY`).
- Cross-Origin Resource Sharing is open on public marketing pages and
  same-origin-only on the admin API.
- Uploaded images are MIME-validated, size-capped at 10 MB, and
  re-encoded server-side through `sharp` — this strips embedded EXIF
  payloads and rules out polyglot file attacks.
- The public contact form is protected by a hidden honeypot field, a
  minimum-dwell-time check, and a per-IP rate limit (5 submissions per
  10 minutes).

## Audit logging

- Every successful admin mutation writes a row to the audit log:
  who did it, when, from what IP, what user-agent, and the action.
- Admins can review the log under **Activity** in the admin panel.
- Failed logins are also recorded.

## Operational

- Render runs nightly DB backups for every customer database. We can
  restore on request — contact support@twomiah.com.
- Secrets (Stripe keys, JWT secrets, SendGrid keys) are stored in Render's
  encrypted environment variables and never appear in source control.
- Customer payment information never touches our servers — Stripe
  Checkout and Stripe Customer Portal handle PCI compliance.

## What we don't do (yet)

We are honest about the gaps:

- **No SOC 2 audit.** We are a small company. If you need SOC 2
  attestation for your buyer's procurement process, contact us — we
  expect to begin a Type I audit when revenue supports the cost.
- **No formal penetration test on record.** We rely on conventional
  security middleware (CSP, HSTS, rate limits, sandboxed input
  rendering) and code review. A scheduled pen test is on the roadmap.
- **No WAF rules beyond Cloudflare defaults.** We will publish a
  Terraform module for customer-specific WAF rules when there is
  demand.
- **No malware scanning of non-image uploads.** Only images can be
  uploaded today; if we ever accept PDFs or office documents we will
  add ClamAV or an equivalent scan.

## Responsible disclosure

- Email **security@twomiah.com** with vulnerability details.
- Please give us 90 days to remediate before public disclosure.
- We will not pursue legal action against good-faith researchers who
  follow this process and do not exfiltrate customer data.
