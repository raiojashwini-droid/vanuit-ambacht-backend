export type InvoiceType =
  | 'down_payment_upfront'
  | 'final_completion'
  | 'interim_progress'
  | 'full_amount'
  | 'credit_note';

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'credited';

export interface InvoiceItemDto {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  subtext?: string | null;
  quantity: number;
  unitPriceExclVat: number;
  vatRate: number;
  lineTotalExclVat: number;
  lineTotalInclVat: number;
  isIncluded: boolean;
  createdAt: string;
}

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  projectId: string;
  customerId: string;
  quoteId?: string | null;
  milestoneId?: string | null;
  originalInvoiceId?: string | null;
  creditReason?: string | null;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  subtotalExclVat: number;
  totalVatAmount: number;
  totalInclVat: number;
  totalPaid: number;
  outstandingBalance: number;
  issueDate: string;
  dueDate: string;
  paidDate?: string | null;
  paymentTermsDays: number;
  notes?: string | null;
  customerName?: string;
  customerEmail?: string;
  projectName?: string;
  projectNumber?: string;
  items?: InvoiceItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummaryDto {
  totalCount: number;
  totalAmount: number;
  paidCount: number;
  paidSum: number;
  pendingCount: number;
  pendingSum: number;
  overdueCount: number;
  overdueSum: number;
}

export interface CreateInvoiceItemInput {
  position?: number;
  description: string;
  subtext?: string | null;
  quantity?: number;
  unitPriceExclVat?: number;
  unitPriceInclVat?: number;
  vatRate?: number;
  isIncluded?: boolean;
}

export interface CreateInvoiceInput {
  projectId: string;
  customerId?: string | null; // Optional if derived from project
  quoteId?: string | null;
  milestoneId?: string | null;
  invoiceType?: InvoiceType;
  status?: InvoiceStatus;
  issueDate?: string;
  dueDate?: string;
  paymentTermsDays?: number;
  notes?: string | null;
  items: CreateInvoiceItemInput[];
}

export interface UpdateInvoiceInput {
  projectId?: string;
  quoteId?: string | null;
  milestoneId?: string | null;
  invoiceType?: InvoiceType;
  issueDate?: string;
  dueDate?: string;
  paymentTermsDays?: number;
  notes?: string | null;
  items?: CreateInvoiceItemInput[];
}

export interface CreditNoteInput {
  reason: string;
  issueDate?: string;
  notes?: string | null;
}

export interface MarkPaidInput {
  paidDate?: string;
  paymentMethod?: 'ideal_mollie' | 'bank_transfer_abn' | 'credit_card' | 'cash';
  paymentReference?: string;
  amount?: number; // Partial or full amount
  notes?: string | null;
}

export interface CustomerProjectInvoiceScheduleDto {
  projectId: string;
  projectNumber: string;
  projectName: string;
  contractValue: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  instalments: {
    invoiceId: string;
    invoiceNumber: string;
    invoiceType: InvoiceType;
    status: InvoiceStatus;
    title: string;
    percentage: number;
    amountInclVat: number;
    dueDate: string;
    paidDate?: string | null;
    downloadUrl: string;
    canPayOnline: boolean;
  }[];
}
