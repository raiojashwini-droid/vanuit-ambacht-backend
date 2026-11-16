import { db } from '../../db/index.js';
import { projects } from '../../db/schema.js';
import { eq, ilike, desc } from 'drizzle-orm';
import { invoiceService, InvoiceError } from './invoice.service.js';
import { invoicePdfService } from './invoice-pdf.service.js';
import { invoiceIdParamSchema, projectInvoicesParamSchema, invoiceQuerySchema, createInvoiceSchema, updateInvoiceSchema, markPaidSchema, creditNoteSchema, } from './invoice.schema.js';
export const invoiceRoutes = async (fastify) => {
    /**
     * GET /api/invoices/summary
     * Aggregated financial KPI metrics for Admin Dashboard / Invoices header
     */
    fastify.get('/summary', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        try {
            const summary = await invoiceService.getSummary(request.user);
            return reply.send({ success: true, data: summary });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * GET /api/invoices
     * List all invoices with filters and search (Admin only, Partner blocked)
     */
    fastify.get('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const queryCheck = invoiceQuerySchema.safeParse(request.query);
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
            const result = await invoiceService.list(queryCheck.data, request.user);
            return reply.send({
                success: true,
                data: result.data,
                pagination: {
                    total: result.total,
                    page: result.page,
                    limit: result.limit,
                    totalPages: result.totalPages,
                },
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/invoices
     * Create new custom invoice (Admin only)
     */
    fastify.post('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const rawBody = request.body || {};
        // 1. Auto-resolve projectId if missing
        if (!rawBody.projectId) {
            if (rawBody.customerId) {
                const [found] = await db
                    .select({ id: projects.id, customerId: projects.customerId })
                    .from(projects)
                    .where(eq(projects.customerId, rawBody.customerId))
                    .limit(1);
                if (found) {
                    rawBody.projectId = found.id;
                }
            }
            if (!rawBody.projectId && rawBody.customerName) {
                const [found] = await db
                    .select({ id: projects.id, customerId: projects.customerId })
                    .from(projects)
                    .where(ilike(projects.name, `%${rawBody.customerName}%`))
                    .limit(1);
                if (found) {
                    rawBody.projectId = found.id;
                    if (!rawBody.customerId)
                        rawBody.customerId = found.customerId;
                }
            }
            if (!rawBody.projectId) {
                const [anyProject] = await db
                    .select({ id: projects.id, customerId: projects.customerId })
                    .from(projects)
                    .orderBy(desc(projects.createdAt))
                    .limit(1);
                if (anyProject) {
                    rawBody.projectId = anyProject.id;
                    if (!rawBody.customerId)
                        rawBody.customerId = anyProject.customerId;
                }
            }
        }
        // 2. Normalize items
        if (Array.isArray(rawBody.items) && rawBody.items.length > 0) {
            rawBody.items = rawBody.items.map((it, idx) => {
                const pos = it.position || idx + 1;
                const isInc = it.isIncluded === true || String(it.price).toLowerCase().includes('inbegrepen');
                let num = typeof it.unitPriceInclVat === 'number'
                    ? it.unitPriceInclVat
                    : (typeof it.unitPriceExclVat === 'number'
                        ? it.unitPriceExclVat * 1.21
                        : (typeof it.price === 'number'
                            ? it.price
                            : parseFloat(String(it.price || '').replace(/[^\d.-]/g, '')) || 0));
                if (isInc)
                    num = 0;
                return {
                    position: pos,
                    description: it.description || 'Factuurregel',
                    subtext: it.subtext || null,
                    quantity: typeof it.quantity === 'number' ? it.quantity : (parseFloat(it.quantity) || 1),
                    unitPriceInclVat: num,
                    unitPriceExclVat: it.unitPriceExclVat !== undefined ? it.unitPriceExclVat : Math.round((num / 1.21) * 100) / 100,
                    vatRate: it.vatRate !== undefined ? it.vatRate : 21.00,
                    isIncluded: isInc,
                };
            });
        }
        else {
            const total = typeof rawBody.totalAmount === 'number'
                ? rawBody.totalAmount
                : parseFloat(String(rawBody.totalAmount || '').replace(/[^\d.-]/g, '')) || 1000;
            rawBody.items = [
                {
                    position: 1,
                    description: rawBody.notes || `Factuur ${rawBody.customerName || 'Klant'}`,
                    subtext: null,
                    quantity: 1,
                    unitPriceInclVat: total,
                    unitPriceExclVat: Math.round((total / 1.21) * 100) / 100,
                    vatRate: 21.00,
                    isIncluded: false,
                },
            ];
        }
        // 3. Normalize invoiceType
        if (rawBody.invoiceType) {
            const t = String(rawBody.invoiceType).toLowerCase();
            if (t.includes('aanbetaling') || t.includes('down_payment'))
                rawBody.invoiceType = 'down_payment_upfront';
            else if (t.includes('eindfactuur') || t.includes('completion'))
                rawBody.invoiceType = 'final_completion';
            else if (t.includes('termijn') || t.includes('interim'))
                rawBody.invoiceType = 'interim_progress';
            else
                rawBody.invoiceType = 'full_amount';
        }
        // 4. Normalize status
        if (rawBody.status) {
            const s = String(rawBody.status).toLowerCase();
            if (s.includes('betaald') || s.includes('paid'))
                rawBody.status = 'paid';
            else if (s.includes('open') || s.includes('verzonden') || s.includes('sent'))
                rawBody.status = 'sent';
            else
                rawBody.status = 'draft';
        }
        const bodyCheck = createInvoiceSchema.safeParse(rawBody);
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
            const created = await invoiceService.create(bodyCheck.data, request.user);
            return reply.status(201).send({
                success: true,
                data: created,
                message: `Factuur ${created.invoiceNumber} succesvol aangemaakt!`,
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * GET /api/invoices/:id
     * Get single invoice detail with line items & payment history
     * Admin and Customer (own invoice) allowed. Partner strictly 403.
     */
    fastify.get('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        try {
            const invoice = await invoiceService.getById(paramCheck.data.id, request.user);
            return reply.send({ success: true, data: invoice });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/invoices/:id
     * Update invoice (Draft status only, Admin only)
     */
    fastify.patch('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        const bodyCheck = updateInvoiceSchema.safeParse(request.body);
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
            const updated = await invoiceService.update(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({
                success: true,
                data: updated,
                message: `Factuur ${updated.invoiceNumber} succesvol bijgewerkt!`,
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * DELETE /api/invoices/:id
     * Delete draft invoice (Draft status only, Admin only)
     */
    fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        try {
            const result = await invoiceService.delete(paramCheck.data.id, request.user);
            return reply.send({ success: true, message: result.message });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/invoices/:id/send
     * Mark invoice as sent & lock content (Admin only)
     */
    fastify.post('/:id/send', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        try {
            const sent = await invoiceService.sendInvoice(paramCheck.data.id, request.user);
            return reply.send({
                success: true,
                data: sent,
                message: `Factuur ${sent.invoiceNumber} gemarkeerd als verzonden!`,
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/invoices/:id/mark-paid
     * Record manual bank payment & mark invoice as paid (Admin only)
     */
    fastify.post('/:id/mark-paid', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        const bodyCheck = markPaidSchema.safeParse(request.body || {});
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
            const paid = await invoiceService.markAsPaid(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({
                success: true,
                data: paid,
                message: `Factuur ${paid.invoiceNumber} succesvol gemarkeerd als betaald!`,
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/invoices/:id/credit-note
     * Issue official Credit Note (CR-YYYY-XXX) (Admin only)
     */
    fastify.post('/:id/credit-note', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        const bodyCheck = creditNoteSchema.safeParse(request.body);
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
            const result = await invoiceService.createCreditNote(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.status(201).send({
                success: true,
                data: result,
                message: `Creditfactuur ${result.creditNote.invoiceNumber} succesvol aangemaakt!`,
            });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * GET /api/invoices/:id/pdf
     * Generate and stream official Dutch Factuur PDF
     * Admin and Customer (own invoice) allowed. Partner strictly 403.
     */
    fastify.get('/:id/pdf', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const paramCheck = invoiceIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid invoice UUID' },
            });
        }
        try {
            // First ensure user has authorization to view this invoice
            const inv = await invoiceService.getById(paramCheck.data.id, request.user);
            const pdfBuffer = await invoicePdfService.generateFactuurPdf(inv.id);
            return reply
                .header('Content-Type', 'application/pdf')
                .header('Content-Disposition', `attachment; filename="${inv.invoiceNumber}_Factuur_VanuitAmbacht.pdf"`)
                .send(pdfBuffer);
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
};
/**
 * Customer portal project invoice schedule routes
 * Mounted under /api/customer/projects
 */
export const customerInvoiceScheduleRoutes = async (fastify) => {
    /**
     * GET /api/customer/projects/:id/invoices
     * Get project instalment schedule for Customer portal
     */
    fastify.get('/:id/invoices', { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] }, async (request, reply) => {
        const paramCheck = projectInvoicesParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        try {
            const schedule = await invoiceService.getCustomerProjectInvoices(paramCheck.data.id, request.user);
            return reply.send({ success: true, data: schedule });
        }
        catch (err) {
            if (err instanceof InvoiceError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
};
