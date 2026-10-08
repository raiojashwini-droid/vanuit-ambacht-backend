import { z } from 'zod';
export const listPaymentsQuerySchema = z.object({
    invoiceId: z.string().uuid().optional(),
    status: z.enum(['pending', 'succeeded', 'failed', 'refunded']).optional(),
    limit: z.coerce.number().min(1).max(200).default(50),
    page: z.coerce.number().min(1).default(1),
});
export const mollieCheckoutSchema = z.object({
    invoiceId: z.string().uuid('Invalid invoice UUID'),
});
export const mollieWebhookBodySchema = z.object({
    id: z.string().min(1, 'Payment ID is required'),
});
