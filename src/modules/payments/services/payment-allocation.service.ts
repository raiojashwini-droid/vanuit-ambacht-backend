import { db } from '../../../db/index.js';
import {
  payments,
  paymentAllocations,
  bankTransactions,
  invoices,
  projectMilestones,
  journalEntries,
} from '../../../db/schema.js';
import { eq, and, sql, ilike, desc } from 'drizzle-orm';
import { PaymentError } from '../payment.types.js';
import type { JwtTokenPayload } from '../../../types/auth.types.js';
import type { AllocateBankTxInput, BankTxDto } from '../../bank/bank.types.js';
import { accountingService } from '../../accounting/accounting.service.js';

export class PaymentAllocationService {
  /**
   * Generates sequential payment number: PAY-YYYY-XXX
   */
  async generatePaymentNumber(offset: number = 0, executor: any = db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PAY-${year}-`;

    const [latest] = await executor
      .select({ paymentNumber: payments.paymentNumber })
      .from(payments)
      .where(ilike(payments.paymentNumber, `${prefix}%`))
      .orderBy(desc(payments.paymentNumber))
      .limit(1);

    const baseSeq = latest
      ? parseInt(latest.paymentNumber.replace(prefix, ''), 10) || 0
      : 0;
    const nextSeq = baseSeq + 1 + offset;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Recalculates invoice status based on all succeeded payments
   * Uses transactional client `tx`
   */
  async recalculateInvoiceStatus(
    tx: any,
    invoiceId: string,
    paidDate?: string
  ): Promise<{ status: 'paid' | 'partially_paid' | 'sent'; totalPaid: number; isFullyPaid: boolean }> {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!inv) {
      throw new PaymentError(`Invoice ${invoiceId} not found`, 404, 'INVOICE_NOT_FOUND');
    }

    if (inv.status === 'credited') {
      return { status: 'sent', totalPaid: 0, isFullyPaid: false };
    }

    const totalIncl = parseFloat(inv.totalInclVat || '0');

    const invPayments = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'succeeded')));

    const currentPaidSum = invPayments.reduce(
      (sum: number, p: any) => sum + parseFloat(p.amount || '0'),
      0
    );

    const isFullyPaid = currentPaidSum >= totalIncl;
    const newStatus: 'paid' | 'partially_paid' | 'sent' = isFullyPaid
      ? 'paid'
      : currentPaidSum > 0
      ? 'partially_paid'
      : 'sent';

    const effectivePaidDate = isFullyPaid
      ? paidDate || new Date().toISOString().split('T')[0]
      : null;

    await tx
      .update(invoices)
      .set({
        status: newStatus,
        paidDate: effectivePaidDate,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    // Milestone completion synchronization
    if (inv.milestoneId) {
      if (isFullyPaid) {
        await tx
          .update(projectMilestones)
          .set({
            status: 'completed',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(projectMilestones.id, inv.milestoneId));
      } else {
        // If unallocated and no longer fully paid, reset milestone to in_progress
        const [m] = await tx
          .select()
          .from(projectMilestones)
          .where(eq(projectMilestones.id, inv.milestoneId))
          .limit(1);

        if (m && m.status === 'completed') {
          await tx
            .update(projectMilestones)
            .set({
              status: 'in_progress',
              completedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(projectMilestones.id, inv.milestoneId));
        }
      }
    }

    return {
      status: newStatus,
      totalPaid: Math.round(currentPaidSum * 100) / 100,
      isFullyPaid,
    };
  }

  /**
   * Allocates a bank transaction to one or more invoices
   * Atomic operation using `await db.transaction(async (tx) => { ... })`
   * NEVER uses global db inside transaction block
   */
  async allocate(
    bankTxId: string,
    input: AllocateBankTxInput,
    user: JwtTokenPayload
  ): Promise<{
    bankTxId: string;
    allocatedCount: number;
    totalAllocated: number;
    reconciliationStatus: string;
  }> {
    if (user.role !== 'admin') {
      throw new PaymentError('Only administrators can allocate bank transactions', 403, 'FORBIDDEN');
    }

    if (!input.allocations || input.allocations.length === 0) {
      throw new PaymentError('At least one allocation item is required', 400, 'EMPTY_ALLOCATIONS');
    }

    const [bankTx] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, bankTxId))
      .limit(1);

    if (!bankTx) {
      throw new PaymentError('Bank transaction not found', 404, 'BANK_TX_NOT_FOUND');
    }

    if (bankTx.direction !== 'credit') {
      throw new PaymentError('Only incoming credit transactions can be allocated to invoices', 400, 'INVALID_TX_DIRECTION');
    }

    const bankTxAmount = parseFloat(bankTx.amount || '0');

    // Execute atomic transaction
    return await db.transaction(async (tx) => {
      // 1. Check existing allocations on this bank transaction
      const existingAllocations = await tx
        .select()
        .from(paymentAllocations)
        .where(eq(paymentAllocations.bankTransactionId, bankTxId));

      const existingAllocatedSum = existingAllocations.reduce(
        (sum: number, a: any) => sum + parseFloat(a.allocatedAmount || '0'),
        0
      );

      const requestedTotal = input.allocations.reduce((sum, item) => sum + item.amount, 0);
      const remainingBankAmount = Math.round((bankTxAmount - existingAllocatedSum) * 100) / 100;

      // Over-allocation prevention (bank transaction total)
      if (requestedTotal > remainingBankAmount + 0.01) {
        throw new PaymentError(
          `Allocated amount (€${requestedTotal.toFixed(2)}) exceeds available bank transaction credit (€${remainingBankAmount.toFixed(2)})`,
          400,
          'OVER_ALLOCATION_EXCEEDS_BANK_AMOUNT'
        );
      }

      let offset = 0;
      for (const item of input.allocations) {
        if (item.amount <= 0) {
          throw new PaymentError('Allocation amount must be greater than 0', 400, 'INVALID_AMOUNT');
        }

        const [inv] = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.id, item.invoiceId))
          .limit(1);

        if (!inv) {
          throw new PaymentError(`Invoice ${item.invoiceId} not found`, 404, 'INVOICE_NOT_FOUND');
        }

        if (inv.status === 'credited') {
          throw new PaymentError(`Cannot allocate payment to credited invoice ${inv.invoiceNumber}`, 400, 'INVOICE_CREDITED');
        }

        const totalIncl = parseFloat(inv.totalInclVat || '0');

        // Current payments on target invoice
        const invPayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.invoiceId, item.invoiceId), eq(payments.status, 'succeeded')));

        const currentPaidSum = invPayments.reduce(
          (sum: number, p: any) => sum + parseFloat(p.amount || '0'),
          0
        );

        const currentOutstanding = Math.max(0, Math.round((totalIncl - currentPaidSum) * 100) / 100);

        // Over-payment prevention (invoice outstanding balance)
        if (item.amount > currentOutstanding + 0.01) {
          throw new PaymentError(
            `Allocation amount (€${item.amount.toFixed(2)}) exceeds invoice ${inv.invoiceNumber} outstanding balance (€${currentOutstanding.toFixed(2)})`,
            400,
            'OVER_PAYMENT_EXCEEDS_INVOICE_BALANCE'
          );
        }

        // Generate sequential payment number
        const paymentNumber = await this.generatePaymentNumber(offset++, tx);
        const todayStr = bankTx.transactionDate || new Date().toISOString().split('T')[0];

        // 2. Insert payment record for target invoice
        const [payment] = await tx
          .insert(payments)
          .values({
            paymentNumber,
            invoiceId: item.invoiceId,
            amount: sql`${item.amount}::numeric`,
            paymentMethod: 'bank_transfer_abn',
            paymentReference: item.notes || `Bank Settlement: ${bankTx.bankTxId} (${inv.invoiceNumber})`,
            status: 'succeeded',
            paidAt: new Date(todayStr),
          })
          .returning();

        // 3. Insert payment allocation linking payment to bank transaction
        await tx.insert(paymentAllocations).values({
          paymentId: payment.id,
          bankTransactionId: bankTxId,
          allocatedAmount: sql`${item.amount}::numeric`,
          notes: item.notes || null,
        });

        // 4. Recalculate invoice status & milestone completion
        await this.recalculateInvoiceStatus(tx, item.invoiceId, todayStr);

        // MODULE 8 HOOK: Post bank receipt double-entry for allocated payment
        await accountingService.postPaymentReceiptEntry(payment.id, tx);
      }

      // 5. Update bank transaction reconciliation status
      await tx
        .update(bankTransactions)
        .set({
          reconciliationStatus: 'matched_invoice',
          reviewReason: null,
        })
        .where(eq(bankTransactions.id, bankTxId));

      return {
        bankTxId,
        allocatedCount: input.allocations.length,
        totalAllocated: Math.round(requestedTotal * 100) / 100,
        reconciliationStatus: 'matched_invoice',
      };
    });
  }

  /**
   * Reverts all allocations on a bank transaction
   * Atomic operation using `tx`
   */
  async unallocate(
    bankTxId: string,
    user: JwtTokenPayload
  ): Promise<{ bankTxId: string; unallocatedCount: number; message: string }> {
    if (user.role !== 'admin') {
      throw new PaymentError('Only administrators can unallocate bank transactions', 403, 'FORBIDDEN');
    }

    const [bankTx] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, bankTxId))
      .limit(1);

    if (!bankTx) {
      throw new PaymentError('Bank transaction not found', 404, 'BANK_TX_NOT_FOUND');
    }

    return await db.transaction(async (tx) => {
      // 1. Find all allocations for this bank transaction
      const allocations = await tx
        .select({
          allocationId: paymentAllocations.id,
          paymentId: paymentAllocations.paymentId,
          invoiceId: payments.invoiceId,
        })
        .from(paymentAllocations)
        .leftJoin(payments, eq(paymentAllocations.paymentId, payments.id))
        .where(eq(paymentAllocations.bankTransactionId, bankTxId));

      if (allocations.length === 0) {
        throw new PaymentError('No active allocations found for this bank transaction', 400, 'NO_ALLOCATIONS');
      }

      const affectedInvoiceIds = new Set<string>();

      for (const alloc of allocations) {
        if (alloc.invoiceId) {
          affectedInvoiceIds.add(alloc.invoiceId);
        }

        // MODULE 8 HOOK: Reverse posted journal entry for this payment if it exists
        const [je] = await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.paymentId, alloc.paymentId),
              eq(journalEntries.status, 'posted'),
              eq(journalEntries.isReversal, false)
            )
          )
          .limit(1);

        if (je) {
          await accountingService.reverseJournalEntry(
            je.id,
            `Bank transaction ${bankTx.bankTxId} unallocated`,
            undefined,
            user?.sub || null,
            tx
          );
        }

        // Delete allocation
        await tx.delete(paymentAllocations).where(eq(paymentAllocations.id, alloc.allocationId));

        // Delete linked payment
        await tx.delete(payments).where(eq(payments.id, alloc.paymentId));
      }

      // 2. Recalculate status for all affected invoices
      for (const invId of affectedInvoiceIds) {
        await this.recalculateInvoiceStatus(tx, invId);
      }

      // 3. Reset bank transaction reconciliation status
      await tx
        .update(bankTransactions)
        .set({
          reconciliationStatus: 'unmatched',
          matchReason: 'Unallocated by admin',
        })
        .where(eq(bankTransactions.id, bankTxId));

      return {
        bankTxId,
        unallocatedCount: allocations.length,
        message: `Successfully unallocated ${allocations.length} payment(s) from bank transaction ${bankTx.bankTxId}`,
      };
    });
  }
}

export const paymentAllocationService = new PaymentAllocationService();
