import { z } from 'zod';

// Common schemas
export const id = z.string().uuid();
export const email = z.string().email().toLowerCase().trim();
export const phone = z.string().regex(/^[\d\s\-\+\(\)]+$/).optional().nullable();
export const date = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export const money = z.number().nonnegative().multipleOf(0.01);
export const percentage = z.number().min(0).max(100);
export const positiveInt = z.number().int().positive();

// Pagination
export const pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Auth schemas
export const registerSchema = z.object({
  email: email,
  password: z.string().min(8).max(100),
  firstName: z.string().min(1).max(50).trim(),
  lastName: z.string().min(1).max(50).trim(),
  companyName: z.string().min(1).max(100).trim(),
  phone: phone,
});

export const loginSchema = z.object({
  email: email,
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
});

// Contact schemas
export const contactType = z.enum(['lead', 'client', 'subcontractor', 'vendor']);

export const contactSchema = z.object({
  type: contactType,
  name: z.string().min(1).max(100).trim(),
  company: z.string().max(100).trim().optional().nullable(),
  email: email.optional().nullable(),
  phone: phone,
  mobile: phone,
  address: z.string().max(200).trim().optional().nullable(),
  city: z.string().max(100).trim().optional().nullable(),
  state: z.string().max(50).trim().optional().nullable(),
  zip: z.string().max(20).trim().optional().nullable(),
  source: z.string().max(50).trim().optional().nullable(),
  notes: z.string().max(5000).trim().optional().nullable(),
});

// Project schemas
export const projectStatus = z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']);
export const projectType = z.enum(['residential', 'commercial', 'renovation', 'new_construction', 'other']);

export const projectSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).trim().optional().nullable(),
  status: projectStatus.default('planning'),
  type: projectType.optional().nullable(),
  address: z.string().max(200).trim().optional().nullable(),
  city: z.string().max(100).trim().optional().nullable(),
  state: z.string().max(50).trim().optional().nullable(),
  zip: z.string().max(20).trim().optional().nullable(),
  startDate: date.optional().nullable(),
  endDate: date.optional().nullable(),
  estimatedValue: money.optional().nullable(),
  budget: money.optional().nullable(),
  contactId: id.optional().nullable(),
  notes: z.string().max(5000).trim().optional().nullable(),
});

// Job schemas
export const jobStatus = z.enum(['scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled']);
export const jobPriority = z.enum(['low', 'normal', 'high', 'urgent']);

export const jobSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).trim().optional().nullable(),
  status: jobStatus.default('scheduled'),
  priority: jobPriority.default('normal'),
  type: z.string().max(50).trim().optional().nullable(),
  scheduledDate: date.optional().nullable(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  estimatedHours: z.number().positive().optional().nullable(),
  address: z.string().max(200).trim().optional().nullable(),
  city: z.string().max(100).trim().optional().nullable(),
  state: z.string().max(50).trim().optional().nullable(),
  zip: z.string().max(20).trim().optional().nullable(),
  projectId: id.optional().nullable(),
  contactId: id.optional().nullable(),
  assignedToId: id.optional().nullable(),
  notes: z.string().max(5000).trim().optional().nullable(),
});

// Line item schema (used by quotes, invoices, change orders)
export const lineItemSchema = z.object({
  description: z.string().min(1).max(500).trim(),
  quantity: z.number().positive().default(1),
  unitPrice: money.default(0),
  unit: z.string().max(20).trim().optional().nullable(),
});

// Quote schemas
export const quoteStatus = z.enum(['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired']);

export const quoteSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  status: quoteStatus.default('draft'),
  contactId: id.optional().nullable(),
  projectId: id.optional().nullable(),
  expiryDate: date.optional().nullable(),
  taxRate: percentage.default(0),
  discount: money.default(0),
  notes: z.string().max(5000).trim().optional().nullable(),
  terms: z.string().max(5000).trim().optional().nullable(),
  lineItems: z.array(lineItemSchema).optional(),
});

// Invoice schemas
export const invoiceStatus = z.enum(['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'cancelled']);
export const paymentMethod = z.enum(['cash', 'check', 'card', 'bank_transfer', 'other']);

export const invoiceSchema = z.object({
  status: invoiceStatus.default('draft'),
  contactId: id.optional().nullable(),
  projectId: id.optional().nullable(),
  quoteId: id.optional().nullable(),
  dueDate: date.optional().nullable(),
  taxRate: percentage.default(0),
  discount: money.default(0),
  notes: z.string().max(5000).trim().optional().nullable(),
  terms: z.string().max(5000).trim().optional().nullable(),
  lineItems: z.array(lineItemSchema).optional(),
});

export const paymentSchema = z.object({
  amount: money.positive(),
  method: paymentMethod.default('card'),
  reference: z.string().max(100).trim().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
  paidAt: date.optional(),
});

// Time entry schemas
export const timeEntrySchema = z.object({
  date: date,
  hours: z.number().positive().max(24),
  description: z.string().max(500).trim().optional().nullable(),
  billable: z.boolean().default(true),
  hourlyRate: money.optional().nullable(),
  projectId: id.optional().nullable(),
  jobId: id.optional().nullable(),
});

// Expense schemas
export const expenseCategory = z.enum(['materials', 'equipment', 'labor', 'travel', 'permits', 'subcontractor', 'other']);

export const expenseSchema = z.object({
  date: date,
  category: expenseCategory,
  vendor: z.string().max(100).trim().optional().nullable(),
  description: z.string().min(1).max(500).trim(),
  amount: money.positive(),
  billable: z.boolean().default(false),
  receipt: z.string().max(500).optional().nullable(),
  projectId: id.optional().nullable(),
  jobId: id.optional().nullable(),
});

// RFI schemas
export const rfiStatus = z.enum(['open', 'answered', 'closed']);
export const rfiPriority = z.enum(['low', 'normal', 'high', 'urgent']);

export const rfiSchema = z.object({
  projectId: id,
  subject: z.string().min(1).max(200).trim(),
  question: z.string().min(1).max(5000).trim(),
  priority: rfiPriority.default('normal'),
  dueDate: date.optional().nullable(),
  assignedTo: z.string().max(100).trim().optional().nullable(),
});

export const rfiResponseSchema = z.object({
  response: z.string().min(1).max(5000).trim(),
  respondedBy: z.string().min(1).max(100).trim(),
});

// Change order schemas
export const changeOrderStatus = z.enum(['draft', 'submitted', 'under_review', 'approved', 'rejected']);

export const changeOrderSchema = z.object({
  projectId: id,
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).trim().optional().nullable(),
  reason: z.string().max(500).trim().optional().nullable(),
  daysAdded: z.number().int().default(0),
  lineItems: z.array(lineItemSchema).optional(),
});

// Punch list schemas
export const punchListStatus = z.enum(['open', 'in_progress', 'completed', 'verified']);

export const punchListSchema = z.object({
  projectId: id,
  description: z.string().min(1).max(1000).trim(),
  location: z.string().max(200).trim().optional().nullable(),
  priority: rfiPriority.default('normal'),
  assignedTo: z.string().max(100).trim().optional().nullable(),
  dueDate: date.optional().nullable(),
  photos: z.array(z.string()).optional(),
});

// Daily log schemas
export const dailyLogSchema = z.object({
  projectId: id,
  date: date,
  weather: z.string().max(50).trim().optional().nullable(),
  temperature: z.number().optional().nullable(),
  crewSize: positiveInt.optional().nullable(),
  hoursWorked: z.number().positive().max(24).optional().nullable(),
  workPerformed: z.string().max(5000).trim().optional().nullable(),
  materials: z.string().max(2000).trim().optional().nullable(),
  equipment: z.string().max(2000).trim().optional().nullable(),
  delays: z.string().max(2000).trim().optional().nullable(),
  safetyNotes: z.string().max(2000).trim().optional().nullable(),
  visitors: z.string().max(1000).trim().optional().nullable(),
});

// Inspection schemas
export const inspectionStatus = z.enum(['scheduled', 'passed', 'failed', 'cancelled']);
export const inspectionType = z.enum(['Foundation', 'Framing', 'Electrical', 'Plumbing', 'HVAC', 'Insulation', 'Drywall', 'Final', 'Other']);

export const inspectionSchema = z.object({
  projectId: id,
  type: inspectionType,
  scheduledDate: date.optional().nullable(),
  inspector: z.string().max(100).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
});

// Bid schemas
export const bidStatus = z.enum(['draft', 'submitted', 'under_review', 'won', 'lost', 'withdrawn']);
export const bidType = z.enum(['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build', 'other']);

export const bidSchema = z.object({
  projectName: z.string().min(1).max(200).trim(),
  client: z.string().max(200).trim().optional().nullable(),
  bidType: bidType.default('lump_sum'),
  dueDate: date.optional().nullable(),
  estimatedValue: money.optional().nullable(),
  bidAmount: money.optional().nullable(),
  bondRequired: z.boolean().default(false),
  scope: z.string().max(5000).trim().optional().nullable(),
  notes: z.string().max(5000).trim().optional().nullable(),
});

// Team member schemas
export const teamMemberSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: email.optional().nullable(),
  phone: phone,
  role: z.string().max(50).trim().optional().nullable(),
  department: z.string().max(50).trim().optional().nullable(),
  hourlyRate: money.optional().nullable(),
  startDate: date.optional().nullable(),
  emergencyContact: z.string().max(200).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
});

// Company schemas
export const companySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  email: email.optional().nullable(),
  phone: phone,
  address: z.string().max(200).trim().optional().nullable(),
  city: z.string().max(100).trim().optional().nullable(),
  state: z.string().max(50).trim().optional().nullable(),
  zip: z.string().max(20).trim().optional().nullable(),
  website: z.string().url().optional().nullable(),
  licenseNumber: z.string().max(50).trim().optional().nullable(),
  taxId: z.string().max(50).trim().optional().nullable(),
});

// Validation helper
export function validate(schema, data) {
  return schema.parse(data);
}

export function safeParse(schema, data) {
  return schema.safeParse(data);
}

export default {
  // Common
  id,
  email,
  phone,
  date,
  money,
  percentage,
  positiveInt,
  pagination,
  lineItemSchema,
  
  // Auth
  registerSchema,
  loginSchema,
  changePasswordSchema,
  resetPasswordSchema,
  
  // Entities
  contactSchema,
  projectSchema,
  jobSchema,
  quoteSchema,
  invoiceSchema,
  paymentSchema,
  timeEntrySchema,
  expenseSchema,
  rfiSchema,
  rfiResponseSchema,
  changeOrderSchema,
  punchListSchema,
  dailyLogSchema,
  inspectionSchema,
  bidSchema,
  teamMemberSchema,
  companySchema,
  
  // Helpers
  validate,
  safeParse,
};
