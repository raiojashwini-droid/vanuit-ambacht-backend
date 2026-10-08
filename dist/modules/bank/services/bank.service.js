import { db } from '../../../db/index.js';
import { bankTransactions, paymentAllocations, payments, invoices, } from '../../../db/schema.js';
import { eq, and, sql, desc, or, ilike, gte, lte } from 'drizzle-orm';
import { PaymentError } from '../../payments/payment.types.js';
import { categorizeBankTransaction } from './bank-categorizer.service.js';
import { accountingService } from '../../accounting/accounting.service.js';
export class BankService {
    /**
     * Lists bank transactions with comprehensive filtering and pagination
     * Admin only
     */
    async listTransactions(query, user) {
        if (user.role !== 'admin') {
            throw new PaymentError('Only administrators can access bank transactions', 403, 'FORBIDDEN');
        }
        const limit = query.limit || 50;
        const page = query.page || 1;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (query.status) {
            conditions.push(eq(bankTransactions.reconciliationStatus, query.status));
        }
        if (query.category) {
            conditions.push(eq(bankTransactions.category, query.category));
        }
        if (query.direction) {
            conditions.push(eq(bankTransactions.direction, query.direction));
        }
        if (query.statementId) {
            conditions.push(eq(bankTransactions.statementId, query.statementId));
        }
        if (query.startDate) {
            conditions.push(gte(bankTransactions.transactionDate, query.startDate));
        }
        if (query.endDate) {
            conditions.push(lte(bankTransactions.transactionDate, query.endDate));
        }
        if (query.search && query.search.trim()) {
            const q = `%${query.search.trim()}%`;
            conditions.push(or(ilike(bankTransactions.description, q), ilike(bankTransactions.counterName, q), ilike(bankTransactions.counterIban, q), ilike(bankTransactions.bankTxId, q)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [{ count }] = await db
            .select({ count: sql `count(*)::int` })
            .from(bankTransactions)
            .where(whereClause);
        const rows = await db
            .select()
            .from(bankTransactions)
            .where(whereClause)
            .orderBy(desc(bankTransactions.transactionDate), desc(bankTransactions.createdAt))
            .limit(limit)
            .offset(offset);
        // Fetch allocations for matched transactions
        const txIds = rows.map((r) => r.id);
        const allocationsMap = new Map();
        if (txIds.length > 0) {
            const allocRows = await db
                .select({
                id: paymentAllocations.id,
                paymentId: paymentAllocations.paymentId,
                bankTransactionId: paymentAllocations.bankTransactionId,
                allocatedAmount: paymentAllocations.allocatedAmount,
                allocatedAt: paymentAllocations.allocatedAt,
                notes: paymentAllocations.notes,
                paymentNumber: payments.paymentNumber,
                invoiceId: payments.invoiceId,
                invoiceNumber: invoices.invoiceNumber,
            })
                .from(paymentAllocations)
                .leftJoin(payments, eq(paymentAllocations.paymentId, payments.id))
                .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
                .where(sql `${paymentAllocations.bankTransactionId} IN ${txIds}`);
            for (const a of allocRows) {
                const list = allocationsMap.get(a.bankTransactionId) || [];
                list.push({
                    id: a.id,
                    paymentId: a.paymentId,
                    paymentNumber: a.paymentNumber || '',
                    invoiceId: a.invoiceId || '',
                    invoiceNumber: a.invoiceNumber || '',
                    allocatedAmount: parseFloat(a.allocatedAmount || '0'),
                    allocatedAt: a.allocatedAt ? new Date(a.allocatedAt).toISOString() : new Date().toISOString(),
                    notes: a.notes,
                });
                allocationsMap.set(a.bankTransactionId, list);
            }
        }
        const dtos = rows.map((r) => ({
            id: r.id,
            statementId: r.statementId,
            bankTxId: r.bankTxId,
            accountIban: r.accountIban,
            transactionDate: String(r.transactionDate).split('T')[0],
            valueDate: r.valueDate ? String(r.valueDate).split('T')[0] : null,
            counterIban: r.counterIban,
            counterName: r.counterName,
            amount: parseFloat(r.amount || '0'),
            direction: r.direction,
            description: r.description,
            remittanceInfo: r.remittanceInfo,
            category: r.category,
            matchReason: r.matchReason,
            reviewReason: r.reviewReason,
            isInternalTransfer: r.isInternalTransfer,
            bolSpecification: r.bolSpecification || null,
            reconciliationStatus: r.reconciliationStatus,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
            allocations: allocationsMap.get(r.id) || [],
        }));
        return {
            data: dtos,
            meta: {
                total: count,
                page,
                limit,
            },
        };
    }
    /**
     * Retrieves single bank transaction dossier
     * Admin only
     */
    async getById(id, user) {
        if (user.role !== 'admin') {
            throw new PaymentError('Only administrators can access bank transactions', 403, 'FORBIDDEN');
        }
        const [r] = await db
            .select()
            .from(bankTransactions)
            .where(eq(bankTransactions.id, id))
            .limit(1);
        if (!r) {
            throw new PaymentError('Bank transaction not found', 404, 'NOT_FOUND');
        }
        const allocRows = await db
            .select({
            id: paymentAllocations.id,
            paymentId: paymentAllocations.paymentId,
            bankTransactionId: paymentAllocations.bankTransactionId,
            allocatedAmount: paymentAllocations.allocatedAmount,
            allocatedAt: paymentAllocations.allocatedAt,
            notes: paymentAllocations.notes,
            paymentNumber: payments.paymentNumber,
            invoiceId: payments.invoiceId,
            invoiceNumber: invoices.invoiceNumber,
        })
            .from(paymentAllocations)
            .leftJoin(payments, eq(paymentAllocations.paymentId, payments.id))
            .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
            .where(eq(paymentAllocations.bankTransactionId, id));
        const allocations = allocRows.map((a) => ({
            id: a.id,
            paymentId: a.paymentId,
            paymentNumber: a.paymentNumber || '',
            invoiceId: a.invoiceId || '',
            invoiceNumber: a.invoiceNumber || '',
            allocatedAmount: parseFloat(a.allocatedAmount || '0'),
            allocatedAt: a.allocatedAt ? new Date(a.allocatedAt).toISOString() : new Date().toISOString(),
            notes: a.notes,
        }));
        return {
            id: r.id,
            statementId: r.statementId,
            bankTxId: r.bankTxId,
            accountIban: r.accountIban,
            transactionDate: String(r.transactionDate).split('T')[0],
            valueDate: r.valueDate ? String(r.valueDate).split('T')[0] : null,
            counterIban: r.counterIban,
            counterName: r.counterName,
            amount: parseFloat(r.amount || '0'),
            direction: r.direction,
            description: r.description,
            remittanceInfo: r.remittanceInfo,
            category: r.category,
            matchReason: r.matchReason,
            reviewReason: r.reviewReason,
            isInternalTransfer: r.isInternalTransfer,
            bolSpecification: r.bolSpecification || null,
            reconciliationStatus: r.reconciliationStatus,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
            allocations,
        };
    }
    /**
     * Creates a manual bank transaction entry
     * Admin only
     */
    async createManualTransaction(input, user) {
        if (user.role !== 'admin') {
            throw new PaymentError('Only administrators can create bank entries', 403, 'FORBIDDEN');
        }
        const defaultIban = input.accountIban || 'NL44ABNA0987654321';
        const bankTxId = `TXN-MAN-${Date.now().toString().slice(-6)}`;
        const catResult = categorizeBankTransaction({
            counterName: input.counterName,
            counterIban: input.counterIban,
            description: input.description,
            amount: input.amount,
            direction: input.direction,
        });
        const finalCategory = input.category || catResult.category;
        const [row] = await db
            .insert(bankTransactions)
            .values({
            bankTxId,
            accountIban: defaultIban,
            transactionDate: input.date,
            valueDate: input.valueDate || input.date,
            counterIban: input.counterIban || null,
            counterName: input.counterName || null,
            amount: sql `${input.amount}::numeric`,
            direction: input.direction,
            description: input.description,
            remittanceInfo: input.description,
            category: finalCategory,
            matchReason: `Manual Entry: ${finalCategory}`,
            reviewReason: null,
            isInternalTransfer: catResult.isInternalTransfer,
            reconciliationStatus: 'unmatched',
        })
            .returning();
        return this.getById(row.id, user);
    }
    /**
     * Reclassifies category for a bank transaction
     * Admin only
     */
    async reclassifyCategory(id, input, user) {
        if (user.role !== 'admin') {
            throw new PaymentError('Only administrators can reclassify bank transactions', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(bankTransactions)
            .where(eq(bankTransactions.id, id))
            .limit(1);
        if (!existing) {
            throw new PaymentError('Bank transaction not found', 404, 'NOT_FOUND');
        }
        await db
            .update(bankTransactions)
            .set({
            category: input.category,
            matchReason: `Manual Review — ${input.category}${input.notes ? ` (${input.notes})` : ''}`,
            reviewReason: null,
            reconciliationStatus: existing.reconciliationStatus === 'unmatched'
                ? 'manual_reconciled'
                : existing.reconciliationStatus,
        })
            .where(eq(bankTransactions.id, id));
        // MODULE 8 HOOK: Post expense entry for categorized bank debit
        await accountingService.postBankCategorizationEntry(id);
        return this.getById(id, user);
    }
    /**
     * Attaches Bol.com sales and commission specification to transaction
     * Admin only
     */
    async setBolSpecification(id, input, user) {
        if (user.role !== 'admin') {
            throw new PaymentError('Only administrators can set Bol.com specifications', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(bankTransactions)
            .where(eq(bankTransactions.id, id))
            .limit(1);
        if (!existing) {
            throw new PaymentError('Bank transaction not found', 404, 'NOT_FOUND');
        }
        // 3-way check: Gross - Commission = Net
        const calculatedNet = Math.round((input.grossSales - input.commissionFees) * 100) / 100;
        const txAmount = parseFloat(existing.amount || '0');
        if (Math.abs(calculatedNet - txAmount) > 0.5) {
            throw new PaymentError(`Bol.com net calculation (€${calculatedNet.toFixed(2)}) does not match bank transaction payout amount (€${txAmount.toFixed(2)})`, 400, 'BOL_SPEC_MISMATCH');
        }
        await db
            .update(bankTransactions)
            .set({
            category: 'Revenue – bol.com',
            bolSpecification: input,
            matchReason: `Bol.com Seller Reconciliation (Gross €${input.grossSales} - Fee €${input.commissionFees} = Net €${input.netPayout})`,
            reviewReason: null,
            reconciliationStatus: 'matched_expense',
        })
            .where(eq(bankTransactions.id, id));
        // MODULE 8 HOOK: Post 3-way balanced Bol.com journal entry
        await accountingService.postBankCategorizationEntry(id);
        return this.getById(id, user);
    }
}
export const bankService = new BankService();
