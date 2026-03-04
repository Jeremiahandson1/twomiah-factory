import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding {{COMPANY_NAME}} Care database...');

  // ── AGENCY ────────────────────────────────────────────
  const agency = await prisma.agency.upsert({
    where: { slug: '{{COMPANY_SLUG}}' },
    update: {},
    create: {
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
    },
  });
  console.log(`✅ Agency: ${agency.name}`);

  // ── ADMIN USER ────────────────────────────────────────
  const passwordHash = await bcrypt.hash('{{DEFAULT_PASSWORD}}', 12);

  const admin = await prisma.user.upsert({
    where: { email: '{{ADMIN_EMAIL}}' },
    update: {},
    create: {
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      firstName: '{{OWNER_FIRST_NAME}}',
      lastName: '{{OWNER_LAST_NAME}}',
      role: 'admin',
      isActive: true,
      certifications: [],
      certificationsExpiry: [],
    },
  });

  await prisma.notificationPreference.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ── NO-SHOW ALERT CONFIG ──────────────────────────────
  const existing = await prisma.noshowAlertConfig.findFirst();
  if (!existing) {
    await prisma.noshowAlertConfig.create({
      data: { graceMinutes: 15, notifyAdmin: true, notifyCaregiver: true, isActive: true, adminEmail: '{{ADMIN_EMAIL}}' },
    });
  }
  console.log('✅ No-show config');

  // ── SERVICE CODES ─────────────────────────────────────
  const existingCodes = await prisma.serviceCode.count();
  if (existingCodes === 0) {
    const serviceCodes = [
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
    ];
    await prisma.serviceCode.createMany({ data: serviceCodes });
    console.log(`✅ ${serviceCodes.length} service codes`);
  }

  // ── PAYERS ────────────────────────────────────────────
  const existingPayers = await prisma.referralSource.count();
  if (existingPayers === 0) {
    const payers = [
      { name: 'Private Pay', type: 'private_pay', payerType: 'private_pay', isActivePayer: true, expectedPayDays: 14, submissionMethod: 'manual' },
      { name: 'Medicaid', type: 'insurance', payerType: 'medicaid', isActivePayer: true, expectedPayDays: 30, submissionMethod: 'edi' },
      { name: 'Medicare', type: 'insurance', payerType: 'medicare', isActivePayer: true, expectedPayDays: 30, submissionMethod: 'edi' },
      { name: 'Veterans Affairs (VA)', type: 'insurance', payerType: 'va', isActivePayer: true, expectedPayDays: 45, submissionMethod: 'edi' },
    ];
    await prisma.referralSource.createMany({ data: payers });
    console.log(`✅ ${payers.length} payers`);
  }

  // ── SERVICE LOCATION ──────────────────────────────────
  const existingLoc = await prisma.serviceLocation.count();
  if (existingLoc === 0) {
    await prisma.serviceLocation.create({
      data: { name: '{{COMPANY_NAME}} Main Office', address: '{{COMPANY_ADDRESS}}', city: '{{CITY}}', state: '{{STATE}}', zip: '{{ZIP}}', isActive: true },
    });
  }

  // ── FORM TEMPLATES ────────────────────────────────────
  const existingForms = await prisma.formTemplate.count();
  if (existingForms === 0) {
    const formTemplates = [
      {
        name: 'Initial Client Assessment',
        description: 'Standard intake assessment for new clients',
        category: 'assessment',
        requiresSignature: true,
        autoAttachTo: 'client',
        fields: JSON.stringify([
          { id: 'f1', type: 'text', label: 'Primary Diagnosis', required: true },
          { id: 'f2', type: 'textarea', label: 'Medical History', required: false },
          { id: 'f3', type: 'select', label: 'Mobility Level', required: true, options: ['Independent', 'Requires Assistance', 'Non-Ambulatory'] },
          { id: 'f4', type: 'select', label: 'Cognitive Status', required: true, options: ['Alert & Oriented', 'Mild Impairment', 'Moderate Impairment', 'Severe Impairment'] },
          { id: 'f5', type: 'checkbox', label: 'Fall Risk', required: false },
          { id: 'f6', type: 'checkbox', label: 'Requires Hoyer Lift', required: false },
          { id: 'f7', type: 'textarea', label: 'Special Instructions for Caregiver', required: false },
        ]),
      },
      {
        name: 'Incident Report',
        description: 'Document any incidents during a visit',
        category: 'incident',
        requiresSignature: true,
        autoAttachTo: 'client',
        fields: JSON.stringify([
          { id: 'i1', type: 'text', label: 'Date of Incident', required: true, inputType: 'date' },
          { id: 'i2', type: 'text', label: 'Time of Incident', required: true, inputType: 'time' },
          { id: 'i3', type: 'select', label: 'Incident Type', required: true, options: ['Fall', 'Medication Error', 'Behavioral Issue', 'Medical Emergency', 'Property Damage', 'Complaint', 'Other'] },
          { id: 'i4', type: 'textarea', label: 'Description of Incident', required: true },
          { id: 'i5', type: 'textarea', label: 'Immediate Actions Taken', required: true },
          { id: 'i6', type: 'checkbox', label: '911 Called', required: false },
          { id: 'i7', type: 'checkbox', label: 'Family Notified', required: false },
          { id: 'i8', type: 'checkbox', label: 'Supervisor Notified', required: false },
        ]),
      },
      {
        name: 'Caregiver HR Review',
        description: 'Annual performance and compliance review',
        category: 'hr',
        requiresSignature: true,
        autoAttachTo: 'caregiver',
        fields: JSON.stringify([
          { id: 'h1', type: 'select', label: 'Review Period', required: true, options: ['Q1', 'Q2', 'Q3', 'Q4', 'Annual'] },
          { id: 'h2', type: 'select', label: 'Attendance Rating', required: true, options: ['Excellent', 'Good', 'Needs Improvement', 'Unsatisfactory'] },
          { id: 'h3', type: 'select', label: 'Performance Rating', required: true, options: ['Exceeds Expectations', 'Meets Expectations', 'Below Expectations'] },
          { id: 'h4', type: 'textarea', label: 'Strengths', required: false },
          { id: 'h5', type: 'textarea', label: 'Areas for Improvement', required: false },
          { id: 'h6', type: 'checkbox', label: 'CPR Certification Current', required: false },
          { id: 'h7', type: 'checkbox', label: 'Background Check Current', required: false },
          { id: 'h8', type: 'textarea', label: 'Supervisor Comments', required: false },
        ]),
      },
    ];
    await prisma.formTemplate.createMany({ data: formTemplates });
    console.log(`✅ ${formTemplates.length} form templates`);
  }

  console.log('\n✅ Seed complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Agency:   {{COMPANY_NAME}}`);
  console.log(`   Login:    {{ADMIN_EMAIL}}`);
  console.log(`   Password: {{DEFAULT_PASSWORD}}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
