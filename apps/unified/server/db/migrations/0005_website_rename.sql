-- The website's settings table is "website", not "site": the CRMs' own "site" table (a customer's service location, in
-- bar, basic, field service and landscaping) moves across under its name. Nothing outside this app has used "site".
ALTER TABLE "site" RENAME TO "website";--> statement-breakpoint
ALTER TABLE "website" RENAME CONSTRAINT "site_pkey" TO "website_pkey";--> statement-breakpoint
ALTER TABLE "website" RENAME CONSTRAINT "site_company_id_company_id_fk" TO "website_company_id_company_id_fk";--> statement-breakpoint
ALTER INDEX "site_company_id_key" RENAME TO "website_company_id_key";
