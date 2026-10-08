export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
export type JournalEntryType =
  | 'sales_invoice'
  | 'bank_receipt'
  | 'bol_reconciliation'
  | 'purchase_invoice'
  | 'general_journal'
  | 'opening_balance';

export type JournalEntryStatus = 'draft' | 'posted' | 'reversed';

export interface ChartOfAccountDto {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  standardVatRule: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface JournalEntryLineInput {
  accountCode: string; // e.g. '1300', '8000', '1500'
  debit: number;
  credit: number;
  vatRule?: string | null;
  lineDescription?: string | null;
}

export interface JournalEntryLineDto {
  id: string;
  journalEntryId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  vatRule: string | null;
  lineDescription: string | null;
}

export interface JournalEntryDto {
  id: string;
  entryNumber: string;
  status: JournalEntryStatus;
  entryDate: string;
  entryType: JournalEntryType;
  description: string;
  isReversal: boolean;
  reversedByEntryId: string | null;
  originalEntryId: string | null;
  bankTransactionId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  postedAt: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: JournalEntryLineDto[];
}

export interface CreateJournalEntryInput {
  entryDate: string;
  entryType: JournalEntryType;
  description: string;
  status?: 'draft' | 'posted';
  invoiceId?: string | null;
  paymentId?: string | null;
  bankTransactionId?: string | null;
  lines: JournalEntryLineInput[];
}

export interface GeneralLedgerFilter {
  accountCode?: string;
  startDate?: string;
  endDate?: string;
}

export interface GeneralLedgerAccountMovement {
  entryDate: string;
  entryNumber: string;
  entryType: JournalEntryType;
  description: string;
  debit: number;
  credit: number;
  balanceAfter: number;
}

export interface GeneralLedgerAccountReport {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  movements: GeneralLedgerAccountMovement[];
}

export interface TrialBalanceItemDto {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitTotal: number;
  creditTotal: number;
  balanceDebit: number;
  balanceCredit: number;
}

export interface TrialBalanceReportDto {
  asOfDate: string;
  items: TrialBalanceItemDto[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export interface VatReportBoxDto {
  boxCode: string;
  boxName: string;
  turnoverAmount: number;
  vatAmount: number;
}

export interface VatReportDto {
  basis: 'factuurstelsel';
  period: string; // e.g. '2026-Q1', '2026-Q3'
  startDate: string;
  endDate: string;
  boxes: {
    box1a: VatReportBoxDto; // High rate 21%
    box1b: VatReportBoxDto; // Low rate 9%
    box5b: VatReportBoxDto; // Voorbelasting (deductible VAT)
    box5g: {
      boxCode: string;
      boxName: string;
      subtotalPayable: number;
      subtotalDeductible: number;
      netVatPayable: number; // positive = pay Belastingdienst, negative = refund
    };
  };
}

export interface ProfitLossReportDto {
  period: string;
  startDate: string;
  endDate: string;
  revenue: {
    accounts: { accountCode: string; accountName: string; amount: number }[];
    totalRevenue: number;
  };
  directCosts: {
    accounts: { accountCode: string; accountName: string; amount: number }[];
    totalDirectCosts: number;
  };
  grossProfit: number;
  operatingExpenses: {
    accounts: { accountCode: string; accountName: string; amount: number }[];
    totalOperatingExpenses: number;
  };
  netOperatingResult: number;
}

export interface BalanceSheetReportDto {
  asOfDate: string;
  assets: {
    accounts: { accountCode: string; accountName: string; balance: number }[];
    totalAssets: number;
  };
  liabilitiesAndEquity: {
    accounts: { accountCode: string; accountName: string; balance: number }[];
    netResultCurrentYear: number;
    totalLiabilitiesAndEquity: number;
  };
  isBalanced: boolean;
}

export interface FiscalLockSettingsDto {
  fiscalLockDate: string | null;
  isLocked: boolean;
}

export interface UpdateChartOfAccountInput {
  accountName?: string;
  accountType?: AccountType;
  standardVatRule?: string | null;
  isActive?: boolean;
}

export interface ListJournalEntriesFilter {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  status?: JournalEntryStatus;
  entryType?: JournalEntryType;
}

export interface PaginatedJournalEntriesDto {
  entries: JournalEntryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
