export type PaymentMethod = 'ideal_mollie' | 'bank_transfer_abn' | 'credit_card' | 'cash';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  invoiceId: string;
  invoiceNumber?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  status: PaymentStatus;
  paidAt: string;
  molliePaymentId: string | null;
  createdAt: string;
}

export interface PaymentAllocationDto {
  id: string;
  paymentId: string;
  bankTransactionId: string;
  allocatedAmount: number;
  allocatedAt: string;
  notes: string | null;
}

export class PaymentError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 400, code: string = 'PAYMENT_ERROR') {
    super(message);
    this.name = 'PaymentError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
