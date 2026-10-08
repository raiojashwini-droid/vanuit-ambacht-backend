export type BankTxDirection = 'credit' | 'debit';
export type BankTxReconciliationStatus = 'unmatched' | 'matched_invoice' | 'matched_expense' | 'manual_reconciled';
export type StatementFileFormat = 'mt940' | 'camt053' | 'abn_text';

export interface ParsedBankTransaction {
  bankTxId: string;
  accountIban: string;
  transactionDate: string; // YYYY-MM-DD
  valueDate?: string;
  counterIban?: string;
  counterName?: string;
  amount: number;
  direction: BankTxDirection;
  description?: string;
  remittanceInfo?: string;
  eref?: string;
  isInternalTransfer?: boolean;
  category?: string;
  matchReason?: string;
  reviewReason?: string;
}

export interface StatementHeaderInfo {
  statementIdentifier: string;
  accountIban: string;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  expectedCount?: number;
  fileFormat: StatementFileFormat;
  fileName: string;
}

export interface StatementValidationResult {
  isValid: boolean;
  openingBalance: number;
  closingBalance: number;
  calculatedClosingBalance: number;
  totalCredits: number;
  totalDebits: number;
  discrepancy: number;
  transactionCount: number;
  expectedCount?: number;
  errors: string[];
}

export interface BankTxDto {
  id: string;
  statementId: string | null;
  bankTxId: string;
  accountIban: string;
  transactionDate: string;
  valueDate: string | null;
  counterIban: string | null;
  counterName: string | null;
  amount: number;
  direction: BankTxDirection;
  description: string | null;
  remittanceInfo: string | null;
  category: string | null;
  matchReason: string | null;
  reviewReason: string | null;
  isInternalTransfer: boolean;
  bolSpecification: BolSpecificationDto | null;
  reconciliationStatus: BankTxReconciliationStatus;
  createdAt: string;
  allocations?: PaymentAllocationDetailDto[];
}

export interface BolSpecificationDto {
  grossSales: number;
  commissionFees: number;
  netPayout: number;
  sellerOrderCount?: number;
  notes?: string;
}

export interface PaymentAllocationDetailDto {
  id: string;
  paymentId: string;
  paymentNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  allocatedAmount: number;
  allocatedAt: string;
  notes?: string | null;
}

export interface AllocationItemInput {
  invoiceId: string;
  amount: number;
  notes?: string;
}

export interface AllocateBankTxInput {
  allocations: AllocationItemInput[];
}

export interface MatchResult {
  isMatched: boolean;
  matchingMethod?: string;
  tier: 1 | 2 | 3 | 4;
  invoiceId?: string;
  invoiceNumber?: string;
  customerId?: string;
  customerName?: string;
  confidence: number;
  matchReason?: string;
  reviewReason?: string;
}

export interface StatementImportResultDto {
  statementId: string;
  statementIdentifier: string;
  fileName: string;
  fileFormat: string;
  totalTransactions: number;
  autoMatchedCount: number;
  autoCategorizedCount: number;
  reviewCount: number;
  totalCredits: number;
  totalDebits: number;
}
