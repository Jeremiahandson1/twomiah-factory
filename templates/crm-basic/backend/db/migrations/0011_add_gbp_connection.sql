CREATE TABLE "gbp_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"external_email" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"account_name" text,
	"location_name" text,
	"location_title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);