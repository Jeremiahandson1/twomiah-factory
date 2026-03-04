require('dotenv').config();
const pool = require('../config/database');

const seedDb = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Seed lead statuses
    await client.query(`
      INSERT INTO lead_statuses (name, color, sort_order) VALUES
        ('New', '#3b82f6', 1),
        ('Contacted', '#8b5cf6', 2),
        ('Scheduled', '#f59e0b', 3),
        ('Quote Sent', '#06b6d4', 4),
        ('Follow Up', '#ec4899', 5),
        ('Won', '#22c55e', 6),
        ('Lost', '#ef4444', 7)
      ON CONFLICT (name) DO NOTHING
    `);

    // Seed services
    await client.query(`
      INSERT INTO services (name, slug, description, icon, sort_order) VALUES
        -- Services are configured via the CMS admin panel
        ('General', 'general', 'Professional services for your needs.', 'star', 1),
        ('Remodeling', 'remodeling', 'Exterior remodeling and renovation services.', 'remodel', 6)
      ON CONFLICT (slug) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Database seeded successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seedDb().catch(console.error);
