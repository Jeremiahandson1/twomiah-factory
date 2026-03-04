/**
 * Custom Forms Service
 * 
 * Dynamic form builder for field technicians:
 * - Create form templates with various field types
 * - Attach forms to jobs/projects
 * - Fill out forms in the field
 * - Required fields, conditional logic
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  SECTION: 'section', // Visual divider
  INSTRUCTIONS: 'instructions', // Read-only text
};

// ============================================
// FORM TEMPLATES
// ============================================

/**
 * Create form template
 */
export async function createFormTemplate(companyId, data) {
  return prisma.formTemplate.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      category: data.category, // inspection, checklist, intake, survey, etc.
      
      fields: data.fields || [],
      
      // Settings
      requireSignature: data.requireSignature || false,
      requirePhoto: data.requirePhoto || false,
      autoAttachTo: data.autoAttachTo || [], // ['job', 'project', 'quote']
      
      active: true,
    },
  });
}

/**
 * Get form templates
 */
export async function getFormTemplates(companyId, { category, active = true } = {}) {
  const where = { companyId };
  if (category) where.category = category;
  if (active !== null) where.active = active;

  return prisma.formTemplate.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Get single template
 */
export async function getFormTemplate(templateId, companyId) {
  return prisma.formTemplate.findFirst({
    where: { id: templateId, companyId },
  });
}

/**
 * Update template
 */
export async function updateFormTemplate(templateId, companyId, data) {
  return prisma.formTemplate.updateMany({
    where: { id: templateId, companyId },
    data,
  });
}

/**
 * Seed default templates
 */
export async function seedDefaultTemplates(companyId) {
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
    const existing = await prisma.formTemplate.findFirst({
      where: { companyId, name: template.name },
    });
    
    if (!existing) {
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
export async function submitForm(companyId, data) {
  const template = await prisma.formTemplate.findFirst({
    where: { id: data.templateId, companyId },
  });

  if (!template) throw new Error('Form template not found');

  // Validate required fields
  const errors = validateSubmission(template.fields, data.values);
  if (errors.length > 0) {
    throw new Error(`Missing required fields: ${errors.join(', ')}`);
  }

  return prisma.formSubmission.create({
    data: {
      companyId,
      templateId: data.templateId,
      
      jobId: data.jobId,
      projectId: data.projectId,
      contactId: data.contactId,
      
      values: data.values,
      
      signature: data.signature,
      signedAt: data.signature ? new Date() : null,
      signedBy: data.signedBy,
      
      submittedById: data.submittedById,
      submittedAt: new Date(),
      
      status: 'submitted',
    },
    include: {
      template: { select: { name: true, category: true } },
    },
  });
}

/**
 * Validate submission against template
 */
function validateSubmission(fields, values) {
  const errors = [];
  
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
export async function getSubmissions(companyId, { jobId, projectId, contactId, templateId } = {}) {
  const where = { companyId };
  if (jobId) where.jobId = jobId;
  if (projectId) where.projectId = projectId;
  if (contactId) where.contactId = contactId;
  if (templateId) where.templateId = templateId;

  return prisma.formSubmission.findMany({
    where,
    include: {
      template: { select: { name: true, category: true, fields: true } },
      submittedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });
}

/**
 * Get single submission
 */
export async function getSubmission(submissionId, companyId) {
  return prisma.formSubmission.findFirst({
    where: { id: submissionId, companyId },
    include: {
      template: true,
      job: { select: { id: true, number: true, title: true } },
      project: { select: { id: true, number: true, name: true } },
      contact: { select: { id: true, name: true } },
      submittedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

/**
 * Update submission (edit values)
 */
export async function updateSubmission(submissionId, companyId, data) {
  return prisma.formSubmission.updateMany({
    where: { id: submissionId, companyId },
    data: {
      values: data.values,
      updatedAt: new Date(),
    },
  });
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
