import { z } from 'zod';
export const bankTxIdParamSchema = z.object({
    id: z.string().uuid('Invalid bank transaction UUID'),
});
export const listBankTxQuerySchema = z.object({
    status: z.enum(['unmatched', 'matched_invoice', 'matched_expense', 'manual_reconciled']).optional(),
    category: z.string().optional(),
    direction: z.enum(['credit', 'debit']).optional(),
    search: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    statementId: z.string().uuid().optional(),
    limit: z.coerce.number().min(1).max(500).default(50),
    page: z.coerce.number().min(1).default(1),
});
export const createManualBankTxSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().min(1, 'Description is required').max(500),
    amount: z.number().positive('Amount must be positive'),
    direction: z.enum(['credit', 'debit']),
    counterName: z.string().min(1).max(255).optional(),
    counterIban: z.string().min(1).max(34).optional(),
    category: z.string().max(100).optional(),
    accountIban: z.string().max(34).optional(),
});
export const reclassifyCategorySchema = z.object({
    category: z.string().min(1, 'Category is required').max(100),
    notes: z.string().max(500).optional(),
});
export const bolSpecificationSchema = z.object({
    grossSales: z.number().nonnegative('Gross sales must be >= 0'),
    commissionFees: z.number().nonnegative('Commission fees must be >= 0'),
    netPayout: z.number().nonnegative('Net payout must be >= 0'),
    sellerOrderCount: z.number().int().nonnegative().optional(),
    notes: z.string().max(500).optional(),
});
export const allocateBankTxSchema = z.object({
    allocations: z.array(z.object({
        invoiceId: z.string().uuid('Invalid invoice UUID'),
        amount: z.number().positive('Allocation amount must be greater than 0'),
        notes: z.string().max(500).optional(),
    })).min(1, 'At least one allocation item is required'),
});
export const importStatementSchema = z.object({
    rawText: z.string().min(5, 'Statement content is required'),
    fileFormat: z.enum(['mt940', 'camt053', 'abn_text']).optional(),
    fileName: z.string().max(255).optional(),
    accountIban: z.string().max(34).optional(),
});
