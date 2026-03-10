import { z } from 'zod';

export const emailSchema = z
  .string()
  .email('Invalid email address')
  .min(3)
  .max(255)
  .transform((v) => v.toLowerCase().trim());

export const phoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone number')
  .transform((v) => v.replace(/[\s\-().]/g, ''));

export const priceSchema = z
  .number()
  .nonneg('Price must be non-negative')
  .multipleOf(0.01, 'Price must have at most 2 decimal places');

export const positiveIntSchema = z
  .number()
  .int()
  .positive('Must be a positive integer');

export const percentSchema = z
  .number()
  .min(0, 'Percentage must be >= 0')
  .max(100, 'Percentage must be <= 100');

export const cuidSchema = z.string().min(1, 'ID is required');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const dateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const roleSchema = z.enum(['rep', 'senior_rep', 'manager', 'admin']);

export const quoteStatusSchema = z.enum([
  'draft',
  'presented',
  'signed',
  'closed',
  'expired',
  'cancelled',
]);

export const measurementTypeSchema = z.enum([
  'united_inches',
  'sq_ft',
  'linear_ft',
  'count',
  'fixed',
]);

export const tierSchema = z.enum(['good', 'better', 'best']);

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new (require('./errors').ValidationError)(messages);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new (require('./errors').ValidationError)(messages);
  }
  return result.data;
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(255)
  .transform((v) => v.trim());

export const urlSchema = z.string().url('Invalid URL').max(2048);

export const csvRowSchema = z.record(z.string());
