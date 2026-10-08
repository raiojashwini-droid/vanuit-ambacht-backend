import { z } from 'zod';

export const createChartOfAccountSchema = z.object({
  accountCode: z.string().min(3).max(10),
  accountName: z.string().min(2).max(150),
  accountType: z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']),
  standardVatRule: z.string().max(50).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const updateChartOfAccountSchema = z.object({
  accountName: z.string().min(2).max(150).optional(),
  accountType: z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']).optional(),
  standardVatRule: z.string().max(50).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const journalEntryLineInputSchema = z.object({
  accountCode: z.string().min(3).max(10),
  debit: z.number().min(0, 'Debit must be non-negative'),
  credit: z.number().min(0, 'Credit must be non-negative'),
  vatRule: z.string().max(50).optional().nullable(),
  lineDescription: z.string().max(255).optional().nullable(),
}).refine(
  (data) => (data.debit > 0 && data.credit === 0) || (data.credit > 0 && data.debit === 0),
  { message: 'A journal entry line must have either debit > 0 or credit > 0, never both or neither' }
);

export const createJournalEntrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  entryType: z.enum([
    'sales_invoice',
    'bank_receipt',
    'bol_reconciliation',
    'purchase_invoice',
    'general_journal',
    'opening_balance',
  ]),
  description: z.string().min(2, 'Description is required'),
  status: z.enum(['draft', 'posted']).optional().default('posted'),
  invoiceId: z.string().uuid().optional().nullable(),
  paymentId: z.string().uuid().optional().nullable(),
  bankTransactionId: z.string().uuid().optional().nullable(),
  lines: z.array(journalEntryLineInputSchema).min(2, 'A journal entry must have at least 2 lines'),
});

export const reverseJournalEntrySchema = z.object({
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  reason: z.string().min(2, 'Reason for reversal is required'),
});

export const generalLedgerQuerySchema = z.object({
  accountCode: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const trialBalanceQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const vatReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035).default(2026),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
});

export const profitLossQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035).default(2026),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const balanceSheetQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateFiscalLockSchema = z.object({
  fiscalLockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const listJournalEntriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'posted', 'reversed']).optional(),
  entryType: z.enum([
    'sales_invoice',
    'bank_receipt',
    'bol_reconciliation',
    'purchase_invoice',
    'general_journal',
    'opening_balance',
  ]).optional(),
});
