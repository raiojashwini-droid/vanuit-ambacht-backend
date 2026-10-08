import { z } from 'zod';

export const quoteItemInputSchema = z.object({
  id: z.string().optional(),
  position: z.number().int().nonnegative().optional().default(1),
  title: z.string().trim().min(1, 'Item title is required'),
  description: z.string().trim().nullable().optional(),
  quantity: z.number().positive('Quantity must be greater than 0').default(1),
  priceInclVat: z.number().nonnegative('Price incl. VAT must be non-negative').optional(),
  unitPriceInclVat: z.number().nonnegative('Price incl. VAT must be non-negative').optional(),
  vatRate: z.number().nonnegative('VAT rate must be non-negative').default(21),
  isIncluded: z.boolean().default(false),
  isStelpost: z.boolean().default(false),
}).transform((val) => ({
  ...val,
  priceInclVat: val.priceInclVat ?? val.unitPriceInclVat ?? 0,
}));

export const diagramSegmentSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  width: z.number().nonnegative(),
});

export const diagramConfigSchema = z.object({
  show: z.boolean().default(true),
  totalWidth: z.number().nonnegative(),
  segments: z.array(diagramSegmentSchema),
}).nullable().optional();

export const specificationLineSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1),
  isOption: z.boolean().default(false),
});

export const specificationSectionSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  lines: z.array(specificationLineSchema),
});

export const instalmentsConfigSchema = z.object({
  count: z.number().int().min(2).max(3).default(2),
  percentages: z.array(z.number().min(0).max(100)),
  labels: z.array(z.string().trim()),
  subtexts: z.array(z.string().trim()).optional(),
}).nullable().optional();

export const letterConfigSchema = z.object({
  salutation: z.string().trim().optional(),
  letterParagraphs: z.array(z.string().trim()).optional(),
  signoffName: z.string().trim().optional(),
  signoffRole: z.string().trim().optional(),
  uspCards: z.array(z.object({
    id: z.number(),
    title: z.string().trim(),
    desc: z.string().trim(),
  })).optional(),
  processSteps: z.array(z.object({
    step: z.string(),
    title: z.string().trim(),
    desc: z.string().trim(),
    badge: z.string().optional(),
  })).optional(),
  approvalTitle: z.string().trim().optional(),
  approvalSubheading: z.string().trim().optional(),
  approvalText: z.string().trim().optional(),
  closingQuote: z.string().trim().optional(),
  closingAuthor: z.string().trim().optional(),
}).nullable().optional();

export const createQuoteSchema = z.object({
  leadId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  acceptedPartnerOfferId: z.string().uuid().optional().nullable(),
  productType: z.string().trim().min(1, 'Product type is required').default('outdoor_kitchen'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD').optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validUntil must be YYYY-MM-DD').optional(),
});

export const updateQuoteSchema = z.object({
  productType: z.string().trim().min(1).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customerId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
});

export const saveDraftVersionSchema = z.object({
  coverTitleLine1: z.string().trim().max(150).optional().nullable(),
  coverTitleLine2: z.string().trim().max(150).optional().nullable(),
  customSubtitle: z.string().trim().optional().nullable(),
  coverPhotos: z.array(z.string()).optional().nullable(),
  dimensionsText: z.string().trim().max(100).optional().nullable(),
  woodType: z.string().trim().max(100).optional().nullable(),
  woodLifespan: z.string().trim().max(100).optional().nullable(),
  optionsTitle: z.string().trim().max(150).optional().nullable(),
  optionsSubtext: z.string().trim().max(150).optional().nullable(),
  deliveryTimeText: z.string().trim().max(100).optional().nullable(),
  deliverySubtext: z.string().trim().max(150).optional().nullable(),
  costPrice: z.number().nonnegative().optional().nullable(),
  marginPercent: z.number().min(0).max(100).optional().nullable(),
  marginAmount: z.number().nonnegative().optional().nullable(),
  lineItems: z.array(quoteItemInputSchema).optional(),
  items: z.array(quoteItemInputSchema).optional(),
  finishTreatment: z.string().trim().max(255).optional().nullable(),
  stelpostDisclaimer: z.string().trim().optional().nullable(),
  vatDisclaimer: z.string().trim().optional().nullable(),
  validityText: z.string().trim().optional().nullable(),
  instalmentsConfig: instalmentsConfigSchema,
  diagramConfig: diagramConfigSchema,
  specificationsOverview: z.array(specificationSectionSchema).optional().nullable(),
  letterConfig: letterConfigSchema,
});

export const publishQuoteSchema = z.object({
  sendEmail: z.boolean().default(false),
  recipientEmail: z.string().email().optional(),
  customMessage: z.string().trim().optional(),
});

export const approveOfferteSchema = z.object({
  signerName: z.string().trim().min(2, 'Full name of signer is required'),
  agreedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the quote terms and conditions' }),
  }),
  signatureSvg: z.string().optional().nullable(),
});

export const rejectOfferteSchema = z.object({
  reason: z.string().trim().min(3, 'Rejection reason must be at least 3 characters'),
  requestedChanges: z.string().trim().optional().nullable(),
});

export const acceptAndConvertSchema = z.object({
  note: z.string().trim().optional().nullable(),
});

export const quoteQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'sent', 'approved', 'declined', 'expired']).optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['newest', 'oldest', 'amount-desc', 'amount-asc', 'customer-asc']).default('newest'),
  customerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
});

export const quoteIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Quote ID or quote number parameter is required'),
});

export const tokenParamSchema = z.object({
  token: z.string().trim().min(1, 'Token or quote number parameter is required'),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;
export type SaveDraftVersionInput = z.infer<typeof saveDraftVersionSchema>;
export type PublishQuoteInput = z.infer<typeof publishQuoteSchema>;
export type ApproveOfferteInput = z.infer<typeof approveOfferteSchema>;
export type RejectOfferteInput = z.infer<typeof rejectOfferteSchema>;
export type AcceptAndConvertInput = z.infer<typeof acceptAndConvertSchema>;
export type QuoteQueryInput = z.infer<typeof quoteQuerySchema>;
