# Collaborator Portal — BuilderTrend-Style Multi-Role Access

## What BuilderTrend Does

BuilderTrend gives every person on a project their own login with role-scoped access:
- **Homeowner**: See project status, approve selections, pay invoices, view photos, message GC
- **Subcontractor**: See assigned jobs, upload lien waivers, confirm scheduling, view draw schedules for their scope
- **Architect**: View/respond to RFIs, review submittals, approve change orders
- **Inspector**: View inspection schedule, upload reports
- **Supplier**: View material orders, confirm delivery dates

Each role sees ONLY what's relevant to them. All communication is tied to the project.

## What We Have Now

The Build CRM (`templates/crm/`) already has:
- **Customer Portal** (`/portal/:token`) — contacts get a token-based login to view projects, quotes, invoices, change orders, selections, messages
- **Contact types**: Client, Lead, Vendor, Subcontractor (stored in `contact.type`)
- **Portal enable/disable** per contact (`contact.portalEnabled`, `contact.portalToken`)
- **All construction features**: RFIs, submittals, change orders, selections, lien waivers, draw schedules, daily logs, inspections, punch lists
- **Documents system** with upload/download
- Backend portal routes at `/api/portal/`

## What to Build

### Phase 1: Extend Portal to Support Contact Types (2-3 days)

The portal currently shows the same data regardless of contact type. Extend it to show role-appropriate data.

**Backend changes:**

1. **Update `portal.ts` route** — the portal dashboard endpoint (`GET /api/portal/:token/dashboard`) currently returns projects, quotes, invoices for the authenticated contact. Add role-based scoping:

```
if (contact.type === 'client') {
  // Current behavior — projects, quotes, invoices, selections, change orders, messages
}
if (contact.type === 'vendor' || contact.type === 'subcontractor') {
  // Jobs assigned to this contact (via job.subcontractorId or crew assignments)
  // Lien waivers where this contact is the vendor
  // Draw schedule line items for their scope
  // Documents shared with them
  // Messages in threads they're tagged in
}
if (contact.type === 'architect' || contact.type === 'consultant') {
  // RFIs assigned to them
  // Submittals pending their review
  // Change orders pending their approval
  // Project documents (plans, specs)
}
```

2. **Add portal routes per role:**

```
GET  /api/portal/:token/jobs          — sub's assigned jobs with schedule
GET  /api/portal/:token/rfis          — architect's RFIs (already exists for clients)
GET  /api/portal/:token/submittals    — architect's submittals pending review
POST /api/portal/:token/submittals/:id/approve — architect approves submittal
POST /api/portal/:token/submittals/:id/revise  — architect requests revision
GET  /api/portal/:token/lien-waivers  — sub's lien waivers to sign
POST /api/portal/:token/lien-waivers/:id/sign  — sub signs a waiver
GET  /api/portal/:token/documents     — role-scoped shared documents
POST /api/portal/:token/documents     — upload a document (sub uploads insurance cert, etc.)
```

3. **Add `sharedWith` to documents** — currently documents belong to the company. Add a `shared_contacts` JSON array or a `document_shares` junction table so specific documents can be shared with specific portal users.

**Schema changes:**

```sql
-- Link jobs to subcontractors
ALTER TABLE job ADD COLUMN IF NOT EXISTS subcontractor_id TEXT REFERENCES contact(id);

-- Document sharing
CREATE TABLE IF NOT EXISTS document_share (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  shared_by TEXT REFERENCES user(id),
  shared_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(document_id, contact_id)
);
CREATE INDEX idx_document_share_contact ON document_share(contact_id);
```

**Frontend changes:**

4. **Update `PortalLayout.tsx`** — show different nav tabs based on contact type:

```tsx
// Client sees: Dashboard, Projects, Quotes, Invoices, Change Orders, Selections, Messages
// Subcontractor sees: Dashboard, My Jobs, Lien Waivers, Documents, Messages  
// Architect sees: Dashboard, RFIs, Submittals, Change Orders, Documents, Messages
```

5. **Create new portal pages:**
- `PortalMyJobs.tsx` — sub's assigned jobs with dates, status, accept/complete actions
- `PortalLienWaivers.tsx` — sub's waivers to review and sign
- `PortalSubmittalReview.tsx` — architect's submittals to approve/reject
- `PortalDocuments.tsx` — shared documents with upload capability

### Phase 2: Per-Project File Room (1-2 days)

A shared space where everyone on the project can see files organized by category.

**Categories:** Plans & Drawings, Permits, Contracts, Insurance Certs, Lien Waivers, Photos, Submittals, Change Orders, Inspections, Other

**Backend:**
- `GET /api/portal/:token/projects/:projectId/files` — all files shared with this contact for this project
- `POST /api/portal/:token/projects/:projectId/files` — upload a file to the project room
- Files are automatically categorized by type (lien waiver → "Lien Waivers", submittal attachment → "Submittals")

**Frontend:**
- `PortalProjectFiles.tsx` — file browser with category tabs, upload zone, download buttons

### Phase 3: Approval Workflows with Notifications (1-2 days)

When a sub uploads a lien waiver or an architect approves a submittal, the GC gets notified.

- **Email notifications** on key actions: submittal approved/rejected, lien waiver signed, document uploaded, change order approved
- **In-portal notification badge** showing pending actions
- **Activity timeline** on each project showing all portal activity from all collaborators

### Phase 4: Invite Flow (1 day)

From the CRM, the GC clicks "Invite to Portal" on any contact. System sends an email with a portal link. The contact clicks the link and gets role-appropriate access.

This already mostly works (portal enable/disable + send-link). Just needs:
- Better invite email template with the contact's role and project name
- "Invite Sub" quick action on the job detail page
- "Invite Architect" quick action on the RFI/submittal pages
- Bulk invite from the project detail page

---

## Files to Modify/Create

### Backend (templates/crm/backend/)

**Modified:**
- `src/routes/portal.ts` — add role-based scoping to existing endpoints + new sub/architect endpoints
- `db/schema.ts` — add `subcontractorId` to job, create `document_share` table
- `db/migrations/0012_collaborator_portal.sql` — migration for new columns/tables + journal entry

**New:**
- `src/routes/portal-collaborator.ts` — sub/architect-specific portal endpoints (lien waiver signing, submittal approval, document sharing)

### Frontend (templates/crm/frontend/)

**Modified:**
- `src/pages/portal/PortalLayout.tsx` — role-based nav tabs
- `src/components/detail/ContactDetailPage.tsx` — "Invite to Portal" shows role context
- `src/components/detail/JobDetailPage.tsx` — "Invite Sub" quick action

**New:**
- `src/pages/portal/PortalMyJobs.tsx` — subcontractor's job list
- `src/pages/portal/PortalLienWaivers.tsx` — sign/view lien waivers
- `src/pages/portal/PortalSubmittalReview.tsx` — approve/reject submittals
- `src/pages/portal/PortalDocuments.tsx` — shared documents with upload
- `src/pages/portal/PortalProjectFiles.tsx` — per-project file room

---

## How It Differs from BuilderTrend

BuilderTrend requires a username/password login for every collaborator. Our approach uses **token-based access** (same as the customer portal) — no account creation needed. The GC invites a sub, the sub gets an email with a link, clicks it, and sees their stuff. Simpler for subs who work with many GCs and don't want another login.

If we later want username/password for frequent collaborators, we can add it as an option — but the token approach is the faster, lower-friction path that gets us to feature parity.

---

## Priority Order

1. Phase 1 (role-scoped portal) — this is the differentiator
2. Phase 4 (invite flow) — needed for Phase 1 to be usable
3. Phase 2 (file room) — high-value for construction projects
4. Phase 3 (approval notifications) — nice to have, can come after launch
