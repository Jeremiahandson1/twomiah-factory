// Home care: agencies that send caregivers into clients' homes (templates/crm-homecare). Its own records — clients and
// care plans, the schedule, visits and EVV, Medicaid and private-pay billing, payroll, hiring, the family portal — are
// the home-care add-on (server/crm/homecare, docs/UNIFIED_HOMECARE_PLAN.md), behind the registry's home-care features.
import { BASE_CRM, type VerticalSettings } from '../../server/core/vertical.ts'
import type { StarterContent } from '../../server/core/starter.ts'

// What a new home-care agency finds in Help on day one (server/core/starter.ts; written once by modules/provision.ts,
// then the agency's own to edit). The template's built-in guides (templates/crm-homecare frontend/src/components/
// HelpPanel.tsx, 24 articles) rewritten against the moved screens and routes, each claim checked in the code
// (2026-10-19): the old text named buttons, tabs and menu paths that had changed or never existed ("Deactivate",
// "Reveal SSN", "Submit WORCS Check", a 32/37-hour badge rule that is 25/35). The template's seeded articles
// (backend/db/seed.template.ts) named a "New Visit" button and a "Schedule page"; their topics are covered here.
//
// Menu paths are "Section › Item" as the menu reads (web/src/crm/verticals/homecare.tsx MENU and each group's nav).
// When a screen changes, its guide here changes with it.
const HOMECARE_STARTER: StarterContent = {
  helpArticles: [
    {
      title: 'Getting started',
      category: 'Getting Started',
      isFaq: true,
      content: `Welcome. A good order for your first day:
• Add your clients: Operations › Clients, "➕ Add".
• Add your caregivers: Caregivers › Caregivers.
• Build their schedules: Scheduling › Schedule Hub, "+ New Schedule".
• Set up how you bill: Financial › Payers & Codes, then Financial › Authorizations for clients whose payer authorizes hours.

Caregivers sign in to their own app, where they see their schedule and clock in and out of visits. Your Dashboard shows today's visits, who is clocked in now, and the things that need your attention.`,
    },
    {
      title: 'Reading the Today panel',
      category: 'Dashboard',
      isFaq: false,
      content: `The 📅 Today card on your Dashboard shows today's date on your agency's clock and these live numbers:
• Shifts Today: visits on today's schedule. Cancelled visits and ended schedules are not counted.
• Clocked In Now: caregivers who are clocked in right now.
• Shifts Remaining: today's visits that nobody has clocked in for yet.
• Coverage Gaps: call-outs, today or later, still waiting for a caregiver. When there are any, a red "Find Coverage →" button opens Scheduling › Emergency Coverage.

Higher up the Dashboard you may also see:
• A red banner such as "2 active no-show alerts (1 today) — Click to review". Click it to open Scheduling › No-Show Alerts.
• 🎯 Action Items: today's to-do list, for example "Time entries awaiting approval" or "Authorizations expiring within 14 days". Click a line to open the page that clears it.

The Today card only shows for staff whose role includes billing access.`,
    },
    {
      title: 'Your notifications',
      category: 'Dashboard',
      isFaq: false,
      content: `Your alerts are on their own page: Communication › Notifications.

Notifications are sorted into tabs: New, Handled and Archived. Each tab shows a count.
• On a New item, click "Mark Handled" when you have dealt with it, or "Archive" to file it away.
• On the Handled tab, "Reopen" puts an item back into New.
• On the Archived tab, "Move to New" brings an item back.
• "Delete" removes an item for good.

To act on several at once, tick their boxes and use the buttons in the bar that appears.

The Settings tab is where you choose how you hear about things:
• Channels: Email, Text message (SMS), Push notifications.
• Which alerts you want, such as schedule changes, absences or no-shows, and authorizations running low.
• Quiet hours, using the From and Until boxes.
Click "Save Settings" when you're done.

If your role allows it, a "Send Notification" button lets you send one to staff.`,
    },
    {
      title: 'Quick Actions',
      category: 'Dashboard',
      isFaq: false,
      content: `The ⚡ Quick Actions card at the bottom of the Dashboard has shortcuts to common pages. You only see the buttons for pages your role can open.
• ➕ New Client: opens Operations › Onboarding, the onboarding checklist for each client. To add a brand-new client, use "➕ Add" on Operations › Clients.
• ➕ New Caregiver: opens Caregivers › Caregivers.
• 📄 Billing: opens Financial › Billing.
• 📊 Reports: opens Financial › Reports & Analytics.
• 🚨 Emergency Coverage: opens Scheduling › Emergency Coverage.
• 🔍 Background Checks: opens Compliance › Background Checks.`,
    },
    {
      title: 'Adding a new client',
      category: 'Clients',
      isFaq: true,
      content: `Go to Operations › Clients and click "➕ Add". The "Add New Client" form opens.

Only First Name and Last Name are required. The rest of the form is:
• Basic Information: date of birth, gender, phone, email.
• Address.
• Billing Information. Pick their "Payer / referral source", Medicaid (MA) ID, MCO member ID and Care Type. If they pay themselves, tick "Private Pay Client" instead and enter a Rate Amount, per hour or per 15 minutes. The rate is required for private-pay clients.
• Weekly Authorized Units. One unit is 15 minutes, and the form shows the hours for you.
• Emergency Contact and Notes.

Click "Add Client". The client appears in your list. They also get an onboarding checklist under Operations › Onboarding.`,
    },
    {
      title: 'Setting up a care plan',
      category: 'Clients',
      isFaq: false,
      content: `A care plan describes the services a client receives and how caregivers should give them.

Go to Operations › Care Plans and click "Add Care Plan". You can also start from a template with "📋 Use Template".
• Choose the Client and Service Type. Both are required.
• Add Frequency, Start Date and End Date (if applicable), and Status.
• Fill in Care Goals, Special Instructions, Safety Precautions and the notes fields.
• "📅 Fill from current schedule" copies the client's shifts from Scheduling into the plan.
Click "Create Care Plan".

Only a plan with status Active, inside its dates, is the client's current plan. That is the one caregivers and family see.

Each plan has these buttons:
• "Generate Schedule" creates recurring shifts. It is refused if the client already has visits scheduled.
• "📜 History" shows earlier versions.
• "📄 PDF" prints the plan.

Authorized hours are not set on the care plan. They come from the client's Weekly Authorized Units and from Financial › Authorizations.`,
    },
    {
      title: 'Referral sources and prospects',
      category: 'Clients',
      isFaq: false,
      content: `Clients are people your agency is serving.

Referral Sources (Operations › Referral Sources) are the organisations that send you clients: a Hospital, Doctor, Agency, Social Services or Family. Add one with the Organization Name and Type. You then pick it on a client as their "Payer / referral source".

Prospects are people who may become clients. They live in the Schedule Hub:
1. Go to Scheduling › Schedule Hub, stay on the 📅 Schedule tab, and switch to "📆 Month".
2. Click "+ New Prospect", enter a first and last name (plus phone and notes if you have them), and click "✓ Save Prospect".
3. To book an intake visit, click "+ Prospect Appt". It shows on the calendar in orange.
4. When they sign up, click the ✅ next to their name under "Active Prospects". Confirm "Convert this prospect to a full client?" and they are added to your client list.`,
    },
    {
      title: 'Schedule types explained',
      category: 'Scheduling',
      isFaq: false,
      content: `Go to Scheduling › Schedule Hub and click "+ New Schedule". Choose a caregiver first; the rest of the form then appears. Pick a Type:

• One-Time: a single shift on one date.
• Recurring: the same day every week, for example every Monday 9–1. Set a Start Date and, if you need one, an End Date (optional).
• Multi-Day: several days each week. One weekly schedule is created per day you select, and the button reads "✓ Create 3 Weekly Schedules" (or however many days).
• Bi-Weekly: every other week. Pick the days and a "First 'on' date". The pattern repeats every 2 weeks from there.

You can tick "Training shift (don't bill client)" for a trainee who is shadowing. The caregiver is still paid.`,
    },
    {
      title: 'Conflict and overtime warnings',
      category: 'Scheduling',
      isFaq: false,
      content: `When you choose a caregiver in "+ New Schedule", their current shifts are listed on the right.

If two of their existing weekly shifts overlap, a red "⚠️ Existing Conflicts" box names the day. Two bi-weekly shifts are only flagged when they fall on the same weeks.

As you fill in the form you may also see:
• An overtime warning, for example "approaching overtime" or "puts them at 42h this week". It shows current hours plus this shift.
• A travel-time warning, when the gap to the next client is shorter than the drive.

These are warnings only. You can still save. The one save that is refused is an exact duplicate: the same caregiver, client, day and time. You'll see "That shift is already scheduled for this caregiver."`,
    },
    {
      title: 'Ending or pausing a recurring schedule',
      category: 'Scheduling',
      isFaq: true,
      content: `On the Schedule Hub grid, click the shift, then click "Delete". For a repeating shift you get these choices:
• "This occurrence only": cancels one date.
• "This & all following": ends the pattern from that date. Past visits stay.
• "Stop going forward": ends it as of today. Past, already-worked visits are kept for payroll and billing.
• "Erase entire schedule (incl. past history)": only for a schedule created by mistake.

To pause a client's service without ending it (a hospital stay, for example), open the shift and use "Suspend service". Pick a start date, then click "⏸ Just [day]s" or "⏸ All [client]'s days". Nothing is deleted, and "▶ Resume" restarts it.

To change a schedule (a new time or a new caregiver), you don't need to end it. Edit it and choose "This & all following" so earlier weeks stay as they were.`,
    },
    {
      title: 'The bi-weekly "on" date',
      category: 'Scheduling',
      isFaq: false,
      content: `A bi-weekly schedule needs to know which week is its "on" week. That is the "First 'on' date" box.

When creating one, enter any date in the first week the caregiver should work. It defaults to the Start Date. Each day you selected starts on the first matching weekday on or after that date, then repeats every 2 weeks. A Saturday and Sunday starting on a Saturday stay on the same weekend.

To change it later:
1. Open "+ New Schedule" and choose the caregiver.
2. Click the shift in their "Current Schedule".
3. Under Bi-Weekly, change the First "on" date.
4. Under "Apply this change to", choose "This day and all future [day]s". The option "Every [day] — past and future" also rewrites weeks already worked.

Afterwards, check the next few weeks on the calendar.`,
    },
    {
      title: 'Finding coverage fast',
      category: 'Emergency Coverage',
      isFaq: true,
      content: `1. Go to Scheduling › Emergency Coverage.
2. At the top, "Shifts Need Coverage" lists every caregiver who has called out, with the date, time, client and reason.
3. Click "Find Coverage" on that shift.
4. Check the list of available caregivers. Clients' preferred caregivers come first, then the best rated, then those with the fewest hours this week.
5. Click "📞 Call" to confirm with the caregiver.
6. Click "Assign Coverage". This adds the shift to their schedule and sends them a notification.

Only caregivers who are free are listed. People are left out if they are already booked at that time, on approved time off, or have called out that day.`,
    },
    {
      title: 'Caregiver hour badges',
      category: 'Emergency Coverage',
      isFaq: false,
      content: `Each caregiver in the coverage results shows their scheduled hours this week and a badge:

• Available (green): 25 hours or less this week.
• Moderate Hours (amber): more than 25, up to 35 hours.
• Near Overtime (red): more than 35 hours. This shift may push them into overtime, so use it as a last resort and let payroll know.
• ⭐ Preferred: the client has this caregiver on their Preferred Caregivers list. Preferred caregivers are shown first. You set the list when editing the client.`,
    },
    {
      title: 'Searching for cover without a call-out',
      category: 'Emergency Coverage',
      isFaq: false,
      content: `You can check who is free at any time, for example when planning ahead or filling a new client's hours.

Under "🔍 Find Available Caregivers", enter the Date, Start Time and End Time. You can also pick a Client (optional), which puts that client's preferred caregivers first. Then click "🔍 Search Available Caregivers".

A search on its own can't assign anyone. "Assign Coverage" only works against a called-out shift. To book someone you found this way, create the shift in Scheduling › Schedule Hub with "+ New Schedule".`,
    },
    {
      title: 'Texting several caregivers at once',
      category: 'Caregivers',
      isFaq: false,
      content: `Go to Caregivers › Caregivers. Tick the boxes on the left of the caregiver table. The box in the header selects everyone in the list.

A bar appears showing how many you selected. Click "📱 Send SMS", type your message once, and click "Send". It goes to each selected caregiver.

The confirmation tells you how many were sent. Caregivers are skipped if they have no phone number on file, have turned text messages off, or are in their quiet hours.

From the same bar, "📥 Export CSV" downloads the selected caregivers.`,
    },
    {
      title: 'Viewing GPS visit routes',
      category: 'Caregivers',
      isFaq: false,
      content: `For a visit happening today, go to Scheduling › Live Board. Click "🗺️ View on Map" on the visit. A map shows the caregiver's GPS trail, with a green marker where it started and a red marker for the last point, and the client's home when known.

For past visits:
1. Go to Caregivers › Caregivers and click "👁 Full Profile".
2. Open the "🗺️ GPS Map" tab and pick a visit from "Recent Shifts".
3. The GPS Trail lists each recorded point with its time.
4. "View Full Route in Google Maps ↗" opens the route.

This helps confirm a caregiver was at the client's home and settle questions about a visit. GPS is recorded only when the caregiver allows location on their phone.`,
    },
    {
      title: 'Giving a caregiver office access',
      category: 'Caregivers',
      isFaq: false,
      content: `In Caregivers › Caregivers, click "Make Admin" on a caregiver's row and confirm. On a phone the button reads "⬆️ Admin". Their role badge changes to ADMIN.

You can also do this from Settings › Users & Access.

This suits lead caregivers or supervisors who need office access. Admins can manage the whole system, including client records, billing and payroll, so only give it to trusted staff.

Only staff allowed to manage the team can do this. The account owner can't be changed this way.`,
    },
    {
      title: 'Creating an invoice',
      category: 'Billing & Payroll',
      isFaq: true,
      content: `1. Go to Financial › Billing and click "📄 New Invoice".
2. Choose the Client, Billing Period Start and Billing Period End, then click "Review Days →".
3. The "🧾 Review Before Invoicing" screen shows each visit. Days with no clock-in bill their scheduled hours. Where a clock-in differs from the schedule, you choose to bill "Scheduled" or "Clocked". A visit that wasn't on the schedule defaults to "Don't bill". Cancelled visits are listed as not billed.
4. Check the "Invoice total" and click "Create Invoice".

The invoice opens as a 🔒 DRAFT. The family can't see it until you click "👁️ Release to Portal", "📧 Send Invoice", or create a pay link.

The rate comes from the client's private-pay rate, or from your payer's contract rate (the Rates tab). If neither is set, the invoice is refused with instructions.`,
    },
    {
      title: 'Running payroll',
      category: 'Billing & Payroll',
      isFaq: true,
      content: `Go to Financial › Payroll. Payroll pays from approved shift reviews:

1. On the "📋 Shift Reviews" tab, set the Pay Period Start and End and click "Generate Shifts". Every scheduled visit is matched to its clock-in. A visit within 15 minutes of its scheduled length is marked Verified; one with no clock-in is marked Missing Punch.
2. Approve shifts one at a time, or use "Approve Clocked" or "Approve All". Use "Flag" or "Resolve" for problems.
3. On the "💰 Payroll" tab, set the dates and click "Calculate". Only Verified, Approved and Manual Entry shifts are paid. Overtime is hours over 40 in each Sunday–Saturday week; "⚙️ Settings" changes the threshold.
4. Approve each row, or click "Approve All".

To export, use "📥 CSV" or "📤 QuickBooks".`,
    },
    {
      title: 'Why payroll hours might look wrong',
      category: 'Billing & Payroll',
      isFaq: true,
      content: `Payroll pays the payable minutes of shift reviews marked Verified, Approved or Manual Entry. A shift that is Pending, Flagged, Missing Punch or Excused pays nothing. After you click "Calculate", a red note tells you how many reviews in the period still need a decision.

Common reasons hours are missing or wrong:
• No clock-in, or the caregiver clocked in for a different client. The visit shows Missing Punch. Click "Resolve", choose Manual Entry, and enter the Payable Minutes.
• The caregiver never clocked out. The shift isn't counted until it's closed. Look for "Open clock-ins more than 24h old" in your Dashboard's Action Items. A shift still open today can be closed with "🛑 Force Clock Out" on Scheduling › Live Board.
• The schedule changed after you generated reviews. Click "Generate Shifts" again; decisions you already made are kept.

Before approving, check the "⚠️ Hour Discrepancies" tab and look for anyone scheduled who shows no hours.`,
    },
    {
      title: 'Background check expiry overview',
      category: 'Compliance',
      isFaq: false,
      content: `To see expiring checks for everyone:
1. Go to Compliance › Compliance, choose any caregiver from "Select Caregiver", and open the "Overview" tab.
2. "Background Check Expiry — All Caregivers" lists every check that has expired or expires in the next 30 days.
3. Click the Expired or Expiring Soon card to show only those. Click it again to show all.

Compliance › Background Checks also shows Pending, Expiring Soon (within 30 days), Expired and Total counts. Expired rows are tinted red and expiring rows amber.

Check at least monthly. Deal with any Expired check before that caregiver's next shift.`,
    },
    {
      title: 'WORCS checks (Wisconsin)',
      category: 'Compliance',
      isFaq: false,
      content: `Wisconsin agencies (agency state WI) get their WORCS checks automatically, through each new hire's onboarding packet: nothing is submitted by hand.

1. Hire the applicant from Caregivers › Job Applications ("✅ Convert to Caregiver"). They are emailed an onboarding packet.
2. In the packet, the new hire signs the background-check consent and enters their Social Security Number.
3. When they submit, the check goes to Wisconsin DOJ WORCS by itself. It appears in Compliance › Background Checks as "WI DOJ WORCS".
4. Results are checked every 30 minutes. To check now, open the caregiver's "👁 Full Profile", go to the "🔍 Background Check" tab, and click "Poll WORCS Now". The same card shows their Wisconsin eligibility result.
5. If a submission didn't go through, open Caregivers › Onboarding Queue, click "View Detail", then "Retry WORCS".

Your agency's WORCS account details are set up for you by Twomiah, not on a screen. Contact Twomiah to have them added.`,
    },
    {
      title: 'How Social Security numbers are protected',
      category: 'Compliance',
      isFaq: false,
      content: `The app asks for a Social Security Number in one place only: a Wisconsin new hire's onboarding packet, for their WORCS check. Agencies in other states are never asked for one.

The number is encrypted (AES-256-GCM) before it is saved. As soon as WORCS accepts the check it is erased. If the submission fails, it is kept, still encrypted, so you can click "Retry WORCS".

SSNs are never shown in the app. No screen displays them, and they are left out of client and caregiver records, packet details and reports, so there is nothing to reveal.`,
    },
    {
      title: 'Available reports',
      category: 'Reports',
      isFaq: false,
      content: `Go to Financial › Reports & Analytics, pick a report, and set the Start Date and End Date. The default is the last month. Reports that can be narrowed to one caregiver or one client show those pickers. The report updates as you change these.
• Overview: scheduled hours, revenue billed, scheduled visits, delivered vs scheduled, top caregivers and most active clients.
• Hours Worked: hours by service type and by week, and each caregiver's hours.
• Performance: ratings, on-time percentage and GPS capture per caregiver.
• Satisfaction: average rating, trend by week and feedback themes.
• Revenue: billed, collected, outstanding, A/R aging, and revenue by payer and service type.
• Profit & Loss: earned revenue, payroll, expenses and net income.
• Also: Hours by Payer, Caregiver Utilization, Client Visits Summary, Client Revenue by Month and Client Incidents.

Some reports need billing, payroll or HR access. If your role doesn't have it, the page says why.`,
    },
    {
      title: 'Exporting reports to CSV or PDF',
      category: 'Reports',
      isFaq: false,
      content: `Every report has two buttons next to the filters: "📥 CSV" for Excel, and "📄 PDF" for printing. Both use the dates and the caregiver or client you have chosen.

The PDF has your agency's name, the report name and the date range.
• Overview and Hours Worked give a summary and each caregiver's hours.
• Performance gives each caregiver's rating.
• Revenue gives billed, collected and outstanding totals.
• Other reports have no PDF summary. Their PDF says to use the CSV export.

Long reports run onto more pages. The file name includes your agency's name and the dates.`,
    },
  ],
  // Home care has no price book.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const homecare: VerticalSettings = {
  id: 'homecare',
  label: 'Home Care',
  mfaIssuer: 'Twomiah Home Care',
  featureSet: 'crm-homecare',
  // The template's seats were owner, admin and caregiver; a caregiver is the field rung.
  roleLabels: { field: 'Caregiver', manager: 'Office Manager' },
  roleMapping: { caregiver: 'field' },
  // Help on day one: the agency's guides, not the contractor CRM's (HOMECARE_STARTER, below).
  starter: HOMECARE_STARTER,
  // What a caregiver's own day needs: their schedule, their clients' care plans, their visits (clock in and out,
  // notes, tasks) and the portal messages about them. The routes narrow each to the caregiver's own clients and
  // shifts (core/caregiverAccess.ts, core/selfService.ts), as the template's role checks did.
  extraRolePermissions: {
    field: ['care-schedule:read', 'care-clients:read', 'evv:read', 'evv:create', 'evv:update', 'care-portal:read', 'my-pay:read', 'my-pay:create'],
  },
  // The home-care add-on on; the CRM's shared modules as the base CRM has them.
  crm: {
    ...BASE_CRM, homecare: true,
    // A caller is matched to a client, a first call makes one, and calls are counted on the agency's clock
    // (call tracking and the AI receptionist).
    callers: 'clients',
    // The agency's own dashboard and reports in place of the CRM's (server/crm/homecare/planning).
    dashboard: 'homecare',
    reports: { module: 'homecare' },
    // The help assistant was told it served "a business management CRM" and, with the base CRM's articles, offered
    // agencies quotes and jobs. Its features in the menu's words (web/src/crm/verticals/homecare.tsx MENU).
    support: {
      assistant: 'a home care agency\'s app. The app\'s features are: Clients (client records, onboarding, documents, referral sources, care plans), Scheduling (the Schedule Hub, the Live Board, Emergency Coverage, No-Show Alerts, Shift Approvals, route and staffing optimizers), Clinical (ADLs, medications, visit documentation, incidents, forms), Caregivers (caregiver records, performance, applications, job postings, onboarding packets), Financial (billing and visit invoices, claims, authorizations, payers and service codes, payroll, expenses, reports), Compliance (EVV, background checks, documents, audit logs, login activity), Communication (texting, the family portal, alerts, messages, notifications), and the caregivers\' own app (their schedule, clocking in and out, visits). This app has NO "jobs", "projects", "quotes" or construction concepts — never suggest those. Answer from these features and the knowledge base articles provided.',
    },
  },
  screens: {
    searchPlaceholder: 'Search clients, caregivers, visits...',
    // The agency's own screens (web/src/crm/verticals/homecare.tsx): its dashboard at /crm/dashboard (the office's, or a
    // caregiver's day), its menu, and its public pages (the portals, paying an invoice, onboarding, careers).
    home: 'homecare',
    // The first-run wizard (templates/crm-homecare pages/OnboardingWizard.tsx): no lead marketplaces; the agency's
    // suggested addresses (support@, admin@, care@); and its HIPAA checklist, its steps pointing at pages the app has
    // (the template's said "Settings > Compliance", which never existed). Its CareSmartz360 and HHAeXchange import entries
    // are not offered: they sent the owner to "Settings > Import", and home care has no client or caregiver import.
    onboarding: {
      integrations: ['dns', 'quickbooks', 'stripe', 'twilio', 'hipaa'],
      emailProduct: 'crm-homecare',
      extra: [{
        id: 'hipaa',
        label: 'HIPAA Compliance',
        description: 'Make sure your team is trained on HIPAA and sign-in and record changes are being watched.',
        category: 'compliance',
        guideSteps: [
          'Changes to clients’ care records are logged automatically: review them under Compliance › Audit Logs',
          'Review who signed in, and failed sign-ins, under Compliance › Login Activity',
          'Have every office login turn on two-step sign-in (My Account)',
          'Make sure everyone with access to the CRM has completed HIPAA training',
        ],
      }],
    },
  },
  // The agency's website (templates/website-premium-homecare): its words, and a text-size control for readers who
  // want larger type.
  site: {
    design: 'homecare',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: 'How can we help?',
      contactMessageRequired: 'Please write a short message.',
    },
    textSizeToggle: true,
  },
}

export default homecare
