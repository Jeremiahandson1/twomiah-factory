// Seeds the Knowledge Base with starter articles
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/seed-knowledge-base.ts

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1) }

const supabase = createClient(url, key)

interface Article {
  title: string
  content: string
  category: string
  tags: string[]
  published: boolean
}

const articles: Article[] = [
  // ─── Getting Started ────────────────────────────────────────────────────────
  {
    title: 'Welcome to Your CRM — Getting Started',
    content: `Congratulations on setting up your new CRM! Here's a quick roadmap to get your team up and running.

**Step 1: Add Your Company Info**
Go to Settings → Company and fill in your business name, address, phone number, and logo. This information appears on quotes, invoices, and your client portal.

**Step 2: Invite Your Team**
Navigate to Team → Invite Member. Each team member gets their own login. You can assign roles like Admin, Manager, or Technician to control what they can see and do.

**Step 3: Import Your Contacts**
Head to Contacts → Import to upload your existing customer list. We accept CSV files. Map your columns (name, email, phone, address) and hit Import.

**Step 4: Create Your First Job**
Go to Jobs → New Job, pick a customer, add a description, and assign a team member. You're in business!

**Step 5: Set Up Integrations**
Check Settings → Integrations to connect Stripe (payments), Twilio (texting), and other tools you use.`,
    category: 'getting_started',
    tags: ['onboarding', 'setup', 'first-steps'],
    published: true,
  },
  {
    title: 'Inviting Team Members & Managing Roles',
    content: `Your CRM supports multiple team members with different permission levels.

**Roles Available:**
- **Admin** — Full access to everything: settings, billing, team management, and all data.
- **Manager** — Can create and manage jobs, quotes, invoices, and view reports. Cannot change billing or system settings.
- **Technician** — Can view assigned jobs, clock in/out, upload photos, and update job status. Cannot create quotes or invoices.
- **Office** — Can manage contacts, scheduling, and invoicing but cannot access field operations.

**To invite someone:**
1. Go to Team in the sidebar
2. Click "Invite Member"
3. Enter their email and select a role
4. They'll receive an email with a login link

**Changing roles:**
Click on any team member's name, then use the Role dropdown to change their access level. Changes take effect immediately.

**Removing a member:**
Open their profile and click "Deactivate." Their historical data (jobs completed, time logged) is preserved but they can no longer log in.`,
    category: 'getting_started',
    tags: ['team', 'roles', 'permissions', 'onboarding'],
    published: true,
  },
  {
    title: 'Importing Your Customer List',
    content: `You can bulk-import your existing contacts from a CSV file.

**Preparing your file:**
Your CSV should include columns for at least a name and one contact method (email or phone). We also support:
- First Name, Last Name (or Full Name)
- Email
- Phone
- Address, City, State, ZIP
- Company Name
- Notes

**To import:**
1. Go to Contacts → Import
2. Upload your CSV file
3. Map each column in your file to the matching CRM field
4. Preview the first few rows to make sure everything looks right
5. Click "Import"

**Tips:**
- Remove any header rows that aren't column names
- Phone numbers in any format work — we'll normalize them
- Duplicate detection runs on email and phone, so existing contacts won't be doubled
- You can tag imported contacts (e.g., "imported-march-2026") to find them easily later

**After import:**
Review your contacts list and spot-check a few records. If something mapped wrong, you can delete the batch and re-import.`,
    category: 'getting_started',
    tags: ['import', 'contacts', 'csv', 'migration'],
    published: true,
  },

  // ─── Billing ────────────────────────────────────────────────────────────────
  {
    title: 'Understanding Your Subscription & Billing',
    content: `Your CRM subscription is billed monthly and includes a set number of user seats based on your plan.

**What's included:**
Each plan includes core CRM features (contacts, jobs, quotes, invoices, scheduling) plus additional features that unlock at higher tiers. Check your plan details in Settings → Billing.

**User seats:**
Your plan includes a specific number of users. If you need more, you can upgrade to a higher plan or contact us about per-seat pricing.

**Billing cycle:**
You're billed on the same date each month. Your card on file is charged automatically. You can view invoices and update your payment method in Settings → Billing.

**Upgrading or downgrading:**
- **Upgrade:** Takes effect immediately. You're charged a prorated amount for the rest of the current billing cycle.
- **Downgrade:** Takes effect at the end of your current billing cycle. Features from your current plan remain available until then.

**Cancellation:**
You can cancel anytime from Settings → Billing. Your data is retained for 30 days after cancellation in case you change your mind.`,
    category: 'billing',
    tags: ['subscription', 'pricing', 'payment', 'upgrade', 'cancel'],
    published: true,
  },
  {
    title: 'Setting Up Online Payments with Stripe',
    content: `Accept credit card payments directly through your CRM by connecting Stripe.

**Connecting Stripe:**
1. Go to Settings → Integrations → Stripe
2. Click "Connect Stripe Account"
3. You'll be redirected to Stripe to sign in (or create an account)
4. Authorize the connection and you'll be sent back to your CRM

**What you can do once connected:**
- **Invoice payments** — Customers can pay invoices online via a secure payment link
- **Client portal payments** — Customers pay directly from their portal
- **Deposit collection** — Require a deposit before work begins
- **Recurring billing** — Set up service agreements with automatic monthly charges

**Fees:**
Stripe charges standard processing fees (typically 2.9% + $0.30 per transaction). These are Stripe's fees, not ours.

**Payouts:**
Funds are deposited to your bank account on Stripe's standard schedule (usually 2 business days). You can check payout status in your Stripe dashboard.

**Refunds:**
You can issue full or partial refunds from the invoice detail page. Refunds typically appear on the customer's statement within 5-10 business days.`,
    category: 'integrations',
    tags: ['stripe', 'payments', 'online-payments', 'invoicing'],
    published: true,
  },

  // ─── Features ───────────────────────────────────────────────────────────────
  {
    title: 'Creating and Sending Quotes',
    content: `Quotes let you send professional estimates to your customers before starting work.

**Creating a quote:**
1. Go to Quotes → New Quote
2. Select a customer (or create one on the fly)
3. Add line items — description, quantity, and price for each
4. Add any notes or terms at the bottom
5. Click "Save" to save as a draft, or "Send" to email it immediately

**Using a Pricebook:**
If your plan includes Pricebook, you can select from pre-defined services and materials instead of typing line items manually. This keeps pricing consistent across your team.

**Customer approval:**
When you send a quote, the customer receives an email with a link to view it. They can approve or request changes right from the email. You'll get a notification when they respond.

**Converting to a job:**
Once a quote is approved, click "Convert to Job" to automatically create a job with all the quote details pre-filled. The quote stays linked to the job for reference.

**Converting to an invoice:**
You can also convert an approved quote directly into an invoice. Line items carry over automatically.

**Tips:**
- Add your company logo in Settings so it appears on quotes
- Use the Notes field for scope of work details, warranty info, or payment terms
- You can duplicate a previous quote to save time on similar jobs`,
    category: 'general',
    tags: ['quotes', 'estimates', 'sales', 'pricebook'],
    published: true,
  },
  {
    title: 'Managing Jobs from Start to Finish',
    content: `Jobs are the core of your CRM — they track work from assignment through completion.

**Job statuses:**
- **Scheduled** — Work is planned but hasn't started
- **In Progress** — Crew is actively working
- **On Hold** — Paused (waiting on materials, customer, weather, etc.)
- **Completed** — Work is done
- **Cancelled** — Job was cancelled

**Creating a job:**
Go to Jobs → New Job. Select a customer, add a description, choose a date, and assign team members. You can also attach a related quote.

**Scheduling:**
Jobs appear on the Schedule calendar. Drag and drop to reschedule. Assigned team members see their jobs on their mobile app.

**On the job site:**
Team members can:
- Clock in/out with GPS verification
- Upload job site photos
- Update the job status
- Add notes about the work performed

**Completing a job:**
When work is done, mark the job as Completed. You can then create an invoice directly from the job, with the description and line items pre-filled.

**Job history:**
Everything is tracked — status changes, time entries, photos, notes, and communications. Click on any job to see the full timeline.`,
    category: 'general',
    tags: ['jobs', 'scheduling', 'workflow', 'field-work'],
    published: true,
  },
  {
    title: 'Invoicing and Getting Paid',
    content: `Create professional invoices and get paid faster with online payment options.

**Creating an invoice:**
1. Go to Invoices → New Invoice (or click "Create Invoice" from a completed job)
2. Select the customer
3. Add line items with descriptions, quantities, and prices
4. Set payment terms (Due on Receipt, Net 15, Net 30, etc.)
5. Click "Send" to email the invoice to your customer

**Payment methods:**
If you've connected Stripe, customers can pay online by clicking the payment link in their invoice email. You can also manually record cash, check, or other offline payments.

**Invoice statuses:**
- **Draft** — Not yet sent
- **Sent** — Emailed to customer
- **Viewed** — Customer opened the email/link
- **Partial** — Some payment received
- **Paid** — Fully paid
- **Overdue** — Past the due date

**Payment reminders:**
You can send manual reminders from the invoice detail page. The system also sends automatic reminders for overdue invoices if you enable them in Settings → Notifications.

**Deposits and progress billing:**
For larger projects, you can create multiple invoices against the same job — a deposit invoice upfront, progress invoices during work, and a final invoice upon completion.`,
    category: 'general',
    tags: ['invoices', 'payments', 'billing', 'accounts-receivable'],
    published: true,
  },
  {
    title: 'Using the Schedule & Calendar',
    content: `The Schedule view gives you a visual calendar of all upcoming jobs and appointments.

**Views:**
- **Day** — Detailed view of one day with time slots
- **Week** — Overview of the full week
- **Month** — Bird's eye view of the entire month

**Scheduling a job:**
Click on any empty time slot to quickly create a new job at that time. Or drag an existing job to reschedule it.

**Filtering:**
Use the team member filter to see one person's schedule or the whole team's. Color coding helps distinguish between different job types or statuses.

**Recurring jobs:**
If your plan includes Recurring Jobs, you can set a job to automatically repeat — weekly, biweekly, monthly, etc. Great for maintenance contracts and regular service visits.

**Online booking (if enabled):**
Customers can book appointments through your client portal or website widget. Available time slots are based on your team's schedule, so there are no double-bookings.

**Dispatch board (Field Service plans):**
The dispatch board shows all techs and their assignments for the day in a timeline view. Drag jobs between techs to reassign on the fly. Techs receive push notifications when their schedule changes.`,
    category: 'general',
    tags: ['scheduling', 'calendar', 'dispatch', 'recurring-jobs'],
    published: true,
  },
  {
    title: 'Two-Way SMS Texting with Customers',
    content: `Send and receive text messages with your customers directly from the CRM, powered by Twilio.

**Setup:**
Go to Settings → Integrations → Twilio and enter your Account SID, Auth Token, and Twilio phone number. If you don't have a Twilio account, create one at twilio.com — you'll need to purchase a phone number that supports SMS.

**Sending a text:**
Open any contact and click the Messages tab. Type your message and hit Send. The customer receives a text from your Twilio number.

**Receiving replies:**
When a customer texts your Twilio number back, their reply appears in the Messages tab on their contact record. You'll also see it in the Messages inbox.

**Automated texts:**
Depending on your plan, you can set up automated text messages for:
- Job reminders ("Your appointment is tomorrow at 9am")
- Quote follow-ups ("Have you had a chance to review our estimate?")
- Invoice notifications ("Your invoice is ready — pay online here")
- Review requests ("How did we do? Leave us a review")

**Tips:**
- Keep messages short and professional
- Include your company name since the number may not be saved in their phone
- Customers can opt out by replying STOP
- Message history is stored on the contact record for your team to reference`,
    category: 'general',
    tags: ['sms', 'texting', 'twilio', 'communication'],
    published: true,
  },

  // ─── Integrations ──────────────────────────────────────────────────────────
  {
    title: 'Connecting Twilio for SMS & Call Tracking',
    content: `Twilio powers text messaging and call tracking in your CRM.

**What you need:**
1. A Twilio account (sign up at twilio.com)
2. Your Account SID and Auth Token (found in Twilio Console → Dashboard)
3. A Twilio phone number with SMS and Voice capabilities

**Connecting:**
1. Go to Settings → Integrations → Twilio
2. Enter your Account SID, Auth Token, and phone number
3. Click Save

**What it enables:**
- **Two-way texting** — Send/receive SMS with customers from the CRM
- **Call tracking** — Track inbound calls, see caller ID matched to contacts, and optionally record calls
- **Automated notifications** — Job reminders, invoice alerts, review requests via SMS

**Cost:**
Twilio charges per message and per minute. Typical costs are around $0.0079/SMS and $0.013/min for calls, but check Twilio's current pricing. These are Twilio's fees, not ours.

**Troubleshooting:**
- "Message failed to send" — Check that your Twilio balance isn't zero and your phone number is active
- "Not receiving replies" — Make sure the webhook URL in your Twilio phone number settings points to your CRM`,
    category: 'integrations',
    tags: ['twilio', 'sms', 'calls', 'setup'],
    published: true,
  },
  {
    title: 'Connecting SendGrid for Email',
    content: `SendGrid handles transactional emails from your CRM — invoice notifications, quote delivery, password resets, and more.

**What you need:**
A SendGrid account and an API key with "Mail Send" permissions.

**Getting your API key:**
1. Sign in at sendgrid.com
2. Go to Settings → API Keys → Create API Key
3. Name it something like "CRM Integration"
4. Select "Restricted Access" and enable "Mail Send" → Full Access
5. Copy the key (you won't see it again)

**Connecting:**
1. Go to Settings → Integrations → SendGrid in your CRM
2. Paste your API key
3. Click Save

**What it enables:**
- Quote and invoice emails sent to customers
- Appointment confirmation and reminder emails
- Password reset and account notification emails
- Email marketing campaigns (if your plan includes this feature)

**Sender verification:**
SendGrid requires you to verify your sending domain or email address. Go to SendGrid → Settings → Sender Authentication and follow their steps. Without this, emails may land in spam.

**Troubleshooting:**
- Emails going to spam — Complete domain authentication in SendGrid
- "Unauthorized" error — Regenerate your API key and make sure Mail Send is enabled`,
    category: 'integrations',
    tags: ['sendgrid', 'email', 'setup'],
    published: true,
  },
  {
    title: 'Connecting QuickBooks for Accounting Sync',
    content: `Sync your CRM invoices and payments with QuickBooks Online to keep your books up to date without double entry.

**What syncs:**
- **Invoices** — CRM invoices push to QuickBooks as invoices
- **Payments** — When a customer pays in the CRM, the payment is recorded in QuickBooks
- **Customers** — New contacts in the CRM create matching customers in QuickBooks

**Connecting:**
1. Go to Settings → Integrations → QuickBooks
2. Click "Connect to QuickBooks"
3. Sign in to your QuickBooks Online account and authorize access
4. Select which QuickBooks company to connect (if you have multiple)

**How it works:**
When you create and send an invoice in the CRM, it automatically appears in QuickBooks. When the customer pays (online via Stripe or recorded manually), the payment is synced too.

**Things to know:**
- Sync is one-way: CRM → QuickBooks. Changes made in QuickBooks don't flow back.
- Existing invoices before the connection are not retroactively synced. Only new activity syncs.
- If you disconnect and reconnect, duplicates won't be created — we track sync IDs.

**Troubleshooting:**
- "Sync failed" — Usually means the QuickBooks token expired. Go to Integrations and click "Reconnect."
- Invoice amounts don't match — Check that tax settings are consistent between both systems.`,
    category: 'integrations',
    tags: ['quickbooks', 'accounting', 'sync', 'invoices'],
    published: true,
  },
  {
    title: 'Setting Up Google Maps',
    content: `Google Maps powers address autocomplete, job site mapping, GPS tracking, and route planning in your CRM.

**What you need:**
A Google Cloud API key with the following APIs enabled:
- Maps JavaScript API
- Places API
- Geocoding API
- Directions API

**Getting your API key:**
1. Go to console.cloud.google.com
2. Create a project (or select an existing one)
3. Go to APIs & Services → Library and enable the four APIs listed above
4. Go to APIs & Services → Credentials → Create Credentials → API Key
5. Restrict the key to only the APIs you enabled (recommended for security)

**Connecting:**
1. Go to Settings → Integrations → Google Maps in your CRM
2. Paste your API key
3. Click Save

**What it enables:**
- **Address autocomplete** — Start typing an address and get suggestions
- **Map view** — See all your jobs plotted on a map
- **GPS tracking** — Track technician locations in real time
- **Route optimization** — Get optimized driving routes for the day's jobs

**Cost:**
Google gives you $200/month free credit, which covers most small businesses. After that, you pay per API call. Monitor usage in your Google Cloud console.`,
    category: 'integrations',
    tags: ['google-maps', 'gps', 'mapping', 'setup'],
    published: true,
  },

  // ─── Technical / Troubleshooting ────────────────────────────────────────────
  {
    title: 'Supported Browsers and Devices',
    content: `Your CRM works on any modern web browser. Here's what we recommend:

**Supported browsers:**
- Google Chrome (latest) — recommended
- Firefox (latest)
- Safari (latest, Mac/iOS)
- Microsoft Edge (latest)

**Not supported:**
- Internet Explorer (any version)
- Browsers older than 2 years

**Mobile:**
The CRM is fully responsive on tablets and phones. For field technicians, we recommend using the mobile app (available for iOS and Android) for the best on-the-go experience, with features like:
- Push notifications for new assignments
- One-tap clock in/out
- Camera integration for job photos
- GPS tracking (when enabled)

**Tips for best performance:**
- Use a stable internet connection — the CRM needs connectivity for real-time data
- Clear your browser cache if you experience display issues after an update
- Enable notifications in your browser so you don't miss alerts`,
    category: 'technical',
    tags: ['browsers', 'mobile', 'devices', 'compatibility'],
    published: true,
  },
  {
    title: 'Troubleshooting: Can\'t Log In',
    content: `If you're having trouble logging in, try these steps:

**Forgot your password:**
Click "Forgot Password" on the login screen. Enter your email address and check your inbox for a reset link. The link expires in 1 hour.

**Reset email not arriving:**
- Check your spam/junk folder
- Make sure you're using the email address your admin used to invite you
- Ask your admin to re-send the invite from Team settings

**"Account not found" error:**
Your admin may not have added you yet, or may have used a different email. Ask them to check the Team page and confirm your email address.

**"Account deactivated" error:**
Your admin has deactivated your account. Contact them to reactivate it.

**Login works but you see a blank screen:**
- Try a hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)
- Clear your browser cache
- Try a different browser
- Disable browser extensions (ad blockers can sometimes interfere)

**Still stuck?**
Contact your account admin. If you're the admin and still can't get in, reach out to our support team.`,
    category: 'troubleshooting',
    tags: ['login', 'password', 'access', 'account'],
    published: true,
  },
  {
    title: 'Troubleshooting: Emails Not Being Delivered',
    content: `If your customers aren't receiving emails (quotes, invoices, notifications), check these common causes:

**1. SendGrid not connected:**
Go to Settings → Integrations and make sure SendGrid shows as connected with a valid API key.

**2. Sender not verified:**
SendGrid requires domain or email verification. Log into SendGrid and check Settings → Sender Authentication. Without this, emails get blocked or sent to spam.

**3. Customer's email is wrong:**
Open the contact record and double-check the email address for typos.

**4. Emails landing in spam:**
Ask the customer to check their spam folder and mark your emails as "Not Spam." For a long-term fix, complete domain authentication in SendGrid (DKIM and SPF records).

**5. SendGrid sending limits:**
Free SendGrid accounts have a daily sending limit (100 emails/day). If you're hitting this, upgrade your SendGrid plan.

**6. API key permissions:**
Make sure your SendGrid API key has "Mail Send" full access. A key with only read permissions can't send emails.

**Still not working?**
Check the SendGrid Activity Feed (in your SendGrid dashboard) to see if emails are being sent, bounced, or blocked. This usually reveals the exact problem.`,
    category: 'troubleshooting',
    tags: ['email', 'sendgrid', 'delivery', 'spam'],
    published: true,
  },
  {
    title: 'Troubleshooting: Payments Not Working',
    content: `If customers can't pay invoices online, or payments aren't being recorded:

**Stripe not connected:**
Go to Settings → Integrations and confirm Stripe shows as connected. If it says "Disconnected," click "Connect" and re-authorize.

**"Payment failed" error for customer:**
Common reasons:
- Card declined by the bank — the customer should try a different card
- Card expired — customer needs to enter updated card details
- Insufficient funds — customer needs to use a different payment method

**Payment went through but invoice still shows "Sent":**
There may be a webhook delay. Wait a few minutes and refresh. If it persists, check that your Stripe webhook is properly configured (Settings → Integrations → Stripe → Webhook Status).

**Customer doesn't see the "Pay Now" button:**
Make sure the invoice was sent (not just saved as draft) and that Stripe is connected. The payment link only appears on sent invoices when Stripe is active.

**Refund needed:**
Open the invoice → click "Refund." You can issue a full or partial refund. It processes through Stripe and the invoice status updates automatically.`,
    category: 'troubleshooting',
    tags: ['stripe', 'payments', 'errors', 'invoicing'],
    published: true,
  },

  // ─── FAQ ────────────────────────────────────────────────────────────────────
  {
    title: 'Can I Use the CRM on My Phone?',
    content: `Yes! There are two ways to use the CRM on your phone:

**Mobile app (recommended for field teams):**
Download the mobile app from the App Store (iOS) or Google Play (Android). The mobile app is designed for technicians and field workers with features like:
- View assigned jobs and schedules
- Clock in/out with GPS
- Take and upload job site photos
- Update job statuses
- Send and receive text messages with customers

**Mobile browser:**
You can also log in from any mobile browser at your CRM URL. The web interface is responsive and works on phones, though the mobile app provides a better experience for field work.

**Who should use what:**
- Office staff → Desktop browser
- Field techs → Mobile app
- Managers on the go → Either works great`,
    category: 'faq',
    tags: ['mobile', 'app', 'phone', 'field'],
    published: true,
  },
  {
    title: 'How Do I Export My Data?',
    content: `You own your data and can export it at any time.

**Contacts export:**
Go to Contacts, use filters to select the contacts you want, then click the Export button (top right). You'll get a CSV file with all contact details.

**Jobs export:**
Go to Jobs → Export. You can filter by date range, status, or team member before exporting.

**Invoices export:**
Go to Invoices → Export. Includes invoice number, customer, amount, status, dates, and payment info.

**Reports:**
Most reports have an Export or Download button that generates a PDF or CSV.

**Full data export:**
If you need everything (contacts, jobs, quotes, invoices, time entries, photos), contact support and we'll prepare a complete export for you.

**What format?**
- CSV for tabular data (contacts, jobs, invoices)
- PDF for formatted documents (individual invoices, quotes, reports)
- Original format for uploaded files and photos`,
    category: 'faq',
    tags: ['export', 'data', 'csv', 'backup'],
    published: true,
  },
  {
    title: 'How Do Feature Tiers Work?',
    content: `Your CRM plan determines which features are available to your team.

**How it works:**
Each plan tier unlocks a set of features. Higher tiers include everything from lower tiers plus additional capabilities. You can see exactly what's included in your plan under Settings → Billing → Plan Details.

**Common tier structure:**
- **Starter** — Core CRM features: contacts, jobs, quotes, invoices, scheduling, team management
- **Pro** — Adds communication tools (texting, call tracking), pricebook, service agreements, and lead inbox
- **Business** — Adds fleet management, advanced reporting, inventory, equipment tracking, and email campaigns
- **Enterprise** — Unlimited users, API access, custom dashboards, and priority support

**Add-on products:**
Some features are available as add-ons regardless of your plan:
- **Exterior Visualizer** — Let customers see what new siding, paint, or roofing looks like on their home using AI
- **Instant Roof Estimator** — Satellite-based roof measurements and instant estimates (roofing plans)

**Upgrading:**
Go to Settings → Billing → Change Plan. Upgrades take effect immediately with prorated billing. You won't lose any data.

**Feature requests:**
Don't see something you need? Let us know through the Feedback section — we prioritize features based on customer demand.`,
    category: 'faq',
    tags: ['features', 'tiers', 'plans', 'upgrade'],
    published: true,
  },
  {
    title: 'What Is the Client Portal?',
    content: `The Client Portal is a customer-facing page where your clients can view their project status, approve quotes, pay invoices, and communicate with your team.

**What customers can do:**
- View job status and progress
- See and approve quotes
- View and pay invoices online
- Send messages to your team
- See uploaded job photos
- Download documents (contracts, warranties, etc.)

**How it works:**
Each customer gets a unique portal link. You can share this link via email or text. No password is required — the link itself is secure and unique to that customer.

**Customization:**
The portal shows your company logo, colors, and contact info. It includes cards for your products and services so customers can see what you offer.

**Enabling the portal:**
The Client Portal is available on Pro plans and above. Once enabled, portal links are automatically included in quote and invoice emails.

**Privacy:**
Each customer can only see their own data. They cannot see other customers' information, your internal notes, or your team's communications.`,
    category: 'general',
    tags: ['client-portal', 'customers', 'self-service'],
    published: true,
  },

  // ─── Roofing-Specific ──────────────────────────────────────────────────────
  {
    title: 'Using the Insurance Workflow (Roofing)',
    content: `The Insurance Workflow feature helps roofing contractors manage insurance claim jobs from inspection through completion.

**Setting up a claim job:**
1. Create a new job and select "Insurance" as the job type
2. Enter the insurance company name, policy number, and claim number
3. Add adjuster contact information (name, phone, email)
4. Set the claim status (Filed, Adjuster Scheduled, Approved, Supplement Needed, etc.)

**Claim statuses:**
- **Filed** — Claim submitted to insurance
- **Adjuster Scheduled** — Meeting date set with adjuster
- **Approved** — Insurance approved the claim
- **Supplement Needed** — Additional documentation required
- **Supplement Approved** — Additional amounts approved
- **Completed** — Work done, final payment received
- **Denied** — Claim was denied

**Tracking supplement amounts:**
Track the original approved amount and any supplements separately. The system calculates the total approved amount for you.

**Tips:**
- Upload adjuster reports and photos as documentation on the job
- Use the timeline to track every interaction with the insurance company
- The insurance pipeline board gives you a visual overview of all claim jobs by status`,
    category: 'general',
    tags: ['insurance', 'roofing', 'claims', 'workflow'],
    published: true,
  },
  {
    title: 'Roof Measurements & Estimating',
    content: `Generate accurate roof measurements and professional estimates using satellite imagery.

**How it works:**
1. Go to a job or quote and click "Order Measurement"
2. Enter the property address
3. Our system uses satellite imagery to identify the roof and calculate measurements
4. You receive a detailed report with total area, pitch, ridges, valleys, hips, rakes, and eaves

**What's in the report:**
- Total roof area (squares)
- Pitch/slope for each roof face
- Linear measurements for all edges (ridge, hip, valley, rake, eave)
- Waste factor calculation
- Suggested material quantities

**Using measurements in quotes:**
Measurement data flows directly into your quotes. Select materials, set your labor rate, and the system calculates the total. You can adjust quantities and add line items as needed.

**Instant Roof Estimator (add-on):**
The standalone estimator tool lets you or your customers get an instant ballpark estimate by entering an address. Great for lead qualification and initial customer conversations.

**Tips:**
- Measurements are most accurate on simple roof geometries
- For complex roofs, verify satellite measurements against a physical inspection
- You can order measurements for any US address`,
    category: 'general',
    tags: ['roofing', 'measurements', 'estimating', 'satellite'],
    published: true,
  },

  // ─── API ────────────────────────────────────────────────────────────────────
  {
    title: 'API Access & Integrations Overview',
    content: `Enterprise plan customers get access to the CRM API for custom integrations.

**What the API provides:**
- Read and write contacts, jobs, quotes, and invoices
- Trigger automations
- Sync data with external systems (ERP, accounting, custom tools)
- Webhook subscriptions for real-time event notifications

**Authentication:**
API requests use bearer token authentication. Generate your API token in Settings → Integrations → API Access. Keep your token secure — it provides full access to your account.

**Rate limits:**
- 100 requests per minute per token
- Bulk endpoints available for large data operations

**Webhooks:**
Subscribe to events like "job.completed," "invoice.paid," or "contact.created" to get real-time notifications pushed to your endpoint.

**Documentation:**
Full API documentation is available at your CRM URL under /api/docs. It includes endpoint references, request/response examples, and error codes.

**Need help?**
Contact our support team for integration assistance. We can help you design your integration and troubleshoot issues.`,
    category: 'api',
    tags: ['api', 'integrations', 'webhooks', 'enterprise'],
    published: true,
  },

  // ─── Field Service Specific ────────────────────────────────────────────────
  {
    title: 'Service Agreements & Maintenance Contracts',
    content: `Service Agreements let you set up recurring maintenance contracts with your customers.

**Creating an agreement:**
1. Go to Service Agreements → New Agreement
2. Select the customer
3. Define the service scope (what's covered, number of visits per year)
4. Set billing terms (monthly, quarterly, annually)
5. Set the start date and term length

**What happens automatically:**
- Recurring invoices are generated on schedule
- Maintenance visits are auto-scheduled based on your defined frequency
- Customers are notified before upcoming visits
- Agreement renewals prompt you before expiration

**Types of agreements:**
- **Preventive maintenance** — Regular scheduled visits (HVAC tune-ups, filter changes, etc.)
- **Full coverage** — Parts and labor included, emergency service priority
- **Parts only** — Labor charged separately, parts covered under agreement

**Revenue tracking:**
The Reports section shows recurring revenue from service agreements, helping you forecast monthly income and track agreement renewals.

**Tips:**
- Set up agreements in Pricebook with standard pricing so your team quotes consistently
- Agreements are great for customer retention — they keep customers coming back
- Track agreement profitability to make sure your pricing covers actual service costs`,
    category: 'general',
    tags: ['service-agreements', 'maintenance', 'recurring', 'field-service'],
    published: true,
  },
  {
    title: 'Time Tracking & GPS for Field Teams',
    content: `Track your team's time and location for accurate job costing and accountability.

**Time tracking:**
Team members clock in and out from the mobile app or web CRM. Each time entry is linked to a specific job so you can see exactly how long each job takes.

**How to clock in:**
1. Open the assigned job
2. Tap "Clock In"
3. Work the job
4. Tap "Clock Out" when done
5. Optionally add notes about the work performed

**GPS tracking:**
When enabled, the system records the location at clock-in and clock-out. This verifies that team members are at the job site. Managers can see real-time locations on the Map View.

**Reports:**
Time tracking feeds into:
- **Payroll reports** — Total hours per team member per pay period
- **Job costing** — Actual labor hours vs. estimated, for profitability analysis
- **Utilization** — How much of each tech's day is spent on billable work

**Privacy:**
GPS tracking only records location during clock-in/clock-out events (not continuous tracking). Team members can see their own tracked data. Only managers and admins can view other members' locations.

**Tips:**
- Set up geofencing to get alerts if someone clocks in far from the job site
- Review time entries weekly to catch any missed clock-outs
- Use the utilization report to balance workloads across your team`,
    category: 'general',
    tags: ['time-tracking', 'gps', 'field-teams', 'payroll'],
    published: true,
  },
  {
    title: 'Lead Inbox: Managing Leads from Multiple Sources',
    content: `The Lead Inbox consolidates incoming leads from all your marketing channels into one place.

**Supported lead sources:**
- Angi (formerly Angie's List)
- Thumbtack
- HomeAdvisor
- Google Local Services Ads (LSA)
- Website contact forms
- Manual entry

**How it works:**
When a lead comes in from any connected source, it appears in your Lead Inbox with the customer's name, contact info, service needed, and source. From there you can:
- Respond immediately via text or email
- Convert to a contact and create a job or quote
- Assign to a team member
- Mark as won, lost, or nurturing

**Response time matters:**
The inbox shows how long ago each lead arrived. Fast response dramatically increases your close rate — aim to respond within 5 minutes.

**Lead tracking:**
Every lead source is tracked so your Reports dashboard shows:
- Which sources generate the most leads
- Cost per lead by source
- Conversion rate by source
- Revenue attributed to each source

**Tips:**
- Enable push notifications so you don't miss new leads
- Set up auto-response texts to acknowledge leads instantly while your team prepares a full reply
- Review your lead source ROI monthly and shift budget to what's working`,
    category: 'general',
    tags: ['leads', 'lead-inbox', 'marketing', 'angi', 'thumbtack'],
    published: true,
  },
]

async function seed() {
  console.log(`Seeding ${articles.length} Knowledge Base articles...`)

  // Check for existing articles to avoid duplicates
  const { data: existing } = await supabase.from('support_knowledge_base').select('title')
  const existingTitles = new Set((existing || []).map((a: any) => a.title))

  let created = 0
  let skipped = 0

  for (const article of articles) {
    if (existingTitles.has(article.title)) {
      console.log(`  ⏭ Skipped (exists): ${article.title}`)
      skipped++
      continue
    }

    const { error } = await supabase.from('support_knowledge_base').insert({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags,
      published: article.published,
    })

    if (error) {
      console.error(`  ✗ Failed: ${article.title} — ${error.message}`)
    } else {
      console.log(`  ✓ Created: ${article.title}`)
      created++
    }
  }

  console.log(`\nDone! Created ${created}, skipped ${skipped} (already existed)`)
}

seed().catch(console.error)
