-- TURNING TWO-FACTOR OFF ANSWERED 409. (T57)
--
-- mfa_challenges.device_id references mfa_devices(id) with no ON DELETE action, so Postgres refused to
-- delete an authenticator that had ever completed a sign-in — which is every authenticator anybody
-- actually used. The route reported "A related record does not exist, or is still in use." and the
-- device stayed enrolled.
--
-- Found on the contractor CRM by tests/crm/t57-mfa.test.ts while porting this feature out of the
-- dispensary; the dispensary carried the same constraint and no test had ever deleted a used device.
--
-- A challenge row is the record that a sign-in HAPPENED. The device it used may be removed later, and
-- the historical pointer going null is the correct outcome — the row still says when, and for whom.
DO $$ BEGIN
  ALTER TABLE "mfa_challenges" DROP CONSTRAINT IF EXISTS "mfa_challenges_device_id_mfa_devices_id_fk";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_device_id_mfa_devices_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "mfa_devices"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
