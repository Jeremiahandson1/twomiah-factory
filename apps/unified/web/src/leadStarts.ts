// What a lead can start the moment it becomes a contact (Lead Inbox: "Convert and start a job"). Pure, so each trade's real
// settings are tested without a browser. A trade lists in screens.leads.startWith the shared screens that open with a
// contact chosen; this keeps what the business has switched on and what this seat may create — so nothing is offered
// that would then refuse the person.
export interface LeadStart { id: string; label: string; to: (contactId: string) => string }

const CATALOG: Record<string, { feature: string; permission: string; label: (jobWord: string) => string; to: (id: string) => string }> = {
  job: { feature: 'jobs', permission: 'jobs:create', label: (w) => `Start a ${w}`, to: (id) => `/crm/jobs?contactId=${id}` },
  project: { feature: 'projects', permission: 'projects:create', label: () => 'Start a project', to: (id) => `/crm/projects?new=1&contactId=${id}` },
  quote: { feature: 'quotes', permission: 'quotes:create', label: () => 'Start a quote', to: (id) => `/crm/quotes?contactId=${id}` },
}

export function leadStarts(screens: any, hasFeature: (f: string) => boolean, can: (p: string) => boolean): LeadStart[] {
  const jobWord = String(screens?.jobs?.labels?.singular || 'job').toLowerCase()
  const startWith: string[] = Array.isArray(screens?.leads?.startWith) ? screens.leads.startWith : []
  return startWith
    .filter((k) => CATALOG[k] && hasFeature(CATALOG[k].feature) && can(CATALOG[k].permission))
    .map((k) => ({ id: k, label: CATALOG[k].label(jobWord), to: CATALOG[k].to }))
}
