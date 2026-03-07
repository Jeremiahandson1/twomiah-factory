import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, count } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import {
  agencies, users, notificationPreferences, noshowAlertConfig,
  serviceCodes, referralSources, serviceLocations, formTemplates,
} from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

async function main() {
  console.log('Seeding {{COMPANY_NAME}} Care database...')

  // ── AGENCY ────────────────────────────────────────────
  const [existingAgency] = await db.select().from(agencies).where(eq(agencies.slug, '{{COMPANY_SLUG}}')).limit(1)
  const agency = existingAgency || (await db.insert(agencies).values({
    name: '{{COMPANY_NAME}}',
    legalName: '{{COMPANY_LEGAL_NAME}}',
    slug: '{{COMPANY_SLUG}}',
    email: '{{COMPANY_EMAIL}}',
    phone: '{{COMPANY_PHONE}}',
    address: '{{COMPANY_ADDRESS}}',
    city: '{{CITY}}',
    state: '{{STATE}}',
    zip: '{{ZIP}}',
    primaryColor: '{{PRIMARY_COLOR}}',
    secondaryColor: '{{SECONDARY_COLOR}}',
  }).returning())[0]
  console.log(`Agency: ${agency.name}`)

  // ── ADMIN USER ────────────────────────────────────────
  const passwordHash = await bcrypt.hash('{{DEFAULT_PASSWORD}}', 12)

  const [existingAdmin] = await db.select().from(users).where(eq(users.email, '{{ADMIN_EMAIL}}')).limit(1)
  let admin: typeof existingAdmin
  if (existingAdmin) {
    await db.update(users).set({ passwordHash, role: 'admin', isActive: true }).where(eq(users.id, existingAdmin.id))
    admin = existingAdmin
    console.log('Updated admin user password')
  } else {
    admin = (await db.insert(users).values({
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      firstName: '{{OWNER_FIRST_NAME}}',
      lastName: '{{OWNER_LAST_NAME}}',
      role: 'admin',
      isActive: true,
      certifications: [],
      certificationsExpiry: [],
    }).returning())[0]
    console.log('Created admin user')
  }

  const [existingPref] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, admin.id)).limit(1)
  if (!existingPref) {
    await db.insert(notificationPreferences).values({ userId: admin.id })
  }
  console.log(`Admin: ${admin.email}`)

  // ── NO-SHOW ALERT CONFIG ──────────────────────────────
  const [existingConfig] = await db.select().from(noshowAlertConfig).limit(1)
  if (!existingConfig) {
    await db.insert(noshowAlertConfig).values({
      graceMinutes: 15,
      notifyAdmin: true,
      notifyCaregiver: true,
      isActive: true,
      adminEmail: '{{ADMIN_EMAIL}}',
    })
  }
  console.log('No-show config')

  // ── SERVICE CODES ─────────────────────────────────────
  const [{ value: codeCount }] = await db.select({ value: count() }).from(serviceCodes)
  if (Number(codeCount) === 0) {
    const codes = [
      { code: 'T1019', description: 'Personal Care Services - per 15 min', serviceCategory: 'personal_care', payerType: 'all', unitType: '15min', requiresEvv: true },
      { code: 'T1019', modifier1: 'U1', description: 'Personal Care - Supportive Home Care', serviceCategory: 'personal_care', payerType: 'mco_family_care', unitType: '15min', requiresEvv: true },
      { code: 'T1019', modifier1: 'U2', description: 'Personal Care - Consumer Directed', serviceCategory: 'personal_care', payerType: 'mco_family_care', unitType: '15min', requiresEvv: true },
      { code: 'S5125', description: 'Attendant Care Services - per 15 min', serviceCategory: 'personal_care', payerType: 'all', unitType: '15min', requiresEvv: true },
      { code: 'S5130', description: 'Homemaker Services - per 15 min', serviceCategory: 'homemaker', payerType: 'all', unitType: '15min', requiresEvv: true },
      { code: 'S5135', description: 'Companion Services - per 15 min', serviceCategory: 'companion', payerType: 'all', unitType: '15min', requiresEvv: true },
      { code: 'T1005', description: 'Respite Care Services - per 15 min', serviceCategory: 'respite', payerType: 'all', unitType: '15min', requiresEvv: true },
      { code: 'G0299', description: 'Direct Skilled Nursing - per visit', serviceCategory: 'skilled_nursing', payerType: 'medicaid', unitType: 'visit', requiresEvv: true },
      { code: '99509', description: 'Home Visit - Assistance with ADLs', serviceCategory: 'personal_care', payerType: 'all', unitType: 'visit', requiresEvv: true },
      { code: 'T2025', description: 'Waiver Services - Hourly', serviceCategory: 'personal_care', payerType: 'mco_family_care', unitType: 'hour', requiresEvv: true },
    ]
    await db.insert(serviceCodes).values(codes)
    console.log(`${codes.length} service codes`)
  }

  // ── PAYERS ────────────────────────────────────────────
  const [{ value: payerCount }] = await db.select({ value: count() }).from(referralSources)
  if (Number(payerCount) === 0) {
    const payers = [
      { name: 'Private Pay', type: 'private_pay', payerType: 'private_pay', isActivePayer: true, expectedPayDays: 14, submissionMethod: 'manual' },
      { name: 'Medicaid', type: 'insurance', payerType: 'medicaid', isActivePayer: true, expectedPayDays: 30, submissionMethod: 'edi' },
      { name: 'Medicare', type: 'insurance', payerType: 'medicare', isActivePayer: true, expectedPayDays: 30, submissionMethod: 'edi' },
      { name: 'Veterans Affairs (VA)', type: 'insurance', payerType: 'va', isActivePayer: true, expectedPayDays: 45, submissionMethod: 'edi' },
    ]
    await db.insert(referralSources).values(payers)
    console.log(`${payers.length} payers`)
  }

  // ── SERVICE LOCATION ──────────────────────────────────
  const [{ value: locCount }] = await db.select({ value: count() }).from(serviceLocations)
  if (Number(locCount) === 0) {
    await db.insert(serviceLocations).values({
      name: '{{COMPANY_NAME}} Main Office',
      address: '{{COMPANY_ADDRESS}}',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      isActive: true,
    })
  }

  // ── FORM TEMPLATES ────────────────────────────────────
  const [{ value: formCount }] = await db.select({ value: count() }).from(formTemplates)
  if (Number(formCount) === 0) {
    const forms = [
      {
        name: 'Initial Client Assessment',
        description: 'Standard intake assessment for new clients',
        category: 'assessment',
        requiresSignature: true,
        autoAttachTo: 'client',
        fields: [
          { id: 'f1', type: 'text', label: 'Primary Diagnosis', required: true },
          { id: 'f2', type: 'textarea', label: 'Medical History', required: false },
          { id: 'f3', type: 'select', label: 'Mobility Level', required: true, options: ['Independent', 'Requires Assistance', 'Non-Ambulatory'] },
          { id: 'f4', type: 'select', label: 'Cognitive Status', required: true, options: ['Alert & Oriented', 'Mild Impairment', 'Moderate Impairment', 'Severe Impairment'] },
          { id: 'f5', type: 'checkbox', label: 'Fall Risk', required: false },
          { id: 'f6', type: 'checkbox', label: 'Requires Hoyer Lift', required: false },
          { id: 'f7', type: 'textarea', label: 'Special Instructions for Caregiver', required: false },
        ],
      },
      {
        name: 'Incident Report',
        description: 'Document any incidents during a visit',
        category: 'incident',
        requiresSignature: true,
        autoAttachTo: 'client',
        fields: [
          { id: 'i1', type: 'text', label: 'Date of Incident', required: true, inputType: 'date' },
          { id: 'i2', type: 'text', label: 'Time of Incident', required: true, inputType: 'time' },
          { id: 'i3', type: 'select', label: 'Incident Type', required: true, options: ['Fall', 'Medication Error', 'Behavioral Issue', 'Medical Emergency', 'Property Damage', 'Complaint', 'Other'] },
          { id: 'i4', type: 'textarea', label: 'Description of Incident', required: true },
          { id: 'i5', type: 'textarea', label: 'Immediate Actions Taken', required: true },
          { id: 'i6', type: 'checkbox', label: '911 Called', required: false },
          { id: 'i7', type: 'checkbox', label: 'Family Notified', required: false },
          { id: 'i8', type: 'checkbox', label: 'Supervisor Notified', required: false },
        ],
      },
      {
        name: 'Caregiver HR Review',
        description: 'Annual performance and compliance review',
        category: 'hr',
        requiresSignature: true,
        autoAttachTo: 'caregiver',
        fields: [
          { id: 'h1', type: 'select', label: 'Review Period', required: true, options: ['Q1', 'Q2', 'Q3', 'Q4', 'Annual'] },
          { id: 'h2', type: 'select', label: 'Attendance Rating', required: true, options: ['Excellent', 'Good', 'Needs Improvement', 'Unsatisfactory'] },
          { id: 'h3', type: 'select', label: 'Performance Rating', required: true, options: ['Exceeds Expectations', 'Meets Expectations', 'Below Expectations'] },
          { id: 'h4', type: 'textarea', label: 'Strengths', required: false },
          { id: 'h5', type: 'textarea', label: 'Areas for Improvement', required: false },
          { id: 'h6', type: 'checkbox', label: 'CPR Certification Current', required: false },
          { id: 'h7', type: 'checkbox', label: 'Background Check Current', required: false },
          { id: 'h8', type: 'textarea', label: 'Supervisor Comments', required: false },
        ],
      },
    ]
    await db.insert(formTemplates).values(forms)
    console.log(`${forms.length} form templates`)
  }

  console.log('\nSeed complete!')
  console.log('===')
  console.log(`   Agency:   {{COMPANY_NAME}}`)
  console.log(`   Login:    {{ADMIN_EMAIL}}`)
  console.log(`   Password: {{DEFAULT_PASSWORD}}`)
  console.log('===')
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1) })
