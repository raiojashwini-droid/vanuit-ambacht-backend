import { bankService } from './services/bank.service.js';
import { bankStatementService } from './services/bank-statement.service.js';
import { paymentAllocationService } from '../payments/services/payment-allocation.service.js';
import { bankTxIdParamSchema, listBankTxQuerySchema, createManualBankTxSchema, reclassifyCategorySchema, bolSpecificationSchema, allocateBankTxSchema, importStatementSchema, } from './bank.schema.js';
import { PaymentError } from '../payments/payment.types.js';
export const bankRoutes = async (fastify) => {
    // All bank routes require Admin role. Customers and Partners strictly 403.
    const adminGuard = { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] };
    /**
     * GET /api/bank/transactions
     * List bank transactions with status, category, date, and text search filters
     */
    fastify.get('/transactions', adminGuard, async (request, reply) => {
        const queryCheck = listBankTxQuerySchema.safeParse(request.query);
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
            const result = await bankService.listTransactions(queryCheck.data, request.user);
            return reply.send({ success: true, ...result });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * GET /api/bank/transactions/:id
     * Get single bank transaction dossier with full allocation history
     */
    fastify.get('/transactions/:id', adminGuard, async (request, reply) => {
        const paramCheck = bankTxIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid bank transaction UUID' },
            });
        }
        try {
            const data = await bankService.getById(paramCheck.data.id, request.user);
            return reply.send({ success: true, data });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/bank/transactions
     * Create a manual bank transaction entry
     */
    fastify.post('/transactions', adminGuard, async (request, reply) => {
        const bodyCheck = createManualBankTxSchema.safeParse(request.body);
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
            const created = await bankService.createManualTransaction(bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/bank/transactions/:id/category
     * Reclassify category & review status
     */
    fastify.patch('/transactions/:id/category', adminGuard, async (request, reply) => {
        const paramCheck = bankTxIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid bank transaction UUID' },
            });
        }
        const bodyCheck = reclassifyCategorySchema.safeParse(request.body);
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
            const updated = await bankService.reclassifyCategory(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/bank/statements/import
     * Ingest MT940, CAMT.053 XML, or ABN text statement file
     */
    fastify.post('/statements/import', adminGuard, async (request, reply) => {
        const bodyCheck = importStatementSchema.safeParse(request.body);
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
            const result = await bankStatementService.importStatement(bodyCheck.data, request.user);
            return reply.status(201).send({
                success: true,
                data: result,
                message: `Statement ${result.statementIdentifier} imported successfully with ${result.totalTransactions} transactions (${result.autoMatchedCount} auto-matched)!`,
            });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/bank/transactions/:id/allocate
     * Allocate bank transaction to one or more invoices (Atomic)
     */
    fastify.post('/transactions/:id/allocate', adminGuard, async (request, reply) => {
        const paramCheck = bankTxIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid bank transaction UUID' },
            });
        }
        const bodyCheck = allocateBankTxSchema.safeParse(request.body);
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
            const result = await paymentAllocationService.allocate(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.status(201).send({
                success: true,
                data: result,
                message: `Successfully allocated €${result.totalAllocated} across ${result.allocatedCount} invoice(s)!`,
            });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/bank/transactions/:id/unallocate
     * Revert all allocations on a bank transaction (Atomic)
     */
    fastify.post('/transactions/:id/unallocate', adminGuard, async (request, reply) => {
        const paramCheck = bankTxIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid bank transaction UUID' },
            });
        }
        try {
            const result = await paymentAllocationService.unallocate(paramCheck.data.id, request.user);
            return reply.send({ success: true, data: result });
        }
        catch (err) {
            if (err instanceof PaymentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/bank/transactions/:id/bol-spec
     * Attach Bol.com settlement breakdown (Gross - Fee = Net)
     */
    fastify.post('/transactions/:id/bol-spec', adminGuard, async (request, reply) => {
        const paramCheck = bankTxIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid bank transaction UUID' },
            });
        }
        const bodyCheck = bolSpecificationSchema.safeParse(request.body);
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
            const updated = await bankService.setBolSpecification(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({
                success: true,
                data: updated,
                message: 'Bol.com specification saved successfully!',
            });
        }
        catch (err) {
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
