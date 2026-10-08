import { z } from 'zod';

export const invoiceIdParamSchema = z.object({
  id: z.string().uuid('Invalid invoice UUID'),
});

export const projectInvoicesParamSchema = z.object({
  id: z.string().uuid('Invalid project UUID'),
});

export const invoiceItemInputSchema = z.object({
  position: z.number().int().min(1).optional(),
  description: z.string().min(1, 'Item description is required'),
  subtext: z.string().optional().nullable(),
  quantity: z.number().positive('Quantity must be greater than 0').default(1),
  unitPriceExclVat: z.number().min(0, 'Unit price must be non-negative').optional(),
  unitPriceInclVat: z.number().min(0, 'Unit price must be non-negative').optional(),
  vatRate: z.number().min(0).max(100).default(21.00),
  isIncluded: z.boolean().default(false),
});

export const createInvoiceSchema = z.object({
  projectId: z.string().uuid('Invalid project UUID'),
  customerId: z.string().uuid('Invalid customer UUID').optional(),
  quoteId: z.string().uuid('Invalid quote UUID').optional().nullable(),
  milestoneId: z.string().uuid('Invalid milestone UUID').optional().nullable(),
  invoiceType: z
    .enum(['down_payment_upfront', 'final_completion', 'interim_progress', 'full_amount', 'credit_note'])
    .default('down_payment_upfront'),
  status: z.enum(['draft', 'sent']).default('draft'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD').optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD').optional(),
  paymentTermsDays: z.number().int().min(1).max(180).default(14),
  notes: z.string().optional().nullable(),
  items: z.array(invoiceItemInputSchema).min(1, 'At least 1 invoice item is required'),
});

export const updateInvoiceSchema = z.object({
  projectId: z.string().uuid('Invalid project UUID').optional(),
  quoteId: z.string().uuid('Invalid quote UUID').optional().nullable(),
  milestoneId: z.string().uuid('Invalid milestone UUID').optional().nullable(),
  invoiceType: z
    .enum(['down_payment_upfront', 'final_completion', 'interim_progress', 'full_amount'])
    .optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD').optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD').optional(),
  paymentTermsDays: z.number().int().min(1).max(180).optional(),
  notes: z.string().optional().nullable(),
  items: z.array(invoiceItemInputSchema).min(1, 'At least 1 invoice item is required').optional(),
});

export const markPaidSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paidDate must be YYYY-MM-DD').optional(),
  paymentMethod: z
    .enum(['ideal_mollie', 'bank_transfer_abn', 'credit_card', 'cash'])
    .default('bank_transfer_abn'),
  paymentReference: z.string().max(150).optional(),
  amount: z.number().positive('Payment amount must be positive').optional(),
  notes: z.string().optional().nullable(),
});

export const creditNoteSchema = z.object({
  reason: z.string().min(3, 'A clear reason for crediting the invoice is required'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD').optional(),
  notes: z.string().optional().nullable(),
});

export const invoiceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'credited', 'all'])
    .default('all'),
  customerId: z.string().uuid('Invalid customer UUID').optional(),
  projectId: z.string().uuid('Invalid project UUID').optional(),
  search: z.string().optional(),
  sortBy: z.enum(['newest', 'oldest', 'amount-desc', 'amount-asc']).default('newest'),
});
