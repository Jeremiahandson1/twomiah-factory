import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Setting up your CRM...');
  // Skip if already seeded
  const existing = await prisma.company.findUnique({ where: { slug: "jeremiah" } });
  if (existing) { console.log("Already seeded, skipping."); return; }

  // Create company
  const company = await prisma.company.create({
    data: {
      name: 'Jeremiah',
      slug: 'jeremiah',
      email: 'jeremiahandson@gmail.com',
      phone: '5555555555',
      address: '123 Main St',
      city: 'EC',
      state: 'ST',
      zip: '00000',
      primaryColor: '#8b5cf6',
      secondaryColor: '#1e1b4b',
      website: 'https://test@test.com',
      enabledFeatures: [
            "contacts",
            "jobs",
            "quotes",
            "invoices",
            "scheduling",
            "team",
            "dashboard",
            "projects",
            "rfis",
            "change_orders",
            "punch_lists",
            "daily_logs",
            "inspections",
            "bid_management",
            "takeoff_tools",
            "selections",
            "drag_drop_calendar",
            "recurring_jobs",
            "route_optimization",
            "online_booking",
            "service_dispatch",
            "service_agreements",
            "warranties",
            "pricebook",
            "time_tracking",
            "gps_tracking",
            "photo_capture",
            "equipment_tracking",
            "fleet",
            "online_payments",
            "expense_tracking",
            "job_costing",
            "consumer_financing",
            "quickbooks",
            "two_way_texting",
            "call_tracking",
            "client_portal",
            "paid_ads",
            "google_reviews",
            "email_marketing",
            "referral_program",
            "inventory",
            "documents",
            "reports",
            "custom_dashboards",
            "ai_receptionist",
            "map_view"
      ],
      settings: {
        products: ["website","cms","crm","vision"],
        siteUrl: 'https://test@test.com',
        cmsUrl: 'https://jeremiah-site.onrender.com/admin',
        generatedBy: 'Twomiah Build Factory',
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Create admin user
  const passwordHash = await bcrypt.hash('bMDER9jk!', 12);
  
  await prisma.user.create({
    data: {
      email: 'jeremiahandson@gmail.com',
      passwordHash,
      firstName: 'J',
      lastName: 'P',
      role: 'owner',
      companyId: company.id,
    },
  });

  console.log('✓ CRM setup complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  Email: jeremiahandson@gmail.com');
  console.log('  Password: bMDER9jk!');
  console.log('');
  console.log('Enabled features: 47 features');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
