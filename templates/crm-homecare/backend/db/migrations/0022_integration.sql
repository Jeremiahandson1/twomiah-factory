-- Home care catch-up, integration: the caregiver app's Expo push tokens.
--
-- One row per device token (a caregiver may sign in on two phones). sendPush (services/visitNotify.ts)
-- sends to every token of the person through Expo's push service as well as to their web-push
-- subscriptions; a token Expo reports as DeviceNotRegistered is deleted.
CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "platform" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_tokens_token_idx" ON "expo_push_tokens" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expo_push_tokens_user_id_idx" ON "expo_push_tokens" ("user_id");
