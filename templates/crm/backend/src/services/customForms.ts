/**
 * Custom Forms Service (Drizzle)
 *
 * Dynamic form builder for field technicians:
 * - Create form templates with various field types
 * - Attach forms to jobs/projects
 * - Fill out forms in the field
 * - Required fields, conditional logic
 *
 * NOTE: formTemplate and formSubmission tables are not in the current Drizzle
 * schema. This uses raw SQL for those. Add them to db/schema.ts for full support.
 */

import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';

// Field types
export const FIELD_TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  EMAIL: 'email',
  PHONE: 'phone',
  DATE: 'date',
  TIME: 'time',
  DATETIME: 'datetime',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  SIGNATURE: 'signature',
  PHOTO: 'photo',
  FILE: 'file',
  SECTION: 'section',
  INSTRUCTIONS: 'instructions',
} as const;

// ============================================
// FORM TEMPLATES
// ============================================

/**
 * Create form template
 */
export async function createFormTemplate(companyId: string, data: {
  name: string;
  description?: string;
  category?: string;
  fields?: unknown[];
  requireSignature?: boolean;
  requirePhoto?: boolean;
  autoAttachTo?: string[];
}) {
  const result = await db.execute(sql`
    INSERT INTO form_template (id, company_id, name, description, category, fields, require_signature, require_photo, auto_attach_to, active, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${companyId}, ${data.name}, ${data.description || null},
      ${data.category || null}, ${JSON.stringify(data.fields || [])}::jsonb,
      ${data.requireSignature || false}, ${data.requirePhoto || false},
      ${JSON.stringify(data.autoAttachTo || [])}::jsonb, true, NOW(), NOW()
    )
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

/**
 * Get form templates
 */
export async function getFormTemplates(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
  let whereClause = `company_id = '${companyId}'`;
  if (category) whereClause += ` AND category = '${category}'`;
  if (active !== null) whereClause += ` AND active = ${active}`;

  const result = await db.execute(sql.raw(`
    SELECT * FROM form_template WHERE ${whereClause}
    ORDER BY category ASC, name ASC
  `));
  return (result as any).rows || result;
}

/**
 * Get single template
 */
export async function getFormTemplate(templateId: string, companyId: string) {
  const result = await db.execute(sql`
    SELECT * FROM form_template WHERE id = ${templateId} AND company_id = ${companyId} LIMIT 1
  `);
  const rows = (result as any).rows || result;
  return rows[0] || null;
}

/**
 * Update template
 */
export async function updateFormTemplate(templateId: string, companyId: string, data: Record<string, unknown>) {
  const sets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (typeof value === 'object' && value !== null) {
      sets.push(`${colName} = '${JSON.stringify(value)}'::jsonb`);
    } else if (typeof value === 'boolean') {
      sets.push(`${colName} = ${value}`);
    } else {
      sets.push(`${colName} = '${value}'`);
    }
  }
  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE form_template SET ${sets.join(', ')}, updated_at = NOW() WHERE id = '${templateId}' AND company_id = '${companyId}'`));
  }
}

/**
 * Seed default templates
 */
export async function seedDefaultTemplates(companyId: string) {
  const defaults = [
    {
      name: 'HVAC Maintenance Checklist',
      category: 'checklist',
      fields: [
        { id: 'section1', type: 'section', label: 'Filter & Airflow' },
        { id: 'filter_checked', type: 'checkbox', label: 'Filter inspected/replaced', required: true },
        { id: 'filter_size', type: 'text', label: 'Filter size' },
        { id: 'airflow_test', type: 'select', label: 'Airflow test result', options: ['Pass', 'Fail', 'N/A'], required: true },
        { id: 'section2', type: 'section', label: 'Electrical' },
        { id: 'electrical_connections', type: 'checkbox', label: 'Electrical connections inspected' },
        { id: 'capacitor_tested', type: 'checkbox', label: 'Capacitor tested' },
        { id: 'amp_draw', type: 'number', label: 'Amp draw reading' },
        { id: 'section3', type: 'section', label: 'Refrigerant' },
        { id: 'refrigerant_type', type: 'text', label: 'Refrigerant type' },
        { id: 'suction_pressure', type: 'number', label: 'Suction pressure (PSI)' },
        { id: 'head_pressure', type: 'number', label: 'Head pressure (PSI)' },
        { id: 'notes', type: 'textarea', label: 'Additional notes' },
        { id: 'photo', type: 'photo', label: 'Equipment photo' },
      ],
      requireSignature: true,
    },
    {
      name: 'Job Site Safety Checklist',
      category: 'checklist',
      fields: [
        { id: 'ppe_worn', type: 'checkbox', label: 'Proper PPE worn', required: true },
        { id: 'area_secured', type: 'checkbox', label: 'Work area secured', required: true },
        { id: 'hazards_identified', type: 'checkbox', label: 'Hazards identified and mitigated' },
        { id: 'tools_inspected', type: 'checkbox', label: 'Tools and equipment inspected' },
        { id: 'emergency_exits', type: 'checkbox', label: 'Emergency exits identified' },
        { id: 'hazard_notes', type: 'textarea', label: 'Hazard notes' },
      ],
    },
    {
      name: 'Customer Intake Form',
      category: 'intake',
      fields: [
        { id: 'preferred_contact', type: 'select', label: 'Preferred contact method', options: ['Phone', 'Email', 'Text'] },
        { id: 'best_time', type: 'select', label: 'Best time to contact', options: ['Morning', 'Afternoon', 'Evening'] },
        { id: 'how_heard', type: 'select', label: 'How did you hear about us?', options: ['Google', 'Referral', 'Social Media', 'Direct Mail', 'Other'] },
        { id: 'property_type', type: 'select', label: 'Property type', options: ['Residential', 'Commercial', 'Industrial'] },
        { id: 'property_age', type: 'number', label: 'Approximate property age (years)' },
        { id: 'special_instructions', type: 'textarea', label: 'Special instructions or access notes' },
      ],
    },
    {
      name: 'Final Walkthrough',
      category: 'inspection',
      fields: [
        { id: 'instructions', type: 'instructions', label: 'Complete this form with the customer present' },
        { id: 'work_complete', type: 'checkbox', label: 'All work completed as quoted', required: true },
        { id: 'area_clean', type: 'checkbox', label: 'Work area cleaned', required: true },
        { id: 'customer_demo', type: 'checkbox', label: 'Customer demonstrated operation' },
        { id: 'warranty_explained', type: 'checkbox', label: 'Warranty information provided' },
        { id: 'customer_satisfied', type: 'radio', label: 'Customer satisfaction', options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Unsatisfied'], required: true },
        { id: 'feedback', type: 'textarea', label: 'Customer feedback' },
        { id: 'signature', type: 'signature', label: 'Customer signature', required: true },
      ],
      requireSignature: true,
    },
  ];

  for (const template of defaults) {
    const existing = await db.execute(sql`
      SELECT id FROM form_template WHERE company_id = ${companyId} AND name = ${template.name} LIMIT 1
    `);
    const rows = (existing as any).rows || existing;

    if (rows.length === 0) {
      await createFormTemplate(companyId, template);
    }
  }
}

// ============================================
// FORM SUBMISSIONS
// ============================================

/**
 * Create form submission (fill out a form)
 */
export async function submitForm(companyId: string, data: {
  templateId: string;
  jobId?: string;
  projectId?: string;
  contactId?: string;
  values: Record<string, unknown>;
  signature?: string;
  signedBy?: string;
  submittedById: string;
}) {
  const template = await getFormTemplate(data.templateId, companyId);
  if (!template) throw new Error('Form template not found');

  // Validate required fields
  const fields = typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields;
  const errors = validateSubmission(fields, data.values);
  if (errors.length > 0) {
    throw new Error(`Missing required fields: ${errors.join(', ')}`);
  }

  const result = await db.execute(sql`
    INSERT INTO form_submission (
      id, company_id, template_id, job_id, project_id, contact_id,
      "values", signature, signed_at, signed_by,
      submitted_by_id, submitted_at, status, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), ${companyId}, ${data.templateId},
      ${data.jobId || null}, ${data.projectId || null}, ${data.contactId || null},
      ${JSON.stringify(data.values)}::jsonb,
      ${data.signature || null}, ${data.signature ? new Date() : null}, ${data.signedBy || null},
      ${data.submittedById}, NOW(), 'submitted', NOW(), NOW()
    )
    RETURNING *
  `);

  const submission = ((result as any).rows || result)[0];
  submission.template = { name: template.name, category: template.category };
  return submission;
}

/**
 * Validate submission against template
 */
function validateSubmission(fields: Array<{ id: string; label?: string; required?: boolean }>, values: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of fields) {
    if (field.required && !values[field.id]) {
      errors.push(field.label || field.id);
    }
  }

  return errors;
}

/**
 * Get submissions for a job/project
 */
export async function getSubmissions(companyId: string, { jobId, projectId, contactId, templateId }: {
  jobId?: string;
  projectId?: string;
  contactId?: string;
  templateId?: string;
} = {}) {
  let whereClause = `fs.company_id = '${companyId}'`;
  if (jobId) whereClause += ` AND fs.job_id = '${jobId}'`;
  if (projectId) whereClause += ` AND fs.project_id = '${projectId}'`;
  if (contactId) whereClause += ` AND fs.contact_id = '${contactId}'`;
  if (templateId) whereClause += ` AND fs.template_id = '${templateId}'`;

  const result = await db.execute(sql.raw(`
    SELECT fs.*, ft.name as template_name, ft.category as template_category, ft.fields as template_fields,
      u.first_name as submitted_by_first_name, u.last_name as submitted_by_last_name
    FROM form_submission fs
    LEFT JOIN form_template ft ON fs.template_id = ft.id
    LEFT JOIN "user" u ON fs.submitted_by_id = u.id
    WHERE ${whereClause}
    ORDER BY fs.submitted_at DESC
  `));
  return (result as any).rows || result;
}

/**
 * Get single submission
 */
export async function getSubmission(submissionId: string, companyId: string) {
  const result = await db.execute(sql`
    SELECT fs.*, ft.name as template_name, ft.category as template_category, ft.fields as template_fields,
      j.id as job_id_ref, j.number as job_number, j.title as job_title,
      p.id as project_id_ref, p.number as project_number, p.name as project_name,
      c.id as contact_id_ref, c.name as contact_name,
      u.first_name as submitted_by_first_name, u.last_name as submitted_by_last_name
    FROM form_submission fs
    LEFT JOIN form_template ft ON fs.template_id = ft.id
    LEFT JOIN job j ON fs.job_id = j.id
    LEFT JOIN project p ON fs.project_id = p.id
    LEFT JOIN contact c ON fs.contact_id = c.id
    LEFT JOIN "user" u ON fs.submitted_by_id = u.id
    WHERE fs.id = ${submissionId} AND fs.company_id = ${companyId}
    LIMIT 1
  `);
  const rows = (result as any).rows || result;
  return rows[0] || null;
}

/**
 * Update submission (edit values)
 */
export async function updateSubmission(submissionId: string, companyId: string, data: { values: Record<string, unknown> }) {
  await db.execute(sql`
    UPDATE form_submission SET "values" = ${JSON.stringify(data.values)}::jsonb, updated_at = NOW()
    WHERE id = ${submissionId} AND company_id = ${companyId}
  `);
}

export default {
  FIELD_TYPES,
  createFormTemplate,
  getFormTemplates,
  getFormTemplate,
  updateFormTemplate,
  seedDefaultTemplates,
  submitForm,
  getSubmissions,
  getSubmission,
  updateSubmission,
};
