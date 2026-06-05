# Security incident response

When something goes wrong (intrusion, data exposure, ransomware, lost
laptop with prod credentials), this is the playbook. Keep it short
enough to actually run during an incident; resist the urge to add
process for its own sake.

## Severity

- **SEV-1** — confirmed unauthorized access to customer data, payment
  systems, or production secrets. Wake people up.
- **SEV-2** — credible report or evidence of a vulnerability that could
  lead to SEV-1 if exploited. Page the on-call within 1 hour.
- **SEV-3** — bug or misconfiguration with security implications, no
  active exploitation. Same-day attention.

## First 30 minutes (SEV-1)

1. **Stop the bleeding.** If a credential is compromised, rotate it
   right now (Render env vars, Stripe keys, Cloudflare API token,
   SendGrid key, GitHub PAT). Don't wait for triage.
2. **Preserve evidence.** Snapshot logs (Render → Logs export), DB
   state if relevant, any malicious request body. Save to a private
   shared drive — do NOT post in chat unredacted.
3. **Notify the team.** Single Slack thread. Title:
   `[SEV-1] <one-line summary>`. Pin it.
4. **Stand up an incident commander.** Whoever's available first.
   They drive comms; everybody else investigates.

## First 4 hours

5. **Determine blast radius.** Which tenants? Which data fields? Was
   anything exfiltrated, or just accessed?
6. **Identify affected customers.** Query `tenants` table for the list.
7. **Draft customer notice** (template below). Do not send until facts
   are confirmed.
8. **Patch the vulnerability** if not already done. Deploy with a
   reduced-checks fast path if needed — get the fix in front of the
   exploit.

## Within 72 hours

9. **Notify affected customers.** Honest, specific, no marketing
   language. Tell them what happened, what data was involved, what we
   did about it, what they should do.
10. **Notify regulators if required.** GDPR: 72 hours from awareness.
    State breach laws vary; California requires "in the most expedient
    time possible."
11. **Public post-mortem.** Within 2 weeks. No customer names, no
    secret implementation details. Yes to: timeline, root cause, what
    we changed, what we are still working on.

## Customer notification template

```
Subject: Security incident on your Twomiah account — please review

[Customer name],

On [date] we discovered [what happened] affecting your account. The
following data was potentially exposed: [specific fields]. We have
[action taken] and confirmed [scope].

What you should do:
- [Specific action items, e.g. reset password, review audit log]
- [Whether they need to notify their own users]

What we are doing:
- [Mitigation deployed]
- [Investigation status]
- [Process change]

We are sorry. Hit reply with any questions and a real human will
respond within 1 business day.

— Twomiah security team
```

## Credentials to rotate during a SEV-1

In order of impact:

1. `JWT_SECRET` per affected tenant (forces re-login of all admin
   sessions for that tenant)
2. `STRIPE_SECRET_KEY` (revoke via Stripe dashboard, regenerate, update
   in Render)
3. `SENDGRID_API_KEY`
4. `CLOUDFLARE_API_TOKEN`
5. `RENDER_API_KEY`
6. GitHub Personal Access Tokens used by the factory
7. Postgres passwords (Render → Settings → Connect → Reset password)

## Roadmap items (not yet built)

- Status page at status.twomiah.com — currently we communicate via
  email.
- Bug bounty on HackerOne — security@twomiah.com is the manual entry
  point.
- SOC 2 Type I audit — pending revenue threshold.
