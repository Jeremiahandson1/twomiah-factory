// The live facts a vertical's own website sections read (SiteSettings.facts): what the bar's sections call `site` and
// `live` — the Tonight board, the taps, the menu, the hours, what's on — read by the vertical's add-on from the same
// database (server/crm/bar/barSite.ts). The website template fetched them from the separate CRM over HTTP; in the one
// app they are a read, made fresh for each page. The pages, the layout and the sitemap ask through this, so no
// website file names a vertical.
import type { PageMeta } from './render.ts'

/** What one page render knows besides its sections' own data. */
export interface PageFacts {
  /** The sections' `site` local (the bar's bundle: menu, taps, hours, events, the story…). */
  site: Record<string, any>
  /** The sections' `live` local: the state right now, or null when there is none to show (the sections fall back). */
  live: unknown | null
  /** Added to the page's settings (the owner's cover art, the address as its parts…). */
  settings: Record<string, any>
}

/** A page the facts make at /<a>/<b> (a signature menu item, an era of the story). */
export interface FactsPage {
  path: string
  sections: any[]
  meta: PageMeta
  /** What the page's JSON-LD is about, handed back to jsonLd. */
  about?: unknown
}

export interface SiteFacts {
  /** This page's facts; `settings` is the site's (the address the facts split into parts). */
  load(companyId: string, settings: Record<string, any>): Promise<PageFacts>
  /**
   * The page's JSON-LD (serialized blocks, joined for one <script type="application/ld+json">), in place of the base
   * layout's LocalBusiness block. '' leaves the layout's own.
   */
  jsonLd(facts: PageFacts, page: { slug: string; title: string; sections: any[]; settings: Record<string, any>; about?: unknown }): string
  nestedPage(facts: PageFacts, a: string, b: string, companyName: string): FactsPage | null
  /** Paths the sitemap lists besides the pages (signature items, the story's eras); `pages` is the published slugs. */
  sitemapPaths(facts: PageFacts, pages: Set<string>): string[]
}
