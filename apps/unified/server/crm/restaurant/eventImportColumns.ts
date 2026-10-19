// The private-events CSV import's columns and sample files (events, spaces, menu packages): the names a column may go
// by in another system's export, and the sample CSV Settings › Import offers. Data only, read by the import itself
// (eventImport.ts) and by the office import's preview and template download (crm/office/importService.ts). Moved from
// templates/crm-restaurant/backend/src/services/import.ts (templates/crm-bar has the same).

export const EVENT_COLUMN_MAP = {
  name: ['name', 'event_name', 'title', 'booking'],
  eventType: ['type', 'event_type', 'category'],
  status: ['status', 'stage'],
  eventDate: ['date', 'event_date', 'booking_date'],
  startTime: ['start', 'start_time', 'from'],
  endTime: ['end', 'end_time', 'to'],
  guestCount: ['guests', 'guest_count', 'covers', 'pax', 'headcount'],
  quotedTotal: ['quote', 'quoted_total', 'total', 'value'],
  depositRequired: ['deposit', 'deposit_required'],
  space: ['space', 'room', 'venue_space'],
  dietaryRequirements: ['dietary', 'dietary_requirements', 'allergies'],
  notes: ['notes', 'details', 'comments'],
  contactName: ['contact', 'contact_name', 'customer', 'client', 'host'],
  contactEmail: ['email', 'contact_email', 'customer_email'],
}

export const SPACE_COLUMN_MAP = {
  name: ['name', 'space_name', 'room', 'room_name'],
  description: ['description', 'details'],
  seatedCapacity: ['seated', 'seated_capacity', 'seats'],
  standingCapacity: ['standing', 'standing_capacity', 'capacity'],
  minimumSpend: ['minimum_spend', 'min_spend', 'minimum'],
  hireFee: ['hire_fee', 'hire', 'room_hire', 'fee'],
}

export const MENU_COLUMN_MAP = {
  name: ['name', 'package', 'package_name', 'menu'],
  description: ['description', 'details'],
  category: ['category', 'type'],
  pricePerPerson: ['price', 'price_per_person', 'per_head', 'pp', 'cost'],
  minGuests: ['min_guests', 'minimum', 'min'],
  dietaryNotes: ['dietary', 'dietary_notes', 'allergens'],
}

/** The column a file must have to be previewed, per type. */
export const VENUE_IMPORT_REQUIRED: Record<string, string[]> = {
  events: EVENT_COLUMN_MAP.name,
  spaces: SPACE_COLUMN_MAP.name,
  menus: MENU_COLUMN_MAP.name,
}

/** The sample CSV per type. */
export const VENUE_IMPORT_TEMPLATES: Record<string, string> = {
  events: 'Name,Type,Status,Date,Start,End,Guests,Quote,Deposit,Space,Contact,Email,Dietary,Notes\nSmith Wedding,wedding,confirmed,2026-09-12,17:00,23:00,120,8500,2000,The Terrace,Jane Smith,jane@example.com,2 vegan / 1 GF,Ceremony on the lawn',
  spaces: 'Name,Description,Seated,Standing,Minimum Spend,Hire Fee\nThe Terrace,Garden room with terrace access,30,55,2000,500\nThe Cellar,Private below-stairs dining,24,30,1500,350',
  menus: 'Name,Description,Category,Price Per Person,Min Guests,Dietary Notes\nCanape Reception,Six seasonal canapes,reception,32.00,25,Vegan option available\nThree-Course Set,Plated three courses,plated,68.00,10,GF & vegan on request',
}
