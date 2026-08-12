-- Domain wiring status, so a failed nameserver handoff is visible rather than
-- silent. A domain we sold can be registered, have a Cloudflare zone, and
-- still not resolve if the registrar was never pointed at it — that state
-- needs a name.
--
-- Values in use: 'nameservers_failed'. Additive and idempotent.

alter table tenants add column if not exists domain_status text;
