const pool = require('../config/database');

class Activity {
  static async create({ entityType, entityId, type, title, description, metadata = {}, createdBy = null }) {
    const result = await pool.query(`
      INSERT INTO activities (entity_type, entity_id, type, title, description, metadata, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [entityType, entityId, type, title, description, JSON.stringify(metadata), createdBy]);

    return result.rows[0];
  }

  static async findByEntity(entityType, entityId, limit = 50) {
    const result = await pool.query(`
      SELECT * FROM activities
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [entityType, entityId, limit]);

    return result.rows;
  }

  static async findRecent(limit = 50) {
    const result = await pool.query(`
      SELECT * FROM activities
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }
}

module.exports = Activity;
