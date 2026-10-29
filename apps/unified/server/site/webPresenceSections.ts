// The sections that exist for the $19 "Web presence" plan only (apps/api/src/webPresence/sections.ts is the table that says
// which trade is offered which). They are static — they read the section's own data and the site's settings, never the
// business's database — and their forms post to the Web presence site's own function, which a full Twomiah app does not have.
// So the full product's "Add a section" picker never offers them (admin.ts offersSection), and the picker's own list of every
// view in the library (tests/site-section-fields.test.ts) holds them out here, by name.
//
// contact/form-info is NOT in this list: it is the library's, shared; the plan only adds `noForm` to it (the lead form's
// switch), which no other site sets.
export const WEB_PRESENCE_SECTIONS: ReadonlySet<string> = new Set([
  'hours/simple', 'banner/announcement', 'hiring/form', 'spot/today', 'spot/places', 'events/dated', 'partners/wall', 'products/featured', 'steps/list', 'social/links',
])
