// What a new business finds in its CRM on day one: the help articles and the price book's categories. Written once,
// when the Factory provisions the tenant (modules/provision.ts), never again — after that they are the owner's.
//
// From the CRM templates' db/seed.template.ts. Left behind on purpose:
//   • sample customers, pets, units, events and invoices (rv, salon, vet, restaurant): a real business's books start
//     empty, and the RV seed's sample salespeople were sign-in accounts with one shared written-down password;
//   • settings.jobStatuses: written by every seed and read by nothing.

export interface StarterArticle {
  title: string
  content: string
  category: string
  isFaq: boolean
}

export interface StarterContent {
  helpArticles: StarterArticle[]
  /** The price book's categories for the business's industry (the Factory's industry name); `default` otherwise. */
  pricebookCategories: { byIndustry: Record<string, string[]>; default: string[] }
  /** The company row's starting values where this vertical's differ from the columns' defaults (roofing: free reports, the estimator's headline). */
  company?: { reportCredits?: number; estimatorHeadline?: string }
  /** Canvassing pitch scripts the shop starts with and edits (roofing: no screen creates the first one). */
  canvassingScripts?: Array<{ name: string; isDefault: boolean; steps: Array<{ title: string; body: string; tips: string }> }>
}

/** The base CRM's (templates/crm/backend/db/seed.template.ts). */
export const BASE_STARTER: StarterContent = {
  // Rewritten against the unified screens, every claim checked in the code (2026-10-19): the seed's named contact tags,
  // click-a-date booking with day / week / month views, roles on the Team page, overdue reminders and attaching files to
  // records, none of which the app has.
  helpArticles: [
    { title: "Getting Started with Your CRM", category: "Getting Started", isFaq: true,
      content: "Welcome to your CRM. Start by adding your customer contacts, creating jobs for the work you have booked, and sending quotes. Use the menu on the left to move between pages." },
    { title: "Managing Contacts", category: "Getting Started", isFaq: false,
      content: "Contacts are the foundation of your CRM. Add one with Add Contact on the Contacts page. A contact's page lists their jobs, quotes and invoices, and under Locations (Add Location) the addresses you work at." },
    { title: "Creating and Sending Quotes", category: "Quotes & Invoices", isFaq: false,
      content: "Go to Quotes and click New Quote. Add a line item for each part of the work and anything you supply, then choose Save & send to email it; the customer needs an email address on file. If their client portal is on (switched on from their contact page), the email lets them approve online. Otherwise, use Mark approved when they say yes. An approved quote becomes a job with Convert to Job, or an invoice with Create Invoice." },
    { title: "Invoice Management", category: "Quotes & Invoices", isFaq: false,
      content: "Create an invoice with New Invoice on the Invoices page, or from an approved quote (Create Invoice). The due date starts from the payment terms in Settings › Company. Add your line items, then click Send to email it. Use Record Payment when you're paid; the invoice shows the Balance Due. To chase an unpaid invoice, use Send again." },
    { title: "How do I schedule jobs?", category: "Scheduling", isFaq: true,
      content: "Give a job its Scheduled Date, Scheduled Time and Estimated Hours, and pick who is doing it under Assigned To. The Schedule page shows a day, a week or a month: click a job to open it. With Drag & Drop Calendar on, drag a job to another day, or in the Day view to another hour, to move it. To repeat a job, choose Repeat on the New Job form (every week, every few weeks or every month) and how many visits or until when: every visit goes on the Schedule, and Stop the series on any visit's page ends it." },
    { title: "Team Management", category: "Team", isFaq: false,
      content: "Give someone a sign-in from Settings › Users (Add User), which can email them an invite. Their Access Role sets what they can do:\n• Viewer can look but change nothing.\n• Staff handles day-to-day work.\n• Manager has full access to work and invoicing.\n• Admin also has company settings and the team.\n\nThe Team page is your roster: each person's job title, department and hourly rate. Team members can be assigned to jobs, and their hours are logged on the Time page." },
    { title: "How do I track time?", category: "Time & Expenses", isFaq: true,
      content: "Use the Time page. Click Clock In when you start and Clock Out when you finish, or use Log Time to enter hours by hand. With Log Time you can link the hours to a job. Managers approve entries." },
    { title: "Document Management", category: "Documents", isFaq: false,
      content: "Keep your files on the Documents page. Click Upload and give each file a name, a type (contract, photo, invoice, receipt…) and a description, so you can find it again with search and the filters." },
  ],
  pricebookCategories: {
    byIndustry: {
      'Roofing': ['Roof Replacement', 'Roof Repair', 'Gutter Installation', 'Gutter Cleaning', 'Roof Inspection', 'Storm Damage Assessment'],
      'General Contractor': ['Foundation', 'Framing', 'Electrical Rough-in', 'Plumbing Rough-in', 'Insulation', 'Drywall', 'Painting', 'Flooring', 'Final Walkthrough'],
      'Remodeling': ['Kitchen Remodel', 'Bathroom Remodel', 'Basement Finish', 'Addition', 'Deck/Patio', 'Interior Demo', 'Tile Work', 'Cabinet Install'],
    },
    default: ['General Services', 'Repairs', 'Installation', 'Consultation', 'Maintenance'],
  },
}

/** The categories a business in `industry` starts with. */
export function starterCategories(starter: StarterContent, industry?: string | null): string[] {
  return (industry && starter.pricebookCategories.byIndustry[industry]) || starter.pricebookCategories.default
}

/**
 * The help desk's rows a starter writes for a company (support_knowledge_base): at signup (modules/provision.ts) and when
 * a live business moves in (apps/unified/server/move/steps). One list, one numbering, wherever it is written.
 */
export function starterArticleRows(starter: StarterContent, companyId: string) {
  return starter.helpArticles.map((a, i) => ({ ...a, tags: [] as string[], sortOrder: i + 1, companyId }))
}
