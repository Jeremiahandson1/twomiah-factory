require('dotenv').config();
const pool = require('../config/database');

const initDb = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // ============================================
    // CORE TABLES - CRM Ready Schema
    // ============================================

    // Lead statuses for pipeline management
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_statuses (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        color VARCHAR(7) DEFAULT '#6b7280',
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Services offered
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        icon VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Leads from contact form and other sources
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        
        -- Contact info
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20) NOT NULL,
        
        -- Address
        address VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50) DEFAULT '{{STATE}}',
        zip VARCHAR(20),
        
        -- Lead details
        source VARCHAR(50) DEFAULT 'website',
        status_id INT REFERENCES lead_statuses(id),
        
        -- Scheduling
        preferred_date DATE,
        preferred_time VARCHAR(50),
        
        -- Project info
        comments TEXT,
        
        -- Tracking
        ip_address VARCHAR(45),
        user_agent TEXT,
        referrer TEXT,
        
        -- CRM fields
        assigned_to INT,
        estimated_value DECIMAL(10, 2),
        probability INT DEFAULT 50,
        next_follow_up DATE,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        converted_at TIMESTAMP,
        closed_at TIMESTAMP
      )
    `);

    // Lead services junction table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_services (
        id SERIAL PRIMARY KEY,
        lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(lead_id, service_id)
      )
    `);

    // Contacts (converted leads or direct entries)
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        lead_id INT REFERENCES leads(id),
        
        -- Contact info
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        phone_secondary VARCHAR(20),
        
        -- Address
        address VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50) DEFAULT '{{STATE}}',
        zip VARCHAR(20),
        
        -- Classification
        type VARCHAR(50) DEFAULT 'residential',
        tags TEXT[],
        
        -- Notes
        notes TEXT,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Quotes/Estimates
    await client.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        quote_number VARCHAR(50) UNIQUE,
        
        -- Relations
        lead_id INT REFERENCES leads(id),
        contact_id INT REFERENCES contacts(id),
        
        -- Quote details
        title VARCHAR(255),
        description TEXT,
        
        -- Financials
        subtotal DECIMAL(10, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 4) DEFAULT 0,
        tax_amount DECIMAL(10, 2) DEFAULT 0,
        discount DECIMAL(10, 2) DEFAULT 0,
        total DECIMAL(10, 2) DEFAULT 0,
        
        -- Status
        status VARCHAR(50) DEFAULT 'draft',
        valid_until DATE,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP,
        accepted_at TIMESTAMP,
        rejected_at TIMESTAMP
      )
    `);

    // Quote line items
    await client.query(`
      CREATE TABLE IF NOT EXISTS quote_items (
        id SERIAL PRIMARY KEY,
        quote_id INT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        service_id INT REFERENCES services(id),
        
        description TEXT NOT NULL,
        quantity DECIMAL(10, 2) DEFAULT 1,
        unit VARCHAR(50) DEFAULT 'each',
        unit_price DECIMAL(10, 2) NOT NULL,
        total DECIMAL(10, 2) NOT NULL,
        
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Jobs/Projects
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        job_number VARCHAR(50) UNIQUE,
        
        -- Relations
        quote_id INT REFERENCES quotes(id),
        contact_id INT REFERENCES contacts(id),
        
        -- Job details
        title VARCHAR(255) NOT NULL,
        description TEXT,
        
        -- Address (can differ from contact address)
        address VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50) DEFAULT '{{STATE}}',
        zip VARCHAR(20),
        
        -- Scheduling
        scheduled_start DATE,
        scheduled_end DATE,
        actual_start DATE,
        actual_end DATE,
        
        -- Status
        status VARCHAR(50) DEFAULT 'pending',
        
        -- Financials
        contract_amount DECIMAL(10, 2),
        paid_amount DECIMAL(10, 2) DEFAULT 0,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    // Activity/Notes log (polymorphic)
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        
        -- Polymorphic relation
        entity_type VARCHAR(50) NOT NULL,
        entity_id INT NOT NULL,
        
        -- Activity details
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        description TEXT,
        
        -- Metadata
        metadata JSONB DEFAULT '{}',
        
        -- User tracking (for future auth)
        created_by INT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id)`);

    await client.query('COMMIT');
    console.log('✅ Database schema initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error initializing database:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

initDb().catch(console.error);
