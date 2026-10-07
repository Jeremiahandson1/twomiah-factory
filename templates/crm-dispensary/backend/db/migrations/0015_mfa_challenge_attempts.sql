-- A SIGN-IN CHALLENGE NOW COUNTS ITS WRONG CODES. (T57)
--
-- mfa_challenges recorded a status and an expiry and nothing about how many codes had been tried
-- against it, so a pending challenge — one that had already passed the password — accepted six-digit
-- guesses for its whole ten-minute life. The suite put twelve through it and the thirteenth, the real
-- code, still signed the user in.
--
-- Five wrong codes and the challenge is spent. On the ROW rather than in process memory, because
-- "this sign-in was abandoned after five bad guesses" is a security event that has to outlive the
-- instance that saw it — and because the row is what a later audit reads.
-- Guarded on the table existing: `mfa_challenges` is declared in db/schema.ts and created by no
-- migration, so on a migration-only database this threw `relation "mfa_challenges" does not exist`
-- and stranded every migration after it. See the note in 0011_batch_status_reason.sql. (T58d)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'mfa_challenges') THEN
    ALTER TABLE "mfa_challenges" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
  END IF;
END $$;
