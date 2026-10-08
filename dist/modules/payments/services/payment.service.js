import { db } from '../../../db/index.js';
import { payments, invoices, customers } from '../../../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { PaymentError } from '../payment.types.js';
export class PaymentService {
    /**
     * Lists payments with RBAC and customer isolation
     */
    async listPayments(query, user) {
        if (user.role === 'partner') {
            throw new PaymentError('Partners are not authorized to view financial payments', 403, 'FORBIDDEN');
        }
        const limit = query.limit || 50;
        const page = query.page || 1;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (query.invoiceId) {
            conditions.push(eq(payments.invoiceId, query.invoiceId));
        }
        if (query.status) {
            conditions.push(eq(payments.status, query.status));
        }
        // Customer scoping: Customer can ONLY view payments on invoices belonging to their profile
        if (user.role === 'customer') {
            const custId = user.profileId ||
                (await db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(eq(customers.userId, user.sub))
                    .limit(1))[0]?.id;
            if (!custId) {
                return { data: [], meta: { total: 0, page, limit } };
            }
            // Filter by customer's invoices
            const custInvoices = await db
                .select({ id: invoices.id })
                .from(invoices)
                .where(eq(invoices.customerId, custId));
            const custInvoiceIds = custInvoices.map((i) => i.id);
            if (custInvoiceIds.length === 0) {
                return { data: [], meta: { total: 0, page, limit } };
            }
            conditions.push(sql `${payments.invoiceId} IN ${custInvoiceIds}`);
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [{ count }] = await db
            .select({ count: sql `count(*)::int` })
            .from(payments)
            .where(whereClause);
        const rows = await db
            .select({
            payment: payments,
            invoiceNumber: invoices.invoiceNumber,
        })
            .from(payments)
            .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
            .where(whereClause)
            .orderBy(desc(payments.paidAt), desc(payments.createdAt))
            .limit(limit)
            .offset(offset);
        const dtos = rows.map((r) => ({
            id: r.payment.id,
            paymentNumber: r.payment.paymentNumber,
            invoiceId: r.payment.invoiceId,
            invoiceNumber: r.invoiceNumber || undefined,
            amount: parseFloat(r.payment.amount || '0'),
            paymentMethod: r.payment.paymentMethod,
            paymentReference: r.payment.paymentReference,
            status: r.payment.status,
            paidAt: r.payment.paidAt ? new Date(r.payment.paidAt).toISOString() : new Date().toISOString(),
            molliePaymentId: r.payment.molliePaymentId,
            createdAt: r.payment.createdAt ? new Date(r.payment.createdAt).toISOString() : new Date().toISOString(),
        }));
        return {
            data: dtos,
            meta: {
                total: count,
                page,
                limit,
            },
        };
    }
    /**
     * Retrieves single payment detail with IDOR validation
     */
    async getById(id, user) {
        if (user.role === 'partner') {
            throw new PaymentError('Partners are not authorized to view financial payments', 403, 'FORBIDDEN');
        }
        const [row] = await db
            .select({
            payment: payments,
            invoiceNumber: invoices.invoiceNumber,
            customerId: invoices.customerId,
        })
            .from(payments)
            .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
            .where(eq(payments.id, id))
            .limit(1);
        if (!row) {
            throw new PaymentError('Payment not found', 404, 'NOT_FOUND');
        }
        if (user.role === 'customer') {
            const custId = user.profileId ||
                (await db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(eq(customers.userId, user.sub))
                    .limit(1))[0]?.id;
            if (!custId || custId !== row.customerId) {
                throw new PaymentError('You are not authorized to view this payment', 403, 'FORBIDDEN');
            }
        }
        return {
            id: row.payment.id,
            paymentNumber: row.payment.paymentNumber,
            invoiceId: row.payment.invoiceId,
            invoiceNumber: row.invoiceNumber || undefined,
            amount: parseFloat(row.payment.amount || '0'),
            paymentMethod: row.payment.paymentMethod,
            paymentReference: row.payment.paymentReference,
            status: row.payment.status,
            paidAt: row.payment.paidAt ? new Date(row.payment.paidAt).toISOString() : new Date().toISOString(),
            molliePaymentId: row.payment.molliePaymentId,
            createdAt: row.payment.createdAt ? new Date(row.payment.createdAt).toISOString() : new Date().toISOString(),
        };
    }
}
export const paymentService = new PaymentService();
