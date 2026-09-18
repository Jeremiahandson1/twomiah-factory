import { db } from '../db/index.ts'
import { leadStatuses, services } from '../db/schema.ts'
import { sql } from 'drizzle-orm'

const seedDb = async () => {
  try {
    // Seed lead statuses
    await db.insert(leadStatuses).values([
      { name: 'New', color: '#3b82f6', sortOrder: 1 },
      { name: 'Contacted', color: '#8b5cf6', sortOrder: 2 },
      { name: 'Scheduled', color: '#f59e0b', sortOrder: 3 },
      { name: 'Quote Sent', color: '#06b6d4', sortOrder: 4 },
      { name: 'Follow Up', color: '#ec4899', sortOrder: 5 },
      { name: 'Won', color: '#22c55e', sortOrder: 6 },
      { name: 'Lost', color: '#ef4444', sortOrder: 7 },
    ]).onConflictDoNothing()

    // Seed services
    await db.insert(services).values([
      { name: 'General', slug: 'general', description: 'Professional services for your needs.', icon: 'star', sortOrder: 1 },
      { name: 'Remodeling', slug: 'remodeling', description: 'Exterior remodeling and renovation services.', icon: 'remodel', sortOrder: 6 },
    ]).onConflictDoNothing()

    console.log('Database seeded successfully')
  } catch (err: any) {
    console.error('Error seeding database:', err)
    throw err
  }
}

seedDb().catch(console.error)
