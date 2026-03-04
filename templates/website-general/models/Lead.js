const pool = require('../config/database');

class Lead {
  // Create a new lead from contact form
  static async create(data) {
    const {
      firstName, lastName, email, phone,
      address, city, state, zip,
      services = [], preferredDate, preferredTime,
      comments, source = 'website',
      ipAddress, userAgent, referrer
    } = data;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get "New" status ID
      const statusResult = await client.query(
        `SELECT id FROM lead_statuses WHERE name = 'New' LIMIT 1`
      );
      const statusId = statusResult.rows[0]?.id || 1;

      // Insert lead
      const leadResult = await client.query(`
        INSERT INTO leads (
          first_name, last_name, email, phone,
          address, city, state, zip,
          preferred_date, preferred_time, comments,
          source, status_id, ip_address, user_agent, referrer
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        firstName, lastName, email, phone,
        address, city, state || 'WI', zip,
        preferredDate || null, preferredTime || null, comments,
        source, statusId, ipAddress, userAgent, referrer
      ]);

      const lead = leadResult.rows[0];

      // Insert lead services
      if (services.length > 0) {
        const serviceQuery = `
          INSERT INTO lead_services (lead_id, service_id)
          SELECT $1, id FROM services WHERE slug = ANY($2)
        `;
        await client.query(serviceQuery, [lead.id, services]);
      }

      // Log activity
      await client.query(`
        INSERT INTO activities (entity_type, entity_id, type, title, description)
        VALUES ('lead', $1, 'created', 'Lead Created', $2)
      `, [lead.id, `New lead from ${source}: ${firstName} ${lastName}`]);

      await client.query('COMMIT');

      // Fetch complete lead with services
      return this.findById(lead.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Find lead by ID
  static async findById(id) {
    const result = await pool.query(`
      SELECT 
        l.*,
        ls.name as status_name,
        ls.color as status_color,
        COALESCE(
          json_agg(
            json_build_object('id', s.id, 'name', s.name, 'slug', s.slug)
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as services
      FROM leads l
      LEFT JOIN lead_statuses ls ON l.status_id = ls.id
      LEFT JOIN lead_services lsv ON l.id = lsv.lead_id
      LEFT JOIN services s ON lsv.service_id = s.id
      WHERE l.id = $1
      GROUP BY l.id, ls.name, ls.color
    `, [id]);

    return result.rows[0] || null;
  }

  // Find lead by UUID
  static async findByUuid(uuid) {
    const result = await pool.query(`
      SELECT 
        l.*,
        ls.name as status_name,
        ls.color as status_color,
        COALESCE(
          json_agg(
            json_build_object('id', s.id, 'name', s.name, 'slug', s.slug)
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as services
      FROM leads l
      LEFT JOIN lead_statuses ls ON l.status_id = ls.id
      LEFT JOIN lead_services lsv ON l.id = lsv.lead_id
      LEFT JOIN services s ON lsv.service_id = s.id
      WHERE l.uuid = $1
      GROUP BY l.id, ls.name, ls.color
    `, [uuid]);

    return result.rows[0] || null;
  }

  // Get all leads with filters
  static async findAll({ status, source, search, page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'DESC' } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = [];

    if (status) {
      params.push(status);
      whereClause.push(`ls.name = $${params.length}`);
    }

    if (source) {
      params.push(source);
      whereClause.push(`l.source = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause.push(`(
        l.first_name ILIKE $${params.length} OR
        l.last_name ILIKE $${params.length} OR
        l.email ILIKE $${params.length} OR
        l.phone ILIKE $${params.length}
      )`);
    }

    const whereStr = whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : '';

    // Validate sort column
    const validSortColumns = ['created_at', 'updated_at', 'first_name', 'last_name', 'status_id'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM leads l
      LEFT JOIN lead_statuses ls ON l.status_id = ls.id
      ${whereStr}
    `, params);

    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await pool.query(`
      SELECT 
        l.*,
        ls.name as status_name,
        ls.color as status_color,
        COALESCE(
          json_agg(
            json_build_object('id', s.id, 'name', s.name, 'slug', s.slug)
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as services
      FROM leads l
      LEFT JOIN lead_statuses ls ON l.status_id = ls.id
      LEFT JOIN lead_services lsv ON l.id = lsv.lead_id
      LEFT JOIN services s ON lsv.service_id = s.id
      ${whereStr}
      GROUP BY l.id, ls.name, ls.color
      ORDER BY l.${sortColumn} ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return {
      leads: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  // Update lead
  static async update(id, data) {
    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone',
      'address', 'city', 'state', 'zip',
      'status_id', 'assigned_to', 'estimated_value',
      'probability', 'next_follow_up', 'preferred_date',
      'preferred_time', 'comments'
    ];

    const updates = [];
    const params = [];

    Object.entries(data).forEach(([key, value]) => {
      // Convert camelCase to snake_case
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      if (allowedFields.includes(snakeKey)) {
        params.push(value);
        updates.push(`${snakeKey} = $${params.length}`);
      }
    });

    if (updates.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    await pool.query(`
      UPDATE leads SET ${updates.join(', ')}
      WHERE id = $${params.length}
    `, params);

    return this.findById(id);
  }

  // Update lead status
  static async updateStatus(id, statusName) {
    const statusResult = await pool.query(
      `SELECT id FROM lead_statuses WHERE name = $1`,
      [statusName]
    );

    if (statusResult.rows.length === 0) {
      throw new Error(`Invalid status: ${statusName}`);
    }

    const statusId = statusResult.rows[0].id;

    await pool.query(`
      UPDATE leads 
      SET status_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [statusId, id]);

    // Log activity
    await pool.query(`
      INSERT INTO activities (entity_type, entity_id, type, title)
      VALUES ('lead', $1, 'status_change', $2)
    `, [id, `Status changed to ${statusName}`]);

    return this.findById(id);
  }

  // Delete lead
  static async delete(id) {
    const result = await pool.query(
      `DELETE FROM leads WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows.length > 0;
  }

  // Get lead statuses
  static async getStatuses() {
    const result = await pool.query(
      `SELECT * FROM lead_statuses WHERE is_active = true ORDER BY sort_order`
    );
    return result.rows;
  }

  // Get pipeline summary
  static async getPipelineSummary() {
    const result = await pool.query(`
      SELECT 
        ls.name,
        ls.color,
        COUNT(l.id) as count,
        COALESCE(SUM(l.estimated_value), 0) as total_value
      FROM lead_statuses ls
      LEFT JOIN leads l ON l.status_id = ls.id
      WHERE ls.is_active = true
      GROUP BY ls.id, ls.name, ls.color
      ORDER BY ls.sort_order
    `);
    return result.rows;
  }
}

module.exports = Lead;
