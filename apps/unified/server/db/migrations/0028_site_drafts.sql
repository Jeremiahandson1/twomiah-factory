-- DRAFT AND LIVE (owner 2026-10-23: "it only changes when I click save, and it says published"). The website's pages, posts,
-- portfolio work and settings each keep the owner's saved, unpublished changes in "draft"; the columns that were there are
-- the live version, which only Publish changes (site/drafts.ts). Every existing row's content is its live version, with
-- no draft: nothing on any site changes.
ALTER TABLE "page" ADD COLUMN "draft" json;--> statement-breakpoint
ALTER TABLE "portfolio_item" ADD COLUMN "draft" json;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "draft" json;--> statement-breakpoint
ALTER TABLE "website" ADD COLUMN "draft" json;
