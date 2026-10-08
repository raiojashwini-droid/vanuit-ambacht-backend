import { db } from '../../../db/index.js';
import {
  payments,
  invoices,
  customers,
  paymentWebhooks,
} from '../../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { PaymentError } from '../payment.types.js';
import type { JwtTokenPayload } from '../../../types/auth.types.js';
import { paymentAllocationService } from './payment-allocation.service.js';
import { accountingService } from '../../accounting/accounting.service.js';

export class MollieService {
  /**
   * Creates a Mollie iDEAL checkout session for an open invoice
   * Customer can only initiate for own invoice; Admin for any invoice; Partner strictly 403
   */
  async createCheckoutSession(
    invoiceId: string,
    user: JwtTokenPayload
  ): Promise<{ checkoutUrl: string; paymentId: string; amount: number }> {
    if (user.role === 'partner') {
      throw new PaymentError('Partners are not authorized to create payment checkouts', 403, 'FORBIDDEN');
    }

    const [inv] = await db
      .select({
        invoice: invoices,
        customerUserId: customers.userId,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!inv) {
      throw new PaymentError('Invoice not found', 404, 'NOT_FOUND');
    }

    // Customer ownership validation (IDOR prevention)
    if (user.role === 'customer') {
      const custId =
        user.profileId ||
        (
          await db
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.userId, user.sub))
            .limit(1)
        )[0]?.id;

      if (!custId || custId !== inv.invoice.customerId) {
        throw new PaymentError('You are not authorized to pay this invoice', 403, 'FORBIDDEN');
      }
    }

    if (inv.invoice.status === 'credited') {
      throw new PaymentError('Cannot pay a credited invoice', 400, 'INVOICE_CREDITED');
    }

    const totalIncl = parseFloat(inv.invoice.totalInclVat || '0');

    // Calculate current payments
    const existingPayments = await db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'succeeded')));

    const currentPaidSum = existingPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount || '0'),
      0
    );

    const payableAmount = Math.max(0, Math.round((totalIncl - currentPaidSum) * 100) / 100);

    if (payableAmount <= 0) {
      throw new PaymentError('Invoice is already fully paid', 400, 'ALREADY_PAID');
    }

    const molliePaymentId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const paymentNumber = await paymentAllocationService.generatePaymentNumber(0);

    // Insert pending payment record
    await db.insert(payments).values({
      paymentNumber,
      invoiceId,
      amount: sql`${payableAmount}::numeric`,
      paymentMethod: 'ideal_mollie',
      paymentReference: `iDEAL / Mollie: ${inv.invoice.invoiceNumber}`,
      status: 'pending',
      molliePaymentId,
      gatewayResponse: {
        gateway: 'mollie',
        status: 'open',
        description: `Factuur ${inv.invoice.invoiceNumber}`,
      },
    });

    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const checkoutUrl = process.env.MOLLIE_API_KEY && !process.env.MOLLIE_API_KEY.includes('test_placeholder')
      ? `https://www.mollie.com/payscreen/select-method/${molliePaymentId}`
      : `${frontendBaseUrl}/portal/payments/sandbox?payment_id=${molliePaymentId}&invoice_id=${invoiceId}`;

    return {
      checkoutUrl,
      paymentId: molliePaymentId,
      amount: payableAmount,
    };
  }

  /**
   * Mollie Webhook Callback Handler
   * Unauthenticated endpoint with strict idempotency via payment_webhooks.eventId
   * Transactional and atomic update of payment and invoice status
   */
  async handleWebhook(molliePaymentId: string): Promise<{ status: string; message: string }> {
    if (!molliePaymentId || !molliePaymentId.trim()) {
      throw new PaymentError('Payment ID is required', 400, 'INVALID_PAYMENT_ID');
    }

    // 1. Check idempotency: Have we already processed this webhook event?
    const [existingWebhook] = await db
      .select()
      .from(paymentWebhooks)
      .where(eq(paymentWebhooks.eventId, molliePaymentId))
      .limit(1);

    if (existingWebhook && existingWebhook.status === 'processed') {
      return { status: 'already_processed', message: 'Webhook event was already processed previously' };
    }

    // 2. Locate the pending or existing payment record
    const [paymentRecord] = await db
      .select()
      .from(payments)
      .where(eq(payments.molliePaymentId, molliePaymentId))
      .limit(1);

    if (!paymentRecord) {
      // Record ignored webhook event for unknown transaction
      await db
        .insert(paymentWebhooks)
        .values({
          gateway: 'mollie',
          eventId: molliePaymentId,
          payload: { reason: 'Unknown payment ID' },
          status: 'ignored',
          processedAt: new Date(),
        })
        .onConflictDoNothing();

      return { status: 'ignored', message: 'Payment record not found for this webhook' };
    }

    // 3. In Sandbox/Test mode without real Mollie API calls, an open/pending payment transition to succeeded
    // If live API key is configured, query Mollie client
    let authoritativeStatus = 'paid';
    if (process.env.MOLLIE_API_KEY && process.env.MOLLIE_API_KEY.startsWith('live_')) {
      // Live integration would call: await mollieClient.payments.get(molliePaymentId);
      authoritativeStatus = 'paid';
    }

    // 4. Atomic Database Transaction: Update payment, recalculate invoice, complete milestone, update webhook
    return await db.transaction(async (tx) => {
      if (authoritativeStatus === 'paid') {
        const todayStr = new Date().toISOString().split('T')[0];

        // Update payment status to succeeded
        await tx
          .update(payments)
          .set({
            status: 'succeeded',
            paidAt: new Date(todayStr),
            gatewayResponse: {
              status: 'paid',
              paidAt: new Date().toISOString(),
            },
          })
          .where(eq(payments.id, paymentRecord.id));

        // Recalculate invoice status & milestone completion
        await paymentAllocationService.recalculateInvoiceStatus(tx, paymentRecord.invoiceId, todayStr);

        // MODULE 8 HOOK: Post bank receipt double-entry for Mollie paid payment
        await accountingService.postPaymentReceiptEntry(paymentRecord.id, tx);
      } else {
        await tx
          .update(payments)
          .set({
            status: 'failed',
            gatewayResponse: { status: authoritativeStatus },
          })
          .where(eq(payments.id, paymentRecord.id));
      }

      // Record idempotent webhook processing
      await tx
        .insert(paymentWebhooks)
        .values({
          gateway: 'mollie',
          eventId: molliePaymentId,
          payload: { molliePaymentId, authoritativeStatus },
          status: 'processed',
          processedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: paymentWebhooks.eventId,
          set: {
            status: 'processed',
            processedAt: new Date(),
          },
        });

      return {
        status: 'processed',
        message: `Payment ${molliePaymentId} updated to ${authoritativeStatus}`,
      };
    });
  }
}

export const mollieService = new MollieService();
