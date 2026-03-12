import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { company, user, contact, job, crew, measurementReport, material, invoice, insuranceClaim, supplement, adjusterContact, claimActivity } from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

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
      enabledFeatures: {{ENABLED_FEATURES_JSON}},
      settings: {
        siteUrl: '{{SITE_URL}}',
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
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
  }

  // Upsert admin user
  const passwordHash = await bcrypt.hash('{{DEFAULT_PASSWORD}}', 12)
  const [existingUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    await db.update(user).set({ passwordHash, role: 'owner', isActive: true }).where(eq(user.id, existingUser.id))
    console.log('Updated admin user password')
  } else {
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

  // ── DEMO SEED DATA ──────────────────────────────────────

  // Check if demo data already exists
  const existingJobs = await db.select().from(job).where(eq(job.companyId, comp.id)).limit(1)
  if (existingJobs.length > 0) {
    console.log('Demo data already exists, skipping seed')
  } else {
    // Create 2 demo crews
    const [crewA] = await db.insert(crew).values({
      companyId: comp.id,
      name: 'Crew A',
      foremanName: 'Carlos Lopez',
      foremanPhone: '(555) 100-0001',
      size: 4,
      isSubcontractor: false,
    }).returning()
    console.log('Created crew:', crewA.name)

    const [crewB] = await db.insert(crew).values({
      companyId: comp.id,
      name: 'Rodriguez Subcontractors',
      foremanName: 'Miguel Rodriguez',
      foremanPhone: '(555) 100-0002',
      size: 6,
      isSubcontractor: true,
      subcontractorCompanyName: 'Rodriguez Roofing LLC',
    }).returning()
    console.log('Created crew:', crewB.name)

    // Create 3 demo contacts
    const [johnson] = await db.insert(contact).values({
      companyId: comp.id,
      firstName: 'Robert',
      lastName: 'Johnson',
      email: 'rjohnson@example.com',
      phone: '(555) 200-0001',
      mobilePhone: '(555) 200-0011',
      address: '1234 Oak Dr',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      leadSource: 'storm_chase',
      propertyType: 'residential',
    }).returning()

    const [martinez] = await db.insert(contact).values({
      companyId: comp.id,
      firstName: 'Maria',
      lastName: 'Martinez',
      email: 'mmartinez@example.com',
      phone: '(555) 200-0002',
      mobilePhone: '(555) 200-0012',
      address: '5678 Elm St',
      city: 'Fort Worth',
      state: 'TX',
      zip: '76102',
      leadSource: 'referral',
      propertyType: 'residential',
    }).returning()

    const [thompson] = await db.insert(contact).values({
      companyId: comp.id,
      firstName: 'James',
      lastName: 'Thompson',
      email: 'jthompson@example.com',
      phone: '(555) 200-0003',
      mobilePhone: '(555) 200-0013',
      address: '9012 Pine Ave',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      leadSource: 'google',
      propertyType: 'residential',
    }).returning()

    console.log('Created 3 demo contacts')

    // Create 5 demo jobs

    // Job 1: Johnson — Insurance, inspection_scheduled
    const [job1] = await db.insert(job).values({
      companyId: comp.id,
      contactId: johnson.id,
      jobNumber: 'ROOF-0001',
      jobType: 'insurance',
      status: 'inspection_scheduled',
      propertyAddress: '1234 Oak Dr',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      roofType: 'asphalt_shingle',
      stories: 2,
      roofAge: 15,
      claimNumber: 'SF-2024-88321',
      insuranceCompany: 'State Farm',
      inspectionDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      inspectionNotes: 'Hail damage reported after March storm. Homeowner noticed missing shingles.',
      source: 'canvassing',
      priority: 'high',
    }).returning()

    // Job 2: Martinez — Insurance, proposal_sent
    const [job2] = await db.insert(job).values({
      companyId: comp.id,
      contactId: martinez.id,
      jobNumber: 'ROOF-0002',
      jobType: 'insurance',
      status: 'proposal_sent',
      propertyAddress: '5678 Elm St',
      city: 'Fort Worth',
      state: 'TX',
      zip: '76102',
      roofType: 'asphalt_shingle',
      stories: 1,
      roofAge: 20,
      claimNumber: 'ALL-2024-44219',
      insuranceCompany: 'Allstate',
      rcv: '14200.00',
      acv: '11800.00',
      deductible: '1000.00',
      totalSquares: '28.00',
      estimatedRevenue: '14200.00',
      source: 'manual',
      priority: 'medium',
    }).returning()

    // Job 3: Thompson — Retail, signed
    const installDate = new Date()
    installDate.setDate(installDate.getDate() + 10)
    const installEndDate = new Date(installDate)
    installEndDate.setDate(installEndDate.getDate() + 2)
    const [job3] = await db.insert(job).values({
      companyId: comp.id,
      contactId: thompson.id,
      jobNumber: 'ROOF-0003',
      jobType: 'retail',
      status: 'signed',
      propertyAddress: '9012 Pine Ave',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      roofType: 'asphalt_shingle',
      stories: 2,
      roofAge: 22,
      totalSquares: '24.00',
      estimatedRevenue: '12500.00',
      installDate,
      installEndDate,
      notes: 'Customer selected GAF Timberline HDZ in Charcoal. Premium underlayment requested.',
      source: 'google',
      priority: 'medium',
    }).returning()

    // Job 4: Williams (uses Johnson contact) — Insurance, in_production
    const [job4] = await db.insert(job).values({
      companyId: comp.id,
      contactId: johnson.id,
      assignedCrewId: crewA.id,
      jobNumber: 'ROOF-0004',
      jobType: 'insurance',
      status: 'in_production',
      propertyAddress: '3456 Maple Ln',
      city: 'Richardson',
      state: 'TX',
      zip: '75080',
      roofType: 'asphalt_shingle',
      stories: 1,
      roofAge: 18,
      claimNumber: 'USAA-2024-67890',
      insuranceCompany: 'USAA',
      rcv: '11500.00',
      acv: '9200.00',
      deductible: '1500.00',
      totalSquares: '22.00',
      estimatedRevenue: '11500.00',
      materialCost: '4200.00',
      laborCost: '3800.00',
      source: 'storm_chase',
      priority: 'high',
    }).returning()

    // Job 5: Davis (uses Martinez contact) — Retail, invoiced
    const [job5] = await db.insert(job).values({
      companyId: comp.id,
      contactId: martinez.id,
      assignedCrewId: crewB.id,
      jobNumber: 'ROOF-0005',
      jobType: 'retail',
      status: 'invoiced',
      propertyAddress: '7890 Cedar Ct',
      city: 'Arlington',
      state: 'TX',
      zip: '76010',
      roofType: 'asphalt_shingle',
      stories: 1,
      roofAge: 25,
      totalSquares: '20.00',
      estimatedRevenue: '8400.00',
      finalRevenue: '8400.00',
      materialCost: '3100.00',
      laborCost: '2800.00',
      source: 'referral',
      priority: 'low',
    }).returning()

    console.log('Created 5 demo jobs')

    // Measurement report for Thompson job — realistic Google Solar API data
    await db.insert(measurementReport).values({
      companyId: comp.id,
      jobId: job3.id,
      address: '9012 Pine Ave',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      provider: 'google_solar',
      status: 'complete',
      totalSquares: '24.00',
      totalArea: '2400.00',
      segments: [
        { name: 'Segment 1', area: 1320, pitch: '6/12', pitchDegrees: 26.6, azimuthDegrees: 180 },
        { name: 'Segment 2', area: 480, pitch: '6/12', pitchDegrees: 26.6, azimuthDegrees: 0 },
        { name: 'Segment 3', area: 360, pitch: '4/12', pitchDegrees: 18.4, azimuthDegrees: 270 },
        { name: 'Segment 4', area: 240, pitch: '8/12', pitchDegrees: 33.7, azimuthDegrees: 90 },
      ],
      imageryQuality: 'HIGH',
      imageryDate: '2024-06-15',
      pitchDegrees: [26.6, 26.6, 18.4, 33.7],
      center: { lat: 33.0198, lng: -96.6989 },
    })
    console.log('Created measurement report for Thompson job')

    // Material order for Williams job (job4)
    await db.insert(material).values({
      companyId: comp.id,
      jobId: job4.id,
      supplier: 'abc_supply',
      orderStatus: 'delivered',
      orderDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      deliveryDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      lineItems: [
        { description: 'GAF Timberline HDZ Shingles - Weathered Wood', qty: 22, unit: 'squares', unitPrice: 110, total: 2420 },
        { description: 'GAF FeltBuster Synthetic Underlayment', qty: 8, unit: 'rolls', unitPrice: 65, total: 520 },
        { description: 'GAF Cobra Ridge Vent', qty: 4, unit: 'pieces', unitPrice: 45, total: 180 },
        { description: 'Roofing Nails (coil)', qty: 6, unit: 'boxes', unitPrice: 55, total: 330 },
        { description: 'Ice & Water Shield', qty: 3, unit: 'rolls', unitPrice: 95, total: 285 },
      ],
      totalCost: '3735.00',
      supplierOrderNumber: 'ABC-TX-2024-5521',
      deliveryAddress: '3456 Maple Ln, Richardson, TX 75080',
    })
    console.log('Created material order for Williams job')

    // Invoice for Davis job (job5)
    await db.insert(invoice).values({
      companyId: comp.id,
      jobId: job5.id,
      contactId: martinez.id,
      invoiceNumber: 'INV-0001',
      status: 'sent',
      lineItems: [
        { description: 'Complete Roof Replacement - 20 squares', qty: 1, unitPrice: 7200, total: 7200 },
        { description: 'Premium Underlayment Upgrade', qty: 1, unitPrice: 400, total: 400 },
        { description: 'Ridge Vent Installation', qty: 1, unitPrice: 350, total: 350 },
        { description: 'Debris Removal & Cleanup', qty: 1, unitPrice: 450, total: 450 },
      ],
      subtotal: '8400.00',
      taxRate: '0.00',
      taxAmount: '0.00',
      total: '8400.00',
      amountPaid: '0.00',
      balance: '8400.00',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    console.log('Created invoice for Davis job')

    // ── INSURANCE CLAIMS ──────────────────────────────────

    // Get admin user for activity logging
    const [adminUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
    const adminId = adminUser?.id || 'system'

    // Claim for Johnson job (ROOF-0001) — State Farm, inspection_scheduled
    const [claim1] = await db.insert(insuranceClaim).values({
      companyId: comp.id,
      jobId: job1.id,
      claimNumber: 'SF-2024-887432',
      insuranceCompany: 'State Farm',
      policyNumber: 'HO-9928341',
      adjusterName: 'Mike Torres',
      adjusterPhone: '(515) 555-0101',
      adjusterEmail: 'mtorres@statefarm.com',
      adjusterCompany: 'State Farm',
      dateOfLoss: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      causeOfLoss: 'hail',
      deductible: '1500.00',
      claimStatus: 'inspection_scheduled',
      claimFiledDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      adjusterInspectionDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    }).returning()

    // Activity for claim1
    await db.insert(claimActivity).values([
      {
        companyId: comp.id, jobId: job1.id, claimId: claim1.id, userId: adminId,
        activityType: 'status_change',
        body: 'Insurance claim filed with State Farm — Claim #SF-2024-887432',
        createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job1.id, claimId: claim1.id, userId: adminId,
        activityType: 'status_change',
        body: 'Adjuster assigned — Mike Torres (State Farm)',
        createdAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job1.id, claimId: claim1.id, userId: adminId,
        activityType: 'status_change',
        body: 'Adjuster inspection scheduled for ' + new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    ])
    console.log('Created insurance claim for Johnson job')

    // Claim for Martinez job (ROOF-0002) — Allstate, approved
    const [claim2] = await db.insert(insuranceClaim).values({
      companyId: comp.id,
      jobId: job2.id,
      claimNumber: 'ALL-2024-44219',
      insuranceCompany: 'Allstate',
      policyNumber: 'HO-7723419',
      adjusterName: 'Bob Hendricks',
      adjusterPhone: '(414) 555-0303',
      adjusterEmail: 'bhendricks@allstate.com',
      adjusterCompany: 'Allstate',
      dateOfLoss: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      causeOfLoss: 'hail',
      deductible: '1000.00',
      rcv: '14200.00',
      acv: '11800.00',
      depreciationHeld: '2400.00',
      supplementAmount: '1200.00',
      claimStatus: 'approved',
      claimFiledDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      adjusterInspectionDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
      approvalDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    }).returning()

    // Activity for claim2
    await db.insert(claimActivity).values([
      {
        companyId: comp.id, jobId: job2.id, claimId: claim2.id, userId: adminId,
        activityType: 'status_change',
        body: 'Insurance claim filed with Allstate — Claim #ALL-2024-44219',
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job2.id, claimId: claim2.id, userId: adminId,
        activityType: 'status_change',
        body: 'Adjuster assigned — Bob Hendricks (Allstate)',
        createdAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job2.id, claimId: claim2.id, userId: adminId,
        activityType: 'call',
        body: 'Called adjuster to schedule inspection. Left voicemail.',
        metadata: { callDuration: '2' },
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job2.id, claimId: claim2.id, userId: adminId,
        activityType: 'inspection',
        body: 'Adjuster inspection completed. Bob confirmed hail damage on south-facing slopes.',
        createdAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
      },
      {
        companyId: comp.id, jobId: job2.id, claimId: claim2.id, userId: adminId,
        activityType: 'approval',
        body: 'Claim approved — RCV $14,200, ACV $11,800, Deductible $1,000',
        createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      },
    ])
    console.log('Created insurance claim for Martinez job')

    // Supplement for Martinez claim
    await db.insert(supplement).values({
      companyId: comp.id,
      jobId: job2.id,
      claimId: claim2.id,
      supplementNumber: 'SUP-001',
      status: 'submitted',
      reason: 'Code upgrade required per local building code — ice & water shield full deck and upgraded ventilation',
      lineItems: [
        { code: 'RFG 180', description: 'Ice & water shield - full deck upgrade', qty: 28, unit: 'SQ', unitPrice: 45, total: 1260 },
        { code: 'VNT 100', description: 'Ridge vent - code upgrade', qty: 1, unit: 'EA', unitPrice: 350, total: 350 },
      ],
      totalAmount: '1200.00',
      submittedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    })
    console.log('Created supplement for Martinez claim')

    // ── ADJUSTER DIRECTORY ──────────────────────────────────

    await db.insert(adjusterContact).values([
      {
        companyId: comp.id,
        name: 'Mike Torres',
        phone: '(515) 555-0101',
        email: 'mtorres@statefarm.com',
        adjusterCompany: 'State Farm',
        insuranceCarrier: 'State Farm',
        territory: 'Des Moines, IA',
        jobsWorkedTogether: 3,
      },
      {
        companyId: comp.id,
        name: 'Jennifer Walsh',
        phone: '(312) 555-0202',
        email: 'jwalsh@crawfordco.com',
        adjusterCompany: 'Crawford & Company',
        insuranceCarrier: 'Multiple',
        territory: 'Midwest',
        notes: 'Independent adjuster — fair, thorough inspections. Good to work with.',
        jobsWorkedTogether: 7,
      },
      {
        companyId: comp.id,
        name: 'Bob Hendricks',
        phone: '(414) 555-0303',
        email: 'bhendricks@allstate.com',
        adjusterCompany: 'Allstate',
        insuranceCarrier: 'Allstate',
        territory: 'Wisconsin',
        jobsWorkedTogether: 2,
      },
    ])
    console.log('Created 3 demo adjuster contacts')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
