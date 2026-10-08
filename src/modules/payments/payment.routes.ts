import type { FastifyPluginAsync } from 'fastify';
import { paymentService } from './services/payment.service.js';
import { mollieService } from './services/mollie.service.js';
import {
  listPaymentsQuerySchema,
  mollieCheckoutSchema,
  mollieWebhookBodySchema,
} from './payment.schema.js';
import { PaymentError } from './payment.types.js';

export const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/payments
   * List payments history (Admin all, Customer own invoices only, Partner strictly 403)
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] },
    async (request, reply) => {
      const queryCheck = listPaymentsQuerySchema.safeParse(request.query);
      if (!queryCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: queryCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const result = await paymentService.listPayments(queryCheck.data, request.user);
        return reply.send({ success: true, ...result });
      } catch (err: any) {
        if (err instanceof PaymentError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/payments/mollie/checkout
   * Initiate Mollie iDEAL checkout session for an open invoice
   * Admin or Customer (owning invoice). Partner strictly 403.
   */
  fastify.post(
    '/mollie/checkout',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] },
    async (request, reply) => {
      const bodyCheck = mollieCheckoutSchema.safeParse(request.body);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const result = await mollieService.createCheckoutSession(
          bodyCheck.data.invoiceId,
          request.user
        );
        return reply.status(201).send({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof PaymentError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/payments/mollie/webhook
   * Unauthenticated webhook callback from Mollie payment gateway
   * Idempotent and transactional processing
   */
  fastify.post('/mollie/webhook', async (request, reply) => {
    let paymentId: string | undefined;

    // Support both application/json and application/x-www-form-urlencoded
    const body = request.body as any;
    if (typeof body === 'object' && body !== null) {
      paymentId = body.id;
    } else if (typeof body === 'string') {
      const parsed = new URLSearchParams(body);
      paymentId = parsed.get('id') || undefined;
    }

    if (!paymentId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PAYMENT_ID', message: 'Mollie payment id parameter is required' },
      });
    }

    try {
      const result = await mollieService.handleWebhook(paymentId);
      return reply.send({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof PaymentError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  });
};
