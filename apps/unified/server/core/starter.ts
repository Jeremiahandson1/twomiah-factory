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
}

/** The base CRM's (templates/crm/backend/db/seed.template.ts). */
export const BASE_STARTER: StarterContent = {
  helpArticles: [
    { title: 'Getting Started with Your CRM', content: 'Welcome to your CRM! Start by adding contacts, creating jobs, and sending quotes. Use the sidebar to navigate between modules. Each module has a list view and detail view for managing records.', category: 'Getting Started', isFaq: true },
    { title: 'Managing Contacts', content: 'Contacts are the foundation of your CRM. Add new contacts from the Contacts page. Each contact can have multiple jobs, quotes, and invoices linked to them. Use tags and notes to organize your contacts.', category: 'Getting Started', isFaq: false },
    { title: 'Creating and Sending Quotes', content: 'Navigate to Quotes to create a new quote. Select a contact, add line items with descriptions and prices, then send the quote via email. Customers can approve quotes online through the customer portal.', category: 'Quotes & Invoices', isFaq: false },
    { title: 'Invoice Management', content: 'Create invoices from the Invoices page or convert approved quotes to invoices. Set payment terms, add line items, and send to customers. Track payment status and send reminders for overdue invoices.', category: 'Quotes & Invoices', isFaq: false },
    { title: 'How do I schedule jobs?', content: 'Go to the Schedule page to view your calendar. Click on a date to create a new job or drag existing jobs to reschedule. You can assign team members and set job duration. The calendar supports day, week, and month views.', category: 'Scheduling', isFaq: true },
    { title: 'Team Management', content: 'Add team members from the Team page. Each person gets a role — Viewer can look but change nothing, Staff handles day-to-day work, Manager has full access to work and invoicing, Admin also has company settings and the team itself. Team members can be assigned to jobs, tracked on the schedule, and have their time entries logged.', category: 'Team', isFaq: false },
    { title: 'How do I track time?', content: 'Use the Time page to log hours for jobs. Team members can clock in/out or manually add time entries. Time entries can be linked to specific jobs for accurate billing and labor cost tracking.', category: 'Time & Expenses', isFaq: true },
    { title: 'Document Management', content: 'Upload and organize documents in the Documents section. Attach files to contacts, jobs, or projects. Supported formats include PDF, images, and common document types.', category: 'Documents', isFaq: false },
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
