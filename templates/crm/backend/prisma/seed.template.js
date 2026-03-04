import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Setting up your CRM...');
  // Skip if already seeded
  const existing = await prisma.company.findUnique({ where: { slug: "{{COMPANY_SLUG}}" } });
  if (existing) { console.log("Already seeded, skipping."); return; }

  // Create company
  const company = await prisma.company.create({
    data: {
      name: '{{COMPANY_NAME}}',
      slug: '{{COMPANY_SLUG}}',
      email: '{{COMPANY_EMAIL}}',
      phone: '{{COMPANY_PHONE}}',
      address: '{{COMPANY_ADDRESS}}',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      primaryColor: '{{PRIMARY_COLOR}}',
      secondaryColor: '{{SECONDARY_COLOR}}',
      website: '{{SITE_URL}}',
      enabledFeatures: {{ENABLED_FEATURES_JSON}},
      settings: {
        products: {{PRODUCTS_JSON}},
        siteUrl: '{{SITE_URL}}',
        cmsUrl: '{{CMS_URL}}',
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Create admin user
  const passwordHash = await bcrypt.hash('{{DEFAULT_PASSWORD}}', 12);
  
  await prisma.user.create({
    data: {
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      firstName: '{{OWNER_FIRST_NAME}}',
      lastName: '{{OWNER_LAST_NAME}}',
      role: 'owner',
      companyId: company.id,
    },
  });

  console.log('✓ CRM setup complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  Email: {{ADMIN_EMAIL}}');
  console.log('  Password: {{DEFAULT_PASSWORD}}');
  console.log('');
  console.log('Enabled features: {{ENABLED_FEATURES_COUNT}}');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
