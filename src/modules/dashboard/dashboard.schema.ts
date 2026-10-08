import { z } from 'zod';

export const dateRangeQuerySchema = z.object({
  dateRange: z.enum(['7days', '30days', 'currentMonth', '3months', '6months', '12months', 'custom']).optional().default('30days'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD').optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(10),
});

export const revenueTrendsQuerySchema = z.object({
  year: z.coerce.number().min(2020).max(2050).optional().default(() => new Date().getFullYear()),
});

export type DateRangeQueryInput = z.infer<typeof dateRangeQuerySchema>;
export type ActivityQueryInput = z.infer<typeof activityQuerySchema>;
export type RevenueTrendsQueryInput = z.infer<typeof revenueTrendsQuerySchema>;
