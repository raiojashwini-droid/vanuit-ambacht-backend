import { z } from 'zod';

export const breakdownItemSchema = z.object({
  sectionTitle: z.string().trim().min(1, 'Section title is required'),
  label: z.string().trim().min(1, 'Item label is required'),
  amount: z.number().nonnegative('Amount must be non-negative'),
});

export const offerBreakdownSchema = z.object({
  transportCost: z.number().nonnegative().nullable().optional(),
  installationCost: z.number().nonnegative().nullable().optional(),
  otherCost: z.number().nonnegative().nullable().optional(),
  items: z.array(breakdownItemSchema).optional(),
}).nullable().optional();

export const dimensionsSchema = z.object({
  lengthCm: z.number().positive().nullable().optional(),
  widthCm: z.number().positive().nullable().optional(),
  heightCm: z.number().positive().nullable().optional(),
  rawText: z.string().nullable().optional(),
}).nullable().optional();

export const materialsSchema = z.object({
  woodType: z.string().nullable().optional(),
  countertop: z.string().nullable().optional(),
  appliances: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
}).nullable().optional();

export const locationAccessSchema = z.object({
  city: z.string().nullable().optional(),
  siteAccess: z.string().nullable().optional(),
  gardenAccessNotes: z.string().nullable().optional(),
}).nullable().optional();

export const createPartnerRequestSchema = z.object({
  leadId: z.string().uuid('Valid Lead UUID is required'),
  partnerId: z.string().uuid('Valid Partner UUID is required'),
  category: z.string().trim().max(100).optional().nullable(),
  productInfo: z.string().trim().optional().nullable(),
  dimensions: dimensionsSchema,
  materials: materialsSchema,
  locationAccess: locationAccessSchema,
  expectedResponseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expectedResponseDate must be in YYYY-MM-DD format'),
  attachmentIds: z.array(z.string().uuid()).optional(),
});

export const updatePartnerRequestSchema = z.object({
  category: z.string().trim().max(100).optional().nullable(),
  productInfo: z.string().trim().optional().nullable(),
  dimensions: dimensionsSchema,
  materials: materialsSchema,
  locationAccess: locationAccessSchema,
  expectedResponseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expectedResponseDate must be in YYYY-MM-DD format').optional(),
});

export const submitOfferSchema = z.object({
  costPrice: z.number().positive('Cost price must be greater than 0'),
  laborHours: z.number().nonnegative().optional().nullable(),
  materialsCost: z.number().nonnegative().optional().nullable(),
  laborCost: z.number().nonnegative().optional().nullable(),
  estimatedLeadTimeWeeks: z.number().int().positive().optional().nullable(),
  partnerNotes: z.string().trim().optional().nullable(),
  breakdown: offerBreakdownSchema,
});

export const selectOfferSchema = z.object({
  offerId: z.string().uuid('Valid Offer UUID is required'),
  internalLockedCost: z.number().positive().optional().nullable(),
  targetMarginPercent: z.number().min(0).max(100).optional().nullable(),
  calculatedSellPrice: z.number().positive().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

export const declineRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Decline reason must be at least 3 characters'),
});

export const partnerRequestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['requested', 'offers_received', 'selected', 'declined', 'cancelled']).optional(),
  search: z.string().trim().optional(),
  leadId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
});

export const requestIdParamSchema = z.object({
  id: z.string().uuid('Invalid request ID format'),
});

export const offerIdParamSchema = z.object({
  id: z.string().uuid('Invalid request ID format'),
  offerId: z.string().uuid('Invalid offer ID format'),
});

export type CreatePartnerRequestInput = z.infer<typeof createPartnerRequestSchema>;
export type UpdatePartnerRequestInput = z.infer<typeof updatePartnerRequestSchema>;
export type SubmitOfferInput = z.infer<typeof submitOfferSchema>;
export type SelectOfferInput = z.infer<typeof selectOfferSchema>;
export type DeclineRequestInput = z.infer<typeof declineRequestSchema>;
export type PartnerRequestQueryInput = z.infer<typeof partnerRequestQuerySchema>;
