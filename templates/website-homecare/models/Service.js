const pool = require('../config/database');

class Service {
  static async findAll() {
    const result = await pool.query(`
      SELECT * FROM services 
      WHERE is_active = true 
      ORDER BY sort_order
    `);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT * FROM services WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async findBySlug(slug) {
    const result = await pool.query(
      `SELECT * FROM services WHERE slug = $1`,
      [slug]
    );
    return result.rows[0] || null;
  }
}

module.exports = Service;
