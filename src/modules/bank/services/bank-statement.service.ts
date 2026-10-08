import { db } from '../../../db/index.js';
import { bankStatements, bankTransactions, payments, paymentAllocations } from '../../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { PaymentError } from '../../payments/payment.types.js';
import type { JwtTokenPayload } from '../../../types/auth.types.js';
import type { StatementImportResultDto } from '../bank.types.js';
import { calculateContentHash, validateStatementIntegrity } from '../parsers/statement.validator.js';
import { parseMt940 } from '../parsers/mt940.parser.js';
import { parseCamt053 } from '../parsers/camt053.parser.js';
import { parseAbnText } from '../parsers/abn-text.parser.js';
import { categorizeBankTransaction } from './bank-categorizer.service.js';
import { orderMatcherService } from './order-matcher.service.js';
import { paymentAllocationService } from '../../payments/services/payment-allocation.service.js';

export class BankStatementService {
  /**
   * Imports a bank statement file (MT940, CAMT.053 XML, or ABN text)
   * Enforces checksum, duplicate protection, and atomic transaction
   */
  async importStatement(
    input: {
      rawText: string;
      fileFormat?: 'mt940' | 'camt053' | 'abn_text';
      fileName?: string;
      accountIban?: string;
    },
    user: JwtTokenPayload
  ): Promise<StatementImportResultDto> {
    if (user.role !== 'admin') {
      throw new PaymentError('Only administrators can import bank statements', 403, 'FORBIDDEN');
    }

    const rawContent = input.rawText.trim();
    if (!rawContent) {
      throw new PaymentError('Statement content cannot be empty', 400, 'EMPTY_STATEMENT');
    }

    // 1. Calculate SHA-256 hash for duplicate file detection
    const fileHash = calculateContentHash(rawContent);

    const [existingStatement] = await db
      .select({ id: bankStatements.id, fileName: bankStatements.fileName })
      .from(bankStatements)
      .where(eq(bankStatements.fileHash, fileHash))
      .limit(1);

    if (existingStatement) {
      throw new PaymentError(
        `This bank statement has already been imported (${existingStatement.fileName})`,
        409,
        'DUPLICATE_STATEMENT'
      );
    }

    // 2. Select appropriate parser based on format or content sniffing
    let format = input.fileFormat;
    if (!format) {
      if (rawContent.startsWith(':20:') || rawContent.includes(':61:')) {
        format = 'mt940';
      } else if (
        rawContent.includes('<?xml') ||
        rawContent.includes('<BkToCstmrStmt>') ||
        rawContent.includes('<Stmt>')
      ) {
        format = 'camt053';
      } else {
        format = 'abn_text';
      }
    }

    const defaultIban = input.accountIban || 'NL44ABNA0987654321';

    let parsedResult: ReturnType<typeof parseMt940>;
    try {
      if (format === 'mt940') {
        parsedResult = parseMt940(rawContent, defaultIban);
      } else if (format === 'camt053') {
        parsedResult = parseCamt053(rawContent, defaultIban);
      } else {
        parsedResult = parseAbnText(rawContent, defaultIban);
      }
    } catch (err: any) {
      throw new PaymentError(`Failed to parse bank statement: ${err.message}`, 400, 'PARSE_ERROR');
    }

    const { header, transactions } = parsedResult;
    header.fileName = input.fileName || (format === 'mt940' ? 'statement.sta' : format === 'camt053' ? 'statement.xml' : 'statement.txt');

    // 3. Validate Statement Integrity & Checksum
    const validation = validateStatementIntegrity(header, transactions);
    if (!validation.isValid) {
      throw new PaymentError(
        `Statement validation failed: ${validation.errors.join('; ')}`,
        400,
        'STATEMENT_CHECKSUM_FAILED'
      );
    }

    // 4. Atomic Database Transaction: Roll back everything if any operation fails
    return await db.transaction(async (tx) => {
      // Insert statement master record
      const [statement] = await tx
        .insert(bankStatements)
        .values({
          statementIdentifier: header.statementIdentifier,
          fileFormat: format,
          fileName: header.fileName,
          fileHash,
          accountIban: header.accountIban,
          openingBalance: sql`${header.openingBalance}::numeric`,
          closingBalance: sql`${header.closingBalance}::numeric`,
          totalCredits: sql`${validation.totalCredits}::numeric`,
          totalDebits: sql`${validation.totalDebits}::numeric`,
          transactionCount: transactions.length,
          uploadedByUserId: user.sub,
        })
        .returning();

      let autoMatchedCount = 0;
      let autoCategorizedCount = 0;
      let reviewCount = 0;
      let paymentSeqOffset = 0;

      for (const t of transactions) {
        // Step A: Decision tree categorization
        const catResult = categorizeBankTransaction({
          counterName: t.counterName,
          counterIban: t.counterIban,
          description: t.description,
          remittanceInfo: t.remittanceInfo,
          amount: t.amount,
          direction: t.direction,
        });

        let reconciliationStatus = catResult.reconciliationStatus;
        let matchReason = catResult.matchReason;
        let reviewReason = catResult.reviewReason;
        let matchedInvoiceId: string | undefined;

        // Step B: Multi-tier matching for incoming credit transactions
        if (t.direction === 'credit') {
          const matchResult = await orderMatcherService.matchCreditTransaction(
            {
              amount: t.amount,
              description: t.description,
              remittanceInfo: t.remittanceInfo,
              counterName: t.counterName,
              counterIban: t.counterIban,
              eref: t.eref,
            },
            tx
          );

          if (matchResult.isMatched && matchResult.invoiceId) {
            // Tier 1 (exact) or Tier 2 (controlled) match
            matchedInvoiceId = matchResult.invoiceId;
            reconciliationStatus = 'matched_invoice';
            matchReason = matchResult.matchReason || 'Auto-matched to invoice';
            reviewReason = null;
            autoMatchedCount++;
          } else {
            if (matchResult.tier === 3) {
              reconciliationStatus = 'unmatched';
              reviewReason = matchResult.reviewReason || 'Ambiguous match — manual review required';
              reviewCount++;
            } else if (reconciliationStatus === 'unmatched') {
              reviewCount++;
            }
          }
        } else {
          if (reconciliationStatus === 'matched_expense') {
            autoCategorizedCount++;
          } else {
            reviewCount++;
          }
        }

        // Step C: Insert bank transaction (duplicate protection by bankTxId)
        const [insertedTx] = await tx
          .insert(bankTransactions)
          .values({
            statementId: statement.id,
            bankTxId: t.bankTxId,
            accountIban: t.accountIban,
            transactionDate: t.transactionDate,
            valueDate: t.valueDate || t.transactionDate,
            counterIban: t.counterIban || null,
            counterName: t.counterName || null,
            amount: sql`${t.amount}::numeric`,
            direction: t.direction,
            description: t.description || null,
            remittanceInfo: t.remittanceInfo || null,
            category: catResult.category,
            matchReason,
            reviewReason,
            isInternalTransfer: catResult.isInternalTransfer,
            reconciliationStatus,
          })
          .onConflictDoNothing()
          .returning();

        // Step D: If automatically matched, allocate to target invoice atomically
        if (insertedTx && matchedInvoiceId) {
          const paymentNumber = await paymentAllocationService.generatePaymentNumber(paymentSeqOffset++, tx);
          const todayStr = t.transactionDate;

          const [newPayment] = await tx
            .insert(payments)
            .values({
              paymentNumber,
              invoiceId: matchedInvoiceId,
              amount: sql`${t.amount}::numeric`,
              paymentMethod: 'bank_transfer_abn',
              paymentReference: `Bank auto-match: ${insertedTx.bankTxId}`,
              status: 'succeeded',
              paidAt: new Date(todayStr),
            })
            .returning();

          await tx.insert(paymentAllocations).values({
            paymentId: newPayment.id,
            bankTransactionId: insertedTx.id,
            allocatedAmount: sql`${t.amount}::numeric`,
            notes: `Auto-allocated via statement ${statement.statementIdentifier}`,
          });

          await paymentAllocationService.recalculateInvoiceStatus(tx, matchedInvoiceId, todayStr);
        }
      }

      return {
        statementId: statement.id,
        statementIdentifier: statement.statementIdentifier,
        fileName: statement.fileName,
        fileFormat: statement.fileFormat,
        totalTransactions: transactions.length,
        autoMatchedCount,
        autoCategorizedCount,
        reviewCount,
        totalCredits: validation.totalCredits,
        totalDebits: validation.totalDebits,
      };
    });
  }
}

export const bankStatementService = new BankStatementService();
