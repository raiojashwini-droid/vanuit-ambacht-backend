import { eq, and, sql, desc, asc, lte, gte } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
  companySettings,
  invoices,
  payments,
  bankTransactions,
} from '../../db/schema.js';
import type {
  ChartOfAccountDto,
  JournalEntryDto,
  CreateJournalEntryInput,
  JournalEntryLineInput,
  GeneralLedgerAccountReport,
  TrialBalanceReportDto,
  TrialBalanceItemDto,
  VatReportDto,
  ProfitLossReportDto,
  BalanceSheetReportDto,
  FiscalLockSettingsDto,
  UpdateChartOfAccountInput,
  ListJournalEntriesFilter,
  PaginatedJournalEntriesDto,
} from './accounting.types.js';

export class AccountingError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 400, code: string = 'ACCOUNTING_ERROR') {
    super(message);
    this.name = 'AccountingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AccountingService {
  /**
   * Helper: check if a date falls before or on the active fiscal lock date
   */
  async checkFiscalLock(dateStr: string, tx: any = db): Promise<void> {
    const [settings] = await tx
      .select({ fiscalLockDate: companySettings.fiscalLockDate })
      .from(companySettings)
      .limit(1);

    if (settings?.fiscalLockDate) {
      const lockDate = new Date(settings.fiscalLockDate);
      const targetDate = new Date(dateStr);
      if (targetDate <= lockDate) {
        throw new AccountingError(
          `Action rejected: Fiscal period up to ${settings.fiscalLockDate} is closed and locked.`,
          400,
          'FISCAL_PERIOD_LOCKED'
        );
      }
    }
  }

  /**
   * Auto-generate sequential journal entry number: JNL-YYYY-XXX
   */
  async generateEntryNumber(tx: any = db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `JNL-${year}-`;

    const [latest] = await tx
      .select({ entryNumber: journalEntries.entryNumber })
      .from(journalEntries)
      .where(sql`${journalEntries.entryNumber} LIKE ${prefix + '%'}`)
      .orderBy(desc(journalEntries.entryNumber))
      .limit(1);

    let nextSeq = 1;
    if (latest?.entryNumber) {
      const parts = latest.entryNumber.split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq)) {
        nextSeq = seq + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * List all Chart of Accounts
   */
  async listAccounts(): Promise<ChartOfAccountDto[]> {
    const rows = await db
      .select()
      .from(chartOfAccounts)
      .orderBy(asc(chartOfAccounts.accountCode));

    return rows.map((r) => ({
      id: r.id,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      standardVatRule: r.standardVatRule,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Create new account in chart of accounts
   */
  async createAccount(input: {
    accountCode: string;
    accountName: string;
    accountType: any;
    standardVatRule?: string | null;
    isActive?: boolean;
  }): Promise<ChartOfAccountDto> {
    const [existing] = await db
      .select()
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.accountCode, input.accountCode))
      .limit(1);

    if (existing) {
      throw new AccountingError(`Account code ${input.accountCode} already exists`, 400, 'ACCOUNT_EXISTS');
    }

    const [created] = await db
      .insert(chartOfAccounts)
      .values({
        accountCode: input.accountCode,
        accountName: input.accountName,
        accountType: input.accountType,
        standardVatRule: input.standardVatRule || null,
        isActive: input.isActive ?? true,
      })
      .returning();

    return {
      id: created.id,
      accountCode: created.accountCode,
      accountName: created.accountName,
      accountType: created.accountType,
      standardVatRule: created.standardVatRule,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Update account in Chart of Accounts
   * Protects accounts with posted entries against changing account type
   */
  async updateAccount(
    id: string,
    input: UpdateChartOfAccountInput
  ): Promise<ChartOfAccountDto> {
    const [existing] = await db
      .select()
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, id))
      .limit(1);

    if (!existing) {
      throw new AccountingError('Account not found in Chart of Accounts', 404, 'NOT_FOUND');
    }

    if (input.accountType && input.accountType !== existing.accountType) {
      // Check if account has been used in any posted journal entry lines
      const [used] = await db
        .select({ id: journalEntryLines.id })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(journalEntryLines.accountId, id),
            eq(journalEntries.status, 'posted')
          )
        )
        .limit(1);

      if (used) {
        throw new AccountingError(
          `Cannot modify account type of account ${existing.accountCode}: it is already in use by posted journal entries.`,
          400,
          'CANNOT_MODIFY_USED_ACCOUNT'
        );
      }
    }

    const [updated] = await db
      .update(chartOfAccounts)
      .set({
        accountName: input.accountName ?? existing.accountName,
        accountType: input.accountType ?? existing.accountType,
        standardVatRule: input.standardVatRule !== undefined ? input.standardVatRule : existing.standardVatRule,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      })
      .where(eq(chartOfAccounts.id, id))
      .returning();

    return {
      id: updated.id,
      accountCode: updated.accountCode,
      accountName: updated.accountName,
      accountType: updated.accountType,
      standardVatRule: updated.standardVatRule,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  /**
   * Core Double-Entry Engine: Post or draft a balanced journal entry
   * Validates:
   * 1. Fiscal lock check
   * 2. Non-negative debit & credit
   * 3. Math.round cents check: SUM(debit) === SUM(credit)
   * 4. Account code existence
   * 5. Atomically executes inside tx
   */
  async createJournalEntry(
    input: CreateJournalEntryInput,
    userId?: string | null,
    externalTx?: any
  ): Promise<JournalEntryDto> {
    const run = async (tx: any) => {
      await this.checkFiscalLock(input.entryDate, tx);

      // Validate balanced debits and credits
      let totalDebitCents = 0;
      let totalCreditCents = 0;

      for (const line of input.lines) {
        if (line.debit < 0 || line.credit < 0) {
          throw new AccountingError('Debit and credit amounts must be non-negative', 400, 'NEGATIVE_AMOUNTS');
        }
        totalDebitCents += Math.round(line.debit * 100);
        totalCreditCents += Math.round(line.credit * 100);
      }

      if (totalDebitCents !== totalCreditCents || totalDebitCents === 0) {
        const dStr = (totalDebitCents / 100).toFixed(2);
        const cStr = (totalCreditCents / 100).toFixed(2);
        throw new AccountingError(
          `Unbalanced journal entry rejected: Total Debit (€${dStr}) does not equal Total Credit (€${cStr})`,
          400,
          'UNBALANCED_ENTRY'
        );
      }

      // Fetch accounts to verify existence and map IDs
      const codes = Array.from(new Set(input.lines.map((l) => l.accountCode)));
      const accountsList = await tx
        .select()
        .from(chartOfAccounts)
        .where(sql`${chartOfAccounts.accountCode} IN ${codes}`);

      const accountMap = new Map<string, typeof chartOfAccounts.$inferSelect>();
      for (const a of accountsList) {
        accountMap.set(a.accountCode, a);
      }

      for (const code of codes) {
        if (!accountMap.has(code)) {
          throw new AccountingError(`Account code ${code} does not exist in Chart of Accounts`, 404, 'ACCOUNT_NOT_FOUND');
        }
      }

      const entryNumber = await this.generateEntryNumber(tx);
      const isPosted = input.status !== 'draft';

      const [entry] = await tx
        .insert(journalEntries)
        .values({
          entryNumber,
          status: isPosted ? 'posted' : 'draft',
          entryDate: input.entryDate,
          entryType: input.entryType,
          description: input.description,
          invoiceId: input.invoiceId || null,
          paymentId: input.paymentId || null,
          bankTransactionId: input.bankTransactionId || null,
          createdByUserId: userId || null,
          postedAt: isPosted ? new Date() : null,
        })
        .returning();

      for (const line of input.lines) {
        const acc = accountMap.get(line.accountCode)!;
        await tx.insert(journalEntryLines).values({
          journalEntryId: entry.id,
          accountId: acc.id,
          debit: sql`${line.debit}::numeric`,
          credit: sql`${line.credit}::numeric`,
          vatRule: line.vatRule || acc.standardVatRule || null,
          lineDescription: line.lineDescription || null,
        });
      }

      return entry.id;
    };

    const entryId = externalTx ? await run(externalTx) : await db.transaction(run);
    return await this.getEntryById(entryId, externalTx);
  }

  /**
   * Get single journal entry with its lines
   */
  async getEntryById(id: string, tx: any = db): Promise<JournalEntryDto> {
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, id))
      .limit(1);

    if (!entry) {
      throw new AccountingError('Journal entry not found', 404, 'NOT_FOUND');
    }

    const lines = await tx
      .select({
        line: journalEntryLines,
        account: chartOfAccounts,
      })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
      .where(eq(journalEntryLines.journalEntryId, id));

    let totalDebit = 0;
    let totalCredit = 0;

    const lineDtos = lines.map((r: any) => {
      const d = parseFloat(r.line.debit || '0');
      const c = parseFloat(r.line.credit || '0');
      totalDebit += d;
      totalCredit += c;

      return {
        id: r.line.id,
        journalEntryId: r.line.journalEntryId,
        accountId: r.line.accountId,
        accountCode: r.account.accountCode,
        accountName: r.account.accountName,
        accountType: r.account.accountType,
        debit: d,
        credit: c,
        vatRule: r.line.vatRule,
        lineDescription: r.line.lineDescription,
      };
    });

    return {
      id: entry.id,
      entryNumber: entry.entryNumber,
      status: entry.status,
      entryDate: String(entry.entryDate).split('T')[0],
      entryType: entry.entryType,
      description: entry.description,
      isReversal: entry.isReversal,
      reversedByEntryId: entry.reversedByEntryId,
      originalEntryId: entry.originalEntryId,
      bankTransactionId: entry.bankTransactionId,
      invoiceId: entry.invoiceId,
      paymentId: entry.paymentId,
      createdByUserId: entry.createdByUserId,
      createdAt: entry.createdAt.toISOString(),
      postedAt: entry.postedAt ? entry.postedAt.toISOString() : null,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      lines: lineDtos,
    };
  }

  /**
   * List paginated journal entries with filters
   */
  async listJournalEntries(filter: ListJournalEntriesFilter): Promise<PaginatedJournalEntriesDto> {
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filter.startDate) {
      conditions.push(gte(journalEntries.entryDate, filter.startDate));
    }
    if (filter.endDate) {
      conditions.push(lte(journalEntries.entryDate, filter.endDate));
    }
    if (filter.status) {
      conditions.push(eq(journalEntries.status, filter.status));
    }
    if (filter.entryType) {
      conditions.push(eq(journalEntries.entryType, filter.entryType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(whereClause);

    const total = countResult?.count || 0;

    const rows = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(whereClause)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNumber))
      .limit(limit)
      .offset(offset);

    const entries: JournalEntryDto[] = [];
    for (const r of rows) {
      entries.push(await this.getEntryById(r.id));
    }

    return {
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Transition a DRAFT journal entry to POSTED
   * Validates:
   * 1. Entry exists and is currently 'draft'
   * 2. Fiscal lock on entryDate
   * 3. At least 2 lines
   * 4. Balanced debits = credits
   * 5. Accounts are active
   */
  async postDraftJournalEntry(
    id: string,
    userId?: string | null,
    externalTx?: any
  ): Promise<JournalEntryDto> {
    const run = async (tx: any) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, id))
        .limit(1);

      if (!entry) {
        throw new AccountingError('Journal entry not found', 404, 'NOT_FOUND');
      }

      if (entry.status === 'posted') {
        throw new AccountingError('Journal entry is already posted', 400, 'ALREADY_POSTED');
      }

      if (entry.status === 'reversed') {
        throw new AccountingError('Cannot post a reversed journal entry', 400, 'CANNOT_POST_REVERSED');
      }

      // Check fiscal lock
      await this.checkFiscalLock(String(entry.entryDate).split('T')[0], tx);

      // Validate lines
      const lines = await tx
        .select({
          line: journalEntryLines,
          account: chartOfAccounts,
        })
        .from(journalEntryLines)
        .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
        .where(eq(journalEntryLines.journalEntryId, id));

      if (lines.length < 2) {
        throw new AccountingError('Journal entry must have at least 2 lines to be posted', 400, 'INVALID_LINES');
      }

      let totalDebitCents = 0;
      let totalCreditCents = 0;

      for (const r of lines) {
        const d = parseFloat(r.line.debit || '0');
        const c = parseFloat(r.line.credit || '0');
        if (d < 0 || c < 0) {
          throw new AccountingError('Debit and credit amounts must be non-negative', 400, 'NEGATIVE_AMOUNTS');
        }
        totalDebitCents += Math.round(d * 100);
        totalCreditCents += Math.round(c * 100);

        if (!r.account.isActive) {
          throw new AccountingError(
            `Account ${r.account.accountCode} (${r.account.accountName}) is inactive and cannot be used in a posted entry`,
            400,
            'INACTIVE_ACCOUNT'
          );
        }
      }

      if (totalDebitCents !== totalCreditCents || totalDebitCents === 0) {
        const dStr = (totalDebitCents / 100).toFixed(2);
        const cStr = (totalCreditCents / 100).toFixed(2);
        throw new AccountingError(
          `Unbalanced journal entry rejected: Total Debit (€${dStr}) does not equal Total Credit (€${cStr})`,
          400,
          'UNBALANCED_ENTRY'
        );
      }

      await tx
        .update(journalEntries)
        .set({
          status: 'posted',
          postedAt: new Date(),
          createdByUserId: userId || entry.createdByUserId,
        })
        .where(eq(journalEntries.id, id));

      return id;
    };

    const entryId = externalTx ? await run(externalTx) : await db.transaction(run);
    return await this.getEntryById(entryId, externalTx);
  }

  /**
   * Reverse an existing posted journal entry:
   * 1. Checks fiscal lock
   * 2. Reversal is impossible if already reversed
   * 3. Creates an exact opposite journal entry (swapping Debits and Credits)
   * 4. Links original and reversal with bi-directional FKs
   */
  async reverseJournalEntry(
    id: string,
    reason: string,
    reversalDate?: string,
    userId?: string | null,
    externalTx?: any
  ): Promise<{ originalEntry: JournalEntryDto; reversalEntry: JournalEntryDto }> {
    const run = async (tx: any) => {
      const orig = await this.getEntryById(id, tx);

      if (orig.status === 'reversed') {
        throw new AccountingError(`Journal entry ${orig.entryNumber} has already been reversed`, 400, 'ALREADY_REVERSED');
      }

      if (orig.status === 'draft') {
        throw new AccountingError('Cannot reverse a draft journal entry. Delete or discard it instead.', 400, 'CANNOT_REVERSE_DRAFT');
      }

      const revDate = reversalDate || new Date().toISOString().split('T')[0];
      await this.checkFiscalLock(revDate, tx);

      // Create reversing lines by swapping debit <-> credit
      const reversedLines = orig.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.credit,
        credit: l.debit,
        vatRule: l.vatRule,
        lineDescription: `Reversal of ${orig.entryNumber}: ${l.lineDescription || ''}`.trim(),
      }));

      const reversalNumber = await this.generateEntryNumber(tx);

      const [reversal] = await tx
        .insert(journalEntries)
        .values({
          entryNumber: reversalNumber,
          status: 'posted',
          entryDate: revDate,
          entryType: orig.entryType,
          description: `Storno / Reversal: ${orig.description} — ${reason}`,
          isReversal: true,
          originalEntryId: orig.id,
          invoiceId: orig.invoiceId,
          paymentId: orig.paymentId,
          bankTransactionId: orig.bankTransactionId,
          createdByUserId: userId || null,
          postedAt: new Date(),
        })
        .returning();

      for (const line of reversedLines) {
        const [acc] = await tx
          .select({ id: chartOfAccounts.id })
          .from(chartOfAccounts)
          .where(eq(chartOfAccounts.accountCode, line.accountCode))
          .limit(1);

        await tx.insert(journalEntryLines).values({
          journalEntryId: reversal.id,
          accountId: acc.id,
          debit: sql`${line.debit}::numeric`,
          credit: sql`${line.credit}::numeric`,
          vatRule: line.vatRule,
          lineDescription: line.lineDescription,
        });
      }

      // Mark original entry as reversed
      await tx
        .update(journalEntries)
        .set({
          status: 'reversed',
          reversedByEntryId: reversal.id,
        })
        .where(eq(journalEntries.id, orig.id));

      return {
        origId: orig.id,
        revId: reversal.id,
      };
    };

    const res = externalTx ? await run(externalTx) : await db.transaction(run);
    return {
      originalEntry: await this.getEntryById(res.origId, externalTx),
      reversalEntry: await this.getEntryById(res.revId, externalTx),
    };
  }

  /**
   * General Ledger (Grootboek) report per account
   */
  async getGeneralLedger(filter: { accountCode?: string; startDate?: string; endDate?: string }): Promise<GeneralLedgerAccountReport[]> {
    const conditions: any[] = [eq(journalEntries.status, 'posted')];

    if (filter.startDate) {
      conditions.push(gte(journalEntries.entryDate, filter.startDate));
    }
    if (filter.endDate) {
      conditions.push(lte(journalEntries.entryDate, filter.endDate));
    }

    const accountsQuery = filter.accountCode
      ? await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.accountCode, filter.accountCode))
      : await db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.accountCode));

    const reports: GeneralLedgerAccountReport[] = [];

    for (const acc of accountsQuery) {
      const lines = await db
        .select({
          entryDate: journalEntries.entryDate,
          entryNumber: journalEntries.entryNumber,
          entryType: journalEntries.entryType,
          description: journalEntries.description,
          lineDescription: journalEntryLines.lineDescription,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
        .where(and(eq(journalEntryLines.accountId, acc.id), ...conditions))
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNumber));

      let runningBalance = 0;
      let totalDebit = 0;
      let totalCredit = 0;

      const movements = lines.map((l) => {
        const d = parseFloat(l.debit || '0');
        const c = parseFloat(l.credit || '0');
        totalDebit += d;
        totalCredit += c;

        // Assets and Expenses increase on Debit; Liabilities, Equity, Revenue increase on Credit
        if (acc.accountType === 'Asset' || acc.accountType === 'Expense') {
          runningBalance += d - c;
        } else {
          runningBalance += c - d;
        }

        return {
          entryDate: String(l.entryDate).split('T')[0],
          entryNumber: l.entryNumber,
          entryType: l.entryType,
          description: l.lineDescription || l.description,
          debit: d,
          credit: c,
          balanceAfter: Math.round(runningBalance * 100) / 100,
        };
      });

      reports.push({
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        openingBalance: 0,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        closingBalance: Math.round(runningBalance * 100) / 100,
        movements,
      });
    }

    return reports;
  }

  /**
   * Trial Balance (Saldibalans) report
   */
  async getTrialBalance(asOfDate?: string): Promise<TrialBalanceReportDto> {
    const effectiveDate = asOfDate || new Date().toISOString().split('T')[0];

    const accounts = await db
      .select()
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.isActive, true))
      .orderBy(asc(chartOfAccounts.accountCode));

    const items: TrialBalanceItemDto[] = [];
    let grandDebit = 0;
    let grandCredit = 0;

    for (const acc of accounts) {
      const [sumRow] = await db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(journalEntryLines.accountId, acc.id),
            eq(journalEntries.status, 'posted'),
            lte(journalEntries.entryDate, effectiveDate)
          )
        );

      const d = parseFloat(sumRow?.totalDebit || '0');
      const c = parseFloat(sumRow?.totalCredit || '0');

      grandDebit += d;
      grandCredit += c;

      let balDebit = 0;
      let balCredit = 0;

      if (d >= c) {
        balDebit = d - c;
      } else {
        balCredit = c - d;
      }

      items.push({
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        debitTotal: Math.round(d * 100) / 100,
        creditTotal: Math.round(c * 100) / 100,
        balanceDebit: Math.round(balDebit * 100) / 100,
        balanceCredit: Math.round(balCredit * 100) / 100,
      });
    }

    const roundedDebit = Math.round(grandDebit * 100) / 100;
    const roundedCredit = Math.round(grandCredit * 100) / 100;

    return {
      asOfDate: effectiveDate,
      items,
      totalDebit: roundedDebit,
      totalCredit: roundedCredit,
      isBalanced: roundedDebit === roundedCredit,
    };
  }

  /**
   * VAT Report (BTW Aangifte conform Factuurstelsel)
   * Boxes:
   * 1a: Leveringen/diensten belast met hoog tarief (21%)
   * 1b: Leveringen/diensten belast met laag tarief (9%)
   * 5b: Voorbelasting (Account 1510)
   * 5g: Totaal te betalen / terug te vragen
   */
  async getVatReport(year: number, quarter?: number): Promise<VatReportDto> {
    let startDate = `${year}-01-01`;
    let endDate = `${year}-12-31`;
    let periodName = `${year}`;

    if (quarter) {
      if (quarter === 1) {
        startDate = `${year}-01-01`;
        endDate = `${year}-03-31`;
      } else if (quarter === 2) {
        startDate = `${year}-04-01`;
        endDate = `${year}-06-30`;
      } else if (quarter === 3) {
        startDate = `${year}-07-01`;
        endDate = `${year}-09-30`;
      } else if (quarter === 4) {
        startDate = `${year}-10-01`;
        endDate = `${year}-12-31`;
      }
      periodName = `${year}-Q${quarter}`;
    }

    // High Rate 21% (Account 1500 lines or revenue 8000)
    // Box 1a: Turnover from revenue accounts (Cr - Dr), VAT from 1500 (Cr - Dr)
    const [rev21] = await db
      .select({
        turnover: sql<string>`COALESCE(SUM(${journalEntryLines.credit} - ${journalEntryLines.debit}), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
      .where(
        and(
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate),
          sql`${chartOfAccounts.accountCode} IN ('8000', '8010')`
        )
      );

    const [vat1500] = await db
      .select({
        vat: sql<string>`COALESCE(SUM(${journalEntryLines.credit} - ${journalEntryLines.debit}), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
      .where(
        and(
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate),
          eq(chartOfAccounts.accountCode, '1500')
        )
      );

    // Box 5b: Input VAT / Voorbelasting (Account 1510) (Dr - Cr)
    const [vat1510] = await db
      .select({
        inputVat: sql<string>`COALESCE(SUM(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
      .where(
        and(
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate),
          eq(chartOfAccounts.accountCode, '1510')
        )
      );

    const turnover1a = Math.max(0, Math.round(parseFloat(rev21?.turnover || '0') * 100) / 100);
    const vat1a = Math.round(parseFloat(vat1500?.vat || '0') * 100) / 100;
    const deductible5b = Math.round(parseFloat(vat1510?.inputVat || '0') * 100) / 100;
    const netVat = Math.round((vat1a - deductible5b) * 100) / 100;

    return {
      basis: 'factuurstelsel',
      period: periodName,
      startDate,
      endDate,
      boxes: {
        box1a: {
          boxCode: '1a',
          boxName: 'Leveringen/diensten belast met hoog tarief (21%)',
          turnoverAmount: turnover1a,
          vatAmount: vat1a,
        },
        box1b: {
          boxCode: '1b',
          boxName: 'Leveringen/diensten belast met laag tarief (9%)',
          turnoverAmount: 0,
          vatAmount: 0,
        },
        box5b: {
          boxCode: '5b',
          boxName: 'Voorbelasting (terug te vorderen BTW)',
          turnoverAmount: 0,
          vatAmount: deductible5b,
        },
        box5g: {
          boxCode: '5g',
          boxName: 'Totaal te betalen / terug te vragen',
          subtotalPayable: vat1a,
          subtotalDeductible: deductible5b,
          netVatPayable: netVat,
        },
      },
    };
  }

  /**
   * Profit & Loss (Winst & Verlies) Report
   */
  async getProfitLoss(year: number, customStart?: string, customEnd?: string): Promise<ProfitLossReportDto> {
    const startDate = customStart || `${year}-01-01`;
    const endDate = customEnd || `${year}-12-31`;

    const revRows = await db
      .select({
        code: chartOfAccounts.accountCode,
        name: chartOfAccounts.accountName,
        amount: sql<string>`COALESCE(SUM(${journalEntryLines.credit} - ${journalEntryLines.debit}), 0)`,
      })
      .from(chartOfAccounts)
      .leftJoin(
        journalEntryLines,
        eq(chartOfAccounts.id, journalEntryLines.accountId)
      )
      .leftJoin(
        journalEntries,
        and(
          eq(journalEntryLines.journalEntryId, journalEntries.id),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate)
        )
      )
      .where(eq(chartOfAccounts.accountType, 'Revenue'))
      .groupBy(chartOfAccounts.accountCode, chartOfAccounts.accountName)
      .orderBy(asc(chartOfAccounts.accountCode));

    const expRows = await db
      .select({
        code: chartOfAccounts.accountCode,
        name: chartOfAccounts.accountName,
        amount: sql<string>`COALESCE(SUM(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
      })
      .from(chartOfAccounts)
      .leftJoin(
        journalEntryLines,
        eq(chartOfAccounts.id, journalEntryLines.accountId)
      )
      .leftJoin(
        journalEntries,
        and(
          eq(journalEntryLines.journalEntryId, journalEntries.id),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate)
        )
      )
      .where(eq(chartOfAccounts.accountType, 'Expense'))
      .groupBy(chartOfAccounts.accountCode, chartOfAccounts.accountName)
      .orderBy(asc(chartOfAccounts.accountCode));

    let totalRevenue = 0;
    const revenueList = revRows.map((r) => {
      const val = Math.round(parseFloat(r.amount || '0') * 100) / 100;
      totalRevenue += val;
      return { accountCode: r.code, accountName: r.name, amount: val };
    });

    let totalDirectCosts = 0;
    const directCostsList: any[] = [];
    let totalOperatingExpenses = 0;
    const opExpensesList: any[] = [];

    for (const r of expRows) {
      const val = Math.round(parseFloat(r.amount || '0') * 100) / 100;
      if (r.code.startsWith('7') || r.code === '4000') {
        totalDirectCosts += val;
        directCostsList.push({ accountCode: r.code, accountName: r.name, amount: val });
      } else {
        totalOperatingExpenses += val;
        opExpensesList.push({ accountCode: r.code, accountName: r.name, amount: val });
      }
    }

    const grossProfit = Math.round((totalRevenue - totalDirectCosts) * 100) / 100;
    const netResult = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;

    return {
      period: `${startDate} t/m ${endDate}`,
      startDate,
      endDate,
      revenue: {
        accounts: revenueList,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
      },
      directCosts: {
        accounts: directCostsList,
        totalDirectCosts: Math.round(totalDirectCosts * 100) / 100,
      },
      grossProfit,
      operatingExpenses: {
        accounts: opExpensesList,
        totalOperatingExpenses: Math.round(totalOperatingExpenses * 100) / 100,
      },
      netOperatingResult: netResult,
    };
  }

  /**
   * Balance Sheet (Balans) Report
   */
  async getBalanceSheet(asOfDate?: string): Promise<BalanceSheetReportDto> {
    const effectiveDate = asOfDate || new Date().toISOString().split('T')[0];

    const assetRows = await db
      .select({
        code: chartOfAccounts.accountCode,
        name: chartOfAccounts.accountName,
        balance: sql<string>`COALESCE(SUM(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
      })
      .from(chartOfAccounts)
      .leftJoin(
        journalEntryLines,
        eq(chartOfAccounts.id, journalEntryLines.accountId)
      )
      .leftJoin(
        journalEntries,
        and(
          eq(journalEntryLines.journalEntryId, journalEntries.id),
          eq(journalEntries.status, 'posted'),
          lte(journalEntries.entryDate, effectiveDate)
        )
      )
      .where(eq(chartOfAccounts.accountType, 'Asset'))
      .groupBy(chartOfAccounts.accountCode, chartOfAccounts.accountName)
      .orderBy(asc(chartOfAccounts.accountCode));

    const liabRows = await db
      .select({
        code: chartOfAccounts.accountCode,
        name: chartOfAccounts.accountName,
        balance: sql<string>`COALESCE(SUM(${journalEntryLines.credit} - ${journalEntryLines.debit}), 0)`,
      })
      .from(chartOfAccounts)
      .leftJoin(
        journalEntryLines,
        eq(chartOfAccounts.id, journalEntryLines.accountId)
      )
      .leftJoin(
        journalEntries,
        and(
          eq(journalEntryLines.journalEntryId, journalEntries.id),
          eq(journalEntries.status, 'posted'),
          lte(journalEntries.entryDate, effectiveDate)
        )
      )
      .where(sql`${chartOfAccounts.accountType} IN ('Liability', 'Equity')`)
      .groupBy(chartOfAccounts.accountCode, chartOfAccounts.accountName)
      .orderBy(asc(chartOfAccounts.accountCode));

    let totalAssets = 0;
    const assets = assetRows.map((r) => {
      const b = Math.round(parseFloat(r.balance || '0') * 100) / 100;
      totalAssets += b;
      return { accountCode: r.code, accountName: r.name, balance: b };
    });

    let totalLiabilities = 0;
    const liabilities = liabRows.map((r) => {
      const b = Math.round(parseFloat(r.balance || '0') * 100) / 100;
      totalLiabilities += b;
      return { accountCode: r.code, accountName: r.name, balance: b };
    });

    // Net Result (P&L retained earnings for current period)
    const currentYear = new Date(effectiveDate).getFullYear();
    const pl = await this.getProfitLoss(currentYear, `${currentYear}-01-01`, effectiveDate);
    const netResultCurrentYear = pl.netOperatingResult;

    const totalLiabAndEquity = Math.round((totalLiabilities + netResultCurrentYear) * 100) / 100;
    totalAssets = Math.round(totalAssets * 100) / 100;

    return {
      asOfDate: effectiveDate,
      assets: {
        accounts: assets,
        totalAssets,
      },
      liabilitiesAndEquity: {
        accounts: liabilities,
        netResultCurrentYear,
        totalLiabilitiesAndEquity: totalLiabAndEquity,
      },
      isBalanced: totalAssets === totalLiabAndEquity,
    };
  }

  /**
   * Get / Update Fiscal Lock Date
   */
  async getFiscalLock(): Promise<FiscalLockSettingsDto> {
    const [settings] = await db
      .select({ fiscalLockDate: companySettings.fiscalLockDate })
      .from(companySettings)
      .limit(1);

    const lockDate = settings?.fiscalLockDate ? String(settings.fiscalLockDate).split('T')[0] : null;

    return {
      fiscalLockDate: lockDate,
      isLocked: lockDate !== null,
    };
  }

  async updateFiscalLock(newDate: string | null): Promise<FiscalLockSettingsDto> {
    const [settings] = await db
      .select()
      .from(companySettings)
      .limit(1);

    if (settings) {
      await db
        .update(companySettings)
        .set({ fiscalLockDate: newDate, updatedAt: new Date() })
        .where(eq(companySettings.id, settings.id));
    }

    return {
      fiscalLockDate: newDate,
      isLocked: newDate !== null,
    };
  }

  // ==========================================
  // MODULE INTEGRATION HOOKS
  // ==========================================

  /**
   * Invoice -> Accounting Hook
   * Rule 1: Called when sales invoice is SENT
   * Dr 1300 (Accounts Receivable) - totalInclVat
   *   Cr 8000 (Revenue) - subtotalExclVat
   *   Cr 1500 (VAT Payable) - totalVatAmount
   */
  async postSalesInvoiceEntry(invoiceId: string, tx: any = db): Promise<void> {
    // Idempotency: check if already posted for this invoice
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.invoiceId, invoiceId),
          eq(journalEntries.entryType, 'sales_invoice'),
          eq(journalEntries.isReversal, false)
        )
      )
      .limit(1);

    if (existing) {
      return; // Already posted, skip idempotently
    }

    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!inv || inv.status === 'draft') {
      return; // Draft invoices never generate accounting entries
    }

    const totalIncl = Math.abs(parseFloat(inv.totalInclVat || '0'));
    const subtotalExcl = Math.abs(parseFloat(inv.subtotalExclVat || '0'));
    const vatAmount = Math.abs(parseFloat(inv.totalVatAmount || '0'));

    if (totalIncl === 0) return;

    if (inv.invoiceType === 'credit_note') {
      // Credit Note accounting (Opposite/Reversal)
      // Dr 8000 (Revenue) - subtotalExcl
      // Dr 1500 (VAT Payable) - vatAmount
      //   Cr 1300 (Accounts Receivable) - totalIncl
      const lines: JournalEntryLineInput[] = [
        {
          accountCode: '8000',
          debit: subtotalExcl,
          credit: 0,
          vatRule: 'NL_21',
          lineDescription: `Creditering omzet factuur ${inv.invoiceNumber}`,
        },
      ];

      if (vatAmount > 0) {
        lines.push({
          accountCode: '1500',
          debit: vatAmount,
          credit: 0,
          vatRule: 'NL_21',
          lineDescription: `Creditering BTW factuur ${inv.invoiceNumber}`,
        });
      }

      lines.push({
        accountCode: '1300',
        debit: 0,
        credit: totalIncl,
        vatRule: null,
        lineDescription: `Creditering debiteur ${inv.invoiceNumber}`,
      });

      await this.createJournalEntry(
        {
          entryDate: inv.issueDate || new Date().toISOString().split('T')[0],
          entryType: 'sales_invoice',
          description: `Creditfactuur ${inv.invoiceNumber} (Crediteert ${inv.originalInvoiceId || 'origineel'})`,
          status: 'posted',
          invoiceId: inv.id,
          lines,
        },
        null,
        tx
      );
    } else {
      // Standard Sales Invoice
      const lines: JournalEntryLineInput[] = [
        {
          accountCode: '1300',
          debit: totalIncl,
          credit: 0,
          vatRule: null,
          lineDescription: `Debiteur factuur ${inv.invoiceNumber}`,
        },
        {
          accountCode: '8000',
          debit: 0,
          credit: subtotalExcl,
          vatRule: 'NL_21',
          lineDescription: `Omzet factuur ${inv.invoiceNumber}`,
        },
      ];

      if (vatAmount > 0) {
        lines.push({
          accountCode: '1500',
          debit: 0,
          credit: vatAmount,
          vatRule: 'NL_21',
          lineDescription: `Af te dragen BTW 21% factuur ${inv.invoiceNumber}`,
        });
      }

      await this.createJournalEntry(
        {
          entryDate: inv.issueDate || new Date().toISOString().split('T')[0],
          entryType: 'sales_invoice',
          description: `Verkoopfactuur ${inv.invoiceNumber}`,
          status: 'posted',
          invoiceId: inv.id,
          lines,
        },
        null,
        tx
      );
    }
  }

  /**
   * Payment -> Accounting Hook
   * Rule 2: Called when customer payment succeeds
   * Dr 1000 (Bank)
   *   Cr 1300 (Accounts Receivable)
   */
  async postPaymentReceiptEntry(paymentId: string, tx: any = db): Promise<void> {
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.paymentId, paymentId),
          eq(journalEntries.entryType, 'bank_receipt'),
          eq(journalEntries.isReversal, false)
        )
      )
      .limit(1);

    if (existing) {
      return; // Idempotent check
    }

    const [pay] = await tx
      .select({
        payment: payments,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!pay || pay.payment.status !== 'succeeded') {
      return;
    }

    const amount = Math.round(parseFloat(pay.payment.amount || '0') * 100) / 100;
    if (amount <= 0) return;

    const pDate = pay.payment.paidAt
      ? new Date(pay.payment.paidAt).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const lines = [
      {
        accountCode: '1000',
        debit: amount,
        credit: 0,
        lineDescription: `Ontvangst bank betaling ${pay.payment.paymentNumber}`,
      },
      {
        accountCode: '1300',
        debit: 0,
        credit: amount,
        lineDescription: `Afboeking debiteur factuur ${pay.invoiceNumber || pay.payment.invoiceId}`,
      },
    ];

    await this.createJournalEntry(
      {
        entryDate: pDate,
        entryType: 'bank_receipt',
        description: `Klantbetaling ${pay.payment.paymentNumber} op factuur ${pay.invoiceNumber || ''}`,
        status: 'posted',
        paymentId: pay.payment.id,
        invoiceId: pay.payment.invoiceId,
        lines,
      },
      null,
      tx
    );
  }

  /**
   * Bank Purchasing / Expense Categorization Hook
   * Direct categorization without complex creditor subledger
   * Maps category to expense account and balances against Bank (1000)
   */
  async postBankCategorizationEntry(bankTxId: string, tx: any = db): Promise<void> {
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.bankTransactionId, bankTxId),
          eq(journalEntries.isReversal, false)
        )
      )
      .limit(1);

    if (existing) {
      return; // Already journalized
    }

    const [btx] = await tx
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, bankTxId))
      .limit(1);

    if (!btx || !btx.category) {
      return;
    }

    // Bol.com 3-Way Reconciliation
    if (btx.bolSpecification) {
      const spec = btx.bolSpecification as any;
      const gross = Math.round(spec.grossSales * 100) / 100;
      const fee = Math.round(spec.commissionFees * 100) / 100;
      const net = Math.round(spec.netPayout * 100) / 100;

      // Dr 1000 (Bank) net
      // Dr 4000 (Bol Fee) fee
      //   Cr 8010 (Bol Revenue) gross
      const lines = [
        {
          accountCode: '1000',
          debit: net,
          credit: 0,
          lineDescription: `Bol.com netto uitbetaling op rekening`,
        },
        {
          accountCode: '4000',
          debit: fee,
          credit: 0,
          vatRule: 'NL_21',
          lineDescription: `Bol.com commissiekosten`,
        },
        {
          accountCode: '8010',
          debit: 0,
          credit: gross,
          vatRule: 'NL_21',
          lineDescription: `Bol.com bruto verkoopomzet`,
        },
      ];

      await this.createJournalEntry(
        {
          entryDate: String(btx.transactionDate).split('T')[0],
          entryType: 'bol_reconciliation',
          description: `Bol.com settlement ${btx.bankTxId}`,
          status: 'posted',
          bankTransactionId: btx.id,
          lines,
        },
        null,
        tx
      );
      return;
    }

    // Direct purchasing/expense mapping
    const amount = Math.round(parseFloat(btx.amount || '0') * 100) / 100;
    if (amount <= 0) return;

    // Map common Dutch bank categories to account codes
    let expenseAccount = '4450'; // Default Office / General Expense
    const catLower = btx.category.toLowerCase();

    if (catLower.includes('inkoop') || catLower.includes('hout') || catLower.includes('materiaal')) {
      expenseAccount = '7000';
    } else if (catLower.includes('software') || catLower.includes('ict') || catLower.includes('adobe') || catLower.includes('google')) {
      expenseAccount = '4100';
    } else if (catLower.includes('marketing') || catLower.includes('advert') || catLower.includes('meta')) {
      expenseAccount = '4200';
    } else if (catLower.includes('reis') || catLower.includes('brandstof') || catLower.includes('ns')) {
      expenseAccount = '4300';
    } else if (catLower.includes('bank') || catLower.includes('kosten')) {
      expenseAccount = '4500';
    } else if (catLower.includes('transport') || catLower.includes('bezorg')) {
      expenseAccount = '4600';
    }

    if (btx.direction === 'debit') {
      // Outgoing expense
      // Dr Expense (e.g. 7000/4100)
      //   Cr 1000 (Bank)
      const lines = [
        {
          accountCode: expenseAccount,
          debit: amount,
          credit: 0,
          lineDescription: btx.description || btx.category,
        },
        {
          accountCode: '1000',
          debit: 0,
          credit: amount,
          lineDescription: `Bankafschrijving ${btx.counterName || btx.bankTxId}`,
        },
      ];

      await this.createJournalEntry(
        {
          entryDate: String(btx.transactionDate).split('T')[0],
          entryType: 'purchase_invoice',
          description: `Bankuitgave: ${btx.category} (${btx.counterName || ''})`,
          status: 'posted',
          bankTransactionId: btx.id,
          lines,
        },
        null,
        tx
      );
    }
  }
}

export const accountingService = new AccountingService();
