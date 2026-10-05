import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { company, user, contact, job, crew, measurementReport, material, invoice, insuranceClaim, supplement, adjusterContact, claimActivity, canvassingSession, canvassingStop, canvassingScript, stormEvent, stormLead, smsMessage } from './schema.ts'
import { geocodeAddress } from '../src/services/googleSolar.ts'

const db = drizzle(process.env.DATABASE_URL!)

// Factory replaces this placeholder at generate time. Keeping it inside a
// backtick string guarantees the file is valid JS even if substitution fails —
// the runtime guard below falls back to [] so the seed still completes.
const __FEATURES_RAW = `{{ENABLED_FEATURES_JSON}}`
const enabledFeatures: string[] = __FEATURES_RAW.trim().startsWith('{{') ? [] : JSON.parse(__FEATURES_RAW)

async function main() {
  console.log('Setting up your Roofing CRM...')

  // Upsert company
  let [comp] = await db.select().from(company).where(eq(company.slug, '{{COMPANY_SLUG}}')).limit(1)
  if (!comp) {
    ;[comp] = await db.insert(company).values({
      name: '{{COMPANY_NAME}}',
      slug: '{{COMPANY_SLUG}}',
      email: '{{COMPANY_EMAIL}}',
      phone: '{{COMPANY_PHONE}}',
      address: '{{COMPANY_ADDRESS}}',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      primaryColor: '{{PRIMARY_COLOR}}',
      enabledFeatures,
      settings: {
        siteUrl: '{{SITE_URL}}',
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
        // Storm Lead Generation: seed the tenant's zip so Settings isn't "No zip
        // codes configured" while localized demo storm data (zip {{ZIP}}) exists.
        serviceAreaZips: ['{{ZIP}}'],
        stormAlertEnabled: true,
      },
      reportCredits: 10,
      reportPricePerReport: '9.00',
      estimatorEnabled: true,
      pricePerSquareLow: '350.00',
      pricePerSquareHigh: '550.00',
      estimatorHeadline: 'Get Your Free Roof Estimate',
      estimatorDisclaimer: 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.',
    }).returning()
    console.log('Created company:', comp.name)
  } else {
    console.log('Company already exists:', comp.name)
    // Do NOT re-apply the generation-time feature list to an existing company:
    // the seed runs on EVERY boot (migrate && seed && start), so this clobbered
    // any feature change made after deploy — admin toggles, add-on purchases,
    // factory feature-sync — back to the baked list on every restart/redeploy.
    // enabledFeatures is set once at company creation above; after that the
    // factory sync owns it.
  }

  // Create admin user only if not already present — never overwrite existing password
  const [existingUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    console.log('Admin user already exists - skipping password reset')
  } else {
    const passwordHash = '{{HASHED_DEFAULT_PASSWORD}}' // bcrypt hash injected at generation — plaintext never touches the repo
    await db.insert(user).values({
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      firstName: '{{OWNER_FIRST_NAME}}',
      lastName: '{{OWNER_LAST_NAME}}',
      role: 'owner',
      companyId: comp.id,
    })
    console.log('Created admin user')
  }

  // A NEW TENANT STARTS WITH THEIR OWN BUSINESS, NOT SOMEBODY ELSE'S. (T44)
  //
  // This template used to seed a complete invented roofing company here: two crews, six homeowners,
  // eight jobs, a measurement report, materials, an invoice, two insurance claims with their
  // activity, a supplement, an adjuster, a canvassing session with eight stops, a storm event with
  // leads, and an SMS thread. A real roofer signing up had to delete all of it before the CRM was
  // about them.
  //
  // The flagship `templates/crm/backend/db/seed.template.ts` — the default and the fallback — seeds
  // company, owner, help articles and a pricebook skeleton and nothing else, and so do dispensary,
  // homecare, salon and vet. The rule this now follows is theirs: keep what TEACHES somebody how the
  // screens work, never ship rows that pretend to be records.
  //
  // If a demo book is wanted again it belongs behind an explicit "Load sample data" control the
  // owner chooses, not in the first boot of a CRM somebody is paying for.

  // LIFTED OUT OF THE DEMO BLOCK AND KEPT ON PURPOSE.
  //
  // A canvassing script is a pitch template the shop edits, not a record about an invented customer.
  // And roof has NO screen that creates one — CanvassingDashboard offers edit and delete only,
  // verified by probing every write in that frontend — so removing the seed would leave a roofer with
  // no script and no way to write one, and the canvassing module would arrive dead.
  const existingScripts = await db.select().from(canvassingScript).where(eq(canvassingScript.companyId, comp.id)).limit(1)
  if (existingScripts.length === 0) {
    await db.insert(canvassingScript).values({
    companyId: comp.id,
    name: 'Hail Damage — Standard Script',
    isDefault: true,
    steps: [
      {
        title: 'Introduction',
        body: "Hi, I'm [Name] with [Company]. I'm in the neighborhood today because there was a significant hail storm on March 10th that caused damage to many roofs in this area. Have you had a chance to look at your roof since the storm?",
        tips: "Be friendly and non-pushy. Mention the specific storm date — it shows you're local and informed. If they haven't looked, that's your opening.",
      },
      {
        title: 'Damage Assessment',
        body: "I noticed from the street that your roof may have some damage. Would it be okay if I took a quick look from the ground? I can point out anything I see — no obligation at all.",
        tips: "Never go on the roof without explicit permission. Point out damage from the ground — dented gutters, missing shingles, granule loss in downspouts. Take photos of anything visible.",
      },
      {
        title: 'The Ask',
        body: "Based on what I can see, I think you may have a legitimate insurance claim. Most homeowners in this area are getting full roof replacements covered by insurance with just their deductible out of pocket. Would you like to learn more about how the process works?",
        tips: "Don't promise anything specific about coverage. Use phrases like 'may have' and 'legitimate claim'. Let them ask questions. If they're skeptical, mention neighbors who've already filed.",
      },
      {
        title: 'Close',
        body: "I can schedule a free inspection for you this week. We handle all the insurance paperwork — you just need to be home for about 30 minutes. What day works best for you?",
        tips: "Offer specific time slots rather than open-ended availability. Get their phone number to confirm. Leave a door hanger if they want to think about it. Always be professional — you represent your company in the neighborhood.",
      },
    ],
  })
    console.log('Seeded the default canvassing script')
  }


  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
